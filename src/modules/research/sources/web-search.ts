import type { CompanyInput, RawFinding } from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";
import { buildResearchQueries } from "../queries";

/**
 * Search the web for company information.
 * Returns raw findings from search results.
 */
export async function searchWeb(
  input: CompanyInput,
  searchAdapter: SearchAdapter,
  customQueries?: string[]
): Promise<RawFinding[]> {
  const queries = customQueries ?? buildResearchQueries(input).web;
  const findings: RawFinding[] = [];

  const resultsByQuery = await Promise.all(
    queries.map(async (query) => {
      const results = await searchAdapter.search(query, {
        maxResults: 5,
        language: "vi",
        region: "vn",
      });

      return results.map((result) => ({
        source: "web_search" as const,
        url: result.url,
        content: `[${result.title}]\n${result.snippet}`,
        extractedAt: new Date(),
        confidence: 0.6,
        metadata: { query, title: result.title },
      }));
    })
  );

  for (const group of resultsByQuery) {
    findings.push(...group);
  }

  return findings;
}


