import type {
  CompanyInput,
  CompanyProfile,
  SourceError,
  SourceExecutionResult,
  SourceName,
  StreamEvent,
} from "@/lib/types";
import type { LLMInvocationContext } from "@/adapters/llm/types";
import type { SearchAdapter } from "@/adapters/search/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";
import type { RegistryAdapter } from "@/adapters/registry/types";
import type { ResourceGuards } from "@/config";
import type { ProfileModule } from "@/modules/profile";
import type { AnalystModule } from "@/modules/analyst";
import { prepareEvidence } from "@/modules/research/evidence";
import {
  createResearchBudget,
  ResearchQueryBudgetExceededError,
  type ResearchBudget,
} from "@/modules/research/budget";
import {
  createResearchSourceRunners,
  type ResearchSourceRunner,
} from "@/modules/research";
import type { CrawlPolicy } from "@/modules/research/crawl-policy";
import {
  observeResearchStep,
  updateResearchObservationOutcome,
} from "@/observability/langfuse";
import type { ResearchWorkflowState } from "./state";

const SOURCE_NAMES: SourceName[] = [
  "web_search",
  "website",
  "news",
  "registry",
  "linkedin",
];
const SOURCE_EXECUTION_ORDER: SourceName[] = [
  "web_search",
  "news",
  "website",
  "registry",
  "linkedin",
];

const MAX_RETRY_DELAY_MS = 30_000;

export function retryDelayMs(
  attempt: number,
  baseDelayMs = 1_000,
  jitterRatio = 0.2,
): number {
  const exponential = Math.min(MAX_RETRY_DELAY_MS, baseDelayMs * 2 ** (attempt - 1));
  const jitter = exponential * jitterRatio * Math.random();
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(exponential + jitter));
}

export function getRetryAfterMs(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

type EventEmitter = (event: StreamEvent) => void | Promise<void>;

export interface ResearchWorkflowOptions {
  researchRunId: string;
  companyId?: string;
  existingProfile?: CompanyProfile | null;
  signal?: AbortSignal;
  sessionId?: string;
  onComplete?: (state: ResearchWorkflowState) => void | Promise<void>;
}

export interface ResearchWorkflowDeps {
  search: SearchAdapter;
  scraper: ScraperAdapter;
  registry: RegistryAdapter;
  profile: ProfileModule;
  analyst: AnalystModule;
  guards: ResourceGuards;
  crawlPolicy?: CrawlPolicy;
}

export interface ResearchWorkflow {
  stream(
    input: CompanyInput,
    options: ResearchWorkflowOptions,
  ): AsyncGenerator<StreamEvent, void, unknown>;
  run(
    input: CompanyInput,
    options: ResearchWorkflowOptions,
  ): Promise<ResearchWorkflowState>;
}

export function createResearchWorkflow(
  deps: ResearchWorkflowDeps,
): ResearchWorkflow {
  const runners = createResearchSourceRunners({
    search: deps.search,
    scraper: deps.scraper,
    registry: deps.registry,
    guards: deps.guards,
    crawlPolicy: deps.crawlPolicy,
  });

  return {
    run: (input, options) =>
      executeWorkflow(input, options, deps, runners, () => undefined),

    async *stream(input, options) {
      const activeSources = SOURCE_NAMES.filter(
        (source) => source !== "linkedin" || Boolean(input.linkedinUrl),
      );
      yield {
        event: "research:start",
        data: { sources: activeSources },
      };

      const queue = new AsyncEventQueue<StreamEvent>();
      const execution = executeWorkflow(
        input,
        options,
        deps,
        runners,
        (event) => queue.push(event),
      );
      void execution.then(
        () => queue.close(),
        (error) => queue.fail(error),
      );

      for await (const event of queue) {
        yield event;
      }
      await execution;
    },
  };
}

async function executeWorkflow(
  input: CompanyInput,
  options: ResearchWorkflowOptions,
  deps: ResearchWorkflowDeps,
  runners: Record<SourceName, ResearchSourceRunner>,
  emit: EventEmitter,
): Promise<ResearchWorkflowState> {
  const budget = createResearchBudget({
    maxLLMCalls: deps.guards.maxLLMCallsPerResearch,
    maxTokens: deps.guards.maxTokensPerResearch,
    maxQueries: deps.guards.maxQueriesPerResearch,
    maxConcurrentProviderCalls: deps.guards.maxConcurrentProviderCalls,
  });
  const state = createInitialState(input, options);
  const llmContext: LLMInvocationContext = {
    signal: options.signal,
    budget,
  };

  const sourceTasks = SOURCE_EXECUTION_ORDER.map((source) => async () => {
    if (source === "linkedin" && !input.linkedinUrl) {
      return skippedSource(source);
    }

    return observeResearchStep(`source.${source}`, async () => {
      const result = await executeSourceRunner(
        source,
        runners[source],
        input,
        budget,
        deps.guards,
        emit,
        options.signal,
      );
      if (result.status === "failed") {
        updateResearchObservationOutcome("failed");
      }
      return result;
    });
  });

  const settledSources = await settleWithConcurrency(
    sourceTasks,
    deps.guards.maxConcurrentSourceNodes,
  );
  state.sourceResults = settledSources.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : failedSource(SOURCE_EXECUTION_ORDER[index], result.reason),
  ).sort(
    (left, right) => SOURCE_NAMES.indexOf(left.source) - SOURCE_NAMES.indexOf(right.source),
  );

  throwIfAborted(options.signal);

  await observeResearchStep("evidence.prepare", async () => {
    const prepared = prepareEvidence(state.sourceResults);
    state.findings = prepared.findings;
    state.outcome = prepared.outcome;

    if (state.findings.length === 0) {
      const errorDetails = state.sourceResults
        .filter((result) => result.error)
        .map((result) => `${result.source}: ${result.error?.message}`);
      const details = errorDetails.length > 0
        ? ` Chi tiết: ${errorDetails.join(" | ")}`
        : "";
      state.fatalError = `Không tìm thấy thông tin nào về công ty này.${details}`;
      state.outcome = "failed";
      updateResearchObservationOutcome("failed");
      await emit({
        event: "error",
        data: { message: state.fatalError },
      });
    }
  });

  if (!state.fatalError) {
    await buildProfile(state, options, deps, llmContext, emit);
  }
  if (!state.fatalError && state.profile) {
    await buildDiff(state, deps, emit);
  }
  if (!state.fatalError && state.profile) {
    await analyzeProfile(state, deps, llmContext, emit);
  }

  throwIfAborted(options.signal);
  await options.onComplete?.(state);
  return state;
}

async function buildProfile(
  state: ResearchWorkflowState,
  options: ResearchWorkflowOptions,
  deps: ResearchWorkflowDeps,
  llmContext: LLMInvocationContext,
  emit: EventEmitter,
): Promise<void> {
  await observeResearchStep("profile.build", async () => {
    await emit({
      event: "profile:building",
      data: { message: "Đang tổng hợp hồ sơ công ty..." },
    });
    const targetCompanyId =
      options.companyId || state.existingProfile?.id || options.researchRunId;

    try {
      state.profile = await deps.profile.buildProfile(
        state.findings,
        state.input,
        targetCompanyId,
        state.existingProfile?.version,
        llmContext,
      );
    } catch (error) {
      state.fatalError = error instanceof Error
        ? error.message
        : "Failed to build profile";
      state.outcome = "failed";
      updateResearchObservationOutcome("failed");
      await emit({ event: "error", data: { message: state.fatalError } });
    }
  });
}

async function buildDiff(
  state: ResearchWorkflowState,
  deps: ResearchWorkflowDeps,
  emit: EventEmitter,
): Promise<void> {
  await observeResearchStep("profile.diff", async () => {
    if (!state.existingProfile || !state.profile) {
      state.diff = null;
      return;
    }

    try {
      state.diff = deps.profile.diffProfiles(state.profile, state.existingProfile);
    } catch (error) {
      state.fatalError = error instanceof Error
        ? error.message
        : "Failed to build profile diff";
      state.outcome = "failed";
      updateResearchObservationOutcome("failed");
      await emit({ event: "error", data: { message: state.fatalError } });
    }
  });
}

async function analyzeProfile(
  state: ResearchWorkflowState,
  deps: ResearchWorkflowDeps,
  llmContext: LLMInvocationContext,
  emit: EventEmitter,
): Promise<void> {
  await observeResearchStep("analyst.analyze", async () => {
    if (!state.profile) return;

    try {
      state.report = await deps.analyst.analyze(
        state.profile,
        { previousProfile: state.existingProfile ?? undefined },
        llmContext,
      );
    } catch (error) {
      state.outcome = "partial";
      updateResearchObservationOutcome("partial");
      await emit({
        event: "error",
        data: {
          message: error instanceof Error
            ? error.message
            : "Không thể phân tích hồ sơ.",
        },
      });
    }
  });
}

function createInitialState(
  input: CompanyInput,
  options: ResearchWorkflowOptions,
): ResearchWorkflowState {
  return {
    researchRunId: options.researchRunId,
    input,
    sourceResults: [],
    findings: [],
    existingProfile: options.existingProfile ?? null,
    profile: null,
    diff: null,
    report: null,
    outcome: "running",
    fatalError: null,
  };
}

async function executeSourceRunner(
  source: SourceName,
  runner: ResearchSourceRunner,
  input: CompanyInput,
  budget: ResearchBudget,
  guards: ResourceGuards,
  emit: EventEmitter,
  signal?: AbortSignal,
): Promise<SourceExecutionResult> {
  const startTime = Date.now();
  if (signal?.aborted) return failedSource(source, signal.reason, 1, 0);

  await emit({
    event: "research:progress",
    data: { source, status: "started" },
  });

  let attempts = 0;
  const maxRetries = guards.maxRetriesPerSource ?? 2;
  let lastError: SourceError | undefined;

  while (attempts <= maxRetries) {
    attempts += 1;
    const timeoutSignal = AbortSignal.timeout(guards.sourceTimeoutMs);
    const attemptSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    try {
      throwIfAborted(signal);
      const findings = await runWithAbortSignal(
        runner(input, { budget, signal: attemptSignal }),
        attemptSignal,
      );

      for (const finding of findings) {
        await emit({
          event: "research:finding",
          data: {
            source: finding.source,
            summary: finding.content.slice(0, 200),
            url: finding.url,
          },
        });
      }
      await emit({
        event: "research:progress",
        data: { source, status: "done" },
      });

      return {
        source,
        status: "succeeded",
        findings,
        attempts,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof ResearchQueryBudgetExceededError) {
        await emit({
          event: "research:progress",
          data: { source, status: "done" },
        });
        return skippedSource(source, attempts, Date.now() - startTime);
      }

      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = timeoutSignal.aborted && !signal?.aborted;
      const retryable =
        isRetryableSourceError(error, isTimeout, signal) &&
        attempts <= maxRetries;
      lastError = {
        source,
        type: isTimeout ? "timeout" : "network_error",
        message,
        retryable,
      };
      if (!retryable || attempts > maxRetries) break;

      const retryAfterMs = getRetryAfterMs(
        getRetryAfterHeader(error),
      );
      await delayWithAbort(
        retryAfterMs ?? retryDelayMs(attempts),
        signal,
      );
    }
  }

  await emit({
    event: "error",
    data: { message: lastError?.message ?? "Source execution failed", source },
  });
  await emit({
    event: "research:progress",
    data: { source, status: "failed" },
  });

  return {
    source,
    status: "failed",
    findings: [],
    error: lastError,
    attempts,
    durationMs: Date.now() - startTime,
  };
}

export async function settleWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return [];

  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let nextIndex = 0;
  const workerCount = Math.min(tasks.length, Math.max(1, concurrency));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });

  await Promise.allSettled(workers);
  return results;
}

function skippedSource(
  source: SourceName,
  attempts = 0,
  durationMs = 0,
): SourceExecutionResult {
  return {
    source,
    status: "skipped",
    findings: [],
    attempts,
    durationMs,
  };
}

function failedSource(
  source: SourceName,
  error: unknown,
  attempts = 1,
  durationMs = 0,
): SourceExecutionResult {
  return {
    source,
    status: "failed",
    findings: [],
    error: {
      source,
      type: "network_error",
      message: error instanceof Error ? error.message : "Execution aborted",
      retryable: false,
    },
    attempts,
    durationMs,
  };
}

function getRetryAfterHeader(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const headers = (error as { headers?: Headers | Record<string, string> }).headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get("retry-after") ?? undefined;
  return headers["retry-after"] ?? headers["Retry-After"];
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Execution aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryableSourceError(
  error: unknown,
  isTimeout: boolean,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted) return false;
  if (isTimeout) return true;
  if (
    error &&
    typeof error === "object" &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
  ) {
    return error.retryable;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    /(?:failed:|status(?: code)?|upstream error:)\s*(?:429|5\d{2})\b/i.test(message) ||
    /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b/i.test(message)
  );
}

function runWithAbortSignal<T>(
  task: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(
      signal.reason ?? new DOMException("Execution aborted", "AbortError"),
    );
    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("Execution aborted", "AbortError");
}

type QueueItem<T> =
  | { type: "value"; value: T }
  | { type: "done" }
  | { type: "error"; error: unknown };

class AsyncEventQueue<T> implements AsyncIterableIterator<T> {
  private readonly items: QueueItem<T>[] = [];
  private readonly waiters: Array<(item: QueueItem<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    this.enqueue({ type: "value", value });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.enqueue({ type: "done" });
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.enqueue({ type: "error", error });
  }

  async next(): Promise<IteratorResult<T>> {
    const item = this.items.shift() ?? await new Promise<QueueItem<T>>(
      (resolve) => this.waiters.push(resolve),
    );
    if (item.type === "error") throw item.error;
    if (item.type === "done") return { done: true, value: undefined };
    return { done: false, value: item.value };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }

  private enqueue(item: QueueItem<T>): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }
}
