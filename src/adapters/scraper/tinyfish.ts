// ═══════════════════════════════════════════════════════
// TinyFish Scraper Adapter
// Official TinyFish Fetch API (https://api.fetch.tinyfish.ai)
// ═══════════════════════════════════════════════════════

import {
  ScrapeError,
  type ScrapeOptions,
  type ScraperAdapter,
  type ScrapedContent,
} from "./types";
import { resolvePublicTarget } from "./url-safety";

interface TinyFishResultItem {
  url?: string;
  final_url?: string;
  title?: string;
  description?: string | null;
  text?: string;
  content?: string;
  markdown?: string;
  html?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

interface TinyFishResponse {
  results?: TinyFishResultItem[];
  errors?: Array<{ url?: string; error?: string }>;
  title?: string;
  content?: string;
  text?: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

export class TinyFishScraperAdapter implements ScraperAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.fetch.tinyfish.ai",
    private readonly timeoutMs = 8_000,
  ) {}

  async extract(url: string, options?: ScrapeOptions): Promise<ScrapedContent> {
    const deadlineAt = Date.now() + this.timeoutMs;
    // Enforce SSRF validation: never pass private/forbidden targets to remote proxy
    await resolvePublicTarget(url, deadlineAt);

    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      throw new ScrapeError("TinyFish request timed out", "tinyfish", "timeout");
    }

    try {
      const endpoint = this.baseUrl.endsWith("/")
        ? this.baseUrl.slice(0, -1)
        : this.baseUrl;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "X-API-Key": this.apiKey,
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          urls: [url],
          url,
          format: "markdown",
        }),
        signal: options?.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(remainingMs)])
          : AbortSignal.timeout(remainingMs),
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

      // Handle official results array or flat response
      const firstResult = data.results && data.results.length > 0 ? data.results[0] : null;

      if (!firstResult && data.errors && data.errors.length > 0) {
        const errType = data.errors[0]?.error || "upstream_error";
        const code = errType === "invalid_url" ? "invalid_target" : "upstream_error";
        throw new ScrapeError(`TinyFish error: ${errType}`, "tinyfish", code);
      }

      const text =
        firstResult?.text ??
        firstResult?.content ??
        firstResult?.markdown ??
        data.content ??
        data.text ??
        "";

      if (text.length <= 50) {
        throw new ScrapeError("TinyFish returned empty content", "tinyfish", "empty");
      }

      const title = firstResult?.title ?? data.title ?? "";
      const html = firstResult?.html ?? data.html;
      const metadata = {
        ...(data.metadata ?? {}),
        ...(firstResult?.metadata ?? {}),
        ...(firstResult?.description ? { description: firstResult.description } : {}),
        ...(firstResult?.final_url ? { final_url: firstResult.final_url } : {}),
        provider: "tinyfish" as const,
      };

      return {
        url: firstResult?.url ?? url,
        title,
        text,
        html,
        metadata,
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
