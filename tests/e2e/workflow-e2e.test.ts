import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { vi } from "vitest";

import {
  MockLLMAdapter,
  MockSearchAdapter,
  MockScraperAdapter,
} from "../helpers/mock-adapters";

const TEST_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const TEST_STORAGE_CONTEXT = { tenantId: TEST_TENANT_ID, userId: "user-test" };
const TEST_USER_ID = "00000000-0000-4000-8000-000000000002";
const TEST_KEY_ID = "workflow-e2e-key";
const TEST_SECRET = "workflow-e2e-deterministic-signing-secret-32-bytes";
const ORIGINAL_GATEWAY_ENV = {
  keyId: process.env.GATEWAY_SIGNING_KEY_CURRENT_ID,
  secret: process.env.GATEWAY_SIGNING_KEY_CURRENT,
};
let requestSequence = 0;
let llm: MockLLMAdapter;
let search: MockSearchAdapter;
let scraper: MockScraperAdapter;

vi.mock("@/config", async () => {
  const actual = await vi.importActual<typeof import("@/config")>("@/config");
  return {
    ...actual,
    createLLMAdapter: () => llm,
    createSearchAdapter: () => search,
    createScraperAdapter: () => scraper,
  };
});

import { POST } from "@/app/api/research/route";
import { NextRequest } from "next/server";
import { createStorageAdapter, resetAdapters } from "@/config";
import { MemoryStorageAdapter } from "@/adapters/storage/memory";
import { signInternalGatewayRequest } from "@/lib/internal-gateway-signing";

async function signedRequest(
  payload: unknown,
  signal?: AbortSignal,
): Promise<NextRequest> {
  const body = JSON.stringify(payload);
  const bodyBytes = new TextEncoder().encode(body);
  requestSequence += 1;
  const signedHeaders = await signInternalGatewayRequest({
    keyId: TEST_KEY_ID,
    secret: TEST_SECRET,
    method: "POST",
    pathname: "/api/research",
    body: bodyBytes,
    timestamp: Math.floor(Date.now() / 1000),
    requestId: `00000000-0000-4000-8000-${String(requestSequence).padStart(12, "0")}`,
    tenantId: TEST_TENANT_ID,
    userId: TEST_USER_ID,
  });
  signedHeaders.set("Content-Type", "application/json");
  return new NextRequest("http://localhost:3000/api/research", {
    method: "POST",
    headers: signedHeaders,
    body,
    signal,
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("E2E Workflow Tests - PartnerIQ Research Pipeline", () => {
  beforeAll(() => {
    process.env.GATEWAY_SIGNING_KEY_CURRENT_ID = TEST_KEY_ID;
    process.env.GATEWAY_SIGNING_KEY_CURRENT = TEST_SECRET;
  });

  afterAll(() => {
    restoreEnv("GATEWAY_SIGNING_KEY_CURRENT_ID", ORIGINAL_GATEWAY_ENV.keyId);
    restoreEnv("GATEWAY_SIGNING_KEY_CURRENT", ORIGINAL_GATEWAY_ENV.secret);
  });
  beforeEach(() => {
    llm = new MockLLMAdapter();
    search = new MockSearchAdapter();
    scraper = new MockScraperAdapter();
    process.env.STORAGE_PROVIDER = "memory";
    requestSequence = 0;
    resetAdapters();
  });

  it("handles full E2E research workflow with SSE stream, caching, and versioned updates", async () => {
    const storage = createStorageAdapter() as MemoryStorageAdapter;
    storage.clear();

    // 1. Setup mock data for initial run
    search.setResults("Vingroup", [
      { title: "Tập đoàn Vingroup", url: "https://vingroup.net", snippet: "Tập đoàn tư nhân lớn nhất Việt Nam" },
    ]);
    scraper.setPage("https://vingroup.net", {
      url: "https://vingroup.net",
      title: "Vingroup Trang chủ",
      text: "Vingroup là tập đoàn đa ngành hàng đầu Việt Nam, hoạt động trong công nghệ, công nghiệp, thương mại.",
    });

    const v1MockProfile = {
      officialName: "Tập đoàn Vingroup",
      tradingNames: ["Vingroup", "VIC"],
      taxId: "0101245486",
      industry: ["Bất động sản", "Công nghệ", "Xe điện"],
      description: "Tập đoàn kinh tế tư nhân đa ngành hàng đầu Việt Nam.",
      foundedYear: 1993,
      website: "https://vingroup.net",
      keyPeople: [{ name: "Phạm Nhật Vượng", title: "Chủ tịch HĐQT" }],
      products: ["Vinhomes", "VinFast"],
      markets: ["Việt Nam"],
      companySize: "1000+",
      recentActivities: [{ title: "Mở rộng sản xuất", summary: "Khai trương nhà máy mới", date: "2026-01-01" }],
    };

    const mockAnalysisData = {
      executiveSummary: "Vingroup là tập đoàn có quy mô lớn với nhiều tiềm năng kết nối.",
      criteria: [
        { name: "Industry Alignment", score: 85, reasoning: "Phù hợp đa ngành." },
        { name: "Company Size Match", score: 95, reasoning: "Tập đoàn lớn nhất." },
        { name: "Geographic Relevance", score: 90, reasoning: "Hiện diện toàn quốc." },
        { name: "Digital Maturity", score: 80, reasoning: "Ứng dụng công nghệ mạnh." },
        { name: "Recent Activity", score: 90, reasoning: "Nhiều dự án mới." },
      ],
      riskFlags: [],
      suggestedActions: [{ action: "Thiết lập liên hệ", priority: "high", reasoning: "Tiềm năng lớn" }],
    };
    llm.setResponse("Tổng hợp thông tin", JSON.stringify(v1MockProfile));
    llm.setResponse("Phân tích và đánh giá", JSON.stringify(mockAnalysisData));

    // 2. Execute First API Request (Initial Miss -> Live Workflow -> Version 1 persisted)
    const req1 = await signedRequest({
      input: {
        name: "Vingroup",
        website: "https://vingroup.net",
      },
    });

    const response1 = await POST(req1);
    expect(response1.status).toBe(200);
    expect(response1.headers.get("Content-Type")).toBe("text/event-stream");

    // Read SSE output stream
    const text1 = await response1.text();
    expect(text1).toContain("event: research:start");
    expect(text1).toContain("event: profile:ready");
    expect(text1).toContain("Tập đoàn Vingroup");
    expect(text1).toContain("event: analysis:ready");
    expect(text1).toContain("event: done");

    // Find persisted company ID
    const candidates = await storage.findIdentityCandidates(TEST_STORAGE_CONTEXT, {
      taxId: null,
      domain: "vingroup.net",
      name: "vingroup",
    });
    expect(candidates.length).toBe(1);
    const companyId = candidates[0].companyId;

    const savedV1 = await storage.getLatestCompleteSnapshot(TEST_STORAGE_CONTEXT, companyId);
    expect(savedV1).not.toBeNull();
    expect(savedV1?.profile.version).toBe(1);
    expect(savedV1?.profile.officialName).toBe("Tập đoàn Vingroup");

    // 3. Execute Second API Request with Refresh (Version 2 - Updated data with diff)
    const v2MockProfile = {
      ...v1MockProfile,
      markets: ["Việt Nam", "Mỹ", "Châu Âu"],
      products: ["Vinhomes", "VinFast", "VinAI"],
      description: "Tập đoàn kinh tế tư nhân đa ngành toàn cầu của Việt Nam.",
    };
    llm.setResponse("Tổng hợp thông tin", JSON.stringify(v2MockProfile));

    const req2 = await signedRequest({
      input: {
        name: "Vingroup",
        website: "https://vingroup.net",
      },
      cache: {
        action: "refresh",
        companyId,
      },
    });

    const response2 = await POST(req2);
    expect(response2.status).toBe(200);

    const text2 = await response2.text();
    expect(text2).toContain("event: diff:ready");
    expect(text2).toContain("event: done");

    // Verify version 2 and diff persistence
    const savedV2 = await storage.getLatestCompleteSnapshot(TEST_STORAGE_CONTEXT, companyId);
    expect(savedV2?.profile.version).toBe(2);
    expect(savedV2?.profile.markets).toContain("Mỹ");

    const diffs = await storage.getDiffs(TEST_STORAGE_CONTEXT, companyId);
    expect(diffs.length).toBe(1);
    expect(diffs[0].fromVersion).toBe(1);
    expect(diffs[0].toVersion).toBe(2);
    expect(diffs[0].changes.some((c) => c.field === "markets")).toBe(true);

    // 4. Execute Third API Request (Cache Hit - returns cached snapshot immediately)
    const req3 = await signedRequest({
      input: {
        name: "Vingroup",
        website: "https://vingroup.net",
      },
    });

    const response3 = await POST(req3);
    expect(response3.status).toBe(200);
    const text3 = await response3.text();
    expect(text3).toContain("event: cache:hit");
    expect(text3).toContain("event: profile:ready");
    expect(text3).toContain("event: done");
  });

  it("rejects invalid request inputs with HTTP 400", async () => {
    const invalidReq = await signedRequest({
      input: {
        name: "", // empty name
      },
    });

    const response = await POST(invalidReq);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it("preserves provider errors when no source returns findings", async () => {
    search.search = async () => {
      throw new Error("Serper search failed: 403 Unauthorized");
    };
    scraper.extract = async () => {
      throw new Error("TinyFish request timed out");
    };

    const response = await POST(
      await signedRequest({
        input: { name: "EDUZ", website: "https://eduz.vn" },
      }),
    );

    const text = await response.text();
    const errorMessages = text
      .split("\n\n")
      .filter((block) => block.startsWith("event: error"))
      .map((block) => JSON.parse(block.split("data: ")[1]).message as string);

    expect(errorMessages.at(-1)).toContain("Serper search failed: 403 Unauthorized");
    expect(errorMessages.at(-1)).toContain("TinyFish request timed out");
  });

  it("cancels workflow and prevents profile save on request abort", async () => {
    const storage = createStorageAdapter() as MemoryStorageAdapter;
    storage.clear();

    const controller = new AbortController();

    search.search = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return [{ title: "FPT", url: "https://fpt.com.vn", snippet: "FPT Info" }];
    };

    scraper.extract = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { url: "https://fpt.com.vn", title: "FPT", text: "FPT Content" };
    };

    const req = await signedRequest(
      {
        input: { name: "FPT", website: "https://fpt.com.vn" },
      },
      controller.signal,
    );

    const response = await POST(req);
    expect(response.status).toBe(200);

    // Abort after small delay while sources are in flight
    setTimeout(() => {
      controller.abort();
    }, 50);

    const text = await response.text();
    expect(text).toContain("event: research:start");

    // Profile / snapshot should not have been saved
    const candidates = await storage.findIdentityCandidates(TEST_STORAGE_CONTEXT, {
      taxId: null,
      domain: "fpt.com.vn",
      name: "fpt",
    });
    if (candidates.length > 0) {
      const snapshot = await storage.getLatestCompleteSnapshot(TEST_STORAGE_CONTEXT, candidates[0].companyId);
      expect(snapshot).toBeNull();
    }
  });
});
