// ═══════════════════════════════════════════════════════
// API Route — Research Endpoint (SSE Streaming)
// Thin orchestration: pipes ResearchModule → ProfileModule → Storage
// ═══════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { CompanyInputSchema, slugify } from "@/lib/types";
import type { StreamEvent, RawFinding } from "@/lib/types";
import { createSSEStream } from "@/lib/stream";
import {
  createLLMAdapter,
  createSearchAdapter,
  createScraperAdapter,
  createStorageAdapter,
  getGuards,
} from "@/config";
import { createResearchModule } from "@/modules/research";
import { createProfileModule } from "@/modules/profile";
import { createAnalystModule } from "@/modules/analyst";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = CompanyInputSchema.parse(body);

    const guards = getGuards();
    const llm = createLLMAdapter();
    const search = createSearchAdapter();
    const scraper = createScraperAdapter();
    const storage = createStorageAdapter();

    const researchModule = createResearchModule({
      llm,
      search,
      scraper,
      guards,
    });
    const profileModule = createProfileModule({ llm });
    const analystModule = createAnalystModule({ llm });

    const { stream, writer } = createSSEStream();

    // Run pipeline in background, stream events
    (async () => {
      try {
        const allFindings: RawFinding[] = [];

        // Determine active sources
        const sources = ["web_search", "website", "news", "registry"];
        if (input.linkedinUrl) sources.push("linkedin");

        writer.write({
          event: "research:start",
          data: { sources: sources as StreamEvent extends { event: "research:start" } ? StreamEvent["data"]["sources"] : never },
        } as StreamEvent);

        // 1. Research — stream progress
        for await (const event of researchModule.research(input)) {
          switch (event.type) {
            case "progress":
              writer.write({
                event: "research:progress",
                data: { source: event.source, status: event.status },
              } as StreamEvent);
              break;
            case "finding":
              allFindings.push(event.finding);
              writer.write({
                event: "research:finding",
                data: {
                  source: event.finding.source,
                  summary: event.finding.content.slice(0, 200),
                },
              } as StreamEvent);
              break;
            case "error":
              writer.write({
                event: "error",
                data: { message: event.error, source: event.source },
              } as StreamEvent);
              break;
          }
        }

        if (allFindings.length === 0) {
          writer.write({
            event: "error",
            data: { message: "Không tìm thấy thông tin nào về công ty này." },
          } as StreamEvent);
          writer.write({ event: "done", data: {} } as StreamEvent);
          writer.close();
          return;
        }

        // 2. Build profile
        writer.write({
          event: "profile:building",
          data: { message: "Đang tổng hợp hồ sơ công ty..." },
        } as StreamEvent);

        const companyId = slugify(input.name);
        const existingProfile = await storage.getLatestProfile(companyId);
        const profile = await profileModule.buildProfile(
          allFindings,
          input,
          existingProfile?.id ?? companyId,
          existingProfile?.version
        );

        await storage.saveProfile(profile);

        writer.write({
          event: "profile:ready",
          data: { profile },
        } as StreamEvent);

        // 3. Diff if previous version exists
        if (existingProfile) {
          const diff = profileModule.diffProfiles(profile, existingProfile);
          await storage.saveDiff(diff);
          writer.write({
            event: "diff:ready",
            data: { diff },
          } as StreamEvent);
        } else {
          writer.write({
            event: "diff:ready",
            data: { diff: null },
          } as StreamEvent);
        }

        // 4. Analyst Module: Fit Score, Risk Flags, Actions
        try {
          const report = await analystModule.analyze(profile, {
            previousProfile: existingProfile ?? undefined,
          });
          writer.write({
            event: "analysis:ready",
            data: { report },
          } as StreamEvent);
        } catch (err) {
          writer.write({
            event: "error",
            data: {
              message: err instanceof Error ? err.message : "Không thể phân tích hồ sơ.",
            },
          } as StreamEvent);
        }

        writer.write({ event: "done", data: {} } as StreamEvent);
      } catch (err) {
        writer.write({
          event: "error",
          data: {
            message: err instanceof Error ? err.message : "Unknown error",
          },
        } as StreamEvent);
        writer.write({ event: "done", data: {} } as StreamEvent);
      } finally {
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
