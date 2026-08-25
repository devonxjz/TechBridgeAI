import { describe, it, expect } from "vitest";
import { createProfileModule } from "@/modules/profile";
import { MockLLMAdapter } from "../helpers/mock-adapters";
import type { CompanyInput, RawFinding } from "@/lib/types";

describe("ProfileModule Integration Tests", () => {
  it("builds a structured CompanyProfile from raw findings via LLM", async () => {
    const llm = new MockLLMAdapter();

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
        { name: "Nguyễn Văn Khoa", title: "Tổng Giám đốc" },
      ],
      products: ["FPT Software", "FPT IS", "FPT Telecom"],
      markets: ["Việt Nam", "Nhật Bản", "Mỹ"],
      companySize: "1000+",
      recentActivities: [
        { title: "Khai trương trung tâm AI", summary: "Đầu tư trung tâm AI tại Quy Nhơn", date: "2026-01-15" },
      ],
    };

    llm.setResponse("Tổng hợp thông tin", JSON.stringify(mockProfileData));

    const profileModule = createProfileModule({ llm });

    const input: CompanyInput = {
      name: "FPT",
      website: "https://fpt.com.vn",
    };

    const findings: RawFinding[] = [
      {
        source: "website",
        url: "https://fpt.com.vn",
        content: "FPT là tập đoàn công nghệ thông tin lớn nhất Việt Nam",
        extractedAt: new Date(),
        confidence: 0.85,
      },
      {
        source: "registry",
        url: "https://masothue.com/fpt",
        content: "MST 0101248141, Đại diện: Trương Gia Bình",
        extractedAt: new Date(),
        confidence: 0.75,
      },
    ];

    const profile = await profileModule.buildProfile(findings, input);

    expect(profile.officialName).toBe("Công ty Cổ phần FPT");
    expect(profile.version).toBe(1);
    expect(profile.id).toBeDefined();
    expect(profile.keyPeople.length).toBe(2);
    expect(profile.keyPeople[0].name).toBe("Trương Gia Bình");
    expect(profile.overallConfidence).toBeGreaterThan(0.7);
    expect(profile.lowConfidence).toBe(false);
    expect(profile.sources.length).toBe(2);
  });
});
