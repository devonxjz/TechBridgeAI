import { describe, expect, it } from "vitest";
import type { RawFinding, SourceExecutionResult, SourceName } from "@/lib/types";
import { prepareEvidence } from "@/modules/research/evidence";

function finding(url: string, confidence: number, content: string, source: SourceName = "website"): RawFinding {
  return {
    source,
    url,
    content,
    confidence,
    extractedAt: new Date("2026-08-25T10:00:00Z"),
  };
}

function succeeded(source: SourceName, ...findings: RawFinding[]): SourceExecutionResult {
  return {
    source,
    status: "succeeded",
    findings,
    attempts: 1,
    durationMs: 100,
  };
}

function failed(source: SourceName, message: string = "error"): SourceExecutionResult {
  return {
    source,
    status: "failed",
    findings: [],
    error: {
      source,
      type: "network_error",
      message,
      retryable: false,
    },
    attempts: 1,
    durationMs: 50,
  };
}

function skipped(source: SourceName): SourceExecutionResult {
  return {
    source,
    status: "skipped",
    findings: [],
    attempts: 0,
    durationMs: 0,
  };
}

describe("prepareEvidence", () => {
  it("drops invalid URLs and keeps the stronger duplicate", () => {
    const prepared = prepareEvidence([
      succeeded("web_search", finding("https://example.com/a", 0.4, "short", "web_search")),
      succeeded("website", finding("https://example.com/a#team", 0.9, "official", "website")),
      succeeded("news", finding("file:///etc/passwd", 1, "invalid", "news")),
      succeeded("news", finding("javascript:alert(1)", 1, "invalid", "news")),
      succeeded("news", finding("not a url", 1, "invalid", "news")),
    ]);

    expect(prepared.findings).toHaveLength(1);
    expect(prepared.findings[0].url).toBe("https://example.com/a");
    expect(prepared.findings[0].content).toContain("official");
    expect(prepared.findings[0].confidence).toBe(0.9);
  });

  it("returns identical evidence order for every completion order", () => {
    const a = succeeded("news", finding("https://news.vn/z", 0.7, "news", "news"));
    const b = succeeded("registry", finding("https://api.vietqr.io/x", 0.9, "registry", "registry"));
    const c = succeeded("website", finding("https://company.vn/about", 0.8, "site", "website"));

    const res1 = prepareEvidence([a, b, c]);
    const res2 = prepareEvidence([c, a, b]);

    expect(res1.findings.map((item) => item.url)).toEqual([
      "https://api.vietqr.io/x",
      "https://company.vn/about",
      "https://news.vn/z",
    ]);
    expect(res1.findings.map((item) => item.url)).toEqual(res2.findings.map((item) => item.url));
  });

  it("computes complete, partial, and failed outcomes", () => {
    const s1 = succeeded("website", finding("https://example.com", 0.9, "content", "website"));
    const s2 = succeeded("news", finding("https://news.com", 0.8, "news", "news"));
    const f1 = failed("registry", "timeout");
    const f2 = failed("web_search", "error");
    const sk = skipped("linkedin");

    expect(prepareEvidence([s1, s2]).outcome).toBe("complete");
    expect(prepareEvidence([s1, s2]).sourceCoverage).toBe(1);

    expect(prepareEvidence([s1, f1, sk]).outcome).toBe("partial");
    expect(prepareEvidence([s1, f1, sk]).sourceCoverage).toBe(0.5);

    expect(prepareEvidence([f1, f2, sk]).outcome).toBe("failed");
    expect(prepareEvidence([f1, f2, sk]).sourceCoverage).toBe(0);
  });
});
