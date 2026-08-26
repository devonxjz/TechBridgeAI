// ═══════════════════════════════════════════════════════
// PartnerIQ Research Workflow (LangGraph StateGraph)
// Bounded parallel execution: 5 static source nodes fan-out,
// fan-in to deterministic evidence preparation, downstream profile/diff/analyst.
// ═══════════════════════════════════════════════════════

import { END, START, StateGraph } from "@langchain/langgraph";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { Callbacks } from "@langchain/core/callbacks/manager";
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
import { createResearchSourceRunners, type ResearchSourceRunner } from "@/modules/research";
import {
  observeResearchStep,
  updateResearchObservationOutcome,
} from "@/observability/langfuse";
import {
  ResearchWorkflowAnnotation,
  type ResearchWorkflowState,
} from "./state";

const SSE_EVENT_NAME = "sse_event";

export interface ResearchWorkflowOptions {
  researchRunId: string;
  companyId?: string;
  existingProfile?: CompanyProfile | null;
  signal?: AbortSignal;
  callbacks?: readonly unknown[];
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
}

export interface ResearchWorkflow {
  stream(
    input: CompanyInput,
    options: ResearchWorkflowOptions
  ): AsyncGenerator<StreamEvent, void, unknown>;
  run(
    input: CompanyInput,
    options: ResearchWorkflowOptions
  ): Promise<ResearchWorkflowState>;
}

export function createResearchWorkflow(deps: ResearchWorkflowDeps): ResearchWorkflow {
  const runners = createResearchSourceRunners({
    search: deps.search,
    scraper: deps.scraper,
    registry: deps.registry,
    guards: deps.guards,
  });

  return {
    async run(input, options) {
      return await executeGraph(input, options, deps, runners);
    },

    async *stream(input, options) {
      const activeSources: SourceName[] = ["web_search", "website", "news", "registry"];
      if (input.linkedinUrl) {
        activeSources.push("linkedin");
      }

      yield {
        event: "research:start",
        data: { sources: activeSources },
      } as StreamEvent;

      const app = compileResearchGraph(deps, runners, options);

      const eventStream = app.streamEvents(
        createInitialState(input, options),
        {
          version: "v2",
          signal: options.signal,
          callbacks: options.callbacks as Callbacks,
          maxConcurrency: deps.guards.maxConcurrentSourceNodes,
        }
      );

      let fatalErrorEncountered: string | null = null;
      let hasFindings = false;
      let finalState: ResearchWorkflowState | null = null;

      for await (const event of eventStream) {
        if (event.event === "on_chain_end") {
          const output = (event.data as { output?: unknown }).output;
          if (isResearchWorkflowState(output)) {
            finalState = output;
          }
        }
        if (event.event === "on_custom_event" && event.name === SSE_EVENT_NAME) {
          const sse = event.data as StreamEvent;
          if (sse.event === "research:finding") {
            hasFindings = true;
          }
          if (sse.event === "error" && !sse.data.source) {
            fatalErrorEncountered = sse.data.message;
          }
          yield sse;
        }
      }

      if (finalState) {
        await options.onComplete?.(finalState);
      }

      if (!hasFindings && !fatalErrorEncountered) {
        yield {
          event: "error",
          data: { message: "Không tìm thấy thông tin nào về công ty này." },
        } as StreamEvent;
      }
    },
  };
}

async function executeGraph(
  input: CompanyInput,
  options: ResearchWorkflowOptions,
  deps: ResearchWorkflowDeps,
  runners: Record<SourceName, ResearchSourceRunner>
): Promise<ResearchWorkflowState> {
  const app = compileResearchGraph(deps, runners, options);

  return (await app.invoke(
    createInitialState(input, options),
    {
      signal: options.signal,
      callbacks: options.callbacks as Callbacks,
      maxConcurrency: deps.guards.maxConcurrentSourceNodes,
    }
  )) as ResearchWorkflowState;
}

function compileResearchGraph(
  deps: ResearchWorkflowDeps,
  runners: Record<SourceName, ResearchSourceRunner>,
  options: ResearchWorkflowOptions,
) {
  const budget = createResearchBudget({
    maxLLMCalls: deps.guards.maxLLMCallsPerResearch,
    maxTokens: deps.guards.maxTokensPerResearch,
    maxQueries: deps.guards.maxQueriesPerResearch,
    maxConcurrentProviderCalls: deps.guards.maxConcurrentProviderCalls,
  });
  return buildGraph(deps, runners, budget, options).compile();
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

function buildGraph(
  deps: ResearchWorkflowDeps,
  runners: Record<SourceName, ResearchSourceRunner>,
  budget: ResearchBudget,
  options: ResearchWorkflowOptions,
) {
  const { signal } = options;
  const llmContext: LLMInvocationContext = {
    signal,
    callbacks: options.callbacks,
    budget,
  };
  // Source Nodes
  const createSourceNode = (source: SourceName) => {
    return async (state: typeof ResearchWorkflowAnnotation.State) =>
      observeResearchStep(`source.${source}`, async () => {
        if (source === "linkedin" && !state.input.linkedinUrl) {
          return {
            sourceResults: [
              {
                source: "linkedin" as SourceName,
                status: "skipped" as const,
                findings: [],
                attempts: 0,
                durationMs: 0,
              },
            ],
          };
        }

        const runner = runners[source];
        const result = await executeSourceRunner(
          source,
          runner,
          state.input,
          budget,
          deps.guards,
          signal,
        );
        if (result.status === "failed") {
          updateResearchObservationOutcome("failed");
        }
        return {
          sourceResults: [result],
        };
      });
  };

  const tracedNode = <T,>(
    name: string,
    node: (state: typeof ResearchWorkflowAnnotation.State) => Promise<T>,
  ) =>
    (state: typeof ResearchWorkflowAnnotation.State) =>
      observeResearchStep(name, async () => {
        const result = await node(state);
        if (result && typeof result === "object") {
          const update = result as { fatalError?: unknown; outcome?: unknown };
          if (update.fatalError || update.outcome === "failed") {
            updateResearchObservationOutcome("failed");
          } else if (update.outcome === "partial") {
            updateResearchObservationOutcome("partial");
          }
        }
        return result;
      });

  return new StateGraph(ResearchWorkflowAnnotation)
    .addNode("web_search", createSourceNode("web_search"))
    .addNode("website", createSourceNode("website"))
    .addNode("news", createSourceNode("news"))
    .addNode("registry", createSourceNode("registry"))
    .addNode("linkedin", createSourceNode("linkedin"))
    .addNode("prepare_evidence", tracedNode("evidence.prepare", async (state) => {
      const prepared = prepareEvidence(state.sourceResults);
      if (prepared.findings.length === 0) {
        const errorDetails = state.sourceResults
          .filter((r) => r.error)
          .map((r) => `${r.source}: ${r.error?.message}`);
        const detailStr =
          errorDetails.length > 0 ? ` Chi tiết: ${errorDetails.join(" | ")}` : "";
        const message = `Không tìm thấy thông tin nào về công ty này.${detailStr}`;

        await dispatchCustomEvent(SSE_EVENT_NAME, {
          event: "error",
          data: { message },
        } as StreamEvent);
        return {
          findings: [],
          outcome: "failed" as const,
          fatalError: message,
        };
      }

      return {
        findings: prepared.findings,
        outcome: prepared.outcome,
      };
    }))
    .addNode("build_profile", tracedNode("profile.build", async (state) => {
      if (state.fatalError || state.findings.length === 0) return {};

      await dispatchCustomEvent(SSE_EVENT_NAME, {
        event: "profile:building",
        data: { message: "Đang tổng hợp hồ sơ công ty..." },
      } as StreamEvent);

      const targetCompanyId =
        options.companyId || state.existingProfile?.id || options.researchRunId;
      try {
        const profile = await deps.profile.buildProfile(
          state.findings,
          state.input,
          targetCompanyId,
          state.existingProfile?.version,
          llmContext,
        );

        return { profile };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to build profile";
        await dispatchCustomEvent(SSE_EVENT_NAME, {
          event: "error",
          data: { message },
        } as StreamEvent);
        return { fatalError: message, outcome: "failed" as const };
      }
    }))
    .addNode("build_diff", tracedNode("profile.diff", async (state) => {
      if (state.fatalError || !state.profile) return {};

      if (state.existingProfile) {
        try {
          const diff = deps.profile.diffProfiles(state.profile, state.existingProfile);
          return { diff };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to build profile diff";
          await dispatchCustomEvent(SSE_EVENT_NAME, {
            event: "error",
            data: { message },
          } as StreamEvent);
          return { fatalError: message, outcome: "failed" as const };
        }
      } else {
        return { diff: null };
      }
    }))
    .addNode("analyze", tracedNode("analyst.analyze", async (state) => {
      if (state.fatalError || !state.profile) return {};

      try {
        const report = await deps.analyst.analyze(
          state.profile,
          { previousProfile: state.existingProfile ?? undefined },
          llmContext,
        );

        return { report };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Không thể phân tích hồ sơ.";
        await dispatchCustomEvent(SSE_EVENT_NAME, {
          event: "error",
          data: { message },
        } as StreamEvent);
        return { outcome: "partial" as const };
      }
    }))
    .addEdge(START, "web_search")
    .addEdge(START, "website")
    .addEdge(START, "news")
    .addEdge(START, "registry")
    .addEdge(START, "linkedin")
    .addEdge("web_search", "prepare_evidence")
    .addEdge("website", "prepare_evidence")
    .addEdge("news", "prepare_evidence")
    .addEdge("registry", "prepare_evidence")
    .addEdge("linkedin", "prepare_evidence")
    .addEdge("prepare_evidence", "build_profile")
    .addEdge("build_profile", "build_diff")
    .addEdge("build_diff", "analyze")
    .addEdge("analyze", END);
}

async function executeSourceRunner(
  source: SourceName,
  runner: ResearchSourceRunner,
  input: CompanyInput,
  budget: ResearchBudget,
  guards: ResourceGuards,
  signal?: AbortSignal
): Promise<SourceExecutionResult> {
  const startTime = Date.now();

  if (signal?.aborted) {
    return {
      source,
      status: "failed",
      findings: [],
      error: {
        source,
        type: "network_error",
        message: "Execution aborted",
        retryable: false,
      },
      attempts: 1,
      durationMs: 0,
    };
  }

  await dispatchCustomEvent(SSE_EVENT_NAME, {
    event: "research:progress",
    data: { source, status: "started" },
  } as StreamEvent);

  let attempts = 0;
  const maxRetries = guards.maxRetriesPerSource ?? 2;
  let lastError: SourceError | undefined;

  while (attempts <= maxRetries) {
    attempts++;
    const timeoutSignal = AbortSignal.timeout(guards.sourceTimeoutMs);
    const attemptSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    try {
      if (signal?.aborted) {
        throw new Error("Execution aborted");
      }

      const findings = await runWithAbortSignal(
        runner(input, { budget, signal: attemptSignal }),
        attemptSignal,
      );

      for (const finding of findings) {
        await dispatchCustomEvent(SSE_EVENT_NAME, {
          event: "research:finding",
          data: {
            source: finding.source,
            summary: finding.content.slice(0, 200),
          },
        } as StreamEvent);
      }

      await dispatchCustomEvent(SSE_EVENT_NAME, {
        event: "research:progress",
        data: { source, status: "done" },
      } as StreamEvent);

      return {
        source,
        status: "succeeded",
        findings,
        attempts,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (err instanceof ResearchQueryBudgetExceededError) {
        await dispatchCustomEvent(SSE_EVENT_NAME, {
          event: "research:progress",
          data: { source, status: "done" },
        } as StreamEvent);
        return {
          source,
          status: "skipped",
          findings: [],
          attempts,
          durationMs: Date.now() - startTime,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = timeoutSignal.aborted || message.includes("timed out");
      const retryable =
        isRetryableSourceError(err, isTimeout, signal) &&
        attempts <= maxRetries;

      lastError = {
        source,
        type: isTimeout ? "timeout" : "network_error",
        message,
        retryable,
      };

      if (!retryable || attempts > maxRetries) {
        break;
      }
    }
  }

  await dispatchCustomEvent(SSE_EVENT_NAME, {
    event: "error",
    data: { message: lastError?.message ?? "Source execution failed", source },
  } as StreamEvent);

  await dispatchCustomEvent(SSE_EVENT_NAME, {
    event: "research:progress",
    data: { source, status: "failed" },
  } as StreamEvent);

  return {
    source,
    status: "failed",
    findings: [],
    error: lastError,
    attempts,
    durationMs: Date.now() - startTime,
  };
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
    const onAbort = () => reject(signal.reason);
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

function isResearchWorkflowState(value: unknown): value is ResearchWorkflowState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ResearchWorkflowState>;
  return (
    typeof state.researchRunId === "string" &&
    Array.isArray(state.sourceResults) &&
    Array.isArray(state.findings) &&
    typeof state.outcome === "string"
  );
}
