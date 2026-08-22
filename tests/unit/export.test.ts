import { describe, it, expect } from "vitest";
import { exportProfileToMarkdown, exportProfileToJSON } from "@/lib/export";
import type { CompanyProfile, AnalysisReport, ProfileDiff } from "@/lib/types";

describe("Export Utility Unit Tests", () => {
  const profile: CompanyProfile = {
    id: "vingroup",
    version: 1,
    createdAt: new Date("2026-01-01"),
    lastUpdated: new Date("2026-01-01"),
    input: { name: "Vingroup" },
    officialName: "Tập đoàn Vingroup",
    tradingNames: ["VIC"],
    taxId: "0101245486",
    industry: ["Bất động sản", "Xe điện"],
    description: "Tập đoàn đa ngành hàng đầu Việt Nam.",
    foundedYear: 1993,
    companySize: "1000+",
    keyPeople: [{ name: "Phạm Nhật Vượng", title: "Chủ tịch HĐQT", source: "website", confidence: 0.95 }],
    products: ["VinFast", "Vinhomes"],
    markets: ["Việt Nam", "Mỹ"],
    recentActivities: [{ title: "Khai trương nhà máy", summary: "Mở rộng sản xuất xe điện", date: new Date("2026-02-01"), url: "", source: "news" }],
    sources: [{ source: "website", url: "https://vingroup.net", accessedAt: new Date("2026-01-01"), fieldsContributed: [] }],
    overallConfidence: 0.9,
  };

  const report: AnalysisReport = {
    companyId: "vingroup",
    generatedAt: new Date("2026-01-01"),
    fitScore: {
      score: 88,
      reasoning: "Tiềm năng hợp tác rất cao.",
      criteria: [
        { name: "Industry Alignment", score: 90, weight: 0.3, reasoning: "Phù hợp" },
      ],
    },
    riskFlags: [{ type: "financial", description: "Vốn đầu tư lớn", severity: "medium", source: "news" }],
    suggestedActions: [{ action: "Liên hệ bộ phận Mua sắm", priority: "high", reasoning: "Cơ hội cung cấp giải pháp" }],
    executiveSummary: "Doanh nghiệp quy mô cực lớn với nhiều cơ hội kết nối.",
  };

  const diff: ProfileDiff = {
    companyId: "vingroup",
    fromVersion: 1,
    toVersion: 2,
    changes: [{ field: "products", oldValue: ["VinFast"], newValue: ["VinFast", "VinAI"], changeType: "modified", significance: "medium" }],
    summary: "Bổ sung sản phẩm VinAI.",
  };

  it("exports formatted markdown with all sections", () => {
    const md = exportProfileToMarkdown(profile, report, diff);
    expect(md).toContain("# Hồ sơ Doanh nghiệp: Tập đoàn Vingroup");
    expect(md).toContain("## 1. Ngành nghề & Tổng quan");
    expect(md).toContain("## 2. Ban lãnh đạo & Nhân sự chủ chốt");
    expect(md).toContain("## 3. Sản phẩm, Dịch vụ & Thị trường");
    expect(md).toContain("## 5. Đánh giá Tiềm năng Hợp tác (PartnerIQ Analyst)");
    expect(md).toContain("Điểm Phù hợp: **88/100**");
    expect(md).toContain("## 6. Lịch sử Thay đổi So với Phiên bản Trước");
    expect(md).toContain("Bổ sung sản phẩm VinAI.");
    expect(md).toContain("## 7. Nguồn Dữ liệu & Tra cứu");
  });

  it("exports valid JSON structure", () => {
    const jsonStr = exportProfileToJSON(profile, report, diff);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.profile.officialName).toBe("Tập đoàn Vingroup");
    expect(parsed.report.fitScore.score).toBe(88);
    expect(parsed.diff.toVersion).toBe(2);
  });
});
