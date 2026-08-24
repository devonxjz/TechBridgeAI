import { describe, it, expect } from "vitest";
import { mapToPdfPayload, buildPdfFilename } from "@/lib/export-pdf";
import type { CompanyProfile, AnalysisReport } from "@/lib/types";

describe("PDF One-Pager Export - Payload Mapper & Filename", () => {
  const fixedDate = new Date("2026-08-24T09:00:00.000Z");

  const longProfile: CompanyProfile = {
    id: "comp-123",
    version: 1,
    createdAt: fixedDate,
    lastUpdated: fixedDate,
    officialName: "CÔNG TY CỔ PHẦN CÔNG NGHỆ VÀ TRUYỀN THÔNG FPT RẤT DÀI VÀ VƯỢT QUÁ CHÍN MƯƠI KÝ TỰ ĐỂ KIỂM TRA ĐỘ DÀI CẮT NGẮN CỦA MAPPER",
    tradingNames: ["FPT Corp", "FPT Software"],
    input: { name: "FPT Corporation" },
    taxId: "0101248141",
    industry: [
      "Information Technology and Cloud Computing",
      "Telecommunications and Network Infrastructure",
      "Digital Transformation and AI Services",
      "Software Outsourcing and Consulting",
      "Education and Training",
    ],
    description:
      "FPT Corporation is the leading technology enterprise in Vietnam with thousands of employees and global presence across Asia, America, and Europe. ".repeat(
        10,
      ),
    keyPeople: [],
    products: ["FPT Cloud", "FPT.AI"],
    markets: ["Vietnam", "Japan", "USA"],
    recentActivities: [],
    sources: [
      { source: "website", url: "https://fpt.com.vn/about", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "registry", url: "https://vietqr.io/lookup", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "news", url: "https://vnexpress.net/fpt-ai", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "website", url: "https://fpt.com.vn/investors", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "news", url: "https://cafef.vn/fpt-growth", accessedAt: fixedDate, fieldsContributed: [] },
    ],
    overallConfidence: 0.95,
  };

  const longReport: AnalysisReport = {
    companyId: "comp-123",
    generatedAt: fixedDate,
    fitScore: {
      score: 110, // will be clamped to 100
      reasoning:
        "Doanh nghiệp rất phù hợp với tiêu chí hợp tác công nghệ cao nhờ năng lực triển khai AI xuất sắc, quy mô nhân sự lớn, độ trưởng thành số dẫn đầu ngành và vị thế thị trường vượt trội.",
      criteria: [
        { name: "Industry Alignment", score: 95, weight: 0.25 },
        { name: "Company Size Match", score: 85, weight: 0.2 },
        { name: "Geographic Relevance", score: 90, weight: 0.2 },
        { name: "Digital Maturity", score: 88, weight: 0.2 },
        { name: "Recent Activity", score: 82, weight: 0.15 },
      ],
    },
    executiveSummary:
      "FPT Corporation là đối tác chiến lược hàng đầu tại Việt Nam với năng lực công nghệ mạnh mẽ và hệ sinh thái số toàn diện. ".repeat(
        5,
      ),
    riskFlags: [
      { type: "operational", description: "Rủi ro thấp về biến động nhân sự cấp cao tại thị trường quốc tế.", severity: "low", source: "news" },
      { type: "reputation", description: "Rủi ro trung bình do cạnh tranh gay gắt từ các tập đoàn công nghệ toàn cầu.", severity: "medium", source: "news" },
      { type: "financial", description: "Rủi ro cao về biến động tỷ giá ngoại tệ USD/JPY ảnh hưởng doanh thu xuất khẩu phần mềm.", severity: "high", source: "news" },
    ],
    suggestedActions: [
      { action: "Thiết lập quan hệ hợp tác thử nghiệm cho giải pháp AI Agentic.", priority: "medium", reasoning: "Tối ưu hóa quy trình" },
      { action: "Tổ chức phiên làm việc kỹ thuật chuyên sâu cấp điều hành.", priority: "high", reasoning: "Xác định lộ trình" },
      { action: "Tham khảo các case study thành công trước đây.", priority: "low", reasoning: "Tăng độ tin cậy" },
    ],
  };

  it("maps only bounded one-pager content", () => {
    const payload = mapToPdfPayload(longProfile, longReport, fixedDate);
    expect(payload.companyName.length).toBeLessThanOrEqual(90);
    expect(payload.industries).toHaveLength(3);
    for (const ind of payload.industries) {
      expect(ind.length).toBeLessThanOrEqual(32);
    }
    expect(payload.criteria).toHaveLength(5);
    expect(payload.risks).toHaveLength(2);
    for (const r of payload.risks) {
      expect(r.length).toBeLessThanOrEqual(120);
    }
    // High severity risk sorted first
    expect(payload.risks[0]).toContain("Rủi ro cao");
    expect(payload.actions).toHaveLength(2);
    for (const a of payload.actions) {
      expect(a.length).toBeLessThanOrEqual(110);
    }
    // High priority action sorted first
    expect(payload.actions[0]).toContain("Tổ chức phiên làm việc");
    expect(payload.sources).toHaveLength(3);
    expect(payload.description.length).toBeLessThanOrEqual(320);
    expect(payload.fitReason.length).toBeLessThanOrEqual(140);
    expect(payload.executiveSummary.length).toBeLessThanOrEqual(260);
    expect(payload.fitScore).toBe(100);
    expect(payload.generatedAt).toBe("24/08/2026");

    // Vietnamese mapped labels for criteria
    expect(payload.criteria[0].name).toBe("Phù hợp ngành");
    expect(payload.criteria[1].name).toBe("Tương thích quy mô");
    expect(payload.criteria[2].name).toBe("Phù hợp địa lý");
    expect(payload.criteria[3].name).toBe("Trưởng thành số");
    expect(payload.criteria[4].name).toBe("Hoạt động gần đây");
  });

  it("rejects reports without exactly five fit criteria", () => {
    const reportWithFourCriteria: AnalysisReport = {
      ...longReport,
      fitScore: {
        score: 80,
        reasoning: "Reason",
        criteria: [
          { name: "Industry Alignment", score: 90, weight: 0.3 },
          { name: "Company Size Match", score: 80, weight: 0.3 },
          { name: "Geographic Relevance", score: 80, weight: 0.2 },
          { name: "Digital Maturity", score: 80, weight: 0.2 },
        ],
      },
    };

    expect(() => mapToPdfPayload(longProfile, reportWithFourCriteria)).toThrow(
      "PDF export requires exactly 5 fit criteria",
    );
  });

  it("rejects reports without fitScore", () => {
    const reportWithoutFitScore: AnalysisReport = {
      ...longReport,
      fitScore: undefined,
    };

    expect(() => mapToPdfPayload(longProfile, reportWithoutFitScore)).toThrow(
      "PDF export requires fitScore in report",
    );
  });

  it("builds a filesystem-safe dated filename", () => {
    expect(buildPdfFilename("FPT Corporation", fixedDate)).toBe(
      "PartnerIQ_FPT-Corporation_2026-08-24.pdf",
    );

    expect(
      buildPdfFilename("TẬP ĐOÀN VINGROUP - CÔNG TY CP", fixedDate),
    ).toBe("PartnerIQ_TAP-DOAN-VINGROUP-CONG-TY-CP_2026-08-24.pdf");
  });
});
