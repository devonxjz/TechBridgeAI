import { describe, it, expect } from "vitest";
import { createAnalystModule } from "@/modules/analyst";
import { MockLLMAdapter } from "@/adapters/llm/mock";
import type { CompanyProfile } from "@/lib/types";

describe("AnalystModule Unit Tests", () => {
  const llm = new MockLLMAdapter();
  const analystModule = createAnalystModule({ llm });

  const sampleProfile: CompanyProfile = {
    id: "fpt-corp",
    version: 1,
    createdAt: new Date(),
    lastUpdated: new Date(),
    input: { name: "FPT Corporation" },
    officialName: "Công ty Cổ phần FPT",
    tradingNames: ["FPT Corp"],
    taxId: "0101248141",
    industry: ["Công nghệ thông tin", "Viễn thông"],
    description: "Tập đoàn công nghệ hàng đầu tại Việt Nam.",
    keyPeople: [{ name: "Trương Gia Bình", title: "Chủ tịch HĐQT", source: "web_search", confidence: 0.9 }],
    products: ["FPT Software", "Cloud"],
    markets: ["Việt Nam", "Toàn cầu"],
    recentActivities: [],
    sources: [],
    overallConfidence: 0.9,
  };

  it("calculates weighted Collaboration Fit Score and returns full analysis report", async () => {
    const mockAnalysisData = {
      executiveSummary: "FPT là đối tác chiến lược lý tưởng về giải pháp công nghệ.",
      criteria: [
        { name: "Industry Alignment", score: 90, reasoning: "Rất phù hợp với lĩnh vực CNTT." },
        { name: "Company Size Match", score: 95, reasoning: "Quy mô lớn hơn 30.000 nhân sự." },
        { name: "Geographic Relevance", score: 85, reasoning: "Mạng lưới phủ sóng toàn quốc và quốc tế." },
        { name: "Digital Maturity", score: 95, reasoning: "Năng lực số hóa dẫn đầu." },
        { name: "Recent Activity", score: 85, reasoning: "Nhiều dự án AI mới triển khai." },
      ],
      riskFlags: [
        { type: "operational", description: "Áp lực tuyển dụng nhân sự chất lượng cao.", severity: "low" },
      ],
      suggestedActions: [
        { action: "Gửi thư ngỏ hợp tác mảng AI Agent", priority: "high", reasoning: "Phù hợp với định hướng chiến lược." },
      ],
    };

    llm.setResponse("Phân tích và đánh giá", JSON.stringify(mockAnalysisData));

    const report = await analystModule.analyze(sampleProfile, {
      sponsorCriteria: "Tìm kiếm đối tác công nghệ AI hàng đầu",
    });

    expect(report.companyId).toBe("fpt-corp");
    expect(report.fitScore).toBeDefined();
    expect(report.fitScore?.score).toBeGreaterThanOrEqual(85);
    expect(report.fitScore?.criteria.length).toBe(5);
    expect(report.riskFlags.length).toBe(1);
    expect(report.riskFlags[0].type).toBe("operational");
    expect(report.suggestedActions.length).toBe(1);
    expect(report.suggestedActions[0].priority).toBe("high");
    expect(report.executiveSummary).toContain("đối tác chiến lược");
  });
});
