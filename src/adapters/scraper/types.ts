// ═══════════════════════════════════════════════════════
// Scraper Adapter — Interface & Error Types
// ═══════════════════════════════════════════════════════

export type ScraperProvider = "direct" | "jina" | "tinyfish" | "mock";

export type ScrapeErrorCode =
  | "blocked"
  | "timeout"
  | "invalid_target"
  | "too_large"
  | "empty"
  | "rate_limited"
  | "upstream_error";

export interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown> & { provider?: ScraperProvider };
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
  extract(url: string): Promise<ScrapedContent>;
}
