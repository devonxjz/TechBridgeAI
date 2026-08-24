// ═══════════════════════════════════════════════════════
// Research Module — Source: Website Scraping
// ═══════════════════════════════════════════════════════

import type { CompanyInput, RawFinding } from "@/lib/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";
import type { SearchAdapter } from "@/adapters/search/types";

/**
 * Extract information from the company's official website.
 * If no website URL provided, tries to discover it via search.
 * Strictly respects maxPages budget (including homepage and failed attempts).
 */
export async function scrapeWebsite(
  input: CompanyInput,
  scraperAdapter: ScraperAdapter,
  searchAdapter: SearchAdapter,
  maxPages = 5,
): Promise<RawFinding[]> {
  const websiteUrl = input.website ?? (await discoverWebsite(input, searchAdapter));

  if (!websiteUrl) {
    return [];
  }

  const findings: RawFinding[] = [];
  let pagesScraped = 0;
  let lastError: Error | null = null;

  // Scrape main page
  if (pagesScraped < maxPages) {
    pagesScraped++;
    try {
      const mainPage = await scraperAdapter.extract(websiteUrl);
      if (mainPage.text.length > 50) {
        findings.push({
          source: "website",
          url: websiteUrl,
          content: mainPage.text.slice(0, 10_000), // Cap content length
          extractedAt: new Date(),
          confidence: 0.85,
          metadata: { title: mainPage.title, section: "main" },
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "invalid_target") {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Try to scrape key subpages
  const subpages = ["/about", "/about-us", "/gioi-thieu", "/ve-chung-toi", "/products", "/san-pham"];
  for (const path of subpages) {
    if (pagesScraped >= maxPages) {
      break;
    }
    pagesScraped++;

    try {
      const url = new URL(path, websiteUrl).toString();
      const page = await scraperAdapter.extract(url);
      if (page.text.length > 50) {
        findings.push({
          source: "website",
          url,
          content: page.text.slice(0, 5_000),
          extractedAt: new Date(),
          confidence: 0.8,
          metadata: { title: page.title, section: path },
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "invalid_target") {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (findings.length === 0 && lastError) {
    throw lastError;
  }

  return findings;
}

async function discoverWebsite(
  input: CompanyInput,
  searchAdapter: SearchAdapter,
): Promise<string | null> {
  const results = await searchAdapter.search(
    `"${input.name}" official website`,
    { maxResults: 3 }
  );

  // Return the first result that looks like a company website
  for (const result of results) {
    const url = result.url.toLowerCase();
    // Skip social media, news, and aggregator sites
    if (
      !url.includes("facebook.com") &&
      !url.includes("linkedin.com") &&
      !url.includes("wikipedia.org") &&
      !url.includes("youtube.com")
    ) {
      return result.url;
    }
  }

  return null;
}
