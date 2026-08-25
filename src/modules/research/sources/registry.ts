// ═══════════════════════════════════════════════════════
// Research Module — Source: Vietnamese Business Registry
// ═══════════════════════════════════════════════════════

import type { CompanyInput, RawFinding } from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";
import { RegistryError, type RegistryAdapter } from "@/adapters/registry";

/**
 * Fetch company info from Vietnamese business registry sources.
 * If taxId is provided, queries official VietQR registry first.
 * If VietQR fails, falls back through aggregator -> search hierarchy.
 */
export async function fetchRegistryData(
  input: CompanyInput,
  searchAdapter: SearchAdapter,
  scraperAdapter: ScraperAdapter,
  registryAdapter: RegistryAdapter,
): Promise<RawFinding[]> {
  if (!input.taxId) return [];

  // 1. Try VietQR if taxId is provided
  try {
    const record = await registryAdapter.findByTaxId(input.taxId);
    if (record) {
      const details = [
        `[Thông tin ĐKKD VietQR]`,
        `Tên doanh nghiệp: ${record.name}`,
        `Mã số thuế: ${record.taxId}`,
        record.internationalName ? `Tên quốc tế: ${record.internationalName}` : null,
        record.shortName ? `Tên viết tắt: ${record.shortName}` : null,
        record.address ? `Địa chỉ: ${record.address}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      return [
        {
          source: "registry",
          url: `https://api.vietqr.io/v2/business/${encodeURIComponent(record.taxId)}`,
          content: details,
          extractedAt: new Date(),
          confidence: 0.95, // Official registry record
          metadata: {
            via: "vietqr",
            taxId: record.taxId,
            name: record.name,
          },
        },
      ];
    }
  } catch (err: unknown) {
    const reason = err instanceof RegistryError ? err.code : "lookup_failed";
    console.log(
      JSON.stringify({
        event: "registry_fallback",
        reason,
        taxId: input.taxId,
      }),
    );
  }

  // 2. Try aggregator sites
  const aggregatorResult = await tryAggregatorSites(
    input,
    searchAdapter,
    scraperAdapter,
  );
  if (aggregatorResult.length > 0) return aggregatorResult;

  // 3. Fallback: search registry sites
  const registrySearchResult = await tryRegistrySearch(input, searchAdapter);
  if (registrySearchResult.length > 0) return registrySearchResult;

  // 4. Final fallback: general search for registry-type info
  return tryGeneralRegistrySearch(input, searchAdapter);
}

async function tryAggregatorSites(
  input: CompanyInput,
  searchAdapter: SearchAdapter,
  scraperAdapter: ScraperAdapter,
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
