import { afterEach, describe, expect, it, vi } from "vitest";
import { TinyFishScraperAdapter } from "@/adapters/scraper/tinyfish";
import { ScrapeError } from "@/adapters/scraper/types";

describe("TinyFishScraperAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts text successfully and attaches provider metadata", async () => {
    const mockResponse = {
      title: "Test Page",
      content: "This is valid scraped content that is longer than fifty characters for sure.",
      html: "<p>This is valid scraped content that is longer than fifty characters for sure.</p>",
      metadata: { author: "John" },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new TinyFishScraperAdapter("test-key");
    const result = await adapter.extract("https://example.com");

    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Test Page");
    expect(result.text).toBe(mockResponse.content);
    expect(result.html).toBe(mockResponse.html);
    expect(result.metadata).toEqual({
      author: "John",
      provider: "tinyfish",
    });
  });

  it("throws ScrapeError with upstream_error on non-2xx status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server error", { status: 500 }),
    );

    const adapter = new TinyFishScraperAdapter("test-key");
    await expect(adapter.extract("https://example.com")).rejects.toThrow(ScrapeError);

    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Server error", { status: 500 }),
      );
      await adapter.extract("https://example.com");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      const scrapeError = err as ScrapeError;
      expect(scrapeError.provider).toBe("tinyfish");
      expect(scrapeError.code).toBe("upstream_error");
    }
  });

  it("throws ScrapeError with rate_limited on 429 status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Too Many Requests", { status: 429 }),
    );

    const adapter = new TinyFishScraperAdapter("test-key");
    try {
      await adapter.extract("https://example.com");
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      const scrapeError = err as ScrapeError;
      expect(scrapeError.provider).toBe("tinyfish");
      expect(scrapeError.code).toBe("rate_limited");
      expect(scrapeError.retryable).toBe(false);
    }
  });

  it("throws ScrapeError with empty when content is <= 50 characters", async () => {
    const mockResponse = {
      title: "Short",
      content: "Too short",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new TinyFishScraperAdapter("test-key");
    try {
      await adapter.extract("https://example.com");
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      const scrapeError = err as ScrapeError;
      expect(scrapeError.provider).toBe("tinyfish");
      expect(scrapeError.code).toBe("empty");
    }
  });

  it("throws ScrapeError with upstream_error on fetch rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network failure"));

    const adapter = new TinyFishScraperAdapter("test-key");
    try {
      await adapter.extract("https://example.com");
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      const scrapeError = err as ScrapeError;
      expect(scrapeError.provider).toBe("tinyfish");
      expect(scrapeError.code).toBe("upstream_error");
    }
  });

  it("throws ScrapeError with timeout on request timeout/abort", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const adapter = new TinyFishScraperAdapter("test-key");
    try {
      await adapter.extract("https://example.com");
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      const scrapeError = err as ScrapeError;
      expect(scrapeError.provider).toBe("tinyfish");
      expect(scrapeError.code).toBe("timeout");
    }
  });
});
