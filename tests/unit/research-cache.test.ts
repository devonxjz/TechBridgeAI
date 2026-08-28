import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  normalizeCompanyIdentity,
  decideCacheLookup,
  type IdentityCandidate,
  type NormalizedCompanyIdentity,
  type ResearchCache,
} from "@/modules/cache";
import type { CompanyProfile } from "@/lib/types";
import type { MemoryStorageAdapter } from "@/adapters/storage/memory";

describe("Research Cache - Normalization", () => {
  it("normalizes tax ID, domain, and Vietnamese name without dropping legal suffixes", () => {
    expect(
      normalizeCompanyIdentity({
        name: "  CÔNG TY  CP Ánh Dương  ",
        taxId: "0101-245.486",
        website: "https://WWW.Example.VN:443/about?q=1",
      })
    ).toEqual({
      taxId: "0101245486",
      domain: "example.vn",
      name: "công ty cp ánh dương",
    });
  });

  it("handles 13-digit tax IDs correctly", () => {
    expect(
      normalizeCompanyIdentity({
        name: "Chi nhánh FPT",
        taxId: "0101248141-001",
      })
    ).toEqual({
      taxId: "0101248141001",
      domain: null,
      name: "chi nhánh fpt",
    });
  });

  it("rejects a malformed supplied tax ID", () => {
    expect(() =>
      normalizeCompanyIdentity({ name: "FPT", taxId: "abc" })
    ).toThrow("Mã số thuế phải có 10 hoặc 13 chữ số");

    expect(() =>
      normalizeCompanyIdentity({ name: "FPT", taxId: "123456789" })
    ).toThrow("Mã số thuế phải có 10 hoặc 13 chữ số");

    expect(() =>
      normalizeCompanyIdentity({ name: "FPT", taxId: "12345678901" })
    ).toThrow("Mã số thuế phải có 10 hoặc 13 chữ số");
  });

  it("normalizes domain removing leading www. and trailing dot", () => {
    expect(
      normalizeCompanyIdentity({
        name: "Test Corp",
        website: "http://www.sub.domain.vn./path",
      })
    ).toEqual({
      taxId: null,
      domain: "sub.domain.vn",
      name: "test corp",
    });
  });

  it("handles null/optional taxId and website gracefully", () => {
    expect(
      normalizeCompanyIdentity({
        name: "Công ty TNHH Một Thành Viên",
      })
    ).toEqual({
      taxId: null,
      domain: null,
      name: "công ty tnhh một thành viên",
    });
  });
});

describe("Research Cache - Decision Logic", () => {
  const withTaxAndDomain: NormalizedCompanyIdentity = {
    taxId: "0101245486",
    domain: "vingroup.net",
    name: "tập đoàn vingroup",
  };

  const candidatesForSameCompany: IdentityCandidate[] = [
    {
      companyId: "company-a",
      taxId: "0101245486",
      domain: "vingroup.net",
      name: "tập đoàn vingroup",
    },
  ];

  const withConflictingKeys: NormalizedCompanyIdentity = {
    taxId: "0101245486",
    domain: "fpt.com.vn",
    name: "tập đoàn vingroup",
  };

  const conflictingCandidates: IdentityCandidate[] = [
    {
      companyId: "company-a",
      taxId: "0101245486",
      domain: "vingroup.net",
      name: "tập đoàn vingroup",
    },
    {
      companyId: "company-b",
      taxId: "0101248141",
      domain: "fpt.com.vn",
      name: "công ty cp fpt",
    },
  ];

  const domainOnly: NormalizedCompanyIdentity = {
    taxId: null,
    domain: "shared-domain.vn",
    name: "công ty a",
  };

  const twoDomainCandidates: IdentityCandidate[] = [
    {
      companyId: "company-a",
      taxId: "0101245486",
      domain: "shared-domain.vn",
      name: "công ty a",
    },
    {
      companyId: "company-b",
      taxId: "0101248141",
      domain: "shared-domain.vn",
      name: "công ty b",
    },
  ];

  const nameOnly: NormalizedCompanyIdentity = {
    taxId: null,
    domain: null,
    name: "công ty cp ánh dương",
  };

  const oneNameCandidate: IdentityCandidate[] = [
    {
      companyId: "company-a",
      taxId: "0101245486",
      domain: "anhduong.vn",
      name: "công ty cp ánh dương",
    },
  ];

  it("resolves exact tax ID and compatible domain to an automatic hit", () => {
    expect(decideCacheLookup(withTaxAndDomain, candidatesForSameCompany)).toEqual({
      kind: "hit",
      companyId: "company-a",
      matchedBy: "tax_id",
    });
  });

  it("detects conflict when supplied tax ID and domain resolve to different companies", () => {
    expect(decideCacheLookup(withConflictingKeys, conflictingCandidates)).toEqual({
      kind: "conflict",
      taxCompanyId: "company-a",
      domainCompanyIds: ["company-b"],
    });
  });

  it("returns suggestions for multi-candidate domain matches", () => {
    expect(decideCacheLookup(domainOnly, twoDomainCandidates)).toEqual({
      kind: "suggestions",
      companyIds: ["company-a", "company-b"],
    });
  });

  it("returns automatic hit for unique domain match without tax ID", () => {
    const singleDomainCandidate: IdentityCandidate[] = [
      {
        companyId: "company-a",
        taxId: "0101245486",
        domain: "unique-domain.vn",
        name: "công ty a",
      },
    ];
    expect(
      decideCacheLookup(
        { taxId: null, domain: "unique-domain.vn", name: "công ty a" },
        singleDomainCandidate
      )
    ).toEqual({
      kind: "hit",
      companyId: "company-a",
      matchedBy: "domain",
    });
  });

  it("returns suggestions for name matches", () => {
    expect(decideCacheLookup(nameOnly, oneNameCandidate)).toEqual({
      kind: "suggestions",
      companyIds: ["company-a"],
    });
  });

  it("returns miss when no candidates match", () => {
    expect(decideCacheLookup(nameOnly, [])).toEqual({ kind: "miss" });
  });
});

describe("ResearchCache - Storage-backed Cache Module", () => {
  let storage: MemoryStorageAdapter;
  let cache: ResearchCache;

  const validProfile: CompanyProfile = {
    id: "company-a",
    version: 1,
    createdAt: new Date("2026-08-26T00:00:00.000Z"),
    lastUpdated: new Date("2026-08-26T08:00:00.000Z"),
    input: { name: "FPT Corporation" },
    officialName: "Công ty Cổ phần FPT",
    tradingNames: ["FPT"],
    taxId: "0101248141",
    industry: ["Technology"],
    description: "Technology Corporation",
    keyPeople: [],
    products: [],
    markets: [],
    recentActivities: [],
    sources: [],
    overallConfidence: 0.95,
  };

  const validReport = {
    companyId: "company-a",
    generatedAt: new Date("2026-08-26T08:00:00.000Z"),
    riskFlags: [],
    suggestedActions: [],
    executiveSummary: "Executive Summary",
  };

  beforeEach(async () => {
    const { MemoryStorageAdapter } = await import("@/adapters/storage/memory");
    const { createResearchCache } = await import("@/modules/cache");
    storage = new MemoryStorageAdapter();
    cache = createResearchCache(storage);
  });

  it("resolves tax-ID match to an immediate hit with complete snapshot", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "company-a"
    );
    await storage.persistResearchSnapshot(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      { profile: validProfile, report: validReport, diff: null }
    );

    const resolution = await cache.lookup({ name: "FPT", taxId: "0101248141" });
    expect(resolution).toMatchObject({
      kind: "hit",
      matchedBy: "tax_id",
      snapshot: { profile: { id: "company-a" } },
    });
  });

  it("returns suggestions for name matches", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "company-a"
    );
    await storage.persistResearchSnapshot(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      { profile: validProfile, report: validReport, diff: null }
    );

    const resolution = await cache.lookup({ name: "Công ty CP FPT" });
    expect(resolution).toMatchObject({
      kind: "suggestions",
      suggestions: [
        expect.objectContaining({
          companyId: "company-a",
          officialName: "Công ty Cổ phần FPT",
        }),
      ],
    });
  });

  it("returns miss for unknown companies", async () => {
    const resolution = await cache.lookup({ name: "Unknown Company" });
    expect(resolution).toEqual({
      kind: "miss",
      identity: { taxId: null, domain: null, name: "unknown company" },
      cacheInvalid: false,
    });
  });

  it("rejects select when requested companyId is not in the suggestion candidate set", async () => {
    // Seed company-a and company-b
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "company-a"
    );
    await storage.persistResearchSnapshot(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      { profile: validProfile, report: validReport, diff: null }
    );

    const profileB = { ...validProfile, id: "company-b", officialName: "Vingroup" };
    const reportB = { ...validReport, companyId: "company-b" };
    await storage.resolveOrCreateIdentity(
      { taxId: "0101245486", domain: "vingroup.net", name: "tập đoàn vingroup" },
      "company-b"
    );
    await storage.persistResearchSnapshot(
      { taxId: "0101245486", domain: "vingroup.net", name: "tập đoàn vingroup" },
      { profile: profileB, report: reportB, diff: null }
    );

    await expect(
      cache.select({ name: "Công ty CP FPT" }, "company-b")
    ).rejects.toMatchObject({ code: "invalid_cache_selection" });
  });

  it("rejects prepareRefresh when strong keys conflict with target company", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "company-a"
    );
    await storage.persistResearchSnapshot(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      { profile: validProfile, report: validReport, diff: null }
    );

    await storage.resolveOrCreateIdentity(
      { taxId: "0101245486", domain: "vingroup.net", name: "tập đoàn vingroup" },
      "company-b"
    );
    const profileB = { ...validProfile, id: "company-b", officialName: "Vingroup" };
    const reportB = { ...validReport, companyId: "company-b" };
    await storage.persistResearchSnapshot(
      { taxId: "0101245486", domain: "vingroup.net", name: "tập đoàn vingroup" },
      { profile: profileB, report: reportB, diff: null }
    );

    // Refreshing company-b with company-a's tax ID must reject with identity_conflict
    await expect(
      cache.prepareRefresh({ name: "Vingroup", taxId: "0101248141" }, "company-b")
    ).rejects.toMatchObject({ code: "identity_conflict" });
  });

  it("recovers from corrupt snapshot by returning miss with cacheInvalid: true", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "company-a"
    );

    // Mock storage.getLatestCompleteSnapshot to throw CacheInvalidError
    const { CacheInvalidError } = await import("@/modules/cache");
    vi.spyOn(storage, "getLatestCompleteSnapshot").mockRejectedValueOnce(
      new CacheInvalidError("Corrupted data")
    );

    const resolution = await cache.lookup({ name: "FPT", taxId: "0101248141" });
    expect(resolution).toEqual({
      kind: "miss",
      identity: { taxId: "0101248141", domain: null, name: "fpt" },
      cacheInvalid: true,
    });
  });

  it("persists and restores snapshot with rich publication citations and fieldEvidence", async () => {
    const identity = { taxId: "0101248141", domain: "fpt.com.vn", name: "fpt" };
    const richProfile: CompanyProfile = {
      ...validProfile,
      id: "fpt-corp",
      fieldEvidence: {
        officialName: {
          status: "primary_source",
          independentPublisherCount: 1,
          supportingUrls: ["https://api.vietqr.io/mst"],
          conflictingUrls: [],
        },
      },
      sources: [
        {
          source: "news",
          url: "https://vnexpress.net/fpt-1",
          accessedAt: new Date(),
          fieldsContributed: ["officialName"],
          publication: {
            publisherDomain: "vnexpress.net",
            publisherName: "VnExpress",
            authors: ["Nguyen Van A"],
          },
          previewPolicy: {
            mode: "short_excerpt",
            paywallDetected: false,
            robotsDecision: "allowed",
          },
          signals: {
            primarySource: false,
            publisherIdentified: true,
            authorIdentified: true,
            publicationDateIdentified: false,
            duplicateClusterSize: 1,
          },
          excerpt: "Doanh thu FPT",
          contentFingerprint: "fp-1",
          fetchMethod: "server_extract",
        },
      ],
    };

    await storage.resolveOrCreateIdentity(identity, "fpt-corp");
    const persisted = await cache.persist(identity, {
      profile: richProfile,
      report: validReport,
      diff: null,
    });

    expect(persisted.profile.sources[0].publication?.publisherName).toBe("VnExpress");
    expect(persisted.profile.fieldEvidence?.officialName?.status).toBe("primary_source");
  });
});


