// ═══════════════════════════════════════════════════════
// TinyFish Scraper Adapter
// ═══════════════════════════════════════════════════════

import { ScrapeError, type ScraperAdapter, type ScrapedContent } from "./types";

interface TinyFishResponse {
  title?: string;
  content?: string;
  text?: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

export class TinyFishScraperAdapter implements ScraperAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.tinyfish.app",
    private readonly timeoutMs = 8_000,
  ) {}

  async extract(url: string): Promise<ScrapedContent> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/extract`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.status === 429) {
        throw new ScrapeError("TinyFish rate limited", "tinyfish", "rate_limited", false);
      }

      if (!response.ok) {
        throw new ScrapeError(
          `TinyFish upstream error: ${response.status} ${response.statusText}`,
          "tinyfish",
          "upstream_error",
        );
      }

      const data = (await response.json()) as TinyFishResponse;
      const text = data.content ?? data.text ?? "";

      if (text.length <= 50) {
        throw new ScrapeError("TinyFish returned empty content", "tinyfish", "empty");
      }

      return {
        url,
        title: data.title ?? "",
        text,
        html: data.html,
        metadata: {
          ...data.metadata,
          provider: "tinyfish",
        },
      };
    } catch (err: unknown) {
      if (err instanceof ScrapeError) {
        throw err;
      }

      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError")
      ) {
        throw new ScrapeError("TinyFish request timed out", "tinyfish", "timeout");
      }

      throw new ScrapeError(
        `TinyFish request failed: ${err instanceof Error ? err.message : String(err)}`,
        "tinyfish",
        "upstream_error",
      );
    }
  }
}
