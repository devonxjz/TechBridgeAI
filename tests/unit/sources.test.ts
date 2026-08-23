import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockSearchAdapter } from "@/adapters/search/mock";
import { MockScraperAdapter } from "@/adapters/scraper/mock";
import { searchWeb } from "@/modules/research/sources/web-search";
import { scrapeWebsite } from "@/modules/research/sources/website";
import { searchNews } from "@/modules/research/sources/news";
import { fetchRegistryData } from "@/modules/research/sources/registry";
import { scrapeLinkedIn } from "@/modules/research/sources/linkedin";
import {
  createScraperAdapter,
  resetAdapters,
  getGuards,
} from "@/config";
import type { CompanyInput } from "@/lib/types";
import type { RegistryAdapter } from "@/adapters/registry";
import { RegistryError } from "@/adapters/registry";
import type { ScraperAdapter } from "@/adapters/scraper";

describe("Research Sources Unit Tests", () => {
  let search: MockSearchAdapter;
  let scraper: MockScraperAdapter;

  beforeEach(() => {
    search = new MockSearchAdapter();
    scraper = new MockScraperAdapter();
  });

  describe("web-search source", () => {
    it("builds queries with Vietnamese keywords and taxId", async () => {
      search.setResults("FPT", [
        { title: "FPT Telecom", url: "https://fpt.vn", snippet: "Thông tin FPT" },
      ]);

      const input: CompanyInput = {
        name: "FPT",
        taxId: "0101234567",
        additionalKeywords: ["AI"],
      };

      const findings = await searchWeb(input, search);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].source).toBe("web_search");
      expect(findings[0].confidence).toBe(0.6);
      expect(search.callLog.some((c) => c.query.includes("mã số thuế"))).toBe(true);
      expect(search.callLog.some((c) => c.query.includes("AI"))).toBe(true);
    });
  });

  describe("website source", () => {
    it("scrapes direct website url and attempts subpages within maxPages limit", async () => {
      scraper.setPage("https://fpt.com.vn", {
        url: "https://fpt.com.vn",
        title: "FPT Homepage",
        text: "Leading ICT corporation with 30000 employees in Vietnam.",
      });
      scraper.setPage("https://fpt.com.vn/about", {
        url: "https://fpt.com.vn/about",
        title: "About FPT",
        text: "Founded in 1988 by Truong Gia Binh and colleagues.",
      });

      const input: CompanyInput = {
        name: "FPT",
        website: "https://fpt.com.vn",
      };

      const findings = await scrapeWebsite(input, scraper, search, 5);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings.some((f) => f.content.includes("Leading ICT"))).toBe(true);
      expect(findings.every((f) => f.source === "website")).toBe(true);
      expect(scraper.callLog.length).toBeLessThanOrEqual(5);
    });

    it("strictly stops before maxPages + 1 even if all fail", async () => {
      const input: CompanyInput = {
        name: "FPT",
        website: "https://fpt.com.vn",
      };

      scraper.extract = async (url: string) => {
        scraper.callLog.push(url);
        throw new Error("Page error");
      };

      const findings = await scrapeWebsite(input, scraper, search, 3);
      expect(findings).toEqual([]);
      expect(scraper.callLog.length).toBe(3);
    });

    it("discovers website via search when website is not provided", async () => {
      search.setResults("VNPT", [
        { title: "VNPT Official", url: "https://vnpt.vn", snippet: "Tap doan VNPT" },
      ]);
      scraper.setPage("https://vnpt.vn", {
        url: "https://vnpt.vn",
        title: "VNPT",
        text: "VNPT Telecom Group Vietnam - Comprehensive Telecommunications and Information Technology Services in Vietnam with nationwide infrastructure.",
      });

      const input: CompanyInput = { name: "VNPT" };
      const findings = await scrapeWebsite(input, scraper, search, 5);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].url).toBe("https://vnpt.vn");
    });
  });

  describe("news source", () => {
    it("searches news and excludes company's own website", async () => {
      search.setResults("Vingroup", [
        { title: "VinFast IPO", url: "https://vnexpress.net/vinfast-ipo", snippet: "VinFast IPO thanh cong" },
        { title: "Vingroup official", url: "https://vingroup.net/news-1", snippet: "Self news" },
      ]);

      const input: CompanyInput = {
        name: "Vingroup",
        website: "https://vingroup.net",
      };

      const findings = await searchNews(input, search);
      expect(findings.length).toBe(2);
      expect(findings.every((f) => !f.url.includes("vingroup.net"))).toBe(true);
      expect(findings[0].source).toBe("news");
    });
  });

  describe("registry source", () => {
    it("uses VietQR first when taxId is provided and succeeds with high confidence", async () => {
      const mockRegistry: RegistryAdapter = {
        findByTaxId: vi.fn().mockResolvedValue({
          taxId: "0101234567",
          name: "CÔNG TY CỔ PHẦN FPT",
          internationalName: "FPT CORPORATION",
          shortName: "FPT",
          address: "Số 10 Phạm Văn Bạch",
        }),
      };

      const input: CompanyInput = { name: "FPT", taxId: "0101234567" };
      const findings = await fetchRegistryData(input, search, scraper, mockRegistry);

      expect(mockRegistry.findByTaxId).toHaveBeenCalledWith("0101234567");
      expect(findings.length).toBe(1);
      expect(findings[0].source).toBe("registry");
      expect(findings[0].confidence).toBe(0.95);
      expect(findings[0].metadata?.via).toBe("vietqr");
      expect(findings[0].content).toContain("CÔNG TY CỔ PHẦN FPT");
      expect(findings[0].content).toContain("0101234567");
    });

    it("falls back through aggregator -> search when VietQR fails or returns null", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const mockRegistry: RegistryAdapter = {
        findByTaxId: vi.fn().mockRejectedValue(new RegistryError("Rate limit", "rate_limited")),
      };

      search.setResults("masothue.com", [
        { title: "MST FPT", url: "https://masothue.com/0101234-fpt", snippet: "MST: 0101234, Dai dien: Truong Gia Binh" },
      ]);
      scraper.setPage("https://masothue.com/0101234-fpt", {
        url: "https://masothue.com/0101234-fpt",
        title: "Thong tin MST FPT",
        text: "Cong ty Co phan FPT, Ma so thue 0101234567, Ngay cap giay phep kinh doanh nam 1988 boi So Ke hoach va Dau tu Ha Noi. Dia chi: Toa nha FPT, Pho Duy Tan, Cau Giay, Ha Noi.",
      });

      const input: CompanyInput = { name: "FPT", taxId: "0101234567" };
      const findings = await fetchRegistryData(input, search, scraper, mockRegistry);

      expect(findings.length).toBe(1);
      expect(findings[0].source).toBe("registry");
      expect(findings[0].content).toContain("0101234567");
      expect(findings[0].confidence).toBe(0.75);

      const logs = logSpy.mock.calls.map(([arg]) => {
        try {
          return JSON.parse(arg);
        } catch {
          return null;
        }
      }).filter(Boolean);

      expect(logs.some((l) => l.event === "registry_fallback" && l.reason === "rate_limited")).toBe(true);
    });

    it("falls back directly through aggregator without calling VietQR when taxId is missing", async () => {
      const mockRegistry: RegistryAdapter = {
        findByTaxId: vi.fn(),
      };

      search.setResults("masothue.com", [
        { title: "MST FPT", url: "https://masothue.com/0101234-fpt", snippet: "MST: 0101234, Dai dien: Truong Gia Binh" },
      ]);
      scraper.setPage("https://masothue.com/0101234-fpt", {
        url: "https://masothue.com/0101234-fpt",
        title: "Thong tin MST FPT",
        text: "Cong ty Co phan FPT, Ma so thue 0101234567, Ngay cap giay phep kinh doanh nam 1988 boi So Ke hoach va Dau tu Ha Noi. Dia chi: Toa nha FPT, Pho Duy Tan, Cau Giay, Ha Noi.",
      });

      const input: CompanyInput = { name: "FPT" };
      const findings = await fetchRegistryData(input, search, scraper, mockRegistry);

      expect(mockRegistry.findByTaxId).not.toHaveBeenCalled();
      expect(findings.length).toBe(1);
      expect(findings[0].source).toBe("registry");
    });
  });

  describe("linkedin source", () => {
    it("extracts from provided linkedinUrl", async () => {
      scraper.setPage("https://linkedin.com/company/fpt", {
        url: "https://linkedin.com/company/fpt",
        title: "FPT on LinkedIn",
        text: "Information Technology & Services, 10,001+ employees, Hanoi",
      });

      const input: CompanyInput = {
        name: "FPT",
        linkedinUrl: "https://linkedin.com/company/fpt",
      };

      const findings = await scrapeLinkedIn(input, scraper);
      expect(findings.length).toBe(1);
      expect(findings[0].source).toBe("linkedin");
      expect(findings[0].confidence).toBe(0.7);
    });

    it("returns empty array if linkedinUrl is omitted", async () => {
      const input: CompanyInput = { name: "FPT" };
      const findings = await scrapeLinkedIn(input, scraper);
      expect(findings).toEqual([]);
    });
  });

  describe("Scraper Factory and Config composition", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      resetAdapters();
    });

    it("creates tiered adapter with direct, jina, tinyfish when keys are present", () => {
      process.env.SCRAPER_PROVIDER = "tiered";
      process.env.SCRAPER_DIRECT_ENABLED = "true";
      process.env.SCRAPER_JINA_ENABLED = "true";
      process.env.SCRAPER_TINYFISH_ENABLED = "true";
      process.env.JINA_API_KEY = "jina-key";
      process.env.TINYFISH_API_KEY = "tinyfish-key";

      const adapter = createScraperAdapter();
      expect(adapter.constructor.name).toBe("TieredScraperAdapter");
      const tiers = (adapter as unknown as { tiers: ScraperAdapter[] }).tiers;
      expect(tiers.length).toBe(3);
      expect(tiers[0].constructor.name).toBe("SafeDirectScraperAdapter");
      expect(tiers[1].constructor.name).toBe("JinaReaderScraperAdapter");
      expect(tiers[2].constructor.name).toBe("TinyFishScraperAdapter");
    });

    it("skips Jina and TinyFish when keys are missing without crashing", () => {
      process.env.SCRAPER_PROVIDER = "tiered";
      process.env.SCRAPER_DIRECT_ENABLED = "true";
      delete process.env.JINA_API_KEY;
      delete process.env.TINYFISH_API_KEY;

      const adapter = createScraperAdapter();
      expect(adapter.constructor.name).toBe("TieredScraperAdapter");
      const tiers = (adapter as unknown as { tiers: ScraperAdapter[] }).tiers;
      expect(tiers.length).toBe(1);
      expect(tiers[0].constructor.name).toBe("SafeDirectScraperAdapter");
    });

    it("creates rollback chain Jina -> TinyFish when direct is disabled", () => {
      process.env.SCRAPER_PROVIDER = "tiered";
      process.env.SCRAPER_DIRECT_ENABLED = "false";
      process.env.JINA_API_KEY = "jina-key";
      process.env.TINYFISH_API_KEY = "tinyfish-key";

      const adapter = createScraperAdapter();
      const tiers = (adapter as unknown as { tiers: ScraperAdapter[] }).tiers;
      expect(tiers.length).toBe(2);
      expect(tiers[0].constructor.name).toBe("JinaReaderScraperAdapter");
      expect(tiers[1].constructor.name).toBe("TinyFishScraperAdapter");
    });

    it("throws error when all tiers are disabled or have missing keys", () => {
      process.env.SCRAPER_PROVIDER = "tiered";
      process.env.SCRAPER_DIRECT_ENABLED = "false";
      delete process.env.JINA_API_KEY;
      delete process.env.TINYFISH_API_KEY;

      expect(() => createScraperAdapter()).toThrow(/No scraper tiers enabled/);
    });

    it("supports legacy tinyfish provider and mock provider", () => {
      process.env.SCRAPER_PROVIDER = "tinyfish";
      process.env.TINYFISH_API_KEY = "tf-key";
      const tf = createScraperAdapter();
      expect(tf.constructor.name).toBe("TinyFishScraperAdapter");

      resetAdapters();
      process.env.SCRAPER_PROVIDER = "mock";
      const mock = createScraperAdapter();
      expect(mock.constructor.name).toBe("MockScraperAdapter");
    });

    it("parses guards with safe fallbacks on invalid/zero/negative env values", () => {
      process.env.SOURCE_TIMEOUT_MS = "-500";
      process.env.MAX_SCRAPE_PAGES_PER_RESEARCH = "invalid";

      const guards = getGuards();
      expect(guards.sourceTimeoutMs).toBe(30_000);
      expect(guards.maxScrapePagesPerResearch).toBe(5);
    });
  });
});
