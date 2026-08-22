import { describe, it, expect, beforeEach } from "vitest";
import { MockSearchAdapter } from "@/adapters/search/mock";
import { MockScraperAdapter } from "@/adapters/scraper/mock";
import { searchWeb } from "@/modules/research/sources/web-search";
import { scrapeWebsite } from "@/modules/research/sources/website";
import { searchNews } from "@/modules/research/sources/news";
import { fetchRegistryData } from "@/modules/research/sources/registry";
import { scrapeLinkedIn } from "@/modules/research/sources/linkedin";
import type { CompanyInput } from "@/lib/types";

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
    it("scrapes direct website url and attempts subpages", async () => {
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

      const findings = await scrapeWebsite(input, scraper, search);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings.some((f) => f.content.includes("Leading ICT"))).toBe(true);
      expect(findings.every((f) => f.source === "website")).toBe(true);
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
      const findings = await scrapeWebsite(input, scraper, search);
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
      expect(findings.length).toBe(2); // query runs twice for 2 queries
      expect(findings.every((f) => !f.url.includes("vingroup.net"))).toBe(true);
      expect(findings[0].source).toBe("news");
    });
  });

  describe("registry source", () => {
    it("falls back through aggregator -> search hierarchy", async () => {
      search.setResults("masothue.com", [
        { title: "MST FPT", url: "https://masothue.com/0101234-fpt", snippet: "MST: 0101234, Dai dien: Truong Gia Binh" },
      ]);
      scraper.setPage("https://masothue.com/0101234-fpt", {
        url: "https://masothue.com/0101234-fpt",
        title: "Thong tin MST FPT",
        text: "Cong ty Co phan FPT, Ma so thue 0101234567, Ngay cap giay phep kinh doanh nam 1988 boi So Ke hoach va Dau tu Ha Noi. Dia chi: Toa nha FPT, Pho Duy Tan, Cau Giay, Ha Noi.",
      });

      const input: CompanyInput = { name: "FPT", taxId: "0101234567" };
      const findings = await fetchRegistryData(input, search, scraper);
      expect(findings.length).toBe(1);
      expect(findings[0].source).toBe("registry");
      expect(findings[0].content).toContain("0101234567");
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
});
