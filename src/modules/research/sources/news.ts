import type { CompanyInput, RawFinding } from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";
import { buildResearchQueries } from "../queries";

/**
 * Search for recent news about the company.
 */
export async function searchNews(
  input: CompanyInput,
  searchAdapter: SearchAdapter,
  customQueries?: string[]
): Promise<RawFinding[]> {
  const queries = customQueries ?? buildResearchQueries(input).news;
  const findings: RawFinding[] = [];

  const resultsByQuery = await Promise.all(
    queries.map(async (query) => {
      const results = await searchAdapter.search(query, {
        maxResults: 5,
        language: "vi",
        region: "vn",
      });

      const group: RawFinding[] = [];
      for (const result of results) {
        // Skip if it's the company's own website
        if (input.website && result.url.includes(new URL(input.website).hostname)) {
          continue;
        }

        group.push({
          source: "news",
          url: result.url,
          content: `[${result.title}]\n${result.snippet}`,
          extractedAt: new Date(),
          confidence: 0.65,
          metadata: { title: result.title, query },
        });
      }
      return group;
    })
  );

  for (const group of resultsByQuery) {
    findings.push(...group);
  }

  return findings;
}


