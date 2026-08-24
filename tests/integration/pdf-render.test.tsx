import path from "node:path";
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CompanyOnePager, registerPdfFonts } from "@/app/components/pdf/company-one-pager";
import { mapToPdfPayload } from "@/lib/export-pdf";
import type { CompanyProfile, AnalysisReport } from "@/lib/types";

describe("PDF One-Pager Render Integration Test", () => {
  const fixedDate = new Date("2026-08-24T09:00:00.000Z");

  const sampleProfile: CompanyProfile = {
    id: "fpt-corp",
    version: 1,
    createdAt: fixedDate,
    lastUpdated: fixedDate,
    officialName: "CÔNG TY CỔ PHẦN FPT",
    tradingNames: ["FPT Corporation"],
    input: { name: "FPT Corporation" },
    taxId: "0101248141",
    industry: ["Công nghệ thông tin", "Viễn thông", "Giáo dục"],
    description:
      "Tập đoàn công nghệ hàng đầu Việt Nam cung cấp dịch vụ chuyển đổi số, phần mềm xuất khẩu, điện toán đám mây và viễn thông tại hơn 30 quốc gia.",
    keyPeople: [],
    products: ["FPT Cloud", "FPT.AI"],
    markets: ["Việt Nam", "Toàn cầu"],
    recentActivities: [],
    sources: [
      { source: "website", url: "https://fpt.com.vn", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "registry", url: "https://vietqr.io/business/0101248141", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "news", url: "https://vnexpress.net/kinh-doanh/fpt", accessedAt: fixedDate, fieldsContributed: [] },
    ],
    overallConfidence: 0.95,
  };

  const sampleReport: AnalysisReport = {
    companyId: "fpt-corp",
    generatedAt: fixedDate,
    fitScore: {
      score: 88,
      reasoning: "Doanh nghiệp đáp ứng hoàn hảo tiêu chí quy mô, năng lực công nghệ số và uy tín thương hiệu.",
      criteria: [
        { name: "Industry Alignment", score: 92, weight: 0.25 },
        { name: "Company Size Match", score: 85, weight: 0.2 },
        { name: "Geographic Relevance", score: 90, weight: 0.2 },
        { name: "Digital Maturity", score: 89, weight: 0.2 },
        { name: "Recent Activity", score: 80, weight: 0.15 },
      ],
    },
    executiveSummary:
      "FPT là đối tác chiến lược phù hợp nhất cho các sáng kiến hợp tác công nghệ quy mô lớn và giải pháp B2B.",
    riskFlags: [
      {
        type: "financial",
        description: "Rủi ro biến động tỷ giá ngoại tệ USD/JPY đối với các hợp đồng xuất khẩu phần mềm.",
        severity: "high",
        source: "news",
      },
      {
        type: "reputation",
        description: "Cạnh tranh ngày càng gay gắt từ các doanh nghiệp công nghệ quốc tế trong mảng AI.",
        severity: "medium",
        source: "news",
      },
    ],
    suggestedActions: [
      {
        action: "Tổ chức phiên làm việc kỹ thuật cấp cao với ban lãnh đạo khối công nghệ FPT.",
        priority: "high",
        reasoning: "Xác định nhanh phạm vi",
      },
      {
        action: "Đề xuất chương trình thử nghiệm giải pháp PartnerIQ trong 30 ngày.",
        priority: "medium",
        reasoning: "Tạo bằng chứng giá trị",
      },
    ],
  };

  it("renders Vietnamese one-pager to a valid PDF buffer", async () => {
    registerPdfFonts(path.resolve("public/fonts"));
    const payload = mapToPdfPayload(sampleProfile, sampleReport, fixedDate);

    const buffer = await renderToBuffer(<CompanyOnePager payload={payload} />);

    expect(buffer).toBeDefined();
    // PDF Magic number: %PDF-
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(10_000);
  });
});
