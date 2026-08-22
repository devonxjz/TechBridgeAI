import { describe, it, expect } from "vitest";
import { CompanyInputSchema, type CompanyInput } from "@/lib/types";

describe("Domain Validation - CompanyInputSchema", () => {
  it("validates a minimal valid company input", () => {
    const input: CompanyInput = {
      name: "FPT Corporation",
    };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("FPT Corporation");
    }
  });

  it("validates a full company input with optional fields", () => {
    const input: CompanyInput = {
      name: "Tập đoàn Vingroup",
      website: "https://vingroup.net",
      taxId: "0101245486",
      linkedinUrl: "https://www.linkedin.com/company/vingroup",
      additionalKeywords: ["bất động sản", "xe điện", "công nghệ"],
    };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.website).toBe("https://vingroup.net");
      expect(result.data.additionalKeywords?.length).toBe(3);
    }
  });

  it("rejects empty company name", () => {
    const input = { name: "" };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects company name exceeding 200 characters", () => {
    const input = { name: "A".repeat(201) };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid website URLs", () => {
    const input = { name: "Test Corp", website: "not-a-url" };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects more than 5 additional keywords", () => {
    const input = {
      name: "Test Corp",
      additionalKeywords: ["k1", "k2", "k3", "k4", "k5", "k6"],
    };
    const result = CompanyInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
