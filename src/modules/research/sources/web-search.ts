import type { CompanyInput, RawFinding } from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";
import { buildResearchQueries, applyDomainPolicy } from "../queries";

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
    queries.map(async (query, queryIndex) => {
      const rawResults = await searchAdapter.search(query, {
        maxResults: 10,
        language: "vi",
        region: "vn",
        vertical: "web",
      });

      const selectedResults = applyDomainPolicy(rawResults, input.sourcePolicy, 5);
      const providerRankByUrl = new Map(
        rawResults.map((result, index) => [result.url, index + 1]),
      );
      return selectedResults.map((result) => ({
        source: "web_search" as const,
        url: result.url,
        content: `[${result.title}]\n${result.snippet}`,
        extractedAt: new Date(),
        confidence: 0.6,
        metadata: {
          query,
          queryIndex,
          providerRank: providerRankByUrl.get(result.url),
          title: result.title,
          publisherName: result.publisherName,
        },
      }));
    })
  );

  for (const group of resultsByQuery) {
    findings.push(...group);
  }

  return findings;
}
