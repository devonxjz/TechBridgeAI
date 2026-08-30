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

import type { CompanyInput, SourceDomainPolicy } from "@/lib/types";
import type { SearchResult } from "@/adapters/search/types";

export interface ResearchQueryPlan {
  web: string[];
  news: string[];
}

export function isDomainMatch(url: string, domains: readonly string[]): boolean {
  if (!domains || domains.length === 0) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => {
      const d = domain.trim().toLowerCase();
      return hostname === d || hostname.endsWith(`.${d}`);
    });
  } catch {
    return false;
  }
}

export function applyDomainPolicy(
  results: readonly SearchResult[],
  policy?: SourceDomainPolicy,
  limit: number = 5
): SearchResult[] {
  if (!policy || policy.mode === "broad" || policy.domains.length === 0) {
    return results.slice(0, limit);
  }

  if (policy.mode === "only") {
    return results.filter((r) => isDomainMatch(r.url, policy.domains)).slice(0, limit);
  }

  if (policy.mode === "prefer") {
    const matched: SearchResult[] = [];
    const unmatched: SearchResult[] = [];

    for (const r of results) {
      if (isDomainMatch(r.url, policy.domains)) {
        matched.push(r);
      } else {
        unmatched.push(r);
      }
    }

    return [...matched, ...unmatched].slice(0, limit);
  }

  return results.slice(0, limit);
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

  // If domain policy mode is "only", append site constraints
  let siteClause = "";
  if (input.sourcePolicy?.mode === "only" && input.sourcePolicy.domains.length > 0) {
    const sites = input.sourcePolicy.domains.map((d) => `site:${d}`).join(" OR ");
    siteClause = ` (${sites})`;
  }

  // Guarantee at least 1-2 news queries if budget allows
  const maxNews = Math.min(2, Math.max(1, Math.floor(maxQueries / 3)));
  const allocatedNews = newsQueries.slice(0, maxNews).map((q) => (siteClause ? `${q}${siteClause}` : q));
  const remainingBudgetForWeb = Math.max(0, maxQueries - allocatedNews.length);
  const allocatedWeb = uniqueWeb.slice(0, remainingBudgetForWeb).map((q) => (siteClause ? `${q}${siteClause}` : q));

  return {
    web: allocatedWeb,
    news: allocatedNews,
  };
}


