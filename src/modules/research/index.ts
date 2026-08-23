// ═══════════════════════════════════════════════════════
// ResearchModule — Deep Module
// Orchestrates multiple sources, streams progress events.
// Interface: research(input) → AsyncGenerator<ResearchEvent>
// ═══════════════════════════════════════════════════════

import type {
  CompanyInput,
  RawFinding,
  ResearchEvent,
  SourceName,
  SourceResult,
} from "@/lib/types";
import type { LLMAdapter } from "@/adapters/llm/types";
import type { SearchAdapter } from "@/adapters/search/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";
import type { ResourceGuards } from "@/config";
import { searchWeb } from "./sources/web-search";
import { scrapeWebsite } from "./sources/website";
import { searchNews } from "./sources/news";
import { fetchRegistryData } from "./sources/registry";
import { scrapeLinkedIn } from "./sources/linkedin";

export interface ResearchModule {
  research(input: CompanyInput): AsyncGenerator<ResearchEvent, void, unknown>;
}

interface ResearchDeps {
  llm: LLMAdapter;
  search: SearchAdapter;
  scraper: ScraperAdapter;
  guards: ResourceGuards;
}

export function createResearchModule(deps: ResearchDeps): ResearchModule {
  return {
    async *research(input: CompanyInput) {
      const sources: {
        name: SourceName;
        fn: () => Promise<RawFinding[]>;
      }[] = [
        {
          name: "web_search",
          fn: () => searchWeb(input, deps.search),
        },
        {
          name: "website",
          fn: () =>
            scrapeWebsite(
              input,
              deps.scraper,
              deps.search,
              deps.guards.maxScrapePagesPerResearch,
            ),
        },
        {
          name: "news",
          fn: () => searchNews(input, deps.search),
        },
        {
          name: "registry",
          fn: () => fetchRegistryData(input, deps.search, deps.scraper),
        },
        {
          name: "linkedin",
          fn: () => scrapeLinkedIn(input, deps.scraper),
        },
      ];

      // Filter: only include linkedin if URL provided
      const activeSources = sources.filter(
        (s) => s.name !== "linkedin" || input.linkedinUrl
      );

      const allFindings: RawFinding[] = [];

      // Run sources sequentially to respect rate limits and provide streaming progress
      for (const source of activeSources) {
        yield {
          type: "progress" as const,
          source: source.name,
          status: "started" as const,
        };

        const result = await runSourceWithTimeout(
          source.name,
          source.fn,
          deps.guards.sourceTimeoutMs
        );

        if (result.ok) {
          for (const finding of result.findings) {
            allFindings.push(finding);
            yield { type: "finding" as const, finding };
          }
          yield {
            type: "progress" as const,
            source: source.name,
            status: "done" as const,
          };
        } else {
          yield {
            type: "error" as const,
            source: source.name,
            error: result.error.message,
          };
          yield {
            type: "progress" as const,
            source: source.name,
            status: "failed" as const,
          };
        }
      }

      yield { type: "complete" as const, findings: allFindings };
    },
  };
}

async function runSourceWithTimeout(
  source: SourceName,
  fn: () => Promise<RawFinding[]>,
  timeoutMs: number
): Promise<SourceResult> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Source ${source} timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    return { ok: true, findings: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("timed out");
    return {
      ok: false,
      error: {
        source,
        type: isTimeout ? "timeout" : "network_error",
        message,
        retryable: isTimeout,
      },
    };
  }
}
