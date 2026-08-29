import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  MockLLMAdapter,
  MockSearchAdapter,
  MockScraperAdapter,
} from "../helpers/mock-adapters";
import { MemoryStorageAdapter } from "@/adapters/storage/memory";
import type { CompanyProfile, ProfileDiff } from "@/lib/types";

describe("Adapters Unit Tests", () => {
  describe("MockLLMAdapter", () => {
    let llm: MockLLMAdapter;

    beforeEach(() => {
      llm = new MockLLMAdapter();
    });

    it("returns default mock response when no match", async () => {
      const res = await llm.complete("Tell me about company X");
      expect(res).toBe('{"result": "mock response"}');
      expect(llm.callLog.length).toBe(1);
    });

    it("returns canned response on substring match", async () => {
      llm.setResponse("FPT", JSON.stringify({ officialName: "FPT Corporation" }));
      const res = await llm.complete("Analyze FPT now");
      expect(res).toContain("FPT Corporation");
    });

    it("supports completeStructured with zod schema", async () => {
      const schema = z.object({
        name: z.string(),
        founded: z.number(),
      });
      llm.setResponse("struct", JSON.stringify({ name: "FPT", founded: 1988 }));
      const result = await llm.completeStructured("struct test", schema);
      expect(result.name).toBe("FPT");
      expect(result.founded).toBe(1988);
    });

    it("supports streaming async generator", async () => {
      llm.setResponse("hello", "Hello world from stream");
      const chunks: string[] = [];
      for await (const chunk of llm.stream("hello")) {
        chunks.push(chunk);
      }
      expect(chunks.join("")).toContain("Hello world from stream");
    });
  });

  describe("MockSearchAdapter", () => {
    let search: MockSearchAdapter;

    beforeEach(() => {
      search = new MockSearchAdapter();
    });

    it("returns no results for unknown query", async () => {
      const results = await search.search("unknown query");
      expect(results).toEqual([]);
    });

    it("returns matched canned search results and respects maxResults", async () => {
      search.setResults("Viettel", [
        { title: "Viettel 1", url: "https://viettel.vn", snippet: "Tập đoàn Viettel" },
        { title: "Viettel 2", url: "https://viettel.com.vn", snippet: "Viễn thông" },
        { title: "Viettel 3", url: "https://news.vn/viettel", snippet: "Tin tức Viettel" },
      ]);

      const results = await search.search("Viettel Telecom", { maxResults: 2 });
      expect(results.length).toBe(2);
      expect(results[0].title).toBe("Viettel 1");
      expect(search.callLog.length).toBe(1);
    });
  });

  describe("SerperSearchAdapter", () => {
    it("calls news endpoint and maps publisher and date when vertical is news", async () => {
      const { SerperSearchAdapter } = await import("@/adapters/search/serper");
      const adapter = new SerperSearchAdapter("mock-key");

      const originalFetch = globalThis.fetch;
      try {
        let calledUrl = "";

        globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
          calledUrl = String(url);
          return {
            ok: true,
            json: async () => ({
              news: [
                {
                  title: "FPT công bố lợi nhuận",
                  link: "https://vnexpress.net/fpt-loi-nhuan",
                  snippet: "Lợi nhuận quý tăng",
                  source: "VnExpress",
                  date: "1 ngày trước",
                },
              ],
            }),
          };
        });

        const results = await adapter.search("FPT lợi nhuận", { vertical: "news" });
        expect(calledUrl).toBe("https://google.serper.dev/news");
        expect(results.length).toBe(1);
        expect(results[0].publisherName).toBe("VnExpress");
        expect(results[0].publishedLabel).toBe("1 ngày trước");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("calls search endpoint when vertical is web or omitted", async () => {
      const { SerperSearchAdapter } = await import("@/adapters/search/serper");
      const adapter = new SerperSearchAdapter("mock-key");

      const originalFetch = globalThis.fetch;
      try {
        let calledUrl = "";

        globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
          calledUrl = url;
          return {
            ok: true,
            json: async () => ({
              organic: [
                {
                  title: "FPT Trang chủ",
                  link: "https://fpt.com.vn",
                  snippet: "Tập đoàn FPT",
                },
              ],
            }),
          };
        });

        const results = await adapter.search("FPT");
        expect(calledUrl).toBe("https://google.serper.dev/search");
        expect(results.length).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });


  describe("MockScraperAdapter", () => {
    let scraper: MockScraperAdapter;

    beforeEach(() => {
      scraper = new MockScraperAdapter();
    });

    it("returns canned page content if registered", async () => {
      scraper.setPage("https://fpt.com.vn", {
        url: "https://fpt.com.vn",
        title: "FPT Official",
        text: "Leading technology corporation in Vietnam",
      });

      const page = await scraper.extract("https://fpt.com.vn");
      expect(page.title).toBe("FPT Official");
      expect(page.text).toContain("Leading technology");
      expect(scraper.callLog).toContain("https://fpt.com.vn");
    });

    it("throws when url is not explicitly set", async () => {
      await expect(scraper.extract("https://unknown.com")).rejects.toThrow(
        "No mock page registered"
      );
    });
  });

  describe("MemoryStorageAdapter", () => {
    let storage: MemoryStorageAdapter;

    beforeEach(() => {
      storage = new MemoryStorageAdapter();
    });

    const createDummyProfile = (id: string, version: number): CompanyProfile => ({
      id,
      version,
      createdAt: new Date(),
      lastUpdated: new Date(),
      input: { name: "Test Corp" },
      officialName: `Test Corp v${version}`,
      tradingNames: [],
      industry: ["Tech"],
      description: "Test description",
      keyPeople: [],
      products: ["Software"],
      markets: ["Vietnam"],
      recentActivities: [],
      sources: [],
      overallConfidence: 0.85,
    });

    it("saves and retrieves latest version of a profile", async () => {
      const p1 = createDummyProfile("comp-1", 1);
      const p2 = createDummyProfile("comp-1", 2);

      await storage.saveProfile(p1);
      await storage.saveProfile(p2);

      const latest = await storage.getLatestProfile("comp-1");
      expect(latest?.version).toBe(2);
      expect(latest?.officialName).toBe("Test Corp v2");
    });

    it("retrieves a specific version of a profile", async () => {
      const p1 = createDummyProfile("comp-1", 1);
      const p2 = createDummyProfile("comp-1", 2);

      await storage.saveProfile(p1);
      await storage.saveProfile(p2);

      const v1 = await storage.getProfile("comp-1", 1);
      expect(v1?.version).toBe(1);
      expect(v1?.officialName).toBe("Test Corp v1");
    });

    it("lists latest profile across distinct companies", async () => {
      await storage.saveProfile(createDummyProfile("comp-1", 1));
      await storage.saveProfile(createDummyProfile("comp-1", 2));
      await storage.saveProfile(createDummyProfile("comp-2", 1));

      const list = await storage.listProfiles();
      expect(list.length).toBe(2);
    });

    it("saves and retrieves diffs", async () => {
      const diff: ProfileDiff = {
        companyId: "comp-1",
        fromVersion: 1,
        toVersion: 2,
        changes: [{ field: "description", oldValue: "old", newValue: "new", changeType: "modified", significance: "medium" }],
        summary: "Updated description",
      };

      await storage.saveDiff(diff);
      const diffs = await storage.getDiffs("comp-1");
      expect(diffs.length).toBe(1);
      expect(diffs[0].summary).toBe("Updated description");
    });

    it("resolves, persists, and retrieves complete research snapshots", async () => {
      const identity = {
        taxId: "0101245486",
        domain: "vingroup.net",
        name: "tập đoàn vingroup",
      };

      const resolvedId = await storage.resolveOrCreateIdentity(identity, "company-a");
      expect(resolvedId).toBe("company-a");

      const draftSnapshot = {
        profile: createDummyProfile("company-a", 1),
        report: {
          companyId: "company-a",
          generatedAt: new Date(),
          riskFlags: [],
          suggestedActions: [],
          executiveSummary: "Summary",
        },
        diff: null,
      };

      const saved = await storage.persistResearchSnapshot(identity, draftSnapshot);
      expect(saved.profile.id).toBe("company-a");
      expect(saved.lastSyncedAt).toBeDefined();

      const candidates = await storage.findIdentityCandidates(identity);
      expect(candidates).toEqual([
        expect.objectContaining({ companyId: "company-a", taxId: "0101245486" }),
      ]);

      const snapshot = await storage.getLatestCompleteSnapshot("company-a");
      expect(snapshot).toMatchObject({
        profile: { id: "company-a", version: 1 },
        report: { companyId: "company-a" },
        diff: null,
      });
    });

    it("handles version 2 snapshot with matching diff", async () => {
      const identity = {
        taxId: "0101245486",
        domain: "vingroup.net",
        name: "tập đoàn vingroup",
      };

      await storage.resolveOrCreateIdentity(identity, "company-a");

      const v1Draft = {
        profile: createDummyProfile("company-a", 1),
        report: {
          companyId: "company-a",
          generatedAt: new Date(),
          riskFlags: [],
          suggestedActions: [],
          executiveSummary: "Summary v1",
        },
        diff: null,
      };
      await storage.persistResearchSnapshot(identity, v1Draft);

      const v2Diff: ProfileDiff = {
        companyId: "company-a",
        fromVersion: 1,
        toVersion: 2,
        changes: [{ field: "description", oldValue: "v1", newValue: "v2", changeType: "modified", significance: "medium" }],
        summary: "Upgraded to v2",
      };

      const v2Draft = {
        profile: createDummyProfile("company-a", 2),
        report: {
          companyId: "company-a",
          generatedAt: new Date(),
          riskFlags: [],
          suggestedActions: [],
          executiveSummary: "Summary v2",
        },
        diff: v2Diff,
      };
      await storage.persistResearchSnapshot(identity, v2Draft);

      const snapshot = await storage.getLatestCompleteSnapshot("company-a");
      expect(snapshot).toMatchObject({
        profile: { id: "company-a", version: 2 },
        report: { companyId: "company-a", executiveSummary: "Summary v2" },
        diff: { toVersion: 2, summary: "Upgraded to v2" },
      });
    });

    it("throws IdentityConflictError when tax ID is assigned to another company", async () => {
      await storage.resolveOrCreateIdentity(
        { taxId: "0101245486", domain: "vingroup.net", name: "vingroup" },
        "company-a"
      );

      await expect(
        storage.persistResearchSnapshot(
          { taxId: "0101245486", domain: "other.vn", name: "other" },
          {
            profile: createDummyProfile("company-b", 1),
            report: {
              companyId: "company-b",
              generatedAt: new Date(),
              riskFlags: [],
              suggestedActions: [],
              executiveSummary: "Summary",
            },
            diff: null,
          }
        )
      ).rejects.toThrow("Thông tin định danh công ty mâu thuẫn.");
    });
  });
});
