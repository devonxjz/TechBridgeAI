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

  for (const query of queries) {
    const results = await searchAdapter.search(query, {
      maxResults: 5,
      language: "vi",
      region: "vn",
    });

    for (const result of results) {
      findings.push({
        source: "web_search",
        url: result.url,
        content: `[${result.title}]\n${result.snippet}`,
        extractedAt: new Date(),
        confidence: 0.6,
        metadata: { query, title: result.title },
      });
    }
  }

  return findings;
}

