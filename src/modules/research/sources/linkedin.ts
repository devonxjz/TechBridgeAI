// ═══════════════════════════════════════════════════════
// Research Module — Source: LinkedIn (user-provided URL only)
// ═══════════════════════════════════════════════════════

import type { CompanyInput, RawFinding } from "@/lib/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";

/**
 * Extract info from a user-provided LinkedIn company page URL.
 * Does NOT auto-discover LinkedIn pages (too risky for scraping).
 */
export async function scrapeLinkedIn(
  input: CompanyInput,
  scraperAdapter: ScraperAdapter
): Promise<RawFinding[]> {
  if (!input.linkedinUrl) return [];

  try {
    const page = await scraperAdapter.extract(input.linkedinUrl);

    if (page.text.length < 50) return [];

    return [
      {
        source: "linkedin",
        url: input.linkedinUrl,
        content: page.text.slice(0, 5_000),
        extractedAt: new Date(),
        confidence: 0.7,
        metadata: { title: page.title },
      },
    ];
  } catch {
    // LinkedIn scraping is unreliable, fail silently
    return [];
  }
}
