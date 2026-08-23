import { afterEach, describe, expect, it, vi } from "vitest";
import { JinaReaderScraperAdapter } from "@/adapters/scraper/jina";
import { TieredScraperAdapter } from "@/adapters/scraper/tiered";
import { TinyFishScraperAdapter } from "@/adapters/scraper/tinyfish";
import { ScrapeError, type ScraperAdapter } from "@/adapters/scraper/types";

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

describe("JinaReaderScraperAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends request with fixed origin and auth header and returns valid content with provider metadata", async () => {
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      return new Response(
        "Title: Example Title\n\nThis is long enough content fetched from Jina reader that exceeds fifty characters comfortably.",
        {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        },
      );
    });

    const adapter = new JinaReaderScraperAdapter("test-jina-key");
    const result = await adapter.extract("https://example.com/target?param=1");

    expect(capturedUrl).toBe("https://r.jina.ai/https://example.com/target?param=1");
    expect((capturedHeaders as Record<string, string>)["Authorization"]).toBe("Bearer test-jina-key");
    expect(result.url).toBe("https://example.com/target?param=1");
    expect(result.title).toBe("Example Title");
    expect(result.text).toContain("long enough content fetched from Jina reader");
    expect(result.metadata?.provider).toBe("jina");
  });

  it("throws ScrapeError rate_limited on 429 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Rate limit reached", { status: 429 }),
    );

    const adapter = new JinaReaderScraperAdapter("test-jina-key");
    try {
      await adapter.extract("https://example.com");
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      const scrapeError = err as ScrapeError;
      expect(scrapeError.provider).toBe("jina");
      expect(scrapeError.code).toBe("rate_limited");
      expect(scrapeError.retryable).toBe(false);
    }
  });

  it("throws ScrapeError upstream_error on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal error", { status: 502 }),
    );

    const adapter = new JinaReaderScraperAdapter("test-jina-key");
    try {
      await adapter.extract("https://example.com");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("upstream_error");
    }
  });

  it("throws ScrapeError empty when response text <= 50 characters", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Short text", { status: 200 }),
    );

    const adapter = new JinaReaderScraperAdapter("test-jina-key");
    try {
      await adapter.extract("https://example.com");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("empty");
    }
  });

  it("throws ScrapeError timeout on abort", async () => {
    const abortErr = new Error("Timeout");
    abortErr.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortErr);

    const adapter = new JinaReaderScraperAdapter("test-jina-key");
    try {
      await adapter.extract("https://example.com");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("timeout");
    }
  });
});

describe("TieredScraperAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("short-circuits on tier 1 success without calling subsequent tiers", async () => {
    const tier1: ScraperAdapter = {
      extract: vi.fn().mockResolvedValue({
        url: "https://example.com",
        title: "Tier 1 Title",
        text: "Tier 1 content with more than 50 chars of useful information.",
        metadata: { provider: "direct" },
      }),
    };
    const tier2: ScraperAdapter = { extract: vi.fn() };
    const tier3: ScraperAdapter = { extract: vi.fn() };

    const tiered = new TieredScraperAdapter([tier1, tier2, tier3]);
    const res = await tiered.extract("https://example.com");

    expect(res.title).toBe("Tier 1 Title");
    expect(tier1.extract).toHaveBeenCalledTimes(1);
    expect(tier2.extract).not.toHaveBeenCalled();
    expect(tier3.extract).not.toHaveBeenCalled();
  });

  it("falls back to next tiers on recoverable errors (blocked -> jina -> tinyfish)", async () => {
    const tier1: ScraperAdapter = {
      extract: vi.fn().mockRejectedValue(new ScrapeError("Blocked by CF", "direct", "blocked")),
    };
    const tier2: ScraperAdapter = {
      extract: vi.fn().mockRejectedValue(new ScrapeError("Jina timeout", "jina", "timeout")),
    };
    const tier3: ScraperAdapter = {
      extract: vi.fn().mockResolvedValue({
        url: "https://example.com",
        title: "TinyFish Title",
        text: "TinyFish retrieved content successfully with over 50 chars.",
        metadata: { provider: "tinyfish" },
      }),
    };

    const tiered = new TieredScraperAdapter([tier1, tier2, tier3]);
    const res = await tiered.extract("https://example.com");

    expect(res.title).toBe("TinyFish Title");
    expect(tier1.extract).toHaveBeenCalledTimes(1);
    expect(tier2.extract).toHaveBeenCalledTimes(1);
    expect(tier3.extract).toHaveBeenCalledTimes(1);
  });

  it("stops immediately on invalid_target without calling remote tiers", async () => {
    const tier1: ScraperAdapter = {
      extract: vi.fn().mockRejectedValue(new ScrapeError("Blocked private IP", "direct", "invalid_target")),
    };
    const tier2: ScraperAdapter = { extract: vi.fn() };
    const tier3: ScraperAdapter = { extract: vi.fn() };

    const tiered = new TieredScraperAdapter([tier1, tier2, tier3]);
    try {
      await tiered.extract("http://127.0.0.1");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("invalid_target");
      expect(tier1.extract).toHaveBeenCalledTimes(1);
      expect(tier2.extract).not.toHaveBeenCalled();
      expect(tier3.extract).not.toHaveBeenCalled();
    }
  });

  it("throws aggregate ScrapeError with deterministic attempts string when all tiers fail", async () => {
    const tier1: ScraperAdapter = {
      extract: vi.fn().mockRejectedValue(new ScrapeError("Direct blocked", "direct", "blocked")),
    };
    const tier2: ScraperAdapter = {
      extract: vi.fn().mockRejectedValue(new ScrapeError("Jina empty", "jina", "empty")),
    };
    const tier3: ScraperAdapter = {
      extract: vi.fn().mockRejectedValue(new ScrapeError("TinyFish 500", "tinyfish", "upstream_error")),
    };

    const tiered = new TieredScraperAdapter([tier1, tier2, tier3]);
    try {
      await tiered.extract("https://example.com");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).message).toContain("direct:blocked -> jina:empty -> tinyfish:upstream_error");
    }
  });

  it("handles Jina 429 by logging outcome jina_rate_limited and calling TinyFish exactly once", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const tier1: ScraperAdapter = {
      extract: vi.fn().mockRejectedValue(new ScrapeError("Direct timeout", "direct", "timeout")),
    };
    const tier2: ScraperAdapter = {
      extract: vi.fn().mockRejectedValue(new ScrapeError("Jina 429", "jina", "rate_limited", false)),
    };
    const tier3: ScraperAdapter = {
      extract: vi.fn().mockResolvedValue({
        url: "https://example.com/path?secret_token=123",
        title: "TinyFish Success",
        text: "Content from TinyFish that is longer than fifty characters for sure.",
        metadata: { provider: "tinyfish" },
      }),
    };

    const tiered = new TieredScraperAdapter([tier1, tier2, tier3]);
    const result = await tiered.extract("https://example.com/path?secret_token=123");

    expect(result.title).toBe("TinyFish Success");
    expect(tier2.extract).toHaveBeenCalledTimes(1);
    expect(tier3.extract).toHaveBeenCalledTimes(1);

    // Verify structured logs:
    // Event has outcome "jina_rate_limited", provider "jina", hostname "example.com", and NO raw query/key/body
    const loggedObjects = logSpy.mock.calls.map(([arg]) => {
      try {
        return JSON.parse(arg);
      } catch {
        return null;
      }
    }).filter(Boolean);

    const jinaLog = loggedObjects.find((l) => l.provider === "jina");
    expect(jinaLog).toBeDefined();
    expect(jinaLog.outcome).toBe("jina_rate_limited");
    expect(jinaLog.hostname).toBe("example.com");
    expect(jinaLog.duration).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(jinaLog)).not.toContain("secret_token");
  });
});
