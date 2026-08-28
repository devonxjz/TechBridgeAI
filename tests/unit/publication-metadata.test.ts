import { describe, it, expect } from "vitest";
import { normalizePublication } from "@/modules/research/publication";
import type { SearchResult } from "@/adapters/search/types";
import type { ScrapedContent } from "@/adapters/scraper/types";

describe("Publication Metadata Normalizer", () => {
  const baseSearchResult: SearchResult = {
    title: "FPT công bố kết quả kinh doanh 2026",
    url: "https://vnexpress.net/fpt-cong-bo-kqkd-2026-12345.html",
    snippet: "Doanh thu FPT tăng trưởng mạnh trong quý vừa qua nhờ mảng công nghệ.",
    publisherName: "VnExpress",
    publishedLabel: "2 ngày trước",
  };

  it("extracts JSON-LD publisher, author, datePublished, canonical, and AMP URLs", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>FPT công bố kết quả kinh doanh 2026 - VnExpress</title>
          <link rel="canonical" href="https://vnexpress.net/kinh-doanh/fpt-cong-bo-kqkd-2026.html" />
          <link rel="amphtml" href="https://amp.vnexpress.net/fpt-cong-bo-kqkd-2026.html" />
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            "headline": "FPT công bố kết quả kinh doanh 2026",
            "datePublished": "2026-08-25T10:00:00.000Z",
            "dateModified": "2026-08-25T12:00:00.000Z",
            "author": [
              { "@type": "Person", "name": "Văn A" }
            ],
            "publisher": {
              "@type": "Organization",
              "name": "Báo VnExpress"
            }
          }
          </script>
        </head>
        <body>
          <article>
            <p>Tập đoàn FPT vừa công bố kết quả kinh doanh với doanh thu kỷ lục.</p>
          </article>
        </body>
      </html>
    `;

    const scraped: ScrapedContent = {
      url: baseSearchResult.url,
      title: baseSearchResult.title,
      text: "Tập đoàn FPT vừa công bố kết quả kinh doanh với doanh thu kỷ lục.",
      html,
    };

    const norm = normalizePublication(baseSearchResult, scraped, "allowed");

    expect(norm.publication.publisherName).toBe("Báo VnExpress");
    expect(norm.publication.publisherDomain).toBe("vnexpress.net");
    expect(norm.publication.authors).toEqual(["Văn A"]);
    expect(norm.publication.publishedAt).toBe("2026-08-25T10:00:00.000Z");
    expect(norm.publication.modifiedAt).toBe("2026-08-25T12:00:00.000Z");
    expect(norm.publication.canonicalUrl).toBe("https://vnexpress.net/kinh-doanh/fpt-cong-bo-kqkd-2026.html");
    expect(norm.publication.ampUrl).toBe("https://amp.vnexpress.net/fpt-cong-bo-kqkd-2026.html");
    expect(norm.fetchMethod).toBe("server_extract");
    expect(norm.excerpt).toContain("Tập đoàn FPT vừa công bố kết quả kinh doanh");
    expect(norm.previewPolicy.mode).toBe("short_excerpt");
  });

  it("handles malformed JSON-LD gracefully with OpenGraph and meta fallback", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:site_name" content="Báo Đầu Tư" />
          <meta name="author" content="Trần Thị B" />
          <meta property="article:published_time" content="2026-08-26T08:30:00.000Z" />
          <script type="application/ld+json">
            { malformed json ld ;;; }
          </script>
        </head>
        <body>
          <main>
            <p>FPT ký kết hợp tác công nghệ chiến lược.</p>
          </main>
        </body>
      </html>
    `;

    const scraped: ScrapedContent = {
      url: "https://baodautu.vn/fpt-ky-ket-hop-tac.html",
      title: "FPT ký kết hợp tác",
      text: "FPT ký kết hợp tác công nghệ chiến lược.",
      html,
    };

    const norm = normalizePublication(
      { ...baseSearchResult, url: scraped.url, publisherName: undefined },
      scraped,
      "allowed",
    );

    expect(norm.publication.publisherName).toBe("Báo Đầu Tư");
    expect(norm.publication.authors).toEqual(["Trần Thị B"]);
    expect(norm.publication.publishedAt).toBe("2026-08-26T08:30:00.000Z");
    expect(norm.excerpt).toContain("FPT ký kết hợp tác");
  });

  it("enforces metadata_only mode when explicit paywall is detected", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            "headline": "Bài viết độc quyền về FPT",
            "isAccessibleForFree": false,
            "publisher": { "@type": "Organization", "name": "Premium News" }
          }
          </script>
        </head>
        <body>
          <p>Nội dung độc quyền chỉ dành cho tài khoản trả phí.</p>
        </body>
      </html>
    `;

    const scraped: ScrapedContent = {
      url: "https://premium.example.com/article",
      title: "Bài viết độc quyền về FPT",
      text: "Nội dung độc quyền chỉ dành cho tài khoản trả phí.",
      html,
    };

    const norm = normalizePublication(baseSearchResult, scraped, "allowed");

    expect(norm.previewPolicy.paywallDetected).toBe(true);
    expect(norm.previewPolicy.isAccessibleForFree).toBe(false);
    expect(norm.previewPolicy.mode).toBe("metadata_only");
    // Must NOT contain extracted paywalled body
    expect(norm.excerpt).toBeUndefined();
  });

  it("respects nosnippet, data-nosnippet, and max-snippet controls", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="robots" content="max-snippet:40, noarchive" />
        </head>
        <body>
          <article>
            <p>Phần công khai.</p>
            <div data-nosnippet>Phần này cấm trích đoạn hiển thị tìm kiếm.</div>
            <p>Phần tiếp theo của bài viết công khai trên báo chí.</p>
          </article>
        </body>
      </html>
    `;

    const scraped: ScrapedContent = {
      url: "https://news.example.com/item",
      title: "Title",
      text: "Phần công khai. Phần này cấm trích đoạn hiển thị tìm kiếm. Phần tiếp theo.",
      html,
    };

    const norm = normalizePublication(baseSearchResult, scraped, "allowed");

    expect(norm.previewPolicy.maxSnippetLength).toBe(40);
    expect(norm.excerpt).not.toContain("Phần này cấm trích đoạn");
    expect((norm.excerpt ?? "").length).toBeLessThanOrEqual(40);
  });

  it("falls back to search snippet when scraping fails or scraped is null", () => {
    const norm = normalizePublication(baseSearchResult, null, "allowed");

    expect(norm.fetchMethod).toBe("search_snippet");
    expect(norm.publication.publisherName).toBe("VnExpress");
    expect(norm.publication.publishedLabel).toBe("2 ngày trước");
    expect(norm.excerpt).toBe(baseSearchResult.snippet);
    expect(norm.contentFingerprint).toBeDefined();
  });
});
