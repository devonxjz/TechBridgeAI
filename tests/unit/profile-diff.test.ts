import { describe, it, expect } from "vitest";
import { createProfileModule } from "@/modules/profile";
import { MockLLMAdapter } from "../helpers/mock-adapters";
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

  it("builds profile with rich source citations and field evidence mapping", async () => {
    const customLLM = new MockLLMAdapter();
    customLLM.setResponse("", JSON.stringify({
        officialName: "CÔNG TY CỔ PHẦN FPT",
        tradingNames: ["FPT Corporation"],
        taxId: "0101248141",
        industry: ["Công nghệ thông tin"],
        description: "FPT là tập đoàn công nghệ hàng đầu Việt Nam.",
        foundedYear: 1988,
        headquarters: {
          street: "10 Phạm Văn Bạch",
          city: "Hà Nội",
          country: "Việt Nam",
        },
        website: "https://fpt.com.vn",
        keyPeople: [{ name: "Trương Gia Bình", title: "Chủ tịch HĐQT" }],
        products: ["FPT Cloud", "AI Solutions"],
        markets: ["Toàn cầu", "Việt Nam"],
        companySize: "1000+",
        recentActivities: [],
        fieldEvidence: {
          officialName: {
            supportingUrls: ["https://api.vietqr.io/mst"],
            conflictingUrls: [],
          },
          taxId: {
            supportingUrls: ["https://api.vietqr.io/mst"],
            conflictingUrls: [],
          },
        },
      }));

    const profileModuleUnderTest = createProfileModule({ llm: customLLM });
    const profile = await profileModuleUnderTest.buildProfile(
      [
        {
          source: "registry",
          url: "https://api.vietqr.io/mst",
          content: "CÔNG TY CỔ PHẦN FPT MST 0101248141",
          confidence: 0.95,
          extractedAt: new Date(),
        },
      ],
      { name: "FPT", website: "https://fpt.com.vn" }
    );

    expect(profile.sources).toHaveLength(1);
    expect(profile.sources[0].signals?.primarySource).toBe(true);
    expect(profile.sources[0].fieldsContributed).toContain("officialName");
    expect(profile.sources[0].fieldsContributed).toContain("taxId");
    expect(profile.fieldEvidence?.officialName?.status).toBe("primary_source");
  });
});
