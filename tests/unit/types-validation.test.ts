import { describe, it, expect } from "vitest";
import { CompanyInputSchema, type CompanyInput } from "@/lib/types";

describe("Domain Validation - CompanyInputSchema", () => {
  it("validates a minimal valid company input", () => {
    const input: CompanyInput = {
      name: "FPT Corporation",
    };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("FPT Corporation");
    }
  });

  it("validates a full company input with optional fields", () => {
    const input: CompanyInput = {
      name: "Tập đoàn Vingroup",
      website: "https://vingroup.net",
      taxId: "0101245486",
      linkedinUrl: "https://www.linkedin.com/company/vingroup",
      additionalKeywords: ["bất động sản", "xe điện", "công nghệ"],
    };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.website).toBe("https://vingroup.net");
      expect(result.data.additionalKeywords?.length).toBe(3);
    }
  });

  it("rejects empty company name", () => {
    const input = { name: "" };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects company name exceeding 200 characters", () => {
    const input = { name: "A".repeat(201) };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid website URLs", () => {
    const input = { name: "Test Corp", website: "not-a-url" };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects more than 5 additional keywords", () => {
    const input = {
      name: "Test Corp",
      additionalKeywords: ["k1", "k2", "k3", "k4", "k5", "k6"],
    };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("validates SourceDomainPolicySchema with broad, prefer, and only modes", async () => {
    const { SourceDomainPolicySchema } = await import("@/lib/types");
    
    // Broad mode can have empty domains
    const broadResult = SourceDomainPolicySchema.safeParse({
      mode: "broad",
      domains: [],
    });
    expect(broadResult.success).toBe(true);

    // Prefer mode normalizes domains
    const preferResult = SourceDomainPolicySchema.safeParse({
      mode: "prefer",
      domains: ["  VNEXPRESS.NET  ", "dantri.com.vn", "vnexpress.net"],
    });
    expect(preferResult.success).toBe(true);
    if (preferResult.success) {
      expect(preferResult.data.domains).toEqual(["vnexpress.net", "dantri.com.vn"]);
    }

    // Only mode requires at least one domain
    const emptyOnlyResult = SourceDomainPolicySchema.safeParse({
      mode: "only",
      domains: [],
    });
    expect(emptyOnlyResult.success).toBe(false);

    // Rejects protocols, paths, or credentials in domains
    expect(
      SourceDomainPolicySchema.safeParse({
        mode: "prefer",
        domains: ["https://vnexpress.net"],
      }).success,
    ).toBe(false);

    expect(
      SourceDomainPolicySchema.safeParse({
        mode: "prefer",
        domains: ["vnexpress.net/news"],
      }).success,
    ).toBe(false);

    // Caps at 20 domains
    const over20 = Array.from({ length: 21 }, (_, i) => `domain${i}.com`);
    expect(
      SourceDomainPolicySchema.safeParse({
        mode: "prefer",
        domains: over20,
      }).success,
    ).toBe(false);
  });
});

describe("Sprint 0 Provenance and Claim Verification Schemas", () => {
  it("accepts a rich source citation and claim evidence with paywall and metadata_only", async () => {
    const {
      SourceCitationSchema,
      ClaimEvidenceSchema,
    } = await import("@/lib/types");

    const citation = {
      source: "news",
      url: "https://vnexpress.net/kinh-doanh/fpt-mo-rong-ai",
      accessedAt: "2026-08-28T00:00:00.000Z",
      fieldsContributed: ["recentActivities"],
      publication: {
        title: "FPT mở rộng nghiên cứu AI",
        publisherName: "VnExpress",
        publisherDomain: "vnexpress.net",
        authors: ["Nguyễn Văn A"],
        publishedAt: "2026-08-28T07:00:00.000Z",
        canonicalUrl: "https://vnexpress.net/kinh-doanh/fpt-mo-rong-ai",
      },
      previewPolicy: {
        mode: "metadata_only",
        paywallDetected: true,
        isAccessibleForFree: false,
        robotsDecision: "allowed",
      },
      signals: {
        primarySource: false,
        publisherIdentified: true,
        authorIdentified: true,
        publicationDateIdentified: true,
        duplicateClusterSize: 1,
      },
      fetchMethod: "search_snippet",
    };

    const parsedCitation = SourceCitationSchema.safeParse(citation);
    expect(parsedCitation.success).toBe(true);

    const claim = {
      supportingUrls: ["https://vnexpress.net/kinh-doanh/fpt-mo-rong-ai"],
      conflictingUrls: [],
      independentPublisherCount: 1,
      status: "single_source",
    };
    const parsedClaim = ClaimEvidenceSchema.safeParse(claim);
    expect(parsedClaim.success).toBe(true);
  });

  it("rejects invalid verification status, negative counts, and invalid URLs in claim evidence", async () => {
    const { ClaimEvidenceSchema } = await import("@/lib/types");

    expect(
      ClaimEvidenceSchema.safeParse({
        supportingUrls: ["https://vnexpress.net"],
        conflictingUrls: [],
        independentPublisherCount: 1,
        status: "verified_true", // invalid status
      }).success,
    ).toBe(false);

    expect(
      ClaimEvidenceSchema.safeParse({
        supportingUrls: ["https://vnexpress.net"],
        conflictingUrls: [],
        independentPublisherCount: -1, // negative count
        status: "corroborated",
      }).success,
    ).toBe(false);

    expect(
      ClaimEvidenceSchema.safeParse({
        supportingUrls: ["not-a-valid-url"], // invalid URL
        conflictingUrls: [],
        independentPublisherCount: 1,
        status: "single_source",
      }).success,
    ).toBe(false);
  });
});


describe("ResearchRequestSchema and ResearchSnapshotSchema", () => {
  const validProfileJson = {
    id: "fpt-corp",
    version: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    input: { name: "FPT Corporation" },
    officialName: "Công ty Cổ phần FPT",
    tradingNames: ["FPT Corp"],
    taxId: "0101248141",
    industry: ["Technology"],
    description: "Technology corporation in Vietnam",
    foundedYear: 1988,
    headquarters: { country: "Vietnam", city: "Hanoi" },
    website: "https://fpt.com.vn",
    keyPeople: [
      {
        name: "Trương Gia Bình",
        title: "Chủ tịch HĐQT",
        source: "website",
        confidence: 0.9,
      },
    ],
    products: ["FPT Software", "FPT Telecom"],
    markets: ["Vietnam", "Global"],
    companySize: "1000+",
    revenue: "> 1T VND",
    recentActivities: [
      {
        date: "2026-08-20T00:00:00.000Z",
        title: "AI Expansion",
        summary: "FPT expands AI research hub",
        url: "https://fpt.com.vn/news/1",
        source: "news",
      },
    ],
    lastUpdated: "2026-08-26T08:00:00.000Z",
    sources: [
      {
        source: "website",
        url: "https://fpt.com.vn",
        accessedAt: "2026-08-26T08:00:00.000Z",
        fieldsContributed: ["officialName", "products"],
      },
    ],
    overallConfidence: 0.95,
  };

  const validReportJson = {
    companyId: "fpt-corp",
    generatedAt: "2026-08-26T08:00:00.000Z",
    fitScore: {
      score: 88,
      reasoning: "Strong industry alignment and solid financial health.",
      criteria: [
        { name: "Industry Alignment", score: 90, weight: 0.3, reasoning: "Tech fit" },
      ],
    },
    riskFlags: [
      {
        type: "operational",
        description: "Talent competition",
        severity: "low",
        source: "news",
      },
    ],
    suggestedActions: [
      {
        action: "Partner on Cloud transformation",
        priority: "high",
        reasoning: "High capability match",
      },
    ],
    executiveSummary: "FPT is an ideal strategic technology partner.",
  };

  it("accepts default, select, refresh, and bypass research requests", async () => {
    const { ResearchRequestSchema } = await import("@/lib/types");
    const requests = [
      { input: { name: "FPT" } },
      { input: { name: "FPT" }, cache: { action: "select", companyId: "fpt" } },
      { input: { name: "FPT" }, cache: { action: "refresh", companyId: "fpt" } },
      { input: { name: "FPT" }, cache: { action: "bypass" } },
    ];

    expect(requests.every((request) => ResearchRequestSchema.safeParse(request).success))
      .toBe(true);
  });

  it("rejects cache actions with missing or unexpected company IDs", async () => {
    const { ResearchRequestSchema } = await import("@/lib/types");
    expect(
      ResearchRequestSchema.safeParse({
        input: { name: "FPT" },
        cache: { action: "select" },
      }).success,
    ).toBe(false);
    expect(
      ResearchRequestSchema.safeParse({
        input: { name: "FPT" },
        cache: { action: "bypass", companyId: "injected" },
      }).success,
    ).toBe(false);
  });

  it("parses a complete research snapshot and restores dates", async () => {
    const { ResearchSnapshotSchema } = await import("@/lib/types");
    const result = ResearchSnapshotSchema.parse({
      profile: validProfileJson,
      report: validReportJson,
      diff: null,
      lastSyncedAt: "2026-08-26T08:00:00.000Z",
    });

    expect(result.profile.lastUpdated).toBeInstanceOf(Date);
    expect(result.report.generatedAt).toBeInstanceOf(Date);
    expect(result.profile.createdAt).toBeInstanceOf(Date);
  });

  it("rejects mismatched and incomplete snapshots", async () => {
    const { ResearchSnapshotSchema } = await import("@/lib/types");
    expect(() =>
      ResearchSnapshotSchema.parse({
        profile: validProfileJson,
        report: { ...validReportJson, companyId: "other-company" },
        diff: null,
        lastSyncedAt: "2026-08-26T08:00:00.000Z",
      }),
    ).toThrow();
  });
});
