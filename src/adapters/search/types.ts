// ═══════════════════════════════════════════════════════
// Search Adapter — Interface
// ═══════════════════════════════════════════════════════

export interface SearchOptions {
  maxResults?: number;
  language?: string;
  region?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchAdapter {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
