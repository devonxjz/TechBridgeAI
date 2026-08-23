import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { SafeDirectScraperAdapter } from "@/adapters/scraper/direct";
import * as urlSafety from "@/adapters/scraper/url-safety";
import { ScrapeError } from "@/adapters/scraper/types";

describe("SafeDirectScraperAdapter Transport & Security", () => {
  let server: http.Server;
  let port: number;
  let receivedHost = "";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      receivedHost = req.headers.host || "";
      const path = req.url || "/";

      if (path === "/normal") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><head><title>Test Title</title></head><body>This is a valid public test page with more than fifty characters of real content.</body></html>");
        return;
      }

      if (path === "/attachment") {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Disposition": "attachment; filename=\"malicious.html\"",
        });
        res.end("<html><body>Downloadable content</body></html>");
        return;
      }

      if (path === "/gzip-encoding") {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Encoding": "gzip",
        });
        res.end("raw gzip bytes");
        return;
      }

      if (path === "/non-text-mime") {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end("%PDF-1.4 binary data");
        return;
      }

      if (path === "/too-large") {
        res.writeHead(200, { "Content-Type": "text/html" });
        // Stream 200 KB in chunks when limit is 100 KB
        for (let i = 0; i < 20; i++) {
          res.write("x".repeat(10240));
        }
        res.end();
        return;
      }

      if (path === "/short-text") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>Too short</body></html>");
        return;
      }

      if (path.startsWith("/redirect-loop-")) {
        const count = parseInt(path.replace("/redirect-loop-", ""), 10);
        res.writeHead(302, { Location: `/redirect-loop-${count + 1}` });
        res.end();
        return;
      }

      if (path === "/redirect-to-normal") {
        res.writeHead(302, { Location: "/normal" });
        res.end();
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        port = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends request to pinned IP with original Host header and parses response", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      return {
        url: parsed,
        address: "127.0.0.1",
        family: 4,
      };
    });

    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    });

    const result = await adapter.extract(`http://my-secure-hostname.test:${port}/normal`);

    expect(receivedHost).toBe(`my-secure-hostname.test:${port}`);
    expect(result.title).toBe("Test Title");
    expect(result.text).toContain("valid public test page with more than fifty characters");
    expect(result.metadata?.provider).toBe("direct");
  });

  it("follows valid redirects up to limit and resolves new location", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      return {
        url: parsed,
        address: "127.0.0.1",
        family: 4,
      };
    });

    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    });

    const result = await adapter.extract(`http://my-secure-hostname.test:${port}/redirect-to-normal`);
    expect(result.title).toBe("Test Title");
  });

  it("throws ScrapeError blocked when redirect count exceeds maxRedirects", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      return {
        url: parsed,
        address: "127.0.0.1",
        family: 4,
      };
    });

    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    });

    try {
      await adapter.extract(`http://my-secure-hostname.test:${port}/redirect-loop-0`);
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("blocked");
    }
  });

  it("rejects Content-Disposition: attachment with blocked code", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      return {
        url: parsed,
        address: "127.0.0.1",
        family: 4,
      };
    });

    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    });

    try {
      await adapter.extract(`http://my-secure-hostname.test:${port}/attachment`);
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("blocked");
    }
  });

  it("rejects non-identity Content-Encoding with blocked code", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      return {
        url: parsed,
        address: "127.0.0.1",
        family: 4,
      };
    });

    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    });

    try {
      await adapter.extract(`http://my-secure-hostname.test:${port}/gzip-encoding`);
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("blocked");
    }
  });

  it("rejects non-text MIME with blocked code", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      return {
        url: parsed,
        address: "127.0.0.1",
        family: 4,
      };
    });

    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    });

    try {
      await adapter.extract(`http://my-secure-hostname.test:${port}/non-text-mime`);
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("blocked");
    }
  });

  it("rejects stream exceeding maxResponseBytes with too_large code", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      return {
        url: parsed,
        address: "127.0.0.1",
        family: 4,
      };
    });

    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 5_000,
      maxResponseBytes: 50 * 1024, // 50 KB limit
      maxRedirects: 3,
    });

    try {
      await adapter.extract(`http://my-secure-hostname.test:${port}/too-large`);
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("too_large");
    }
  });

  it("rejects response with text <= 50 characters with empty code", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      return {
        url: parsed,
        address: "127.0.0.1",
        family: 4,
      };
    });

    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    });

    try {
      await adapter.extract(`http://my-secure-hostname.test:${port}/short-text`);
      expect.unreachable("Should have thrown ScrapeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("empty");
    }
  });
});
