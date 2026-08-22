// ═══════════════════════════════════════════════════════
// Research Module — Source: News
// ═══════════════════════════════════════════════════════

import type { CompanyInput, RawFinding } from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";

/**
 * Search for recent news about the company.
 */
export async function searchNews(
  input: CompanyInput,
  searchAdapter: SearchAdapter
): Promise<RawFinding[]> {
  const queries = [
    `"${input.name}" tin tức mới nhất`,
    `"${input.name}" news`,
  ];

  const findings: RawFinding[] = [];

  for (const query of queries) {
    const results = await searchAdapter.search(query, {
      maxResults: 5,
      language: "vi",
      region: "vn",
    });

    for (const result of results) {
      // Skip if it's the company's own website
      if (input.website && result.url.includes(new URL(input.website).hostname)) {
        continue;
      }

      findings.push({
        source: "news",
        url: result.url,
        content: `[${result.title}]\n${result.snippet}`,
        extractedAt: new Date(),
        confidence: 0.65,
        metadata: { title: result.title, query },
      });
    }
  }

  return findings;
}
