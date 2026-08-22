// ═══════════════════════════════════════════════════════
// Serper Search Adapter — Google Search via Serper.dev
// ═══════════════════════════════════════════════════════

import type { SearchAdapter, SearchOptions, SearchResult } from "./types";

interface SerperResponse {
  organic: Array<{
    title: string;
    link: string;
    snippet: string;
  }>;
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
    const response = await fetch("https://google.serper.dev/search", {
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
    });

    if (!response.ok) {
      throw new Error(`Serper search failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SerperResponse;

    return (data.organic ?? []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    }));
  }
}
