// ═══════════════════════════════════════════════════════
// Mock Scraper Adapter — for testing and development
// ═══════════════════════════════════════════════════════

import type { ScraperAdapter, ScrapedContent } from "./types";

export class MockScraperAdapter implements ScraperAdapter {
  private pages: Map<string, ScrapedContent> = new Map();
  public callLog: string[] = [];

  setPage(url: string, content: ScrapedContent): void {
    this.pages.set(url, content);
  }

  async extract(url: string): Promise<ScrapedContent> {
    this.callLog.push(url);
    const page = this.pages.get(url);
    if (page) return page;

    // Return rich mock content (> 200 chars) for testing & dev
    return {
      url,
      title: `Trang thông tin doanh nghiệp - ${url}`,
      text: `Thông tin giới thiệu chính thức từ trang web ${url}. Doanh nghiệp cung cấp các giải pháp công nghệ, dịch vụ phần mềm, chuyển đổi số và phát triển thị trường với đội ngũ chuyên gia giàu kinh nghiệm. Cơ cấu quản trị minh bạch, định hướng đổi mới sáng tạo và mở rộng hợp tác toàn diện tại Việt Nam và quốc tế.`,
      metadata: {},
    };
  }
}
