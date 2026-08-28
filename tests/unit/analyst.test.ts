import { describe, it, expect } from "vitest";
import { createAnalystModule } from "@/modules/analyst";
import { MockLLMAdapter } from "../helpers/mock-adapters";
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

  it("resolves claim evidence for criteria, risk flags, and actions from profile sources", async () => {
    const profileWithSources: CompanyProfile = {
      ...sampleProfile,
      sources: [
        {
          source: "news",
          url: "https://vnexpress.net/fpt-ai",
          accessedAt: new Date(),
          fieldsContributed: [],
          publication: { publisherDomain: "vnexpress.net", authors: [] },
          contentFingerprint: "fp-1",
        },
        {
          source: "news",
          url: "https://dantri.com.vn/fpt-risk",
          accessedAt: new Date(),
          fieldsContributed: [],
          publication: { publisherDomain: "dantri.com.vn", authors: [] },
          contentFingerprint: "fp-2",
        },
      ],
    };

    const mockAnalysisData = {
      executiveSummary: "FPT đánh giá tích cực",
      criteria: [
        {
          name: "Recent Activity",
          score: 90,
          reasoning: "Tăng trưởng mạnh",
          evidence: {
            supportingUrls: ["https://vnexpress.net/fpt-ai"],
            conflictingUrls: [],
          },
        },
        { name: "Industry Alignment", score: 80, reasoning: "Phù hợp" },
        { name: "Company Size Match", score: 80, reasoning: "Lớn" },
        { name: "Geographic Relevance", score: 80, reasoning: "Rộng" },
        { name: "Digital Maturity", score: 80, reasoning: "Cao" },
      ],
      riskFlags: [
        {
          type: "reputation",
          description: "Rủi ro biến động thị trường",
          severity: "low",
          evidence: {
            supportingUrls: ["https://dantri.com.vn/fpt-risk"],
            conflictingUrls: [],
          },
        },
      ],
      suggestedActions: [
        {
          action: "Liên hệ làm việc",
          priority: "high",
          reasoning: "Thời điểm thích hợp",
          evidence: {
            supportingUrls: ["https://vnexpress.net/fpt-ai"],
            conflictingUrls: [],
          },
        },
      ],
    };

    llm.setResponse("Phân tích và đánh giá", JSON.stringify(mockAnalysisData));
    const report = await analystModule.analyze(profileWithSources);

    const recentAct = report.fitScore?.criteria.find((c) => c.name === "Recent Activity");
    expect(recentAct?.evidence?.status).toBe("single_source");
    expect(recentAct?.evidence?.supportingUrls).toEqual(["https://vnexpress.net/fpt-ai"]);

    expect(report.riskFlags[0].evidence?.status).toBe("single_source");
    expect(report.riskFlags[0].evidence?.supportingUrls).toEqual(["https://dantri.com.vn/fpt-risk"]);

    expect(report.suggestedActions[0].evidence?.status).toBe("single_source");
    expect(report.suggestedActions[0].evidence?.supportingUrls).toEqual(["https://vnexpress.net/fpt-ai"]);
  });
});

