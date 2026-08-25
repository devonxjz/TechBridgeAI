import { describe, expect, it } from "vitest";
import { buildResearchQueries } from "@/modules/research/queries";

describe("buildResearchQueries", () => {
  it("builds a bounded deterministic query matrix", () => {
    const input = {
      name: "FPT",
      taxId: "0101248141",
      additionalKeywords: ["AI"],
    };
    const plan = buildResearchQueries(input, 6);

    const allQueries = [...plan.web, ...plan.news];
    expect(allQueries.length).toBeLessThanOrEqual(6);
    expect(plan.web.join(" ")).toContain("0101248141");
    expect(plan.web.join(" ")).toContain("lãnh đạo");
    expect(plan.news.join(" ")).toContain("tin tức");
    expect(buildResearchQueries(input, 6)).toEqual(plan);
  });

  it("respects maxQueries cap when additional keywords are provided", () => {
    const input = {
      name: "Vingroup",
      additionalKeywords: ["VinFast", "EV", "RealEstate", "Hospitality"],
    };
    const plan = buildResearchQueries(input, 6);
    const allQueries = [...plan.web, ...plan.news];
    expect(allQueries.length).toBe(6);
    expect(plan.web.join(" ")).toContain("VinFast");
  });

  it("handles basic input without taxId or keywords", () => {
    const input = { name: "MISA" };
    const plan = buildResearchQueries(input, 6);
    expect(plan.web.length).toBeGreaterThan(0);
    expect(plan.news.length).toBeGreaterThan(0);
    expect(plan.web.length + plan.news.length).toBe(6);
  });
});
