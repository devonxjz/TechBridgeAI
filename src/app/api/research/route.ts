// ═══════════════════════════════════════════════════════
// API Route — Research Endpoint (SSE Streaming)
// Cache-first: checks Supabase research cache before initializing
// expensive paid providers (Search, Scraper, LLM, Registry).
// ═══════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  ResearchRequestSchema,
  type CompanyInput,
  type CompanyProfile,
  type StreamEvent,
  type SourceName,
} from "@/lib/types";
import { createSSEStream, type SSEWriter } from "@/lib/stream";
import {
  createLLMAdapter,
  createSearchAdapter,
  createScraperAdapter,
  createRegistryAdapter,
  createStorageAdapter,
  getGuards,
} from "@/config";
import {
  createResearchCache,
  normalizeCompanyIdentity,
  IdentityConflictError,
  type NormalizedCompanyIdentity,
  type ResearchCache,
} from "@/modules/cache";
import { createProfileModule } from "@/modules/profile";
import { createAnalystModule } from "@/modules/analyst";
import { createResearchWorkflow } from "@/modules/workflow";
import type { ResearchWorkflowState } from "@/modules/workflow/state";
import {
  createLangfuseCallback,
  emitResearchScores,
  flushLangfuse,
  traceResearch,
  type ResearchTraceContext,
  updateResearchObservationOutcome,
  updateResearchTraceOutcome,
} from "@/observability/langfuse";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const parseResult = ResearchRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        details: parseResult.error.flatten(),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { input, cache } = parseResult.data;
  const action = cache?.action ?? "auto";
  const selectedCompanyId = cache?.action === "select" ? cache.companyId : undefined;
  const refreshCompanyId = cache?.action === "refresh" ? cache.companyId : undefined;

  const storage = createStorageAdapter();
  const researchCache = createResearchCache(storage);

  const { stream, writer } = createSSEStream();
  const researchRunId = crypto.randomUUID();

  // Cancellation & 285s internal deadline
  const controller = new AbortController();
  const onReqAbort = () => controller.abort();
  req.signal.addEventListener("abort", onReqAbort);
  const deadlineTimeout = setTimeout(() => {
    controller.abort("Research deadline exceeded (285s)");
  }, 285_000);

  void (async () => {
    try {
      // 1. Check Cache / Handle Action
      if (action === "auto") {
        let resolution;
        try {
          resolution = await researchCache.lookup(input, { signal: controller.signal });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Cache lookup failed";
          writer.write({
            event: "error",
            data: { message, code: "cache_unavailable" },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }

        if (resolution.kind === "hit") {
          const traceContext: ResearchTraceContext = {
            researchRunId,
            companyId: resolution.snapshot.profile.id,
            requestedSources: [],
            cacheHit: true,
            cacheMatchedBy: resolution.matchedBy,
            cacheAction: "auto",
          };
          await traceResearch(traceContext, async (traceId) => {
            await emitResearchScores(traceId, {
              sourceResults: [],
              hasProfile: true,
              hasAnalysis: true,
              overallConfidence: resolution.snapshot.profile.overallConfidence,
              outcome: "complete",
            });
          });

          writer.write({
            event: "cache:hit",
            data: {
              companyId: resolution.snapshot.profile.id,
              matchedBy: resolution.matchedBy,
              version: resolution.snapshot.profile.version,
              lastSyncedAt: resolution.snapshot.lastSyncedAt,
            },
          } as StreamEvent);
          writer.write({
            event: "profile:ready",
            data: { profile: resolution.snapshot.profile },
          } as StreamEvent);
          if (resolution.snapshot.diff) {
            writer.write({
              event: "diff:ready",
              data: { diff: resolution.snapshot.diff },
            } as StreamEvent);
          }
          writer.write({
            event: "analysis:ready",
            data: { report: resolution.snapshot.report },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }

        if (resolution.kind === "suggestions") {
          writer.write({
            event: "cache:suggestions",
            data: { suggestions: resolution.suggestions },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }

        if (resolution.kind === "conflict") {
          writer.write({
            event: "error",
            data: {
              message: "Thông tin định danh công ty mâu thuẫn.",
              code: "identity_conflict",
            },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }

        // Miss -> proceed with live research
        const miss = await researchCache.resolveMiss(input, { signal: controller.signal });
        await executeLiveWorkflow({
          input,
          companyId: miss.companyId,
          identity: miss.identity,
          existingProfile: null,
          researchRunId,
          controller,
          writer,
          researchCache,
        });
        return;
      }

      if (action === "select") {
        if (!selectedCompanyId) {
          writer.write({
            event: "error",
            data: {
              message: "Thiếu mã định danh công ty được chọn.",
              code: "invalid_cache_selection",
            },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }

        try {
          const snapshot = await researchCache.select(input, selectedCompanyId, {
            signal: controller.signal,
          });

          const traceContext: ResearchTraceContext = {
            researchRunId,
            companyId: snapshot.profile.id,
            requestedSources: [],
            cacheHit: true,
            cacheMatchedBy: "user_selection",
            cacheAction: "select",
          };
          await traceResearch(traceContext, async (traceId) => {
            await emitResearchScores(traceId, {
              sourceResults: [],
              hasProfile: true,
              hasAnalysis: true,
              overallConfidence: snapshot.profile.overallConfidence,
              outcome: "complete",
            });
          });

          writer.write({
            event: "cache:hit",
            data: {
              companyId: snapshot.profile.id,
              matchedBy: "user_selection",
              version: snapshot.profile.version,
              lastSyncedAt: snapshot.lastSyncedAt,
            },
          } as StreamEvent);
          writer.write({
            event: "profile:ready",
            data: { profile: snapshot.profile },
          } as StreamEvent);
          if (snapshot.diff) {
            writer.write({
              event: "diff:ready",
              data: { diff: snapshot.diff },
            } as StreamEvent);
          }
          writer.write({
            event: "analysis:ready",
            data: { report: snapshot.report },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Invalid cache selection";
          writer.write({
            event: "error",
            data: { message, code: "invalid_cache_selection" },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }
      }

      if (action === "refresh") {
        if (!refreshCompanyId) {
          writer.write({
            event: "error",
            data: {
              message: "Thiếu mã định danh công ty cần làm mới.",
              code: "identity_conflict",
            },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }

        let snapshot;
        try {
          snapshot = await researchCache.prepareRefresh(input, refreshCompanyId, {
            signal: controller.signal,
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Identity conflict on refresh";
          writer.write({
            event: "error",
            data: { message, code: "identity_conflict" },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }

        const identity = normalizeCompanyIdentity(input);
        await executeLiveWorkflow({
          input,
          companyId: refreshCompanyId,
          identity,
          existingProfile: snapshot.profile,
          researchRunId,
          controller,
          writer,
          researchCache,
        });
        return;
      }

      if (action === "bypass") {
        const miss = await researchCache.resolveMiss(input, { signal: controller.signal });
        await executeLiveWorkflow({
          input,
          companyId: miss.companyId,
          identity: miss.identity,
          existingProfile: null,
          researchRunId,
          controller,
          writer,
          researchCache,
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      writer.write({
        event: "error",
        data: { message },
      } as StreamEvent);
      writer.write({ event: "done", data: {} } as StreamEvent);
    } finally {
      clearTimeout(deadlineTimeout);
      req.signal.removeEventListener("abort", onReqAbort);
      await flushLangfuse();
      writer.close();
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function executeLiveWorkflow({
  input,
  companyId,
  identity,
  existingProfile,
  researchRunId,
  controller,
  writer,
  researchCache,
}: {
  input: CompanyInput;
  companyId: string;
  identity: NormalizedCompanyIdentity;
  existingProfile: CompanyProfile | null;
  researchRunId: string;
  controller: AbortController;
  writer: SSEWriter;
  researchCache: ResearchCache;
}) {
  const guards = getGuards();
  const llm = createLLMAdapter();
  const search = createSearchAdapter();
  const scraper = createScraperAdapter();
  const registry = createRegistryAdapter();

  const profile = createProfileModule({ llm });
  const analyst = createAnalystModule({ llm });

  const workflow = createResearchWorkflow({
    search,
    scraper,
    registry,
    profile,
    analyst,
    guards,
  });

  const traceContext: ResearchTraceContext = {
    researchRunId,
    companyId,
    requestedSources: [
      "web_search",
      "website",
      "news",
      "registry",
      ...(input.linkedinUrl ? ["linkedin" as SourceName] : []),
    ],
    cacheHit: false,
    cacheMatchedBy: "none",
    cacheAction: existingProfile ? "refresh" : "auto",
  };
  const langfuseCallback = createLangfuseCallback(traceContext);

  let finalState: ResearchWorkflowState | null = null;

  await traceResearch(traceContext, async (traceId) => {
    try {
      for await (const event of workflow.stream(input, {
        researchRunId,
        companyId,
        existingProfile,
        signal: controller.signal,
        callbacks: langfuseCallback ? [langfuseCallback] : undefined,
        onComplete: async (state) => {
          finalState = state;
          updateResearchTraceOutcome(state);
          await emitResearchScores(traceId, {
            sourceResults: state.sourceResults,
            hasProfile: Boolean(state.profile),
            hasAnalysis: Boolean(state.report),
            overallConfidence: state.profile?.overallConfidence ?? 0,
            outcome: state.outcome === "running" ? "failed" : state.outcome,
          });
        },
      })) {
        writer.write(event);
      }

      // Persist snapshot & emit final events
      if (finalState?.profile && finalState?.report) {
        try {
          await researchCache.persist(
            identity,
            {
              profile: finalState.profile,
              report: finalState.report,
              diff: finalState.diff,
            },
            { signal: controller.signal }
          );

          writer.write({
            event: "profile:ready",
            data: { profile: finalState.profile },
          } as StreamEvent);
          if (finalState.diff) {
            writer.write({
              event: "diff:ready",
              data: { diff: finalState.diff },
            } as StreamEvent);
          }
          writer.write({
            event: "analysis:ready",
            data: { report: finalState.report },
          } as StreamEvent);
        } catch (persistErr) {
          if (persistErr instanceof IdentityConflictError) {
            writer.write({
              event: "error",
              data: {
                message: "Hồ sơ nghiên cứu bị từ chối do mâu thuẫn định danh phát sinh.",
                code: "identity_conflict",
              },
            } as StreamEvent);
          } else {
            const message =
              persistErr instanceof Error ? persistErr.message : "Failed to persist snapshot";
            writer.write({
              event: "error",
              data: { message },
            } as StreamEvent);
          }
        }
      }
      writer.write({ event: "done", data: {} } as StreamEvent);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Internal workflow error";
      updateResearchObservationOutcome(
        controller.signal.aborted ? "cancelled" : "failed",
      );
      await emitResearchScores(traceId, {
        sourceResults: [],
        hasProfile: false,
        hasAnalysis: false,
        overallConfidence: 0,
        outcome: "failed",
      });
      writer.write({
        event: "error",
        data: { message },
      } as StreamEvent);
      writer.write({ event: "done", data: {} } as StreamEvent);
    }
  });
}
