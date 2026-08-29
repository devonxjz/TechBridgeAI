// ═══════════════════════════════════════════════════════
// Scraper Adapter — Interface & Error Types
// ═══════════════════════════════════════════════════════

export type ScraperProvider = "direct" | "jina" | "tinyfish";

export type ScrapeErrorCode =
  | "blocked"
  | "timeout"
  | "invalid_target"
  | "too_large"
  | "empty"
  | "not_found"
  | "rate_limited"
  | "upstream_error";

export interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown> & { provider?: ScraperProvider };
}

export interface ScrapeOptions {
  signal?: AbortSignal;
}

export class ScrapeError extends Error {
  constructor(
    message: string,
    readonly provider: ScraperProvider,
    readonly code: ScrapeErrorCode,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}

export interface ScraperAdapter {
  extract(url: string, options?: ScrapeOptions): Promise<ScrapedContent>;
}
