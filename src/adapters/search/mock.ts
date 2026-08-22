// ═══════════════════════════════════════════════════════
// Mock Search Adapter — for development and testing
// Returns realistic simulated search results when running in mock mode
// ═══════════════════════════════════════════════════════

import type { SearchAdapter, SearchOptions, SearchResult } from "./types";

export class MockSearchAdapter implements SearchAdapter {
  private results: Map<string, SearchResult[]> = new Map();
  public callLog: { query: string; options?: SearchOptions }[] = [];

  setResults(querySubstring: string, results: SearchResult[]): void {
    this.results.set(querySubstring, results);
  }

  async search(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    this.callLog.push({ query, options });

    // 1. Check canned results first
    for (const [key, value] of this.results) {
      if (query.toLowerCase().includes(key.toLowerCase())) {
        return value.slice(0, options?.maxResults ?? 10);
      }
    }

    // 2. Generate dynamic realistic search results for development
    const cleanTerm = query.replace(/["+]/g, "").trim();
    const domainSlug = encodeURIComponent(cleanTerm.split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, ""));
    const companyDomain = domainSlug ? `https://${domainSlug}.vn` : "https://company.vn";

    const dynamicResults: SearchResult[] = [
      {
        title: `${cleanTerm} - Trang chủ & Cổng thông tin doanh nghiệp`,
        url: companyDomain,
        snippet: `${cleanTerm} là doanh nghiệp hàng đầu tại Việt Nam hoạt động trong lĩnh vực kinh doanh, công nghệ và dịch vụ. Trụ sở chính tại Hà Nội và TP.HCM với quy mô hàng nghìn nhân sự.`,
      },
      {
        title: `Mã số thuế & Thông tin đăng ký kinh doanh ${cleanTerm}`,
        url: `https://masothue.com/${domainSlug}-thong-tin-doanh-nghiep`,
        snippet: `Thông tin mã số thuế, người đại diện pháp luật, địa chỉ trụ sở và ngành nghề kinh doanh đã đăng ký của ${cleanTerm}. Ngày cấp giấy phép hoạt động và vốn điều lệ.`,
      },
      {
        title: `Tin tức mới nhất về ${cleanTerm} - Báo Đầu tư & CafeF`,
        url: `https://cafef.vn/${domainSlug}-tin-tuc-su-kien.chn`,
        snippet: `Tổng hợp các tin tức kinh doanh, hoạt động đầu tư, báo cáo tài chính và sự kiện mở rộng thị trường mới nhất của ${cleanTerm} trong năm nay.`,
      },
      {
        title: `Sản phẩm và Dịch vụ cốt lõi của ${cleanTerm}`,
        url: `${companyDomain}/products`,
        snippet: `Danh mục các giải pháp, sản phẩm dịch vụ chủ lực do ${cleanTerm} cung cấp trên thị trường Việt Nam và quốc tế.`,
      },
      {
        title: `Ban Giám đốc & Nhân sự chủ chốt ${cleanTerm}`,
        url: `${companyDomain}/about-us`,
        snippet: `Hội đồng quản trị và Ban tổng giám đốc điều hành của ${cleanTerm}. Chiến lược phát triển dài hạn và cơ cấu tổ chức doanh nghiệp.`,
      },
    ];

    return dynamicResults.slice(0, options?.maxResults ?? 5);
  }
}
