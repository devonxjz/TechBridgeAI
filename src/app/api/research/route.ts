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
  type ResearchSnapshot,
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
  InvalidCacheSelectionError,
  CacheUnavailableError,
  type NormalizedCompanyIdentity,
  type ResearchCache,
  type CacheResolution,
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
  updateResearchCacheOutcome,
  type ResearchTraceContext,
  updateResearchObservationOutcome,
  updateResearchTraceOutcome,
} from "@/observability/langfuse";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // 1. JSON parsing and schema validation
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
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
  const selectedCompanyId =
    cache?.action === "select" ? cache.companyId : undefined;
  const refreshCompanyId =
    cache?.action === "refresh" ? cache.companyId : undefined;

  const storage = createStorageAdapter();
  const researchCache = createResearchCache(storage);

  // 2. Preflight Cache Resolution before opening SSE stream
  let autoResolution: CacheResolution | null = null;
  let selectedSnapshot: ResearchSnapshot | null = null;
  let refreshSnapshot: ResearchSnapshot | null = null;

  try {
    if (action === "auto") {
      autoResolution = await researchCache.lookup(input, {
        signal: req.signal,
      });
      if (autoResolution.kind === "conflict") {
        return new Response(
          JSON.stringify({
            error: "Thông tin định danh công ty mâu thuẫn.",
            code: "identity_conflict",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }
    } else if (action === "select") {
      if (!selectedCompanyId) {
        return new Response(
          JSON.stringify({
            error: "Thiếu mã định danh công ty được chọn.",
            code: "invalid_cache_selection",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      selectedSnapshot = await researchCache.select(input, selectedCompanyId, {
        signal: req.signal,
      });
    } else if (action === "refresh") {
      if (!refreshCompanyId) {
        return new Response(
          JSON.stringify({
            error: "Thiếu mã định danh công ty cần làm mới.",
            code: "identity_conflict",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }
      refreshSnapshot = await researchCache.prepareRefresh(
        input,
        refreshCompanyId,
        {
          signal: req.signal,
        }
      );
    } else if (action === "bypass") {
      const norm = normalizeCompanyIdentity(input);
      if (norm.taxId) {
        const candidates = await storage.findIdentityCandidates(norm, {
          signal: req.signal,
        });
        const taxMatch = candidates.find((c) => c.taxId === norm.taxId);
        if (
          taxMatch &&
          norm.domain &&
          taxMatch.domain &&
          norm.domain !== taxMatch.domain
        ) {
          return new Response(
            JSON.stringify({
              error:
                "Không thể bỏ qua cache khi thông tin định danh mâu thuẫn với MST đã đăng ký.",
              code: "identity_conflict",
            }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
      }
    }
  } catch (err) {
    if (err instanceof IdentityConflictError) {
      return new Response(
        JSON.stringify({ error: err.message, code: "identity_conflict" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }
    if (err instanceof InvalidCacheSelectionError) {
      return new Response(
        JSON.stringify({
          error: err.message,
          code: "invalid_cache_selection",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (err instanceof CacheUnavailableError) {
      return new Response(
        JSON.stringify({ error: err.message, code: "cache_unavailable" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
    const message =
      err instanceof Error ? err.message : "Cache preflight failed";
    return new Response(
      JSON.stringify({ error: message, code: "cache_unavailable" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Open SSE Stream
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
      if (action === "auto" && autoResolution) {
        if (autoResolution.kind === "hit") {
          const traceContext: ResearchTraceContext = {
            researchRunId,
            companyId: autoResolution.snapshot.profile.id,
            requestedSources: [],
            cacheHit: true,
            cacheMatchedBy: autoResolution.matchedBy,
            cacheAction: "auto",
          };
          await traceResearch(traceContext, async (traceId) => {
            await emitResearchScores(traceId, {
              sourceResults: [],
              hasProfile: true,
              hasAnalysis: true,
              overallConfidence:
                autoResolution.snapshot.profile.overallConfidence,
              outcome: "complete",
            });
          });

          writer.write({
            event: "cache:hit",
            data: {
              companyId: autoResolution.snapshot.profile.id,
              matchedBy: autoResolution.matchedBy,
              version: autoResolution.snapshot.profile.version,
              lastSyncedAt: autoResolution.snapshot.lastSyncedAt,
            },
          } as StreamEvent);
          writer.write({
            event: "profile:ready",
            data: { profile: autoResolution.snapshot.profile },
          } as StreamEvent);
          if (autoResolution.snapshot.diff) {
            writer.write({
              event: "diff:ready",
              data: { diff: autoResolution.snapshot.diff },
            } as StreamEvent);
          }
          writer.write({
            event: "analysis:ready",
            data: { report: autoResolution.snapshot.report },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }

        if (autoResolution.kind === "suggestions") {
          writer.write({
            event: "cache:suggestions",
            data: { suggestions: autoResolution.suggestions },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          return;
        }

        if (autoResolution.kind === "miss") {
          if (autoResolution.cacheInvalid) {
            writer.write({
              event: "error",
              data: {
                message:
                  "Dữ liệu cache không hợp lệ, đang tiến hành nghiên cứu mới.",
                code: "cache_invalid",
              },
            } as StreamEvent);
            updateResearchCacheOutcome({ cacheOutcome: "invalid" });
          }

          const miss = await researchCache.resolveMiss(input, {
            signal: controller.signal,
          });
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
      }

      if (action === "select" && selectedSnapshot) {
        const traceContext: ResearchTraceContext = {
          researchRunId,
          companyId: selectedSnapshot.profile.id,
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
            overallConfidence: selectedSnapshot.profile.overallConfidence,
            outcome: "complete",
          });
        });

        writer.write({
          event: "cache:hit",
          data: {
            companyId: selectedSnapshot.profile.id,
            matchedBy: "user_selection",
            version: selectedSnapshot.profile.version,
            lastSyncedAt: selectedSnapshot.lastSyncedAt,
          },
        } as StreamEvent);
        writer.write({
          event: "profile:ready",
          data: { profile: selectedSnapshot.profile },
        } as StreamEvent);
        if (selectedSnapshot.diff) {
          writer.write({
            event: "diff:ready",
            data: { diff: selectedSnapshot.diff },
          } as StreamEvent);
        }
        writer.write({
          event: "analysis:ready",
          data: { report: selectedSnapshot.report },
        } as StreamEvent);
        writer.write({ event: "done", data: {} } as StreamEvent);
        return;
      }

      if (action === "refresh" && refreshSnapshot) {
        const identity = normalizeCompanyIdentity(input);
        await executeLiveWorkflow({
          input,
          companyId: refreshCompanyId!,
          identity,
          existingProfile: refreshSnapshot.profile,
          researchRunId,
          controller,
          writer,
          researchCache,
        });
        return;
      }

      if (action === "bypass") {
        const miss = await researchCache.resolveMiss(input, {
          signal: controller.signal,
        });
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
      ...(input.linkedinUrl ? [("linkedin" as SourceName)] : []),
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
            outcome: state.outcome === "running" ? "partial" : state.outcome,
          });
        },
      })) {
        writer.write(event);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        updateResearchObservationOutcome("cancelled");
        return;
      }
      updateResearchObservationOutcome("failed");
      await emitResearchScores(traceId, {
        sourceResults: [],
        hasProfile: false,
        hasAnalysis: false,
        overallConfidence: 0,
        outcome: "failed",
      });
      throw err;
    }
  });

  // Post-workflow atomic cache persistence and event emission
  if (finalState) {
    const s = finalState as ResearchWorkflowState;
    if (s.profile && s.report) {
      try {
        await researchCache.persist(
          identity,
          {
            profile: s.profile,
            report: s.report,
            diff: s.diff ?? null,
          },
          { signal: controller.signal }
        );
      } catch (persistErr) {
        console.error("Failed to persist research snapshot:", persistErr);
        writer.write({
          event: "error",
          data: {
            message: "Không thể lưu kết quả nghiên cứu vào bộ nhớ đệm.",
            code: "persist_failed",
          },
        } as StreamEvent);
      }

      writer.write({
        event: "profile:ready",
        data: { profile: s.profile },
      } as StreamEvent);
      if (s.diff) {
        writer.write({
          event: "diff:ready",
          data: { diff: s.diff },
        } as StreamEvent);
      }
      writer.write({
        event: "analysis:ready",
        data: { report: s.report },
      } as StreamEvent);
    }
  }

  writer.write({ event: "done", data: {} } as StreamEvent);
}
