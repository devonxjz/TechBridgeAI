// ═══════════════════════════════════════════════════════
// Research Module — Source: Vietnamese Business Registry
// ═══════════════════════════════════════════════════════

import type { CompanyInput, RawFinding } from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";

/**
 * Fetch company info from Vietnamese business registry sources.
 * Uses a 3-level fallback chain:
 *   1. Aggregator sites (masothue.com, thongtindoanhnghiep.co)
 *   2. Google Search with site: filter for registry
 *   3. General search for tax/registry info
 */
export async function fetchRegistryData(
  input: CompanyInput,
  searchAdapter: SearchAdapter,
  scraperAdapter: ScraperAdapter
): Promise<RawFinding[]> {
  // 1. Try aggregator sites first (most reliable)
  const aggregatorResult = await tryAggregatorSites(
    input,
    searchAdapter,
    scraperAdapter
  );
  if (aggregatorResult.length > 0) return aggregatorResult;

  // 2. Fallback: search registry sites
  const registrySearchResult = await tryRegistrySearch(input, searchAdapter);
  if (registrySearchResult.length > 0) return registrySearchResult;

  // 3. Final fallback: general search for registry-type info
  return tryGeneralRegistrySearch(input, searchAdapter);
}

async function tryAggregatorSites(
  input: CompanyInput,
  searchAdapter: SearchAdapter,
  scraperAdapter: ScraperAdapter
): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];
  const searchTerm = input.taxId ?? input.name;

  // Search on known aggregator sites
  const sites = [
    "masothue.com",
    "thongtindoanhnghiep.co",
  ];

  for (const site of sites) {
    try {
      const results = await searchAdapter.search(
        `"${searchTerm}" site:${site}`,
        { maxResults: 2 }
      );

      if (results.length > 0) {
        // Try to scrape the first result for detailed info
        try {
          const page = await scraperAdapter.extract(results[0].url);
          if (page.text.length > 100) {
            findings.push({
              source: "registry",
              url: results[0].url,
              content: page.text.slice(0, 8_000),
              extractedAt: new Date(),
              confidence: 0.75, // Aggregator, not official
              metadata: {
                aggregator: site,
                title: page.title,
              },
            });
            return findings; // One good result is enough
          }
        } catch {
          // Scrape failed, use search snippet instead
          findings.push({
            source: "registry",
            url: results[0].url,
            content: `[${results[0].title}]\n${results[0].snippet}`,
            extractedAt: new Date(),
            confidence: 0.5,
            metadata: { aggregator: site },
          });
        }
      }
    } catch {
      // Search for this site failed, try next
    }
  }

  return findings;
}

async function tryRegistrySearch(
  input: CompanyInput,
  searchAdapter: SearchAdapter
): Promise<RawFinding[]> {
  const searchTerm = input.taxId ?? input.name;
  const results = await searchAdapter.search(
    `"${searchTerm}" site:dangkykinhdoanh.gov.vn`,
    { maxResults: 3 }
  );

  return results.map((r) => ({
    source: "registry" as const,
    url: r.url,
    content: `[${r.title}]\n${r.snippet}`,
    extractedAt: new Date(),
    confidence: 0.6,
    metadata: { via: "registry_search" },
  }));
}

async function tryGeneralRegistrySearch(
  input: CompanyInput,
  searchAdapter: SearchAdapter
): Promise<RawFinding[]> {
  const searchTerm = input.taxId ?? input.name;
  const results = await searchAdapter.search(
    `"${searchTerm}" mã số thuế đăng ký kinh doanh thông tin doanh nghiệp`,
    { maxResults: 3 }
  );

  return results.map((r) => ({
    source: "registry" as const,
    url: r.url,
    content: `[${r.title}]\n${r.snippet}`,
    extractedAt: new Date(),
    confidence: 0.45, // Lower confidence for general search fallback
    metadata: { via: "general_search_fallback" },
  }));
}
