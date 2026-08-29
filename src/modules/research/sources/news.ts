import type { CompanyInput, RawFinding } from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";
import { buildResearchQueries, applyDomainPolicy } from "../queries";
import { normalizePublication } from "../publication";

import type { CrawlPolicy } from "../crawl-policy";
import { getHostname } from "../url-utils";

/**
 * Search for recent news about the company and normalize publication provenance.
 */
export async function searchNews(
  input: CompanyInput,
  searchAdapter: SearchAdapter,
  scraperAdapter?: ScraperAdapter,
  crawlPolicy?: CrawlPolicy,
  customQueries?: string[]
): Promise<RawFinding[]> {
  const queries = customQueries ?? buildResearchQueries(input).news;
  const findings: RawFinding[] = [];

  let companyHostname: string | undefined;
  if (input.website) {
    companyHostname = getHostname(input.website);
  }

  const resultsByQuery = await Promise.all(
    queries.map(async (query, queryIndex) => {
      const rawResults = await searchAdapter.search(query, {
        maxResults: 10,
        language: "vi",
        region: "vn",
        vertical: "news",
      });

      // Filter out company's own website
      const filteredResults = rawResults.filter((result) => {
        if (!companyHostname) return true;
        const resHost = getHostname(result.url);
        return resHost !== companyHostname && !resHost.endsWith(`.${companyHostname}`);
      });

      // Apply domain policy
      const selectedResults = applyDomainPolicy(filteredResults, input.sourcePolicy, 5);
      const providerRankByUrl = new Map(
        rawResults.map((result, index) => [result.url, index + 1]),
      );
      const group: RawFinding[] = [];
      for (const result of selectedResults) {
        let scraped = null;
        let robotsDecision: "allowed" | "disallowed" | "unknown" = "allowed";

        if (scraperAdapter) {
          let shouldExtract = true;
          if (crawlPolicy) {
            try {
              const decision = await crawlPolicy.beforeFetch(result.url);
              robotsDecision = decision.robotsDecision;
              shouldExtract = decision.shouldExtract;
            } catch {
              robotsDecision = "unknown";
              shouldExtract = false;
            }
          }

          if (shouldExtract) {
            try {
              scraped = await scraperAdapter.extract(result.url);
            } catch {
              scraped = null;
            }
          }
        }

        const norm = normalizePublication(result, scraped, robotsDecision);
        const title = norm.publication.title || result.title;
        const body = norm.excerpt || result.snippet;

        const signals = {
          primarySource: false,
          publisherIdentified: !!norm.publication.publisherName,
          authorIdentified: norm.publication.authors.length > 0,
          publicationDateIdentified: !!norm.publication.publishedAt,
          duplicateClusterSize: 1,
        };

        let confidence = 0.65;
        if (signals.publisherIdentified) confidence += 0.1;
        if (signals.authorIdentified) confidence += 0.05;
        if (signals.publicationDateIdentified) confidence += 0.05;
        if (norm.fetchMethod === "server_extract") confidence += 0.05;

        group.push({
          source: "news",
          url: norm.publication.canonicalUrl || result.url,
          content: `[${title}]\n${body}`,
          extractedAt: new Date(),
          confidence: Math.min(confidence, 1.0),
          metadata: {
            title,
            query,
            queryIndex,
            providerRank: providerRankByUrl.get(result.url),
            publisherName: norm.publication.publisherName,
          },
          publication: norm.publication,
          previewPolicy: norm.previewPolicy,
          signals,
          excerpt: norm.excerpt,
          contentFingerprint: norm.contentFingerprint,
          fetchMethod: norm.fetchMethod,
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
