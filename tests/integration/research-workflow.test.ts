import { describe, expect, it, beforeEach, vi } from "vitest";
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
import type { SearchOptions } from "@/adapters/search/types";
import type { ResourceGuards } from "@/config";
import type { CompanyInput, StreamEvent } from "@/lib/types";
import * as langfuseObservability from "@/observability/langfuse";

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

  function buildWorkflow() {
    return createResearchWorkflow({
      search,
      scraper,
      registry,
      storage,
      profile: createProfileModule({ llm }),
      analyst: createAnalystModule({ llm }),
      guards,
    });
  }

  it("limits each search request at the provider boundary", async () => {
    guards.maxConcurrentProviderCalls = 1;
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;

    let activeSearchCalls = 0;
    let maxActiveSearchCalls = 0;
    search.search = async (query: string) => {
      activeSearchCalls++;
      maxActiveSearchCalls = Math.max(maxActiveSearchCalls, activeSearchCalls);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeSearchCalls--;
      return [
        {
          title: query,
          url: `https://example.com/${encodeURIComponent(query)}`,
          snippet: "Company information",
        },
      ];
    };
    scraper.extract = async (url: string) => ({
      url,
      title: "Company",
      text: "Company website content long enough to become a research finding.",
    });

    await buildWorkflow().run(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "provider-limit", signal: new AbortController().signal },
    );

    expect(maxActiveSearchCalls).toBe(1);
  });

  it("honors the shared query guard across web and news", async () => {
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;
    let searchCalls = 0;

    search.search = async (query: string) => {
      searchCalls++;
      return [
        {
          title: query,
          url: `https://example.com/${searchCalls}`,
          snippet: "Company information",
        },
      ];
    };
    scraper.extract = async (url: string) => ({
      url,
      title: "Company",
      text: "Company website content long enough to become a research finding.",
    });

    await buildWorkflow().run(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "query-limit", signal: new AbortController().signal },
    );

    expect(searchCalls).toBe(2);
  });

  it("includes website discovery and registry fallbacks in the shared query guard", async () => {
    guards.maxQueriesPerResearch = 2;
    let searchCalls = 0;
    search.search = async () => {
      searchCalls++;
      return [];
    };

    const state = await buildWorkflow().run(
      { name: "FPT", taxId: "0101248141" },
      { researchRunId: "all-search-query-limit" },
    );

    expect(searchCalls).toBe(2);
    expect(state.sourceResults.find((result) => result.source === "website")?.status)
      .toBe("skipped");
  });

  it("passes an abort signal into every search request", async () => {
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;
    const receivedSignals: Array<AbortSignal | undefined> = [];

    search.search = async (query: string, options?: SearchOptions) => {
      receivedSignals.push(
        (options as SearchOptions & { signal?: AbortSignal } | undefined)?.signal,
      );
      return [
        {
          title: query,
          url: `https://example.com/${encodeURIComponent(query)}`,
          snippet: "Company information",
        },
      ];
    };
    scraper.extract = async (url: string) => ({
      url,
      title: "Company",
      text: "Company website content long enough to become a research finding.",
    });

    await buildWorkflow().run(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "signal-propagation", signal: new AbortController().signal },
    );

    expect(receivedSignals.length).toBeGreaterThan(0);
    expect(receivedSignals.every(Boolean)).toBe(true);
  });

  it("does not retry errors that merely contain a 5xx-like record count", async () => {
    guards.maxQueriesPerResearch = 20;
    guards.maxScrapePagesPerResearch = 1;
    let searchCalls = 0;
    search.search = async () => {
      searchCalls++;
      throw new Error("Validation failed for 500 records");
    };
    scraper.extract = async (url: string) => ({
      url,
      title: "Company",
      text: "Company website content long enough to preserve sibling findings.",
    });

    await buildWorkflow().run(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "non-retryable-error" },
    );

    expect(searchCalls).toBe(6);
  });

  it("passes the run budget and signal into every model call", async () => {
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;
    search.setResults("FPT", [
      {
        title: "FPT",
        url: "https://fpt.com.vn/about",
        snippet: "FPT company information",
      },
    ]);
    scraper.extract = async (url: string) => ({
      url,
      title: "FPT",
      text: "FPT company website content long enough for profile synthesis.",
    });
    const controller = new AbortController();

    await buildWorkflow().run(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "llm-context", signal: controller.signal },
    );

    expect(llm.callLog.length).toBeGreaterThanOrEqual(2);
    expect(
      llm.callLog.every(
        ({ options }) =>
          options?.context?.budget !== undefined &&
          options.context.signal === controller.signal,
      ),
    ).toBe(true);
  });

  it("emits a fatal error and withholds profile-ready when persistence fails", async () => {
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;
    search.setResults("FPT", [
      {
        title: "FPT",
        url: "https://fpt.com.vn/about",
        snippet: "FPT company information",
      },
    ]);
    scraper.extract = async (url: string) => ({
      url,
      title: "FPT",
      text: "FPT company website content long enough for profile synthesis.",
    });
    storage.saveProfile = async () => {
      throw new Error("Profile storage unavailable");
    };
    const observationOutcome = vi.spyOn(
      langfuseObservability,
      "updateResearchObservationOutcome",
    );

    const events: StreamEvent[] = [];
    for await (const event of buildWorkflow().stream(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "persistence-failure" },
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      event: "error",
      data: { message: "Profile storage unavailable" },
    });
    expect(events.some((event) => event.event === "profile:ready")).toBe(false);
    expect(observationOutcome).toHaveBeenCalledWith("failed");
    observationOutcome.mockRestore();
  });

  it("aborts an in-flight profile write when the run is cancelled", async () => {
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;
    search.setResults("FPT", [
      {
        title: "FPT",
        url: "https://fpt.com.vn/about",
        snippet: "FPT company information",
      },
    ]);
    scraper.extract = async (url: string) => ({
      url,
      title: "FPT",
      text: "FPT company website content long enough for profile synthesis.",
    });
    let markWriteStarted: () => void = () => undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    let writeAborted = false;
    storage.saveProfile = async (
      _profile,
      options?: { signal?: AbortSignal },
    ) => {
      markWriteStarted();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 30);
        options?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            writeAborted = true;
            reject(options.signal?.reason);
          },
          { once: true },
        );
      });
    };
    const controller = new AbortController();
    const events: StreamEvent[] = [];

    const consume = (async () => {
      for await (const event of buildWorkflow().stream(
        { name: "FPT", website: "https://fpt.com.vn" },
        { researchRunId: "cancel-persistence", signal: controller.signal },
      )) {
        events.push(event);
      }
    })();
    await writeStarted;
    controller.abort();
    await consume.catch(() => undefined);

    expect(writeAborted).toBe(true);
    expect(events.some((event) => event.event === "profile:ready")).toBe(false);
  });

  it("stops before profile synthesis when existing-profile storage fails", async () => {
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;
    search.setResults("FPT", [
      {
        title: "FPT",
        url: "https://fpt.com.vn/about",
        snippet: "FPT company information",
      },
    ]);
    scraper.extract = async (url: string) => ({
      url,
      title: "FPT",
      text: "FPT company website content long enough for profile synthesis.",
    });
    storage.getLatestProfile = async () => {
      throw new Error("Profile storage read unavailable");
    };

    const events: StreamEvent[] = [];
    for await (const event of buildWorkflow().stream(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "storage-read-failure" },
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      event: "error",
      data: { message: "Profile storage read unavailable" },
    });
    expect(events.some((event) => event.event === "profile:building")).toBe(false);
  });

  it("passes the run signal into the existing-profile read", async () => {
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;
    search.setResults("FPT", [
      {
        title: "FPT",
        url: "https://fpt.com.vn/about",
        snippet: "FPT company information",
      },
    ]);
    scraper.extract = async (url: string) => ({
      url,
      title: "FPT",
      text: "FPT company website content long enough for profile synthesis.",
    });
    let receivedSignal: AbortSignal | undefined;
    storage.getLatestProfile = async (
      _companyId: string,
      options?: { signal?: AbortSignal },
    ) => {
      receivedSignal = options?.signal;
      return null;
    };
    const controller = new AbortController();

    await buildWorkflow().run(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "storage-read-signal", signal: controller.signal },
    );

    expect(receivedSignal).toBe(controller.signal);
  });

  it("treats diff persistence failure as fatal", async () => {
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;
    search.setResults("FPT", [
      {
        title: "FPT",
        url: "https://fpt.com.vn/about",
        snippet: "FPT company information",
      },
    ]);
    scraper.extract = async (url: string) => ({
      url,
      title: "FPT",
      text: "FPT company website content long enough for profile synthesis.",
    });
    const workflow = buildWorkflow();
    await workflow.run(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "diff-v1" },
    );
    storage.saveDiff = async () => {
      throw new Error("Diff storage unavailable");
    };

    const events: StreamEvent[] = [];
    for await (const event of workflow.stream(
      { name: "FPT", website: "https://fpt.com.vn" },
      { researchRunId: "diff-v2" },
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      event: "error",
      data: { message: "Diff storage unavailable" },
    });
    expect(events.some((event) => event.event === "analysis:ready")).toBe(false);
  });

  it("reports the terminal workflow state to its completion hook", async () => {
    guards.maxQueriesPerResearch = 2;
    guards.maxScrapePagesPerResearch = 1;
    search.setResults("FPT", [
      {
        title: "FPT",
        url: "https://fpt.com.vn/about",
        snippet: "FPT company information",
      },
    ]);
    scraper.extract = async (url: string) => ({
      url,
      title: "FPT",
      text: "FPT company website content long enough for profile synthesis.",
    });
    let completedOutcome: string | undefined;

    for await (const event of buildWorkflow().stream(
      { name: "FPT", website: "https://fpt.com.vn" },
      {
        researchRunId: "completion-hook",
        onComplete: (state: { outcome: string }) => {
          completedOutcome = state.outcome;
        },
      } as Parameters<ReturnType<typeof buildWorkflow>["stream"]>[1] & {
        onComplete: (state: { outcome: string }) => void;
      },
    )) {
      void event;
    }

    expect(completedOutcome).toBe("partial");
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
      maxQueriesPerResearch: 2,
      maxScrapePagesPerResearch: 1,
    };

    const workflow = createResearchWorkflow({
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
