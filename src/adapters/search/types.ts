// ═══════════════════════════════════════════════════════
// Search Adapter — Interface
// ═══════════════════════════════════════════════════════

export interface SearchOptions {
  maxResults?: number;
  language?: string;
  region?: string;
  vertical?: "web" | "news";
  signal?: AbortSignal;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publisherName?: string;
  publishedLabel?: string;
}

export interface SearchAdapter {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

