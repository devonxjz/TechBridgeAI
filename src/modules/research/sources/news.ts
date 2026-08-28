import type { CompanyInput, RawFinding } from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";
import { buildResearchQueries, applyDomainPolicy } from "../queries";
import { normalizePublication } from "../publication";

export interface CrawlDecisionLike {
  robotsDecision: "allowed" | "disallowed" | "unknown";
  shouldExtract: boolean;
}

export interface CrawlPolicyLike {
  beforeFetch(url: string, signal?: AbortSignal): Promise<CrawlDecisionLike>;
}

/**
 * Search for recent news about the company and normalize publication provenance.
 */
export async function searchNews(
  input: CompanyInput,
  searchAdapter: SearchAdapter,
  scraperAdapter?: ScraperAdapter,
  crawlPolicy?: CrawlPolicyLike,
  customQueries?: string[]
): Promise<RawFinding[]> {
  const queries = customQueries ?? buildResearchQueries(input).news;
  const findings: RawFinding[] = [];

  let companyHostname: string | undefined;
  if (input.website) {
    try {
      companyHostname = new URL(input.website).hostname.toLowerCase();
    } catch {
      // Ignore malformed website input
    }
  }

  const resultsByQuery = await Promise.all(
    queries.map(async (query) => {
      const rawResults = await searchAdapter.search(query, {
        maxResults: 10,
        language: "vi",
        region: "vn",
        vertical: "news",
      });

      // Filter out company's own website
      const filteredResults = rawResults.filter((result) => {
        if (!companyHostname) return true;
        try {
          const resHost = new URL(result.url).hostname.toLowerCase();
          return resHost !== companyHostname && !resHost.endsWith(`.${companyHostname}`);
        } catch {
          return true;
        }
      });

      // Apply domain policy
      const selectedResults = applyDomainPolicy(filteredResults, input.sourcePolicy, 5);

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

        group.push({
          source: "news",
          url: norm.publication.canonicalUrl || result.url,
          content: `[${title}]\n${body}`,
          extractedAt: new Date(),
          confidence: 0.65,
          metadata: {
            title,
            query,
            publisherName: norm.publication.publisherName,
          },
          publication: norm.publication,
          previewPolicy: norm.previewPolicy,
          signals: {
            primarySource: false,
            publisherIdentified: !!norm.publication.publisherName,
            authorIdentified: norm.publication.authors.length > 0,
            publicationDateIdentified: !!norm.publication.publishedAt,
            duplicateClusterSize: 1,
          },
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



