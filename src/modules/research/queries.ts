// ═══════════════════════════════════════════════════════
// Research Query Matrix
// Deterministic, bounded queries across standard categories:
// 1. Identity
// 2. Products / Services
// 3. Leadership / Key People
// 4. Recent Activity (News)
// 5. Risk / Legal
// 6. Tax / Registry
// ═══════════════════════════════════════════════════════

import type { CompanyInput } from "@/lib/types";

export interface ResearchQueryPlan {
  web: string[];
  news: string[];
}

export function buildResearchQueries(
  input: CompanyInput,
  maxQueries: number = 6
): ResearchQueryPlan {
  const name = input.name.trim();

  // Core candidate queries in priority order
  const identityQuery = `"${name}"`;
  const leadershipQuery = `"${name}" ban lãnh đạo CEO giám đốc người đại diện`;
  const productsQuery = `"${name}" sản phẩm dịch vụ giải pháp`;
  const taxQuery = input.taxId
    ? `"${name}" "${input.taxId}" mã số thuế`
    : `"${name}" mã số thuế đăng ký kinh doanh`;

  const newsActivityQuery = `"${name}" tin tức hoạt động mới nhất`;
  const newsRiskQuery = `"${name}" vi phạm xử phạt tranh chấp rủi ro`;

  const customQueries = (input.additionalKeywords ?? [])
    .map((kw) => kw.trim())
    .filter(Boolean)
    .map((kw) => `"${name}" ${kw}`);

  // Construct web queries with priority:
  // 1. Identity
  // 2. Tax (especially when taxId is present)
  // 3. Leadership
  // 4. Products / Services or Custom Keywords
  let webCandidates: string[];
  if (input.taxId) {
    webCandidates = [
      identityQuery,
      taxQuery,
      leadershipQuery,
      ...customQueries,
      productsQuery,
    ];
  } else {
    webCandidates = [
      identityQuery,
      leadershipQuery,
      ...customQueries,
      productsQuery,
      taxQuery,
    ];
  }

  const uniqueWeb = Array.from(new Set(webCandidates));
  const newsQueries = [newsActivityQuery, newsRiskQuery];

  // Guarantee at least 1-2 news queries if budget allows
  const maxNews = Math.min(2, Math.max(1, Math.floor(maxQueries / 3)));
  const allocatedNews = newsQueries.slice(0, maxNews);
  const remainingBudgetForWeb = Math.max(0, maxQueries - allocatedNews.length);
  const allocatedWeb = uniqueWeb.slice(0, remainingBudgetForWeb);

  return {
    web: allocatedWeb,
    news: allocatedNews,
  };
}

