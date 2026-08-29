import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/research/route";
import { MemoryStorageAdapter } from "@/adapters/storage/memory";
import { CacheInvalidError } from "@/modules/cache";
import type { CompanyProfile, AnalysisReport } from "@/lib/types";

const mockLLM = vi.fn();
const mockSearch = vi.fn();
const mockScraper = vi.fn();
const mockRegistry = vi.fn();
let storage: MemoryStorageAdapter;

vi.mock("@/config", () => ({
  createLLMAdapter: () => {
    mockLLM();
    return {};
  },
  createSearchAdapter: () => {
    mockSearch();
    return {};
  },
  createScraperAdapter: () => {
    mockScraper();
    return {};
  },
  createRegistryAdapter: () => {
    mockRegistry();
    return {};
  },
  createStorageAdapter: () => storage,
  createCrawlPolicyAdapter: () => ({
    beforeFetch: vi.fn().mockResolvedValue({
      robotsDecision: "allowed",
      shouldExtract: true,
    }),
  }),
  getGuards: () => ({
    maxConcurrentResearch: 1,
    maxQueriesPerResearch: 6,
    maxConcurrentSourceNodes: 4,
    maxConcurrentProviderCalls: 4,
    sourceTimeoutMs: 5000,
    maxRetriesPerSource: 2,
    maxTokensPerResearch: 50000,
    maxLLMCallsPerResearch: 10,
    scraperDelayMs: 0,
    maxScrapePagesPerResearch: 5,
    maxResearchPerDay: 50,
    maxTokensPerDay: 500000,
  }),
}));

vi.mock("@/modules/profile", () => ({
  createProfileModule: () => ({
    buildProfile: vi.fn(),
    diffProfiles: vi.fn(),
  }),
}));

vi.mock("@/modules/analyst", () => ({
  createAnalystModule: () => ({
    analyze: vi.fn(),
  }),
}));

vi.mock("@/modules/workflow", () => ({
  createResearchWorkflow: () => ({
    stream: async function* () {
      yield { event: "research:start", data: { sources: [] } };
    },
  }),
}));

vi.mock("@/observability/langfuse", () => ({
  emitResearchScores: vi.fn(async () => undefined),
  flushLangfuse: vi.fn(async () => undefined),
  traceResearch: async (_context: unknown, task: (traceId: string) => Promise<void>) =>
    task("mock-trace-id"),
  updateResearchObservationOutcome: vi.fn(),
  updateResearchTraceOutcome: vi.fn(),
  updateResearchCacheOutcome: vi.fn(),
}));

describe("API Route - /api/research Cache Read-Through", () => {
  const dummyProfile: CompanyProfile = {
    id: "comp-fpt",
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

  const dummyReport: AnalysisReport = {
    companyId: "comp-fpt",
    generatedAt: new Date("2026-08-26T08:00:00.000Z"),
    riskFlags: [],
    suggestedActions: [],
    executiveSummary: "Executive Summary",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new MemoryStorageAdapter();
  });

  it("returns cache:hit and final events without calling search/LLM providers on exact tax-ID match", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "comp-fpt"
    );
    await storage.persistResearchSnapshot(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      { profile: dummyProfile, report: dummyReport, diff: null }
    );

    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          name: "FPT",
          taxId: "0101248141",
        },
      }),
    });

    const response = await POST(req);
    const body = await response.text();

    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockLLM).not.toHaveBeenCalled();
    expect(body).toContain("event: cache:hit");
    expect(body).toContain("event: profile:ready");
    expect(body).toContain("event: analysis:ready");
    expect(body).toContain("event: done");
  });

  it("returns cache:suggestions on ambiguous name matches", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "comp-fpt"
    );
    await storage.persistResearchSnapshot(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      { profile: dummyProfile, report: dummyReport, diff: null }
    );

    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          name: "Công ty CP FPT",
        },
      }),
    });

    const response = await POST(req);
    const body = await response.text();

    expect(mockSearch).not.toHaveBeenCalled();
    expect(body).toContain("event: cache:suggestions");
    expect(body).toContain("comp-fpt");
    expect(body).toContain("event: done");
  });

  it("returns identity_conflict error on conflicting tax-ID and domain input", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "comp-fpt"
    );
    await storage.resolveOrCreateIdentity(
      { taxId: "0101245486", domain: "vingroup.net", name: "tập đoàn vingroup" },
      "comp-vin"
    );

    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          name: "Conflicting Corp",
          taxId: "0101248141",
          website: "https://vingroup.net",
        },
      }),
    });

    const response = await POST(req);
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe("identity_conflict");
  });

  it("resolves cache selection when action is select", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "comp-fpt"
    );
    await storage.persistResearchSnapshot(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      { profile: dummyProfile, report: dummyReport, diff: null }
    );

    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          name: "Công ty CP FPT",
        },
        cache: {
          action: "select",
          companyId: "comp-fpt",
        },
      }),
    });

    const response = await POST(req);
    const body = await response.text();

    expect(mockSearch).not.toHaveBeenCalled();
    expect(body).toContain("event: cache:hit");
    expect(body).toContain("user_selection");
    expect(body).toContain("event: profile:ready");
  });

  it("returns invalid_cache_selection error on invalid selectedCompanyId", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "comp-fpt"
    );

    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          name: "Công ty CP FPT",
        },
        cache: {
          action: "select",
          companyId: "unrelated-uuid",
        },
      }),
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("invalid_cache_selection");
  });

  it("bypasses cache when action is bypass", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "comp-fpt"
    );
    await storage.persistResearchSnapshot(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      { profile: dummyProfile, report: dummyReport, diff: null }
    );

    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          name: "FPT",
          taxId: "0101248141",
        },
        cache: {
          action: "bypass",
        },
      }),
    });

    const response = await POST(req);
    const body = await response.text();

    expect(mockSearch).toHaveBeenCalled();
    expect(body).toContain("event: research:start");
  });

  it("returns HTTP 400 when request body has invalid JSON", async () => {
    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid-json",
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns HTTP 400 when input validation fails", async () => {
    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          name: "",
        },
      }),
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Validation failed");
  });

  it("returns identity_conflict on invalid refresh company ID", async () => {
    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          name: "Vingroup",
        },
        cache: {
          action: "refresh",
          companyId: "nonexistent-id",
        },
      }),
    });

    const response = await POST(req);
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe("identity_conflict");
  });

  it("emits non-terminal cache_invalid notice and proceeds to live workflow on corrupt snapshot", async () => {
    await storage.resolveOrCreateIdentity(
      { taxId: "0101248141", domain: "fpt.com.vn", name: "công ty cp fpt" },
      "comp-fpt"
    );
    vi.spyOn(storage, "getLatestCompleteSnapshot").mockRejectedValueOnce(
      new CacheInvalidError("Corrupted JSONB")
    );

    const req = new NextRequest("http://localhost:3000/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          name: "Công ty CP FPT",
          taxId: "0101248141",
        },
      }),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain("cache_invalid");
    expect(body).toContain("event: research:start");
    expect(mockSearch).toHaveBeenCalled();
  });
});
