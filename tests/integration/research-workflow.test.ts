import { describe, expect, it, beforeEach } from "vitest";
import { createResearchWorkflow } from "@/modules/workflow";
import { createProfileModule } from "@/modules/profile";
import { createAnalystModule } from "@/modules/analyst";
import { MemoryStorageAdapter } from "@/adapters/storage/memory";
import {
  MockLLMAdapter,
  MockSearchAdapter,
  MockScraperAdapter,
} from "../helpers/mock-adapters";
import type { RegistryAdapter } from "@/adapters/registry";
import type { ResourceGuards } from "@/config";
import type { CompanyInput, StreamEvent } from "@/lib/types";

describe("ResearchWorkflow (LangGraph StateGraph)", () => {
  let llm: MockLLMAdapter;
  let search: MockSearchAdapter;
  let scraper: MockScraperAdapter;
  let storage: MemoryStorageAdapter;
  let registry: RegistryAdapter;
  let guards: ResourceGuards;

  beforeEach(() => {
    llm = new MockLLMAdapter();
    search = new MockSearchAdapter();
    scraper = new MockScraperAdapter();
    storage = new MemoryStorageAdapter();
    registry = {
      findByTaxId: async () => null,
    };
    guards = {
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
    };

    const mockProfileData = {
      officialName: "Công ty Cổ phần FPT",
      tradingNames: ["FPT Corp", "FPT"],
      taxId: "0101248141",
      industry: ["Công nghệ thông tin", "Viễn thông"],
      description: "FPT là tập đoàn công nghệ hàng đầu tại Việt Nam.",
      foundedYear: 1988,
      headquarters: {
        street: "10 Pham Van Bach",
        city: "Hanoi",
        province: "Hanoi",
        country: "Việt Nam",
      },
      website: "https://fpt.com.vn",
      keyPeople: [
        { name: "Trương Gia Bình", title: "Chủ tịch HĐQT" },
      ],
      products: ["FPT Software", "FPT Telecom"],
      markets: ["Việt Nam", "Toàn cầu"],
      companySize: "1000+",
      recentActivities: [
        { title: "Khai trương trung tâm AI", summary: "Đầu tư trung tâm AI tại Quy Nhơn", date: "2026-01-15" },
      ],
    };

    const mockAnalystData = {
      fitScore: {
        score: 85,
        reasoning: "Strong fit",
        criteria: [
          { name: "Market Leadership", score: 90, weight: 0.25, reasoning: "Top IT" },
          { name: "Financial Health", score: 85, weight: 0.2, reasoning: "Profitable" },
          { name: "Innovation", score: 85, weight: 0.2, reasoning: "AI focused" },
          { name: "Synergy", score: 80, weight: 0.2, reasoning: "Tech ecosystem" },
          { name: "Reputation", score: 85, weight: 0.15, reasoning: "High trust" },
        ],
      },
      riskFlags: [],
      suggestedActions: [{ action: "Schedule meeting", priority: "high", reasoning: "High potential" }],
      executiveSummary: "FPT is a prime candidate.",
    };

    llm.setResponse("Tổng hợp", JSON.stringify(mockProfileData));
    llm.setResponse("Phân tích", JSON.stringify(mockAnalystData));
    llm.setResponse("Hồ sơ công ty", JSON.stringify(mockAnalystData));
    llm.setResponse("", JSON.stringify(mockProfileData));
  });

  it("runs sources concurrently and prepares deterministic evidence", async () => {
    let activeSources = 0;
    let maxConcurrency = 0;

    search.search = async (query: string) => {
      activeSources++;
      maxConcurrency = Math.max(maxConcurrency, activeSources);
      await new Promise((r) => setTimeout(r, 50));
      activeSources--;
      return [
        { title: `Result for ${query}`, url: `https://example.com/search?q=${encodeURIComponent(query)}`, snippet: "snippet" },
      ];
    };

    scraper.extract = async (url: string) => {
      activeSources++;
      maxConcurrency = Math.max(maxConcurrency, activeSources);
      await new Promise((r) => setTimeout(r, 60));
      activeSources--;
      return {
        url,
        title: "Company Page",
        text: "Company details here",
      };
    };

    registry.findByTaxId = async (taxId: string) => {
      activeSources++;
      maxConcurrency = Math.max(maxConcurrency, activeSources);
      await new Promise((r) => setTimeout(r, 40));
      activeSources--;
      return {
        taxId,
        name: "FPT Telecom JSC",
        address: "Hanoi",
        sourceUrl: "https://api.vietqr.io/v2/business/0101248141",
      };
    };

    const profileModule = createProfileModule({ llm });
    const analystModule = createAnalystModule({ llm });

    const workflow = createResearchWorkflow({
      llm,
      search,
      scraper,
      registry,
      storage,
      profile: profileModule,
      analyst: analystModule,
      guards,
    });

    const input: CompanyInput = {
      name: "FPT",
      website: "https://fpt.com.vn",
      taxId: "0101248141",
    };

    const events: StreamEvent[] = [];
    for await (const event of workflow.stream(input, {
      researchRunId: "test-run-1",
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(maxConcurrency).toBeGreaterThan(1);

    const startEvent = events.find((e) => e.event === "research:start");
    expect(startEvent).toBeDefined();

    const profileReady = events.find((e) => e.event === "profile:ready");
    expect(profileReady).toBeDefined();

    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
  });

  it("handles partial source failure without discarding sibling findings", async () => {
    scraper.extract = async () => {
      throw new Error("Scraper timeout");
    };

    search.setResults("FPT", [
      { title: "FPT Info", url: "https://fpt.com.vn/about", snippet: "FPT overview" },
    ]);

    const profileModule = createProfileModule({ llm });
    const analystModule = createAnalystModule({ llm });

    const workflow = createResearchWorkflow({
      llm,
      search,
      scraper,
      registry,
      storage,
      profile: profileModule,
      analyst: analystModule,
      guards,
    });

    const input: CompanyInput = {
      name: "FPT",
      website: "https://fpt.com.vn",
    };

    const events: StreamEvent[] = [];
    for await (const event of workflow.stream(input, {
      researchRunId: "test-run-2",
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    const progressEvents = events.filter(
      (e): e is Extract<StreamEvent, { event: "research:progress" }> =>
        e.event === "research:progress"
    );
    expect(progressEvents.some((p) => p.data.status === "failed")).toBe(true);

    const profileReady = events.find((e) => e.event === "profile:ready");
    expect(profileReady).toBeDefined();

    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
  });

  it("skips linkedin when no linkedinUrl is provided", async () => {
    const profileModule = createProfileModule({ llm });
    const analystModule = createAnalystModule({ llm });

    const workflow = createResearchWorkflow({
      llm,
      search,
      scraper,
      registry,
      storage,
      profile: profileModule,
      analyst: analystModule,
      guards,
    });

    const input: CompanyInput = {
      name: "MISA",
    };

    const state = await workflow.run(input, {
      researchRunId: "test-run-3",
      signal: new AbortController().signal,
    });

    const linkedinResult = state.sourceResults.find((r) => r.source === "linkedin");
    expect(linkedinResult?.status).toBe("skipped");
  });

  it("runs sources concurrently with mock latency under 650ms", async () => {
    const delays: Record<string, number> = {
      registry: 100,
      website: 200,
      news: 300,
      web_search: 400,
    };

    search.search = async (query: string) => {
      const isNews = query.includes("tin tức") || query.includes("mới nhất");
      await new Promise((r) => setTimeout(r, isNews ? delays.news : delays.web_search));
      return [{ title: "Search result", url: "https://example.com", snippet: "snippet" }];
    };

    scraper.extract = async () => {
      await new Promise((r) => setTimeout(r, delays.website));
      return { url: "https://example.com", title: "Site", text: "Text" };
    };

    registry.findByTaxId = async (taxId: string) => {
      await new Promise((r) => setTimeout(r, delays.registry));
      return {
        taxId,
        name: "Benchmark Co",
        address: "Hanoi",
      };
    };

    const profileModule = createProfileModule({ llm });
    const analystModule = createAnalystModule({ llm });

    const benchmarkGuards: ResourceGuards = {
      ...guards,
      maxScrapePagesPerResearch: 1,
    };

    const workflow = createResearchWorkflow({
      llm,
      search,
      scraper,
      registry,
      storage,
      profile: profileModule,
      analyst: analystModule,
      guards: benchmarkGuards,
    });

    const input: CompanyInput = {
      name: "Benchmark Co",
      website: "https://example.com",
      taxId: "123456",
    };

    const startTime = Date.now();
    await workflow.run(input, {
      researchRunId: "test-bench",
      signal: new AbortController().signal,
    });
    const elapsed = Date.now() - startTime;

    // Concurrency benchmark: parallel should complete well under 650ms (sequential sum is ~1000ms)
    expect(elapsed).toBeLessThan(650);
  });
});
