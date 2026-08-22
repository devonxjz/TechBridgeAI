// ═══════════════════════════════════════════════════════
// Scraper Adapter — Interface
// ═══════════════════════════════════════════════════════

export interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  html?: string;
  metadata?: Record<string, string>;
}

export interface ScraperAdapter {
  extract(url: string): Promise<ScrapedContent>;
}
