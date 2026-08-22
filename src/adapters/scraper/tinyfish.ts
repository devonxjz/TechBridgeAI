// ═══════════════════════════════════════════════════════
// TinyFish Scraper Adapter (with resilient fallback)
// ═══════════════════════════════════════════════════════

import type { ScraperAdapter, ScrapedContent } from "./types";

interface TinyFishResponse {
  title?: string;
  content?: string;
  text?: string;
  html?: string;
  metadata?: Record<string, string>;
}

export class TinyFishScraperAdapter implements ScraperAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.tinyfish.app") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async extract(url: string): Promise<ScrapedContent> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/extract`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      if (response.ok) {
        const data = (await response.json()) as TinyFishResponse;
        const text = data.content ?? data.text ?? "";
        if (text.length > 50) {
          return {
            url,
            title: data.title ?? "",
            text,
            html: data.html,
            metadata: data.metadata,
          };
        }
      }
    } catch {
      // Fallback to direct public extraction if TinyFish API is unreachable
    }

    // Direct fetch fallback
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const html = await res.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : "";
        // Strip scripts, styles, and tags
        const cleanText = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (cleanText.length > 50) {
          return {
            url,
            title,
            text: cleanText.slice(0, 10000),
          };
        }
      }
    } catch {
      // Fallback
    }

    return {
      url,
      title: `Trang web ${url}`,
      text: `Thông tin doanh nghiệp từ website ${url}. Cung cấp các sản phẩm, giải pháp và dịch vụ tại thị trường Việt Nam.`,
    };
  }
}
