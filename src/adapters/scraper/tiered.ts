// ═══════════════════════════════════════════════════════
// Tiered Scraper Adapter (Ordered Fallback Chain)
// ═══════════════════════════════════════════════════════

import {
  ScrapeError,
  type ScrapeOptions,
  type ScraperAdapter,
  type ScrapedContent,
  type ScraperProvider,
  type ScrapeErrorCode,
} from "./types";

export interface ScrapeAttempt {
  provider: ScraperProvider;
  code: ScrapeErrorCode;
}

export class TieredScraperAdapter implements ScraperAdapter {
  constructor(private readonly tiers: readonly ScraperAdapter[]) {}

  async extract(url: string, options?: ScrapeOptions): Promise<ScrapedContent> {
    let targetHost = "unknown";
    try {
      targetHost = new URL(url).hostname;
    } catch {
      targetHost = "invalid-url";
    }

    const attempts: ScrapeAttempt[] = [];

    for (const tier of this.tiers) {
      const startTime = Date.now();
      try {
        const content = await tier.extract(url, options);
        const duration = Date.now() - startTime;
        const provider: ScraperProvider =
          (content.metadata?.provider as ScraperProvider) || "direct";

        console.log(
          JSON.stringify({
            event: "scrape_attempt",
            provider,
            hostname: targetHost,
            duration,
            outcome: "success",
          }),
        );

        return content;
      } catch (err: unknown) {
        if (options?.signal?.aborted) {
          throw err;
        }
        const duration = Date.now() - startTime;
        const provider: ScraperProvider =
          err instanceof ScrapeError ? err.provider : "direct";
        const code: ScrapeErrorCode =
          err instanceof ScrapeError ? err.code : "upstream_error";

        const outcome =
          provider === "jina" && code === "rate_limited"
            ? "jina_rate_limited"
            : code;

        console.log(
          JSON.stringify({
            event: "scrape_attempt",
            provider,
            hostname: targetHost,
            duration,
            outcome,
          }),
        );

        attempts.push({ provider, code });

        // Terminal error: invalid target stops entire chain immediately
        if (code === "invalid_target") {
          throw err instanceof ScrapeError
            ? err
            : new ScrapeError("Invalid target URL or hostname", "direct", "invalid_target");
        }
      }
    }

    const attemptsSummary = attempts
      .map((a) => `${a.provider}:${a.code}`)
      .join(" -> ");

    throw new ScrapeError(
      `All scraper tiers failed: ${attemptsSummary}`,
      attempts[attempts.length - 1]?.provider || "direct",
      attempts[attempts.length - 1]?.code || "upstream_error",
    );
  }
}
