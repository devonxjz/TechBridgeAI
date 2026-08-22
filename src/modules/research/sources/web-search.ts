// ═══════════════════════════════════════════════════════
// Research Module — Source: Web Search
// ═══════════════════════════════════════════════════════

import type { CompanyInput, RawFinding } from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";

/**
 * Search the web for company information.
 * Returns raw findings from search results.
 */
export async function searchWeb(
  input: CompanyInput,
  searchAdapter: SearchAdapter
): Promise<RawFinding[]> {
  const queries = buildSearchQueries(input);
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

function buildSearchQueries(input: CompanyInput): string[] {
  const queries: string[] = [];
  const name = input.name;

  // Primary query
  queries.push(`"${name}" công ty thông tin`);

  // Products/services query
  queries.push(`"${name}" sản phẩm dịch vụ ngành nghề`);

  // If tax ID provided, search specifically
  if (input.taxId) {
    queries.push(`"${input.taxId}" mã số thuế doanh nghiệp`);
  }

  // Additional keywords
  if (input.additionalKeywords?.length) {
    queries.push(`"${name}" ${input.additionalKeywords.join(" ")}`);
  }

  return queries;
}
