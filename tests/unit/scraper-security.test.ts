import { describe, expect, it, vi } from "vitest";
import { isPublicAddress, resolvePublicTarget } from "@/adapters/scraper/url-safety";
import { SafeDirectScraperAdapter } from "@/adapters/scraper/direct";
import { ScrapeError } from "@/adapters/scraper/types";
import dns from "node:dns/promises";

describe("isPublicAddress", () => {
  it("rejects private, loopback, link-local, and reserved IPv4 addresses", () => {
    const invalidIpv4 = [
      "0.0.0.0",
      "0.255.255.255",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1",
      "100.127.255.255",
      "127.0.0.1",
      "127.255.255.254",
      "169.254.169.254",
      "169.254.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "192.168.1.1",
      "192.168.254.254",
      "198.18.0.1",
      "198.19.255.255",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "239.255.255.255",
      "240.0.0.1",
      "255.255.255.255",
    ];

    for (const ip of invalidIpv4) {
      expect(isPublicAddress(ip), `Expected ${ip} to be rejected`).toBe(false);
    }
  });

  it("rejects private, loopback, link-local, documentation, and non-global IPv6 addresses", () => {
    const invalidIpv6 = [
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.1.1",
      "::ffff:8.8.8.8",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
      "2001:db8::1",
      "100::1",
      "64:ff9b::1",
    ];

    for (const ip of invalidIpv6) {
      expect(isPublicAddress(ip), `Expected ${ip} to be rejected`).toBe(false);
    }
  });

  it("accepts valid public IPv4 and global unicast IPv6 addresses", () => {
    const validPublic = [
      "8.8.8.8",
      "1.1.1.1",
      "142.250.190.46",
      "2607:f8b0:4005:805::200e",
      "2001:4860:4860::8888",
    ];

    for (const ip of validPublic) {
      expect(isPublicAddress(ip), `Expected ${ip} to be accepted`).toBe(true);
    }
  });
});

describe("resolvePublicTarget", () => {
  it("rejects invalid schemes and URLs with credentials", async () => {
    const invalidUrls = [
      "ftp://example.com",
      "file:///etc/passwd",
      "gopher://example.com",
      "http://user:pass@example.com",
      "https://user@example.com",
    ];

    for (const url of invalidUrls) {
      await expect(resolvePublicTarget(url)).rejects.toThrow(ScrapeError);
    }
  });

  it("rejects localhost and metadata hostnames", async () => {
    const blockedHosts = [
      "http://localhost",
      "http://localhost:8080",
      "http://app.localhost",
      "http://metadata.google.internal",
      "http://169.254.169.254",
      "http://instance-data",
    ];

    for (const url of blockedHosts) {
      await expect(resolvePublicTarget(url)).rejects.toThrow(ScrapeError);
    }
  });

  it("rejects alternate loopback encodings", async () => {
    const alternateLoopbacks = [
      "http://2130706433/",
      "http://0177.0.0.1/",
      "http://0x7f000001/",
      "http://[::ffff:127.0.0.1]/",
    ];

    for (const url of alternateLoopbacks) {
      await expect(resolvePublicTarget(url)).rejects.toThrow(ScrapeError);
    }
  });

  it("rejects hostname when DNS returns mixed public and private IPs", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "192.168.1.1", family: 4 },
    ] as any);

    await expect(resolvePublicTarget("https://mixed.example.com")).rejects.toThrow(ScrapeError);
  });

  it("rejects hostname when DNS lookup fails or returns zero answers", async () => {
    vi.spyOn(dns, "lookup").mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(resolvePublicTarget("https://notfound.example.com")).rejects.toThrow(ScrapeError);

    vi.spyOn(dns, "lookup").mockResolvedValueOnce([] as any);
    await expect(resolvePublicTarget("https://empty-dns.example.com")).rejects.toThrow(ScrapeError);
  });
});

describe("SafeDirectScraperAdapter HTML and response bounds", () => {
  it("handles repeated unclosed script and style tags linearly without catastrophic backtracking", async () => {
    const adapter = new SafeDirectScraperAdapter({
      timeoutMs: 8_000,
      maxResponseBytes: 1_048_576,
      maxRedirects: 3,
    });

    // 256 KiB repeated unclosed tags
    const unclosedHtml = "<html><body>" + "<script>var x = 1; ".repeat(16384) + "Hello World</body></html>";
    const startTime = Date.now();
    
    // We can test extractHtmlText directly via internal or extract
    const clean = (adapter as any).cleanHtml(unclosedHtml);
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(3000);
    expect(clean).toBe("");
  });
});
