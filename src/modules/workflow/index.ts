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
  RawFinding,
  SourceError,
  SourceExecutionResult,
  SourceName,
  StreamEvent,
} from "@/lib/types";
import { slugify } from "@/lib/types";
import type { LLMAdapter } from "@/adapters/llm/types";
import type { SearchAdapter } from "@/adapters/search/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";
import type { RegistryAdapter } from "@/adapters/registry/types";
import type { StorageAdapter } from "@/adapters/storage/types";
import type { ResourceGuards } from "@/config";
import type { ProfileModule } from "@/modules/profile";
import type { AnalystModule } from "@/modules/analyst";
import { prepareEvidence } from "@/modules/research/evidence";
import { createResearchBudget, type ResearchBudget } from "@/modules/research/budget";
import { createResearchSourceRunners, type ResearchSourceRunner } from "@/modules/research";
import {
  ResearchWorkflowAnnotation,
  type ResearchWorkflowState,
} from "./state";

export interface ResearchWorkflowOptions {
  researchRunId: string;
  signal?: AbortSignal;
  callbacks?: readonly unknown[];
  sessionId?: string;
}

export interface ResearchWorkflowDeps {
  llm: LLMAdapter;
  search: SearchAdapter;
  scraper: ScraperAdapter;
  registry: RegistryAdapter;
  storage: StorageAdapter;
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
    llm: deps.llm,
    search: deps.search,
    scraper: deps.scraper,
    registry: deps.registry,
    guards: deps.guards,
  });

  const runSource = async (
    source: SourceName,
    runner: ResearchSourceRunner,
    input: CompanyInput,
    budget: ResearchBudget,
    signal?: AbortSignal
  ): Promise<SourceExecutionResult> => {
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

    await dispatchCustomEvent("sse_event", {
      event: "research:progress",
      data: { source, status: "started" },
    } as StreamEvent);

    let attempts = 0;
    const maxRetries = deps.guards.maxRetriesPerSource ?? 2;
    let lastError: SourceError | undefined;

    const providerType: "search" | "scraper" | "registry" =
      source === "registry"
        ? "registry"
        : source === "website" || source === "linkedin"
        ? "scraper"
        : "search";

    while (attempts <= maxRetries) {
      attempts++;
      try {
        if (signal?.aborted) {
          throw new Error("Execution aborted");
        }

        const findings = await budget.runWithProviderSlot(providerType, async () => {
          return await Promise.race([
            runner(input),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Source ${source} timed out after ${deps.guards.sourceTimeoutMs}ms`)),
                deps.guards.sourceTimeoutMs
              )
            ),
          ]);
        });

        for (const finding of findings) {
          await dispatchCustomEvent("sse_event", {
            event: "research:finding",
            data: {
              source: finding.source,
              summary: finding.content.slice(0, 200),
            },
          } as StreamEvent);
        }

        await dispatchCustomEvent("sse_event", {
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
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = message.includes("timed out");
        const retryable = (isTimeout || message.includes("50") || message.includes("429")) && attempts <= maxRetries;

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

    await dispatchCustomEvent("sse_event", {
      event: "error",
      data: { message: lastError?.message ?? "Source execution failed", source },
    } as StreamEvent);

    await dispatchCustomEvent("sse_event", {
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
  };

  return {
    async run(input, options) {
      return await executeGraph(input, options, deps, runners);
    },

    async *stream(input, options) {
      const budget = createResearchBudget({
        maxLLMCalls: deps.guards.maxLLMCallsPerResearch,
        maxTokens: deps.guards.maxTokensPerResearch,
        maxConcurrentProviderCalls: deps.guards.maxConcurrentProviderCalls,
      });

      const activeSources: SourceName[] = ["web_search", "website", "news", "registry"];
      if (input.linkedinUrl) {
        activeSources.push("linkedin");
      }

      yield {
        event: "research:start",
        data: { sources: activeSources },
      } as StreamEvent;

      const graph = buildGraph(deps, runners, budget, options.signal);
      const app = graph.compile();

      const eventStream = app.streamEvents(
        {
          researchRunId: options.researchRunId,
          input,
          sourceResults: [],
          findings: [],
          existingProfile: null,
          profile: null,
          diff: null,
          report: null,
          outcome: "running",
          fatalError: null,
        },
        {
          version: "v2",
          signal: options.signal,
          callbacks: options.callbacks as Callbacks,
          maxConcurrency: deps.guards.maxConcurrentSourceNodes,
        }
      );

      let fatalErrorEncountered: string | null = null;
      let hasFindings = false;

      for await (const event of eventStream) {
        if (event.event === "on_custom_event" && event.name === "sse_event") {
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

      if (!hasFindings && !fatalErrorEncountered) {
        yield {
          event: "error",
          data: { message: "Không tìm thấy thông tin nào về công ty này." },
        } as StreamEvent;
      }

      yield { event: "done", data: {} } as StreamEvent;
    },
  };
}

async function executeGraph(
  input: CompanyInput,
  options: ResearchWorkflowOptions,
  deps: ResearchWorkflowDeps,
  runners: Record<SourceName, ResearchSourceRunner>
): Promise<ResearchWorkflowState> {
  const budget = createResearchBudget({
    maxLLMCalls: deps.guards.maxLLMCallsPerResearch,
    maxTokens: deps.guards.maxTokensPerResearch,
    maxConcurrentProviderCalls: deps.guards.maxConcurrentProviderCalls,
  });
  const graph = buildGraph(deps, runners, budget, options.signal);
  const app = graph.compile();

  return (await app.invoke(
    {
      researchRunId: options.researchRunId,
      input,
      sourceResults: [],
      findings: [],
      existingProfile: null,
      profile: null,
      diff: null,
      report: null,
      outcome: "running",
      fatalError: null,
    },
    {
      signal: options.signal,
      callbacks: options.callbacks as Callbacks,
      maxConcurrency: deps.guards.maxConcurrentSourceNodes,
    }
  )) as ResearchWorkflowState;
}

function buildGraph(
  deps: ResearchWorkflowDeps,
  runners: Record<SourceName, ResearchSourceRunner>,
  budget: ResearchBudget,
  signal?: AbortSignal
) {
  // Source Nodes
  const createSourceNode = (source: SourceName) => {
    return async (state: typeof ResearchWorkflowAnnotation.State) => {
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
        signal
      );
      return {
        sourceResults: [result],
      };
    };
  };

  return new StateGraph(ResearchWorkflowAnnotation)
    .addNode("web_search", createSourceNode("web_search"))
    .addNode("website", createSourceNode("website"))
    .addNode("news", createSourceNode("news"))
    .addNode("registry", createSourceNode("registry"))
    .addNode("linkedin", createSourceNode("linkedin"))
    .addNode("prepare_evidence", async (state) => {
      const prepared = prepareEvidence(state.sourceResults);
      if (prepared.findings.length === 0) {
        const errorDetails = state.sourceResults
          .filter((r) => r.error)
          .map((r) => `${r.source}: ${r.error?.message}`);
        const detailStr =
          errorDetails.length > 0 ? ` Chi tiết: ${errorDetails.join(" | ")}` : "";
        const message = `Không tìm thấy thông tin nào về công ty này.${detailStr}`;

        await dispatchCustomEvent("sse_event", {
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
    })
    .addNode("load_existing_profile", async (state) => {
      if (state.fatalError) return {};
      const companyId = slugify(state.input.name);
      try {
        const existing = await deps.storage.getLatestProfile(companyId);
        return { existingProfile: existing };
      } catch {
        return { existingProfile: null };
      }
    })
    .addNode("build_profile", async (state) => {
      if (state.fatalError || state.findings.length === 0) return {};

      await dispatchCustomEvent("sse_event", {
        event: "profile:building",
        data: { message: "Đang tổng hợp hồ sơ công ty..." },
      } as StreamEvent);

      const companyId = slugify(state.input.name);
      try {
        const profile = await deps.profile.buildProfile(
          state.findings,
          state.input,
          state.existingProfile?.id ?? companyId,
          state.existingProfile?.version
        );

        await dispatchCustomEvent("sse_event", {
          event: "profile:ready",
          data: { profile },
        } as StreamEvent);

        return { profile };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to build profile";
        await dispatchCustomEvent("sse_event", {
          event: "error",
          data: { message },
        } as StreamEvent);
        return { fatalError: message, outcome: "failed" as const };
      }
    })
    .addNode("persist_profile", async (state) => {
      if (state.fatalError || !state.profile || signal?.aborted) return {};
      try {
        await deps.storage.saveProfile(state.profile);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to persist profile";
        return { fatalError: message };
      }
      return {};
    })
    .addNode("build_and_persist_diff", async (state) => {
      if (state.fatalError || !state.profile) return {};

      if (state.existingProfile) {
        try {
          const diff = deps.profile.diffProfiles(state.profile, state.existingProfile);
          if (!signal?.aborted) {
            await deps.storage.saveDiff(diff);
          }
          await dispatchCustomEvent("sse_event", {
            event: "diff:ready",
            data: { diff },
          } as StreamEvent);
          return { diff };
        } catch {
          await dispatchCustomEvent("sse_event", {
            event: "diff:ready",
            data: { diff: null },
          } as StreamEvent);
          return { diff: null };
        }
      } else {
        await dispatchCustomEvent("sse_event", {
          event: "diff:ready",
          data: { diff: null },
        } as StreamEvent);
        return { diff: null };
      }
    })
    .addNode("analyze", async (state) => {
      if (state.fatalError || !state.profile) return {};

      try {
        const report = await deps.analyst.analyze(state.profile, {
          previousProfile: state.existingProfile ?? undefined,
        });

        await dispatchCustomEvent("sse_event", {
          event: "analysis:ready",
          data: { report },
        } as StreamEvent);

        return { report };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Không thể phân tích hồ sơ.";
        await dispatchCustomEvent("sse_event", {
          event: "error",
          data: { message },
        } as StreamEvent);
        return { outcome: "partial" as const };
      }
    })
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
    .addEdge("prepare_evidence", "load_existing_profile")
    .addEdge("load_existing_profile", "build_profile")
    .addEdge("build_profile", "persist_profile")
    .addEdge("persist_profile", "build_and_persist_diff")
    .addEdge("build_and_persist_diff", "analyze")
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

  await dispatchCustomEvent("sse_event", {
    event: "research:progress",
    data: { source, status: "started" },
  } as StreamEvent);

  let attempts = 0;
  const maxRetries = guards.maxRetriesPerSource ?? 2;
  let lastError: SourceError | undefined;

  const providerType: "search" | "scraper" | "registry" =
    source === "registry"
      ? "registry"
      : source === "website" || source === "linkedin"
      ? "scraper"
      : "search";

  while (attempts <= maxRetries) {
    attempts++;
    try {
      if (signal?.aborted) {
        throw new Error("Execution aborted");
      }

      const findings = await budget.runWithProviderSlot(providerType, async () => {
        return await Promise.race([
          runner(input),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Source ${source} timed out after ${guards.sourceTimeoutMs}ms`)),
              guards.sourceTimeoutMs
            )
          ),
        ]);
      });

      for (const finding of findings) {
        await dispatchCustomEvent("sse_event", {
          event: "research:finding",
          data: {
            source: finding.source,
            summary: finding.content.slice(0, 200),
          },
        } as StreamEvent);
      }

      await dispatchCustomEvent("sse_event", {
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
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes("timed out");
      const retryable =
        (isTimeout || message.includes("50") || message.includes("429")) &&
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

  await dispatchCustomEvent("sse_event", {
    event: "error",
    data: { message: lastError?.message ?? "Source execution failed", source },
  } as StreamEvent);

  await dispatchCustomEvent("sse_event", {
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
