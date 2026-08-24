import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CompanyOnePager, registerPdfFonts } from "@/app/components/pdf/company-one-pager";
import { mapToPdfPayload } from "@/lib/export-pdf";
import type { CompanyProfile, AnalysisReport } from "@/lib/types";

describe("PDF One-Pager Render Integration Tests", () => {
  const fixedDate = new Date("2026-08-24T09:00:00.000Z");
  const tmpDir = path.resolve("tmp/pdfs");

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    registerPdfFonts(path.resolve("public/fonts"));
  });

  const fptProfile: CompanyProfile = {
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

  const fptReport: AnalysisReport = {
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

  const vingroupProfile: CompanyProfile = {
    id: "vingroup-corp",
    version: 2,
    createdAt: fixedDate,
    lastUpdated: fixedDate,
    officialName: "TẬP ĐOÀN VINGROUP - CÔNG TY CP",
    tradingNames: ["Vingroup", "VIC"],
    input: { name: "Tập đoàn Vingroup" },
    taxId: "0101245486",
    industry: ["Công nghiệp & Xe điện thông minh", "Bất động sản & Nghỉ dưỡng", "Công nghệ cao & Y tế"],
    description:
      "Tập đoàn kinh tế tư nhân đa ngành hàng đầu Việt Nam, tập trung trọng tâm chiến lược vào mảng công nghiệp xe điện VinFast, phát triển đô thị thông minh và nghiên cứu ứng dụng trí tuệ nhân tạo VinAI.",
    keyPeople: [],
    products: ["VinFast VF 8", "Vinhomes", "VinBigData"],
    markets: ["Việt Nam", "Hoa Kỳ", "Châu Âu"],
    recentActivities: [],
    sources: [
      { source: "website", url: "https://vingroup.net", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "registry", url: "https://vietqr.io/business/0101245486", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "news", url: "https://cafef.vn/vingroup", accessedAt: fixedDate, fieldsContributed: [] },
    ],
    overallConfidence: 0.92,
  };

  const vingroupReport: AnalysisReport = {
    companyId: "vingroup-corp",
    generatedAt: fixedDate,
    fitScore: {
      score: 82,
      reasoning: "Tập đoàn có quy mô vượt trội và hệ sinh thái rộng lớn, tiềm năng triển khai diện rộng cao.",
      criteria: [
        { name: "Industry Alignment", score: 85, weight: 0.25 },
        { name: "Company Size Match", score: 95, weight: 0.2 },
        { name: "Geographic Relevance", score: 85, weight: 0.2 },
        { name: "Digital Maturity", score: 80, weight: 0.2 },
        { name: "Recent Activity", score: 75, weight: 0.15 },
      ],
    },
    executiveSummary:
      "Vingroup sở hữu hệ sinh thái công nghiệp - đô thị - dịch vụ toàn diện, là đối tác mục tiêu có sức ảnh hưởng sâu rộng trong toàn bộ chuỗi giá trị đổi mới sáng tạo.",
    riskFlags: [
      {
        type: "financial",
        description: "Áp lực chi phí vốn đầu tư quy mô lớn cho chiến lược toàn cầu hóa xe điện.",
        severity: "high",
        source: "news",
      },
      {
        type: "operational",
        description: "Độ phức tạp cao trong việc tích hợp hạ tầng công nghệ giữa các công ty thành viên.",
        severity: "medium",
        source: "news",
      },
    ],
    suggestedActions: [
      {
        action: "Tiếp cận thông qua chương trình đổi mới sáng tạo nội bộ của VinBigData.",
        priority: "high",
        reasoning: "Đẩy nhanh chu kỳ đánh giá POC",
      },
    ],
  };

  const misaProfile: CompanyProfile = {
    id: "misa-corp",
    version: 1,
    createdAt: fixedDate,
    lastUpdated: fixedDate,
    officialName: "CÔNG TY CỔ PHẦN MISA",
    tradingNames: ["MISA JSC"],
    input: { name: "Công ty CP MISA" },
    taxId: "0101243150",
    industry: ["Phần mềm kế toán", "Giải pháp SaaS B2B", "Agentic AI Doanh nghiệp"],
    description:
      "Doanh nghiệp công nghệ hàng đầu Việt Nam cung cấp nền tảng quản trị tài chính, kế toán và giải pháp Agentic AI phục vụ hơn 350.000 doanh nghiệp và hàng triệu hộ kinh doanh trên toàn quốc.",
    keyPeople: [],
    products: ["MISA AMIS", "MISA meInvoice", "MISA AVA"],
    markets: ["Việt Nam", "Đông Nam Á"],
    recentActivities: [],
    sources: [
      { source: "website", url: "https://misa.vn", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "registry", url: "https://vietqr.io/business/0101243150", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "news", url: "https://vneconomy.vn/misa", accessedAt: fixedDate, fieldsContributed: [] },
    ],
    overallConfidence: 0.9,
  };

  const misaReport: AnalysisReport = {
    companyId: "misa-corp",
    generatedAt: fixedDate,
    fitScore: {
      score: 91,
      reasoning: "Doanh nghiệp tiên phong trong lĩnh vực Agentic AI và quản trị SaaS với tập khách hàng B2B khổng lồ.",
      criteria: [
        { name: "Industry Alignment", score: 96, weight: 0.25 },
        { name: "Company Size Match", score: 88, weight: 0.2 },
        { name: "Geographic Relevance", score: 92, weight: 0.2 },
        { name: "Digital Maturity", score: 94, weight: 0.2 },
        { name: "Recent Activity", score: 86, weight: 0.15 },
      ],
    },
    executiveSummary:
      "MISA là đối tác chiến lược lý tưởng để tích hợp sâu các tác vụ AI phân tích thông minh vào dòng sản phẩm phần mềm doanh nghiệp sẵn có.",
    riskFlags: [
      {
        type: "reputation",
        description: "Yêu cầu khắt khe về an toàn dữ liệu và bảo mật thông tin tài chính của khách hàng.",
        severity: "medium",
        source: "news",
      },
    ],
    suggestedActions: [
      {
        action: "Đề xuất hội thảo kỹ thuật chuyên đề về tích hợp dữ liệu bảo mật cao.",
        priority: "high",
        reasoning: "Tạo niềm tin về compliance",
      },
      {
        action: "Chuẩn bị tài liệu so sánh năng lực kỹ thuật và benchmark hiệu năng.",
        priority: "medium",
        reasoning: "Hỗ trợ hội đồng thẩm định",
      },
    ],
  };

  const stressProfile: CompanyProfile = {
    id: "stress-corp",
    version: 9,
    createdAt: fixedDate,
    lastUpdated: fixedDate,
    officialName: "CÔNG TY CỔ PHẦN GIẢI PHÁP CÔNG NGHỆ CAO VÀ DỊCH VỤ CHUYỂN ĐỔI SỐ TOÀN DIỆN VIỆT NAM QUỐC TẾ SIÊU DÀI",
    tradingNames: ["Stress Corporation Extreme Testing"],
    input: { name: "Stress Testing Corp" },
    taxId: "0109999999",
    industry: [
      "Information Technology and Cloud Engineering",
      "Enterprise Artificial Intelligence Solutions",
      "Big Data Analytics and Business Intelligence",
      "Industrial Internet of Things Systems",
      "Cybersecurity and Data Governance",
    ],
    description:
      "Doanh nghiệp công nghệ chuyên cung cấp các giải pháp phần mềm cấp doanh nghiệp, hệ thống tính toán phân tán hiệu năng cao, nền tảng phân tích dữ liệu lớn và các giải pháp AI tự động hóa tiên tiến phục vụ các khách hàng thuộc khối tài chính, ngân hàng, viễn thông và sản xuất công nghiệp nặng trên toàn cầu với cam kết chất lượng chuẩn quốc tế.",
    keyPeople: [],
    products: ["Product 1", "Product 2", "Product 3"],
    markets: ["Global Market"],
    recentActivities: [],
    sources: [
      { source: "website", url: "https://stress-example-domain-with-very-long-url.com/solutions/enterprise/ai", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "registry", url: "https://vietqr.io/business/0109999999?query=detailed_info_param", accessedAt: fixedDate, fieldsContributed: [] },
      { source: "news", url: "https://vnexpress.net/kinh-doanh/stress-case-technology-breakthrough-2026", accessedAt: fixedDate, fieldsContributed: [] },
    ],
    overallConfidence: 0.99,
  };

  const stressReport: AnalysisReport = {
    companyId: "stress-corp",
    generatedAt: fixedDate,
    fitScore: {
      score: 95,
      reasoning: "Doanh nghiệp đạt điểm số gần như tuyệt đối ở mọi khía cạnh đánh giá chiến lược, năng lực kỹ thuật vượt bậc và đội ngũ kỹ sư hàng đầu.",
      criteria: [
        { name: "Industry Alignment", score: 98, weight: 0.25 },
        { name: "Company Size Match", score: 92, weight: 0.2 },
        { name: "Geographic Relevance", score: 95, weight: 0.2 },
        { name: "Digital Maturity", score: 97, weight: 0.2 },
        { name: "Recent Activity", score: 90, weight: 0.15 },
      ],
    },
    executiveSummary:
      "Tập đoàn sở hữu nền tảng công nghệ vững chắc, tiềm lực tài chính vượt trội và tầm nhìn dẫn dắt thị trường, là đối tác không thể bỏ qua trong mọi chiến dịch tiếp cận mở rộng hệ sinh thái.",
    riskFlags: [
      { type: "financial", description: "Rủi ro kiểm toán tài chính định kỳ tại các thị trường quốc tế có quy định quản lý ngặt nghèo.", severity: "high", source: "news" },
      { type: "operational", description: "Rủi ro thời gian triển khai có thể kéo dài do quy trình xét duyệt nội bộ nhiều cấp.", severity: "medium", source: "news" },
      { type: "reputation", description: "Rủi ro thấp về biến động truyền thông trong các chiến dịch tiếp thị quy mô lớn.", severity: "low", source: "news" },
    ],
    suggestedActions: [
      { action: "Trình bày báo cáo khả thi trực tiếp với Hội đồng Quản trị và Ban Tổng Giám đốc.", priority: "high", reasoning: "Rút ngắn thời gian ra quyết định" },
      { action: "Ký kết thỏa thuận bảo mật thông tin (NDA) và khởi động quy trình POC kỹ thuật.", priority: "high", reasoning: "Thiết lập khung pháp lý" },
    ],
  };

  it("renders FPT one-pager to a valid PDF buffer and saves fixture", async () => {
    const payload = mapToPdfPayload(fptProfile, fptReport, fixedDate);
    const buffer = await renderToBuffer(<CompanyOnePager payload={payload} />);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(10_000);
    fs.writeFileSync(path.join(tmpDir, "fpt.pdf"), buffer);
  });

  it("renders Vingroup one-pager to a valid PDF buffer and saves fixture", async () => {
    const payload = mapToPdfPayload(vingroupProfile, vingroupReport, fixedDate);
    const buffer = await renderToBuffer(<CompanyOnePager payload={payload} />);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(10_000);
    fs.writeFileSync(path.join(tmpDir, "vingroup.pdf"), buffer);
  });

  it("renders MISA one-pager to a valid PDF buffer and saves fixture", async () => {
    const payload = mapToPdfPayload(misaProfile, misaReport, fixedDate);
    const buffer = await renderToBuffer(<CompanyOnePager payload={payload} />);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(10_000);
    fs.writeFileSync(path.join(tmpDir, "misa.pdf"), buffer);
  });

  it("renders Stress case one-pager to a valid PDF buffer and saves fixture", async () => {
    const payload = mapToPdfPayload(stressProfile, stressReport, fixedDate);
    const buffer = await renderToBuffer(<CompanyOnePager payload={payload} />);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(10_000);
    fs.writeFileSync(path.join(tmpDir, "stress.pdf"), buffer);
  });
});
