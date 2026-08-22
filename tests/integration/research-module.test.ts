import { describe, it, expect, beforeEach } from "vitest";
import { createResearchModule } from "@/modules/research";
import { MockLLMAdapter } from "@/adapters/llm/mock";
import { MockSearchAdapter } from "@/adapters/search/mock";
import { MockScraperAdapter } from "@/adapters/scraper/mock";
import type { ResourceGuards } from "@/config";
import type { CompanyInput, ResearchEvent } from "@/lib/types";

describe("ResearchModule Integration Tests", () => {
  let llm: MockLLMAdapter;
  let search: MockSearchAdapter;
  let scraper: MockScraperAdapter;
  const guards: ResourceGuards = {
    maxConcurrentResearch: 1,
    sourceTimeoutMs: 5000,
    maxRetriesPerSource: 2,
    maxTokensPerResearch: 50000,
    maxLLMCallsPerResearch: 10,
    scraperDelayMs: 0,
    maxScrapePagesPerResearch: 5,
    maxResearchPerDay: 50,
    maxTokensPerDay: 500000,
  };

  beforeEach(() => {
    llm = new MockLLMAdapter();
    search = new MockSearchAdapter();
    scraper = new MockScraperAdapter();
  });

  it("orchestrates multi-source research and streams progress events", async () => {
    search.setResults("Viettel", [
      { title: "Viettel Telecom", url: "https://viettel.com.vn", snippet: "Tap doan vien thong" },
    ]);
    scraper.setPage("https://viettel.com.vn", {
      url: "https://viettel.com.vn",
      title: "Viettel Portal",
      text: "Viettel Military Telecommunications Group",
    });

    const researchModule = createResearchModule({ llm, search, scraper, guards });

    const input: CompanyInput = {
      name: "Viettel",
      website: "https://viettel.com.vn",
      taxId: "0100109106",
      linkedinUrl: "https://linkedin.com/company/viettel",
    };

    const events: ResearchEvent[] = [];
    for await (const event of researchModule.research(input)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);

    // Verify progress events emitted
    const progressEvents = events.filter((e) => e.type === "progress");
    expect(progressEvents.some((e) => e.source === "web_search" && e.status === "started")).toBe(true);
    expect(progressEvents.some((e) => e.source === "website" && e.status === "started")).toBe(true);
    expect(
      progressEvents.filter((e) => e.source === "web_search" && e.status === "started")
    ).toHaveLength(1);

    // Verify findings collected
    const findingEvents = events.filter((e) => e.type === "finding");
    expect(findingEvents.length).toBeGreaterThan(0);

    // Verify complete event emitted
    const completeEvent = events.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    if (completeEvent && completeEvent.type === "complete") {
      expect(completeEvent.findings.length).toBe(findingEvents.length);
    }
  });

  it("handles source errors gracefully and continues with remaining sources", async () => {
    // Make search throw an error for one query
    search.search = async (query: string) => {
      if (query.includes("tin tức")) {
        throw new Error("Search rate limit exceeded");
      }
      return [{ title: "FPT Info", url: "https://fpt.com.vn", snippet: "FPT snippet" }];
    };

    const researchModule = createResearchModule({ llm, search, scraper, guards });

    const input: CompanyInput = { name: "FPT" };
    const events: ResearchEvent[] = [];

    for await (const event of researchModule.research(input)) {
      events.push(event);
    }

    // Complete event still reached
    const completeEvent = events.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();

    // Error event captured for failing source
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBeGreaterThan(0);
  });
});
