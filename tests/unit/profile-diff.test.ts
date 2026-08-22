import { describe, it, expect } from "vitest";
import { createProfileModule } from "@/modules/profile";
import { MockLLMAdapter } from "@/adapters/llm/mock";
import type { CompanyProfile } from "@/lib/types";

describe("Profile Diff Engine Unit Tests", () => {
  const llm = new MockLLMAdapter();
  const profileModule = createProfileModule({ llm });

  const baseProfile: CompanyProfile = {
    id: "comp-123",
    version: 1,
    createdAt: new Date("2026-01-01"),
    lastUpdated: new Date("2026-01-01"),
    input: { name: "TechCorp" },
    officialName: "TechCorp Vietnam JSC",
    tradingNames: ["TechCorp"],
    taxId: "0109999999",
    industry: ["Software", "AI"],
    description: "Original description of TechCorp.",
    foundedYear: 2020,
    website: "https://techcorp.vn",
    companySize: "51-200",
    keyPeople: [
      { name: "Nguyen Van A", title: "CEO", source: "website", confidence: 0.9 },
      { name: "Tran Van B", title: "CTO", source: "website", confidence: 0.9 },
    ],
    products: ["Cloud ERP"],
    markets: ["Vietnam"],
    recentActivities: [],
    sources: [],
    overallConfidence: 0.85,
  };

  it("returns summary of no changes when profiles are identical", () => {
    const diff = profileModule.diffProfiles(baseProfile, baseProfile);
    expect(diff.changes.length).toBe(0);
    expect(diff.summary).toContain("Không có thay đổi");
  });

  it("detects scalar field modifications (description, companySize)", () => {
    const updatedProfile: CompanyProfile = {
      ...baseProfile,
      version: 2,
      description: "Updated description with new AI initiatives.",
      companySize: "201-500",
    };

    const diff = profileModule.diffProfiles(updatedProfile, baseProfile);
    expect(diff.fromVersion).toBe(1);
    expect(diff.toVersion).toBe(2);
    expect(diff.changes.length).toBe(2);

    const descChange = diff.changes.find((c) => c.field === "description");
    expect(descChange?.changeType).toBe("modified");
    expect(descChange?.oldValue).toBe(baseProfile.description);
    expect(descChange?.newValue).toBe(updatedProfile.description);

    const sizeChange = diff.changes.find((c) => c.field === "companySize");
    expect(sizeChange?.newValue).toBe("201-500");
  });

  it("detects array modifications (industry, products)", () => {
    const updatedProfile: CompanyProfile = {
      ...baseProfile,
      version: 2,
      industry: ["Software", "AI", "Robotics"],
      products: ["Cloud ERP", "AI Agent System"],
    };

    const diff = profileModule.diffProfiles(updatedProfile, baseProfile);
    expect(diff.changes.some((c) => c.field === "industry")).toBe(true);
    expect(diff.changes.some((c) => c.field === "products")).toBe(true);
  });

  it("detects key people changes with high significance", () => {
    const updatedProfile: CompanyProfile = {
      ...baseProfile,
      version: 2,
      keyPeople: [
        { name: "Nguyen Van A", title: "Chairman", source: "website", confidence: 0.9 },
        { name: "Le Van C", title: "New CEO", source: "website", confidence: 0.9 },
      ],
    };

    const diff = profileModule.diffProfiles(updatedProfile, baseProfile);
    const peopleChange = diff.changes.find((c) => c.field === "keyPeople");
    expect(peopleChange).toBeDefined();
    expect(peopleChange?.significance).toBe("high");
    expect(diff.summary).toContain("keyPeople");
  });
});
