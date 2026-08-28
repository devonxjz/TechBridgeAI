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

describe("Sprint 3 Evidence Normalization & Claim Validation", () => {
  it("groups copied content by fingerprint so three republished articles count as 1 independent source", async () => {
    const { toSourceCitations, buildClaimEvidence } = await import("@/modules/research/evidence");

    const fingerprint = "shared-article-sha256-fingerprint";

    const findings: RawFinding[] = [
      {
        source: "news",
        url: "https://site-a.com/news-1",
        content: "Nội dung bài viết sao chép",
        extractedAt: new Date(),
        confidence: 0.65,
        publication: {
          publisherDomain: "site-a.com",
          publisherName: "Site A",
          authors: ["Author 1"],
        },
        contentFingerprint: fingerprint,
      },
      {
        source: "news",
        url: "https://site-b.com/news-copy",
        content: "Nội dung bài viết sao chép",
        extractedAt: new Date(),
        confidence: 0.65,
        publication: {
          publisherDomain: "site-b.com",
          publisherName: "Site B",
          authors: [],
        },
        contentFingerprint: fingerprint,
      },
      {
        source: "news",
        url: "https://site-c.com/news-mirror",
        content: "Nội dung bài viết sao chép",
        extractedAt: new Date(),
        confidence: 0.65,
        publication: {
          publisherDomain: "site-c.com",
          publisherName: "Site C",
          authors: [],
        },
        contentFingerprint: fingerprint,
      },
    ];

    const citations = toSourceCitations(findings, "https://fpt.com.vn");
    expect(citations).toHaveLength(3);
    expect(citations[0].signals?.duplicateClusterSize).toBe(3);

    const claimEvidence = buildClaimEvidence(
      {
        supportingUrls: [
          "https://site-a.com/news-1",
          "https://site-b.com/news-copy",
          "https://site-c.com/news-mirror",
        ],
      },
      citations,
    );

    expect(claimEvidence.independentPublisherCount).toBe(1);
    expect(claimEvidence.status).toBe("single_source");
  });

  it("produces corroborated status when two distinct publisher domains with different fingerprints support a claim", async () => {
    const { toSourceCitations, buildClaimEvidence } = await import("@/modules/research/evidence");

    const findings: RawFinding[] = [
      {
        source: "news",
        url: "https://vnexpress.net/bai-1",
        content: "FPT đạt doanh thu kỷ lục",
        extractedAt: new Date(),
        confidence: 0.7,
        publication: { publisherDomain: "vnexpress.net", publisherName: "VnExpress", authors: ["Tác giả A"] },
        contentFingerprint: "fingerprint-vnexpress",
      },
      {
        source: "news",
        url: "https://dantri.com.vn/bai-2",
        content: "FPT công bố lợi nhuận tăng mạnh",
        extractedAt: new Date(),
        confidence: 0.7,
        publication: { publisherDomain: "dantri.com.vn", publisherName: "Dân Trí", authors: ["Tác giả B"] },
        contentFingerprint: "fingerprint-dantri",
      },
    ];

    const citations = toSourceCitations(findings);
    const claim = buildClaimEvidence(
      {
        supportingUrls: ["https://vnexpress.net/bai-1", "https://dantri.com.vn/bai-2"],
      },
      citations,
    );

    expect(claim.independentPublisherCount).toBe(2);
    expect(claim.status).toBe("corroborated");
  });

  it("produces primary_source status for official registry or company website citations", async () => {
    const { toSourceCitations, buildClaimEvidence } = await import("@/modules/research/evidence");

    const findings: RawFinding[] = [
      {
        source: "registry",
        url: "https://api.vietqr.io/v2/business/0101248141",
        content: "CÔNG TY CỔ PHẦN FPT - MST 0101248141",
        extractedAt: new Date(),
        confidence: 0.95,
      },
    ];

    const citations = toSourceCitations(findings, "https://fpt.com.vn");
    const claim = buildClaimEvidence(
      { supportingUrls: ["https://api.vietqr.io/v2/business/0101248141"] },
      citations,
    );

    expect(claim.status).toBe("primary_source");
    expect(claim.independentPublisherCount).toBe(1);
  });

  it("discards unknown URLs not in citations allowlist and resolves conflicting URLs", async () => {
    const { toSourceCitations, buildClaimEvidence } = await import("@/modules/research/evidence");

    const findings: RawFinding[] = [
      {
        source: "news",
        url: "https://vnexpress.net/fpt-1",
        content: "FPT mở rộng sang AI",
        extractedAt: new Date(),
        confidence: 0.7,
        publication: { publisherDomain: "vnexpress.net", authors: [] },
        contentFingerprint: "fp-1",
      },
      {
        source: "news",
        url: "https://dantri.com.vn/fpt-conflict",
        content: "FPT phủ nhận mở rộng sang AI",
        extractedAt: new Date(),
        confidence: 0.7,
        publication: { publisherDomain: "dantri.com.vn", authors: [] },
        contentFingerprint: "fp-2",
      },
    ];

    const citations = toSourceCitations(findings);

    // Case 1: Unknown URL discarded
    const unknownClaim = buildClaimEvidence(
      { supportingUrls: ["https://invented-site.com/fake"] },
      citations,
    );
    expect(unknownClaim.supportingUrls).toEqual([]);
    expect(unknownClaim.status).toBe("insufficient");

    // Case 2: Conflicting URL wins over supporting and resolves to conflicting
    const conflictClaim = buildClaimEvidence(
      {
        supportingUrls: ["https://vnexpress.net/fpt-1", "https://dantri.com.vn/fpt-conflict"],
        conflictingUrls: ["https://dantri.com.vn/fpt-conflict"],
      },
      citations,
    );
    expect(conflictClaim.supportingUrls).toEqual(["https://vnexpress.net/fpt-1"]);
    expect(conflictClaim.conflictingUrls).toEqual(["https://dantri.com.vn/fpt-conflict"]);
    expect(conflictClaim.status).toBe("conflicting");
  });
});

