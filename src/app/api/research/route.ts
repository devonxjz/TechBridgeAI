// ═══════════════════════════════════════════════════════
// API Route — Research Endpoint (SSE Streaming)
// Thin adapter: passes request to LangGraph ResearchWorkflow and streams events
// ═══════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { CompanyInputSchema } from "@/lib/types";
import type { StreamEvent } from "@/lib/types";
import { createSSEStream } from "@/lib/stream";
import {
  createLLMAdapter,
  createSearchAdapter,
  createScraperAdapter,
  createRegistryAdapter,
  createStorageAdapter,
  getGuards,
} from "@/config";
import { createProfileModule } from "@/modules/profile";
import { createAnalystModule } from "@/modules/analyst";
import { createResearchWorkflow } from "@/modules/workflow";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = CompanyInputSchema.parse(body);

    const guards = getGuards();
    const llm = createLLMAdapter();
    const search = createSearchAdapter();
    const scraper = createScraperAdapter();
    const registry = createRegistryAdapter();
    const storage = createStorageAdapter();

    const profile = createProfileModule({ llm });
    const analyst = createAnalystModule({ llm });

    const workflow = createResearchWorkflow({
      llm,
      search,
      scraper,
      registry,
      storage,
      profile,
      analyst,
      guards,
    });

    const { stream, writer } = createSSEStream();
    const researchRunId = crypto.randomUUID();

    // Setup cancellation & 285s internal deadline
    const controller = new AbortController();
    const onReqAbort = () => controller.abort();
    req.signal.addEventListener("abort", onReqAbort);
    const deadlineTimeout = setTimeout(() => {
      controller.abort("Research deadline exceeded (285s)");
    }, 285_000);

    (async () => {
      try {
        for await (const event of workflow.stream(input, {
          researchRunId,
          signal: controller.signal,
        })) {
          writer.write(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal workflow error";
        writer.write({
          event: "error",
          data: { message },
        } as StreamEvent);
        writer.write({ event: "done", data: {} } as StreamEvent);
      } finally {
        clearTimeout(deadlineTimeout);
        req.signal.removeEventListener("abort", onReqAbort);
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
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Invalid request",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}
