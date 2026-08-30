// ═══════════════════════════════════════════════════════
// Jina Reader Scraper Adapter
// ═══════════════════════════════════════════════════════

import {
  ScrapeError,
  type ScrapeOptions,
  type ScraperAdapter,
  type ScrapedContent,
} from "./types";
import { resolvePublicTarget } from "./url-safety";

export class JinaReaderScraperAdapter implements ScraperAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 8_000,
  ) {}

  async extract(url: string, options?: ScrapeOptions): Promise<ScrapedContent> {
    const deadlineAt = Date.now() + this.timeoutMs;
    // Enforce SSRF validation: never pass private/forbidden targets to remote proxy
    await resolvePublicTarget(url, deadlineAt);

    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      throw new ScrapeError("Jina Reader request timed out", "jina", "timeout");
    }

    try {
      const headers: Record<string, string> = {
        Accept: "text/plain",
      };

      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const jinaUrl = `https://r.jina.ai/${url}`;
      const response = await fetch(jinaUrl, {
        method: "GET",
        headers,
        signal: options?.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(remainingMs)])
          : AbortSignal.timeout(remainingMs),
      });

      if (response.status === 429) {
        throw new ScrapeError("Jina Reader rate limited", "jina", "rate_limited", false);
      }

      if (!response.ok) {
        throw new ScrapeError(
          `Jina Reader upstream error: ${response.status} ${response.statusText}`,
          "jina",
          "upstream_error",
        );
      }

      const text = await response.text();
      if (text.length <= 50) {
        throw new ScrapeError("Jina Reader returned empty content", "jina", "empty");
      }

      const titleMatch = text.match(/^Title:\s*(.+)$/im) || text.match(/^#\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : "";

      return {
        url,
        title,
        text: text.slice(0, 10000),
        metadata: {
          provider: "jina",
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
        throw new ScrapeError("Jina Reader request timed out", "jina", "timeout");
      }

      throw new ScrapeError(
        `Jina Reader request failed: ${err instanceof Error ? err.message : String(err)}`,
        "jina",
        "upstream_error",
      );
    }
  }
}
