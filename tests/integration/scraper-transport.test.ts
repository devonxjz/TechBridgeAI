import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { AddressInfo } from "node:net";
import { SafeDirectScraperAdapter } from "@/adapters/scraper/direct";
import * as urlSafety from "@/adapters/scraper/url-safety";
import { ScrapeError } from "@/adapters/scraper/types";

describe("SafeDirectScraperAdapter Transport & Security", () => {
  let server: http.Server;
  let httpsServer: https.Server;
  let port: number;
  let httpsPort: number;
  let receivedHost = "";

  const testCertPath = path.resolve(__dirname, "../fixtures/test-cert.pem");
  const testKeyPath = path.resolve(__dirname, "../fixtures/test-key.pem");
  const testCert = fs.readFileSync(testCertPath, "utf-8");
  const testKey = fs.readFileSync(testKeyPath, "utf-8");

  beforeAll(async () => {
    // HTTP Server for transport tests
    server = http.createServer((req, res) => {
      receivedHost = req.headers.host || "";
      const reqPath = req.url || "/";

      if (reqPath === "/normal") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><head><title>Test Title</title></head><body>This is a valid public test page with more than fifty characters of real content.</body></html>");
        return;
      }

      if (reqPath === "/attachment") {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Disposition": "attachment; filename=\"malicious.html\"",
        });
        res.end("<html><body>Downloadable content</body></html>");
        return;
      }

      if (reqPath === "/gzip-encoding") {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Encoding": "gzip",
        });
        res.end("raw gzip bytes");
        return;
      }

      if (reqPath === "/non-text-mime") {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end("%PDF-1.4 binary data");
        return;
      }

      if (reqPath === "/duplicate-content-type") {
        res.setHeader("Content-Type", ["text/html", "text/html"]);
        res.end("<html><body>Duplicate content type headers</body></html>");
        return;
      }

      if (reqPath === "/duplicate-content-length") {
        res.setHeader("Content-Length", ["100", "100"]);
        res.end("x".repeat(100));
        return;
      }

      if (reqPath === "/redirect-to-private") {
        res.writeHead(302, { Location: "http://127.0.0.1/private-endpoint" });
        res.end();
        return;
      }

      if (reqPath === "/slow-stream") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write("<html><body>Starting slow stream ");
        // Delay sending remainder
        setTimeout(() => {
          res.end("finishing with more than fifty characters in total body.</body></html>");
        }, 500);
        return;
      }

      if (reqPath === "/too-large") {
        res.writeHead(200, { "Content-Type": "text/html" });
        for (let i = 0; i < 20; i++) {
          res.write("x".repeat(10240));
        }
        res.end();
        return;
      }

      if (reqPath === "/short-text") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>Too short</body></html>");
        return;
      }

      if (reqPath.startsWith("/redirect-loop-")) {
        const count = parseInt(reqPath.replace("/redirect-loop-", ""), 10);
        res.writeHead(302, { Location: `/redirect-loop-${count + 1}` });
        res.end();
        return;
      }

      if (reqPath === "/redirect-to-normal") {
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

    // HTTPS Server with TLS certificate fixture
    httpsServer = https.createServer({ key: testKey, cert: testCert }, (req, res) => {
      receivedHost = req.headers.host || "";
      const reqPath = req.url || "/";

      if (reqPath === "/normal") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><head><title>HTTPS Test Title</title></head><body>This is a valid public HTTPS test page with more than fifty characters of real content.</body></html>");
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      httpsServer.listen(0, "127.0.0.1", () => {
        const addr = httpsServer.address() as AddressInfo;
        httpsPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => httpsServer.close(() => resolve())),
    ]);
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

  it("rejects duplicate Content-Type headers even if values are identical", async () => {
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
      await adapter.extract(`http://my-secure-hostname.test:${port}/duplicate-content-type`);
      expect.unreachable("Should have rejected duplicate Content-Type");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("blocked");
      expect((err as ScrapeError).message).toContain("Duplicate Content-Type");
    }
  });

  it("rejects duplicate Content-Length headers even if values are identical", async () => {
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
      await adapter.extract(`http://my-secure-hostname.test:${port}/duplicate-content-length`);
      expect.unreachable("Should have rejected duplicate Content-Length");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("blocked");
      expect((err as ScrapeError).message).toContain("Duplicate Content-Length");
    }
  });

  it("rejects redirect to private target during resolution", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      if (parsed.pathname === "/private-endpoint") {
        throw new ScrapeError("Blocked private IP", "direct", "invalid_target");
      }
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
      await adapter.extract(`http://my-secure-hostname.test:${port}/redirect-to-private`);
      expect.unreachable("Should have thrown invalid_target");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("invalid_target");
    }
  });

  it("enforces cumulative deadline across slow connection/stream", async () => {
    vi.spyOn(urlSafety, "resolvePublicTarget").mockImplementation(async (targetUrl: string) => {
      const parsed = new URL(targetUrl);
      return {
        url: parsed,
        address: "127.0.0.1",
        family: 4,
      };
    });

    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 100, // 100ms total deadline, server takes 500ms
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    });

    try {
      await adapter.extract(`http://my-secure-hostname.test:${port}/slow-stream`);
      expect.unreachable("Should have timed out");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("timeout");
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

  it("verifies HTTPS TLS handshake with SNI servername against local HTTPS server with trusted CA", async () => {
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
      ca: [testCert],
    });

    const result = await adapter.extract(`https://test.local:${httpsPort}/normal`);
    expect(receivedHost).toBe(`test.local:${httpsPort}`);
    expect(result.title).toBe("HTTPS Test Title");
    expect(result.text).toContain("valid public HTTPS test page");
  });

  it("rejects HTTPS connection when certificate hostname does not match SNI (active TLS verification)", async () => {
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
      ca: [testCert],
    });

    // Connecting to unmatched-domain.local with test.local cert must fail certificate altname check
    await expect(
      adapter.extract(`https://unmatched-domain.local:${httpsPort}/normal`),
    ).rejects.toThrow();
  });
});
