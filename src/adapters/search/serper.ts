// ═══════════════════════════════════════════════════════
// Serper Search Adapter — Google Search via Serper.dev
// ═══════════════════════════════════════════════════════

import type { SearchAdapter, SearchOptions, SearchResult } from "./types";

interface SerperItem {
  title: string;
  link: string;
  snippet: string;
  source?: string;
  date?: string;
}

interface SerperResponse {
  organic?: SerperItem[];
  news?: SerperItem[];
}

export class SerperSearchAdapter implements SearchAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const isNews = options?.vertical === "news";
    const endpoint = isNews
      ? "https://google.serper.dev/news"
      : "https://google.serper.dev/search";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-API-KEY": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: options?.maxResults ?? 10,
        gl: options?.region ?? "vn",
        hl: options?.language ?? "vi",
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`Serper search failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SerperResponse;
    const items = isNews ? data.news ?? [] : data.organic ?? [];

    return items.map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      publisherName: item.source,
      publishedLabel: item.date,
    }));
  }
}

