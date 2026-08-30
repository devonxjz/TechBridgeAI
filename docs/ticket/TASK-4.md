# TASK-4 — Evidence Provenance & In-App Source Preview

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan sprint-by-sprint. Every production change follows RED → GREEN → review → commit.

**Status:** ✅ COMPLETE (All 8 Sprints Implemented, Tested, and Verified)

**Goal:** Thay các link Google suy đoán bằng bằng chứng thật hiển thị ngay trong app, giữ provenance xuyên suốt pipeline và mô tả độ tin cậy bằng tín hiệu kiểm chứng được thay vì nhãn “thật/giả” hoặc phần trăm thiếu căn cứ.

**Architecture:** Giữ nguyên workflow LangGraph, adapter ports, SSE route và JSONB storage. Làm sâu seam `prepareEvidence`: news discovery dùng Serper News, bài báo được trích xuất qua scraper hiện có, metadata/paywall/robots được chuẩn hóa, ProfileModule và AnalystModule chỉ trả citation URL thuộc evidence đầu vào. `CompanyProfile.sources` là nguồn dữ liệu duy nhất cho source preview nên cache hiện tại không cần bảng mới.

**Tech Stack:** Next.js 16.3.2 App Router, React 19.2.8, TypeScript 6.0.2, Zod 4.4.3, LangGraph 1.4.12, Vitest 4.1.11, Serper News, existing `SafeDirect → Jina → TinyFish` scraper, `cheerio@1.2.0`, `robots-parser@3.0.1`, Supabase JSONB.

**Spec:** `docs/research/2026-08-28-news-source-trust.md`

## Global Constraints

- Không hiển thị `True/False`, “báo thật/báo rác”, “đã xác minh” hoặc phần trăm độ tin cậy cho từng bài.
- Tách source signals khỏi claim verification: metadata tốt không chứng minh nội dung đúng.
- Broad search là mặc định; request-level domain policy chỉ có ba mode `broad | prefer | only`. Registry và official website không bị loại bởi policy dành cho search results.
- Không dùng iframe trong P0. Preview là server-extracted plain text; luôn có CTA mở bài gốc.
- Không render raw HTML hoặc dùng `dangerouslySetInnerHTML`.
- Paywall rõ ràng hoặc `isAccessibleForFree=false`: không giữ body; chỉ metadata + search snippet + CTA.
- Tôn trọng `nosnippet`, `max-snippet`, `data-nosnippet` và robots decision như policy input; chúng không được mô tả là giấy phép bản quyền.
- Mặc định chỉ persist metadata, excerpt tối đa 800 ký tự và SHA-256 fingerprint; không persist full HTML/article body.
- Copyright theo khu vực và publisher terms là release requirement; ticket không tự đưa ra kết luận pháp lý.
- Crawl chỉ dùng URL `http/https` đã qua SSRF guard của Task 2; không bypass paywall, CAPTCHA, Cloudflare hoặc anti-bot.
- Rate limit theo exact hostname ở mức process-local; không thêm public-suffix dependency, Redis hoặc queue trong Task 4.
- Không thêm fake-news classifier, domain reputation API trả phí, vector store, C2PA verification hoặc browser automation.
- Giữ `overallConfidence` trong schema để đọc cache cũ, nhưng UI không dùng nó như truth score.
- Mọi URL do LLM trả về phải nằm trong evidence allowlist; URL lạ bị loại trước khi persist.
- Cached snapshot cũ không đạt schema mới phải đi qua cơ chế `cache_invalid → live research` hiện có.
- UI dùng native `<dialog>`; không thêm modal library.
- Mỗi sprint chỉ sửa file được liệt kê và kết thúc bằng targeted tests, full regression phù hợp và một commit Conventional Commits.

---

## Kiến trúc đích

```text
Serper News
    ↓ title/source/date/snippet/url
CrawlPolicy
    ├── robots decision
    ├── per-domain interval
    └── metadata cache
    ↓
TieredScraperAdapter
    ↓ transient HTML + extracted text
Publication normalizer
    ├── canonical / AMP discovery
    ├── publisher / author / published / modified
    ├── paywall + snippet controls
    └── excerpt + fingerprint
    ↓
prepareEvidence
    ├── canonical dedupe
    ├── copy/republication grouping
    └── deterministic SourceCitation[]
    ↓
ProfileModule + AnalystModule
    ├── supporting URLs
    ├── conflicting URLs
    └── server-validated ClaimEvidence
    ↓
SSE + existing JSONB snapshot
    ↓
ProfileCard → native source dialog → original publisher URL
```

## Verification language

| Internal status | Vietnamese UI |
|---|---|
| `primary_source` | Có nguồn sơ cấp |
| `corroborated` | Được nhiều nguồn độc lập hỗ trợ |
| `single_source` | Chỉ có một nguồn |
| `conflicting` | Có nguồn mâu thuẫn |
| `insufficient` | Không đủ dữ kiện |

`independentPublisherCount` không đếm:

- cùng canonical URL;
- cùng publisher domain;
- các bài có cùng content fingerprint;
- mirror/republish đã được gom cùng duplicate cluster.

## Dependency map

```text
Sprint 0
   ↓
Sprint 1
   ↓
Sprint 2
   ↓
Sprint 3
   ↓
Sprint 4
   ↓
Sprint 5
   ↓
Sprint 6
   ↓
Sprint 7
   ↓
Sprint 8
```

## Sprint dependency và ước lượng

| Sprint | Deliverable | Estimate | Depends on |
|---|---|---:|---|
| 0 | Baseline, contracts và runtime schemas | 3 giờ | — |
| 1 | Serper News + article metadata/excerpt/paywall | 5 giờ | Sprint 0 |
| 2 | Robots, per-domain throttle và metadata cache | 4 giờ | Sprint 1 |
| 3 | Evidence normalization và independent-source signals | 4 giờ | Sprint 2 |
| 4 | Claim citations trong ProfileModule | 5 giờ | Sprint 3 |
| 5 | Evidence-aware AnalystModule | 4 giờ | Sprint 4 |
| 6 | SSE, cache compatibility và storage verification | 3 giờ | Sprint 5 |
| 7 | In-app source dialog và loại Google fallbacks | 6 giờ | Sprint 6 |
| 8 | Security, visual, legal và release gate | 4 giờ | Sprint 7 |

**Tổng:** khoảng 38 giờ tập trung, tương đương 5 ngày triển khai và 1 ngày buffer cho publisher/provider smoke tests.

## File map

| File | Action | Responsibility |
|---|---|---|
| `package.json`, `package-lock.json` | Modify | Pin Cheerio và robots parser |
| `src/lib/types.ts` | Modify | Publication, preview, claim evidence, enriched citations và schemas |
| `src/adapters/search/types.ts` | Modify | Search vertical + publisher/date fields |
| `src/adapters/search/serper.ts` | Modify | Chọn `/search` hoặc `/news`, normalize results |
| `src/adapters/scraper/types.ts` | Modify | Transient HTML and publication metadata |
| `src/adapters/scraper/direct.ts` | Modify | Return bounded transient HTML; configurable minimum text length |
| `src/modules/research/publication.ts` | Create | Metadata, canonical, AMP discovery, paywall/snippet policy, excerpt |
| `src/modules/research/crawl-policy.ts` | Create | Robots cache, per-domain interval và policy result |
| `src/modules/research/evidence.ts` | Modify | Citation normalization, fingerprint clusters, claim validation |
| `src/modules/research/sources/news.ts` | Modify | News vertical → crawl policy → scrape → normalize |
| `src/modules/research/sources/web-search.ts` | Modify | Apply request-level domain policy |
| `src/modules/research/queries.ts` | Modify | Build bounded `only` queries and shared domain matching |
| `src/modules/research/index.ts` | Modify | Inject scraper/crawl policy into news runner |
| `src/config/index.ts` | Modify | Compose crawl policy from existing safe direct transport |
| `src/modules/profile/index.ts` | Modify | LLM citation output, URL allowlist, fieldsContributed |
| `src/modules/analyst/index.ts` | Modify | Evidence-backed criteria, risks, actions và summary |
| `src/modules/workflow/index.ts` | Modify | Stream enriched finding preview |
| `src/app/hooks/use-research.ts` | Modify | Preserve finding preview metadata |
| `src/app/api/research/route.ts` | Modify | Preserve rich evidence across live/cache SSE paths |
| `src/app/components/evidence-dialog.tsx` | Create | Native dialog source preview |
| `src/app/components/profile-card.tsx` | Modify | Evidence triggers; remove Google Search/Maps fallbacks |
| `src/app/components/research-progress.tsx` | Modify | Preview cards without Google fallback |
| `src/app/components/research-form.tsx` | Modify | Broad/prefer/only source controls |
| `src/lib/export.ts`, `src/lib/export-pdf.ts` | Modify | Export evidence links without article bodies |
| `src/app/components/pdf/company-one-pager.tsx` | Modify | Evidence links in PDF |
| `src/adapters/storage/memory.ts`, `src/adapters/storage/supabase.ts` | Modify | Verify rich JSON round-trip |
| `tests/unit/publication-metadata.test.ts` | Create | Metadata, paywall, snippet controls, AMP discovery |
| `tests/unit/adapters.test.ts` | Modify | Serper web/news endpoint and result mapping |
| `tests/unit/crawl-policy.test.ts` | Create | Robots, throttle và cache |
| `tests/unit/research-evidence.test.ts` | Modify | Dedup, clusters, claim status |
| `tests/unit/sources.test.ts` | Modify | News vertical, scraper and policy behavior |
| `tests/unit/research-queries.test.ts` | Modify | Domain policy query/filter behavior |
| `tests/integration/profile-module.test.ts` | Modify | Valid/invalid citations and field mapping |
| `tests/unit/analyst.test.ts` | Modify | Evidence validation and unsupported risks |
| `tests/unit/use-research-reducer.test.ts` | Modify | Enriched SSE preview |
| `tests/unit/evidence-dialog.test.tsx` | Create | Safe rendering and transparent states |
| `tests/unit/source-domain-policy.test.ts` | Create | Form parsing and domain normalization |
| `tests/unit/research-cache-route.test.ts` | Modify | Rich citations survive cache hit; old cache refreshes |
| `tests/unit/research-cache.test.ts` | Modify | In-memory snapshot provenance |
| `tests/unit/supabase-storage.test.ts` | Modify | Supabase JSONB provenance |
| `tests/unit/profile-diff.test.ts` | Modify | Evidence-only changes do not create business diffs |
| `tests/unit/export.test.ts`, `tests/unit/export-pdf.test.ts` | Modify | Citation export expectations |
| `tests/integration/pdf-render.test.tsx` | Modify | Rendered PDF evidence links |
| `tests/unit/types-validation.test.ts` | Modify | Runtime schema acceptance/rejection |
| `README.md` | Modify | Source signals, crawl policy and limitations |
| `docs/plan/ARCHITECTURE.md` | Modify | Provenance flow and claim/source separation |
| `docs/plan/DEMO_SCRIPT.md` | Modify | Source dialog demo and failure states |
| `docs/ticket/TASK.md` | Modify | Task 4 sprint summary and status |

---

## Sprint 0 — Baseline, contracts và runtime schemas

**Outcome:** Domain model phân biệt rõ source signals và claim verification; cache/runtime validation có contract mới trước khi provider hoặc UI thay đổi.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/types.ts`
- Modify: `tests/unit/types-validation.test.ts`

**Dependencies:**

```json
{
  "dependencies": {
    "cheerio": "1.2.0",
    "robots-parser": "3.0.1"
  }
}
```

**Interfaces tạo ra:**

```ts
export type VerificationStatus =
  | "primary_source"
  | "corroborated"
  | "single_source"
  | "conflicting"
  | "insufficient";

export type PreviewMode = "short_excerpt" | "metadata_only";
export type RobotsDecision = "allowed" | "disallowed" | "unknown";
export type FetchMethod = "search_snippet" | "server_extract";

export interface PublicationMetadata {
  title?: string;
  publisherName?: string;
  publisherDomain: string;
  authors: string[];
  publishedAt?: string;
  publishedLabel?: string;
  modifiedAt?: string;
  canonicalUrl?: string;
  ampUrl?: string;
}

export interface PreviewPolicy {
  mode: PreviewMode;
  paywallDetected: boolean;
  isAccessibleForFree?: boolean;
  robotsDecision: RobotsDecision;
  maxSnippetLength?: number;
}

export interface SourceSignals {
  primarySource: boolean;
  publisherIdentified: boolean;
  authorIdentified: boolean;
  publicationDateIdentified: boolean;
  duplicateClusterSize: number;
}

export interface ClaimEvidence {
  supportingUrls: string[];
  conflictingUrls: string[];
  independentPublisherCount: number;
  status: VerificationStatus;
}

export interface SourceDomainPolicy {
  mode: "broad" | "prefer" | "only";
  domains: string[];
}

export interface FindingMetadata extends Record<string, unknown> {
  publication?: PublicationMetadata;
  previewPolicy?: PreviewPolicy;
  excerpt?: string;
  contentFingerprint?: string;
  fetchMethod?: FetchMethod;
}

export const PROFILE_FIELDS = [
  "officialName",
  "tradingNames",
  "taxId",
  "industry",
  "description",
  "foundedYear",
  "headquarters",
  "website",
  "keyPeople",
  "products",
  "markets",
  "companySize",
  "revenue",
  "recentActivities",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export interface SourceCitation {
  source: SourceName;
  url: string;
  accessedAt: Date;
  fieldsContributed: ProfileField[];
  publication: PublicationMetadata;
  previewPolicy: PreviewPolicy;
  signals: SourceSignals;
  excerpt?: string;
  contentFingerprint?: string;
  fetchMethod: FetchMethod;
}
```

`CompanyInput` thêm `sourcePolicy?: SourceDomainPolicy`. `CompanyProfile` thêm:

```ts
fieldEvidence?: Partial<Record<ProfileField, ClaimEvidence>>;
```

`FitScore.criteria`, `RiskFlag`, `SuggestedAction` thêm `evidence?: ClaimEvidence`; `AnalysisReport` thêm `executiveSummaryEvidence?: ClaimEvidence`. Các field mới tạm optional ở TypeScript để code đọc legacy objects vẫn compile, nhưng runtime snapshot schema yêu cầu chúng cho dữ liệu persist mới. `RiskFlag.source` được giữ để tương thích export nhưng phải được suy ra từ citation hợp lệ, không hard-code.

**Runtime schemas:**

```ts
export const ProfileFieldSchema = z.enum(PROFILE_FIELDS);
export const VerificationStatusSchema = z.enum([
  "primary_source",
  "corroborated",
  "single_source",
  "conflicting",
  "insufficient",
]);

export const HttpUrlSchema = z.string().url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  },
  { message: "URL must use http or https" },
);

export const ClaimEvidenceSchema = z.object({
  supportingUrls: z.array(HttpUrlSchema),
  conflictingUrls: z.array(HttpUrlSchema),
  independentPublisherCount: z.number().int().min(0),
  status: VerificationStatusSchema,
});
```

`HttpUrlSchema` accepts only `http:` and `https:`; reuse it for citation, canonical, AMP and claim URLs.

- [ ] Install exact dependencies with `npm install --save-exact cheerio@1.2.0 robots-parser@3.0.1`.
- [ ] Add a failing schema test that accepts one rich citation with `metadata_only`, a paywall signal and one field evidence entry.
- [ ] Add a failing schema test that rejects an unknown verification status, a negative independent publisher count and non-HTTP evidence URL.
- [ ] Run:

```bash
npm test -- tests/unit/types-validation.test.ts
```

- [ ] Expected RED: new types/schemas and `fieldEvidence` do not exist.
- [ ] Add interfaces and Zod schemas exactly as declared above.
- [ ] Use `z.partialRecord(ProfileFieldSchema, ClaimEvidenceSchema)`; do not require every profile field to have evidence.
- [ ] Add `SourceDomainPolicySchema`: normalize lowercase hostnames, reject protocols/paths/credentials, dedupe, cap at 20 domains and require at least one domain for `prefer` or `only`.
- [ ] Keep `overallConfidence` and `lowConfidence` readable for backward compatibility.
- [ ] Run targeted test; expected GREEN.
- [ ] Run `npm run typecheck`; expected GREEN because legacy in-memory evidence fields remain optional at the TypeScript surface.
- [ ] Keep new TypeScript evidence fields optional for legacy in-memory objects; do not add Zod defaults that make an old cached snapshot appear provenance-complete.
- [ ] Run targeted test and typecheck; expected GREEN.
- [ ] Commit:

```bash
git add package.json package-lock.json src/lib/types.ts tests/unit/types-validation.test.ts
git commit -m "feat(evidence): define provenance contracts"
```

**Acceptance:**

- Source signals and claim verification are separate types.
- Missing optional publication metadata is valid and produces transparent UI states later.
- Invalid URLs/statuses cannot enter a cached snapshot.
- No UI label is derived from `RawFinding.confidence`.
- Domain policy cannot smuggle a URL path, credential or more than 20 hostnames into search queries.

---

## Sprint 1 — Serper News, article metadata, excerpt và paywall

**Outcome:** News source uses the provider's news vertical and produces structured search metadata; publication extraction/normalization is implemented and tested but is not wired to live article fetch until Sprint 2 applies robots policy.

**Files:**

- Modify: `src/adapters/search/types.ts`
- Modify: `src/adapters/search/serper.ts`
- Modify: `src/adapters/scraper/types.ts`
- Modify: `src/adapters/scraper/direct.ts`
- Create: `src/modules/research/publication.ts`
- Modify: `src/modules/research/sources/news.ts`
- Modify: `src/modules/research/sources/web-search.ts`
- Modify: `src/modules/research/queries.ts`
- Create: `tests/unit/publication-metadata.test.ts`
- Modify: `tests/unit/sources.test.ts`
- Modify: `tests/unit/research-queries.test.ts`
- Modify: `tests/unit/adapters.test.ts`

**Search contract:**

```ts
export interface SearchOptions {
  maxResults?: number;
  language?: string;
  region?: string;
  vertical?: "web" | "news";
  signal?: AbortSignal;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publisherName?: string;
  publishedLabel?: string;
}
```

**Serper mapping:**

```ts
const isNews = options?.vertical === "news";
const endpoint = isNews
  ? "https://google.serper.dev/news"
  : "https://google.serper.dev/search";

const items = isNews ? data.news ?? [] : data.organic ?? [];
```

**Domain policy rules:**

- `broad`: existing queries/results unchanged.
- `prefer`: request 10 candidates, stable-sort exact/subdomain matches first, then keep the normal five-result cap.
- `only`: append a parenthesized `site:domain-a OR site:domain-b` clause and also discard returned URLs outside the normalized allowlist.
- Apply to `news` and `web_search` only. Registry and official company website runners remain available.

**Publication interface:**

```ts
export interface NormalizedPublication {
  publication: PublicationMetadata;
  previewPolicy: PreviewPolicy;
  excerpt?: string;
  contentFingerprint?: string;
  fetchMethod: FetchMethod;
}

export function normalizePublication(
  result: SearchResult,
  scraped: ScrapedContent | null,
  robotsDecision: RobotsDecision,
): NormalizedPublication;
```

**Normalization rules:**

- Canonical URL: valid `link[rel=canonical]` on the same public HTTP(S) target; otherwise final scraped URL; otherwise search URL.
- AMP URL: discover `link[rel=amphtml]` and store only; Sprint 1 does not fetch it.
- Publisher: JSON-LD `publisher.name` → OpenGraph site name → Serper publisher → URL hostname.
- Authors: JSON-LD `author` → `meta[name=author]`; empty array if absent.
- Published/modified: accept only valid ISO/date values from JSON-LD or article meta tags; keep Serper relative date in `publishedLabel`, not `publishedAt`.
- Paywall: only explicit `isAccessibleForFree=false` or structured paywall markup sets `paywallDetected=true`.
- `nosnippet` or explicit paywall forces `metadata_only`.
- `max-snippet:N` caps excerpt to `min(N, 800)`; negative/zero forces `metadata_only`.
- Remove `script`, `style`, `noscript` and `[data-nosnippet]` before extracting `article`, then `main`, then scraped plain text.
- Excerpt is plain text only, collapsed whitespace, maximum 800 Unicode code points.
- Fingerprint is lowercase/collapsed excerpt hashed with SHA-256; no raw full body is returned.

- [ ] Extend adapter tests: `vertical: "news"` must call Serper `/news` and map `source`/ `date`; web search must remain on `/search`.
- [ ] Add publication tests for JSON-LD author/publisher/dates, OpenGraph fallback, canonical resolution and AMP discovery.
- [ ] Add tests for malformed JSON-LD: normalization must continue with meta/search fallbacks.
- [ ] Add tests for `nosnippet`, `max-snippet:120`, `data-nosnippet`, explicit paywall and `isAccessibleForFree=true`.
- [ ] Add a test proving paywall output contains no extracted body phrase but retains title, publisher, snippet and original URL.
- [ ] Add news source tests:
  - search called with `vertical: "news"`;
  - result produces `search_snippet` with publisher/date metadata;
  - company-owned domain is still excluded;
  - five results remain bounded by the existing query budget.
- [ ] Add query/source tests for all three domain modes, including subdomain matching, provider result outside an `only` allowlist and stable order under `prefer`.
- [ ] Run:

```bash
npm test -- tests/unit/adapters.test.ts tests/unit/publication-metadata.test.ts tests/unit/research-queries.test.ts tests/unit/sources.test.ts
```

- [ ] Expected RED: news vertical and publication normalizer are absent.
- [ ] Modify `SafeDirectScraperAdapter` to return bounded `html: fullHtml` transiently and add `minTextLength` to `DirectScraperLimits`, defaulting to 50.
- [ ] Implement `normalizePublication` with Cheerio; never pass HTML beyond this function.
- [ ] Keep the live `searchNews(input, searchAdapter, customQueries)` signature in Sprint 1 and normalize results with `scraped=null`, `robotsDecision="unknown"`.
- [ ] Apply the same normalized result filter/order helper to `searchWeb`; do not duplicate hostname matching logic.
- [ ] Run targeted tests; expected GREEN.
- [ ] Run scraper security and transport regressions because `direct.ts` changed:

```bash
npm test -- tests/unit/scraper-security.test.ts tests/integration/scraper-transport.test.ts
```

- [ ] Commit:

```bash
git add src/adapters/search src/adapters/scraper/types.ts src/adapters/scraper/direct.ts src/modules/research/publication.ts src/modules/research/queries.ts src/modules/research/sources/news.ts src/modules/research/sources/web-search.ts tests/unit/adapters.test.ts tests/unit/publication-metadata.test.ts tests/unit/research-queries.test.ts tests/unit/sources.test.ts
git commit -m "feat(news): extract publication metadata"
```

**Acceptance:**

- News discovery no longer uses organic search.
- Search results carry honest publisher/date/snippet metadata without claiming that article body was read.
- Publication normalizer tests prove explicit paywall/nosnippet discards extracted body before live wiring.
- AMP is recorded as a possible later fallback, not fetched.

---

## Sprint 2 — Robots policy, per-domain throttle và metadata cache

**Outcome:** Article extraction is polite by default: robots decision is recorded, unknown/disallowed targets fall back to metadata, and requests to one hostname are spaced without adding distributed infrastructure.

**Files:**

- Create: `src/modules/research/crawl-policy.ts`
- Modify: `src/adapters/scraper/types.ts`
- Modify: `src/adapters/scraper/direct.ts`
- Modify: `src/modules/research/sources/news.ts`
- Modify: `src/config/index.ts`
- Modify: `src/modules/research/index.ts`
- Modify: `.env.example`
- Create: `tests/unit/crawl-policy.test.ts`
- Modify: `tests/unit/sources.test.ts`

**Interface tạo ra:**

```ts
export interface CrawlDecision {
  robotsDecision: RobotsDecision;
  shouldExtract: boolean;
}

export type RobotsLoadResult =
  | { status: "found"; body: string }
  | { status: "missing" }
  | { status: "unavailable" };

export interface CrawlPolicy {
  beforeFetch(url: string, signal?: AbortSignal): Promise<CrawlDecision>;
}

export interface CrawlPolicyOptions {
  userAgent: string;
  minDomainIntervalMs: number;
  robotsCacheTtlMs: number;
  now?: () => number;
}

export function createCrawlPolicy(
  loadRobots: (
    robotsUrl: string,
    signal?: AbortSignal,
  ) => Promise<RobotsLoadResult>,
  options: CrawlPolicyOptions,
): CrawlPolicy;
```

**Production defaults:**

```dotenv
CRAWL_USER_AGENT=PartnerIQBot
CRAWL_MIN_DOMAIN_INTERVAL_MS=1000
ROBOTS_CACHE_TTL_MS=86400000
ROBOTS_FAIL_MODE=metadata_only
NEWS_ARTICLE_EXTRACTION_ENABLED=true
```

**Policy rules:**

- `robots.txt` is loaded through a dedicated `SafeDirectScraperAdapter` configured with 3-second timeout, 128 KiB maximum response and `minTextLength=0`.
- `ScrapeError` gains optional `statusCode`; direct transport sets it for non-2xx responses so the robots loader distinguishes 404 from 5xx without parsing error messages.
- Robots 2xx is parsed with `robots-parser@3.0.1`.
- Empty/404 robots content means `allowed`.
- Timeout, DNS error, malformed response or 5xx means `unknown`; `shouldExtract=false`.
- Explicit disallow means `disallowed`; `shouldExtract=false`.
- Allowed means wait until the hostname's next process-local slot, then `shouldExtract=true`.
- Abort during throttle wait rejects immediately and clears the timer/listener.
- Robots text is cached by `protocol//host:port` for 24 hours; article content is not cached here.

- [ ] Write a failing test for allowed/disallowed paths with user agent `PartnerIQBot`.
- [ ] Write a failing test for missing robots → allowed and fetch failure → unknown/metadata-only.
- [ ] Write a fake-clock test: two URLs on one domain are at least 1,000 ms apart; two different domains do not block each other.
- [ ] Write a test proving aborted wait rejects and leaves no pending timer.
- [ ] Write a cache test: two URLs on one origin load robots once before TTL and twice after TTL.
- [ ] Write news source tests proving disallowed/unknown skips scraper but preserves search metadata/snippet.
- [ ] Write news source tests proving allowed + scraper success produces `server_extract`, while allowed + scraper failure preserves `search_snippet`.
- [ ] Run:

```bash
npm test -- tests/unit/crawl-policy.test.ts tests/unit/sources.test.ts
```

- [ ] Expected RED: crawl policy is absent.
- [ ] Implement `createCrawlPolicy` with two Maps only: robots cache and next allowed time. Do not create a queue framework.
- [ ] Compose the dedicated robots loader in `src/config/index.ts`; reuse the SSRF-safe direct transport.
- [ ] Inject `CrawlPolicy` through `ResearchDeps`; mocks use an explicit allow-all adapter.
- [ ] Change the live signature to `searchNews(input, searchAdapter, scraperAdapter, crawlPolicy, customQueries)` and update `createResearchSourceRunners` only after crawl checks exist.
- [ ] Apply `beforeFetch` only to article body extraction. Serper discovery remains available when body extraction is disallowed.
- [ ] When `NEWS_ARTICLE_EXTRACTION_ENABLED=false`, skip crawl policy/scraper entirely and return normalized search metadata with `search_snippet`.
- [ ] Run targeted tests; expected GREEN.
- [ ] Run `npm run typecheck` and existing budget/workflow tests.
- [ ] Commit:

```bash
git add src/adapters/scraper/types.ts src/adapters/scraper/direct.ts src/modules/research/crawl-policy.ts src/modules/research/sources/news.ts src/modules/research/index.ts src/config/index.ts .env.example tests/unit/crawl-policy.test.ts tests/unit/sources.test.ts
git commit -m "feat(crawl): respect publisher fetch policy"
```

**Acceptance:**

- Unknown robots state never silently becomes permission to extract article body.
- Per-domain throttling is bounded, abortable and process-local as documented.
- Search metadata remains visible when crawling is not permitted.

---

## Sprint 3 — Evidence normalization và independent-source signals

**Outcome:** `prepareEvidence` tạo rich citations theo thứ tự xác định, gom bài copy và cung cấp một hàm duy nhất để validate claim citations.

**Files:**

- Modify: `src/modules/research/evidence.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/modules/workflow/index.ts`
- Modify: `tests/unit/research-evidence.test.ts`

**Interfaces tạo ra:**

```ts
export interface ClaimEvidenceInput {
  supportingUrls: readonly string[];
  conflictingUrls?: readonly string[];
}

export function buildClaimEvidence(
  input: ClaimEvidenceInput,
  citations: readonly SourceCitation[],
): ClaimEvidence;

export function toSourceCitations(
  findings: readonly RawFinding[],
  companyWebsite?: string,
): SourceCitation[];
```

**Deterministic rules:**

1. Canonicalize HTTP(S), strip fragment and reject invalid URL.
2. Dedupe canonical URL, keeping the richer extracted finding; tie-break by existing source order.
3. Build exact-copy clusters by `contentFingerprint`.
4. A source is primary only for:
   - registry record;
   - official website finding whose hostname matches `CompanyInput.website`.
5. Validate supporting/conflicting URLs against canonical citation URLs.
6. A URL cannot appear in both sets; conflict wins and removes it from supporting.
7. Collapse identical fingerprint clusters, then count unique publisher domains.
8. Status priority: `conflicting → primary_source → corroborated → single_source → insufficient`.

**Core status implementation:**

```ts
function resolveVerificationStatus(
  hasConflict: boolean,
  hasPrimarySource: boolean,
  independentPublisherCount: number,
  supportingCount: number,
): VerificationStatus {
  if (hasConflict) return "conflicting";
  if (hasPrimarySource) return "primary_source";
  if (independentPublisherCount >= 2) return "corroborated";
  if (supportingCount > 0) return "single_source";
  return "insufficient";
}
```

- [ ] Extend evidence fixtures with two publishers carrying the same fingerprint, two genuinely distinct publishers, one registry citation and one unknown URL.
- [ ] Write a failing test proving copied content on three domains counts as one independent source.
- [ ] Write a failing test proving two distinct publisher domains with different fingerprints produce `corroborated`.
- [ ] Write a failing test proving a registry citation produces `primary_source` even when it is the only citation.
- [ ] Write a failing test proving a URL not in the allowlist is discarded.
- [ ] Write a failing test proving a conflicting URL produces `conflicting` and is removed from supporting URLs.
- [ ] Write a deterministic-order test with reversed workflow completion order.
- [ ] Run:

```bash
npm test -- tests/unit/research-evidence.test.ts
```

- [ ] Expected RED: rich citations and claim builder do not exist.
- [ ] Implement helpers inside existing `evidence.ts`; do not create a second evidence module.
- [ ] Change `prepareEvidence(results, input)` so website ownership can be determined without global config.
- [ ] Populate `duplicateClusterSize` after grouping; do not treat cluster size as corroboration.
- [ ] Preserve `RawFinding.confidence` only for internal dedupe tie-breaking.
- [ ] Run targeted tests; expected GREEN.
- [ ] Run workflow integration tests because the `prepareEvidence` interface changed.
- [ ] Commit:

```bash
git add src/modules/research/evidence.ts src/lib/types.ts src/modules/workflow/index.ts tests/unit/research-evidence.test.ts
git commit -m "feat(evidence): validate claim provenance"
```

**Acceptance:**

- Unknown LLM URLs cannot survive validation.
- Republished copies do not inflate independent-source count.
- Source role and claim status remain separate.

---

## Sprint 4 — Claim citations trong ProfileModule

**Outcome:** Mỗi profile field có supporting/conflicting evidence; recent activities giữ URL bài thật; `fieldsContributed` không còn rỗng.

**Files:**

- Modify: `src/modules/profile/index.ts`
- Modify: `src/lib/types.ts`
- Modify: `tests/integration/profile-module.test.ts`
- Modify: `tests/unit/profile-diff.test.ts`

**LLM output contract:**

```ts
const LLMFieldEvidenceSchema = z.object({
  field: ProfileFieldSchema,
  supportingUrls: z.array(z.string()),
  conflictingUrls: z.array(z.string()).default([]),
});

const LLMActivitySchema = z.object({
  title: z.string(),
  summary: z.string(),
  date: z.string().default(""),
  supportingUrls: z.array(z.string()).default([]),
  conflictingUrls: z.array(z.string()).default([]),
});
```

`LLMProfileSchema` thêm `fieldEvidence: z.array(LLMFieldEvidenceSchema).default([])` và dùng `LLMActivitySchema` cho recent activities.

**Prompt evidence catalog:**

```text
<UNTRUSTED_SOURCE_DATA
  source="news"
  url="https://publisher.example/article"
  publisher="Publisher Example"
  published_at="2026-08-20"
>
Article excerpt
</UNTRUSTED_SOURCE_DATA>
```

Prompt rule phải nói rõ:

- chỉ trả URL xuất hiện nguyên văn trong evidence catalog;
- không có bằng chứng thì để mảng rỗng;
- URL hỗ trợ và URL mâu thuẫn không được trùng;
- không suy đoán URL tìm kiếm.

**Mapping rules:**

- Convert each LLM field item through `buildClaimEvidence`.
- Merge duplicate entries for one field before validation.
- Invert `fieldEvidence` into `SourceCitation.fieldsContributed`.
- For each recent activity, select the first validated supporting citation URL as `Activity.url`; without URL, keep activity but mark field status `insufficient`.
- Derive `Person.source` from the first validated `keyPeople` citation; fallback to `web_search` only for legacy type compatibility.
- Keep numeric `Person.confidence` and profile `overallConfidence` internal; do not expose them as factual certainty in UI.

- [ ] Update the mock LLM profile fixture to return citations for name, tax ID, products, key people and one activity.
- [ ] Write a failing test proving valid evidence URLs populate `profile.fieldEvidence`.
- [ ] Write a failing test proving invented `https://unknown.example/` is dropped and status becomes `insufficient`.
- [ ] Write a failing test proving `SourceCitation.fieldsContributed` is the exact inverse mapping.
- [ ] Write a failing test proving `recentActivities[0].url` equals the validated news URL instead of an empty string.
- [ ] Write a conflict test where registry and web evidence disagree on tax ID; status must be `conflicting`.
- [ ] Update diff test: evidence-only changes do not create a business field diff; an activity value change still does.
- [ ] Run:

```bash
npm test -- tests/integration/profile-module.test.ts tests/unit/profile-diff.test.ts
```

- [ ] Expected RED: LLM schema and profile mapping ignore citation data.
- [ ] Add evidence catalog attributes to `buildProfilePrompt`; continue to cap each excerpt at 4,000 characters.
- [ ] Implement one private mapper from LLM evidence array to `fieldEvidence`; do not scatter URL validation across field assignments.
- [ ] Build `profile.sources` from `toSourceCitations(findings, input.website)`.
- [ ] Compute `fieldsContributed` from the validated field map after profile fields are assembled.
- [ ] Run targeted tests; expected GREEN.
- [ ] Run `npm run typecheck`.
- [ ] Commit:

```bash
git add src/modules/profile/index.ts src/lib/types.ts tests/integration/profile-module.test.ts tests/unit/profile-diff.test.ts
git commit -m "feat(profile): attach claim citations"
```

**Acceptance:**

- Every clickable profile field can resolve to one or more persisted citations.
- Activity URL is no longer fabricated or empty when supporting evidence exists.
- LLM cannot create a link that was not in the research evidence.

---

## Sprint 5 — Evidence-aware AnalystModule

**Outcome:** Fit criteria, risk flags, suggested actions and executive summary cite persisted evidence; unsupported risk flags are removed rather than linked to Google.

**Files:**

- Modify: `src/modules/analyst/index.ts`
- Modify: `src/lib/types.ts`
- Modify: `tests/unit/analyst.test.ts`
- Modify: `src/lib/export.ts`
- Modify: `src/lib/export-pdf.ts`
- Modify: `src/app/components/pdf/company-one-pager.tsx`
- Modify: `tests/unit/export.test.ts`
- Modify: `tests/unit/export-pdf.test.ts`
- Modify: `tests/integration/pdf-render.test.tsx`

**LLM evidence contract:**

```ts
const LLMEvidenceRefsSchema = z.object({
  supportingUrls: z.array(z.string()).default([]),
  conflictingUrls: z.array(z.string()).default([]),
});

const LLMAnalysisSchema = z.object({
  executiveSummary: z.string(),
  executiveSummaryEvidence: LLMEvidenceRefsSchema,
  criteria: z.array(
    z.object({
      name: z.string(),
      score: z.number().min(0).max(100),
      reasoning: z.string(),
      evidence: LLMEvidenceRefsSchema,
    }),
  ),
  riskFlags: z.array(
    z.object({
      type: z.enum(["legal", "financial", "reputation", "operational"]),
      description: z.string(),
      severity: z.enum(["high", "medium", "low"]),
      evidence: LLMEvidenceRefsSchema,
    }),
  ).default([]),
  suggestedActions: z.array(
    z.object({
      action: z.string(),
      priority: z.enum(["high", "medium", "low"]),
      reasoning: z.string(),
      evidence: LLMEvidenceRefsSchema,
    }),
  ).default([]),
});
```

**Validation rules:**

- Analyst prompt receives profile values plus the persisted citation catalog, not raw full pages.
- Every evidence ref passes through `buildClaimEvidence`.
- Risk with zero validated supporting URLs is dropped.
- Risk `source` equals the source type of its first validated citation.
- Criteria/action without evidence remain visible with `insufficient`; UI must not make them clickable.
- Executive summary has one top-level `ClaimEvidence`.
- Fit score computation is unchanged; provenance must not silently alter business weights.

- [ ] Update fake LLM output with evidence for all criteria, one supported risk, one unsupported risk and one action.
- [ ] Write a failing test proving the supported risk survives and derives its source from the cited URL.
- [ ] Write a failing test proving unsupported/invented risk citation is dropped.
- [ ] Write a failing test proving criteria and action with no citation get `insufficient`.
- [ ] Write a failing test proving executive summary citations are validated.
- [ ] Write a regression test proving five criteria weights and final score are unchanged.
- [ ] Update Markdown/JSON/PDF export expectations to include source URLs for risks and actions without rendering raw excerpts.
- [ ] Run:

```bash
npm test -- tests/unit/analyst.test.ts tests/unit/export.test.ts tests/unit/export-pdf.test.ts tests/integration/pdf-render.test.tsx
```

- [ ] Expected RED: analyst output has no evidence contract and hard-codes `source: "news"`.
- [ ] Add a compact citation catalog to `buildAnalysisPrompt`: URL, source, publisher, date and excerpt capped at 500 characters.
- [ ] Map all LLM evidence through the shared builder from `evidence.ts`.
- [ ] Remove the hard-coded risk source assignment.
- [ ] Preserve export layout; add links/labels only where evidence exists.
- [ ] Run targeted tests; expected GREEN.
- [ ] Commit:

```bash
git add src/modules/analyst/index.ts src/lib/types.ts src/lib/export.ts src/lib/export-pdf.ts src/app/components/pdf/company-one-pager.tsx tests/unit/analyst.test.ts tests/unit/export.test.ts tests/unit/export-pdf.test.ts tests/integration/pdf-render.test.tsx
git commit -m "feat(analysis): cite supporting evidence"
```

**Acceptance:**

- No displayed risk exists without a validated source URL.
- Analyst citations are drawn only from `profile.sources`.
- Fit score behavior remains backward compatible.

---

## Sprint 6 — SSE, cache compatibility và storage verification

**Outcome:** Enriched evidence reaches live UI and survives Supabase/in-memory cache without a SQL migration; legacy snapshots fail transparently into the existing refresh path.

**Files:**

- Modify: `src/lib/types.ts`
- Modify: `src/modules/workflow/index.ts`
- Modify: `src/app/hooks/use-research.ts`
- Modify: `src/app/api/research/route.ts`
- Modify: `src/adapters/storage/memory.ts`
- Modify: `src/adapters/storage/supabase.ts`
- Modify: `tests/unit/use-research-reducer.test.ts`
- Modify: `tests/unit/research-cache-route.test.ts`
- Modify: `tests/unit/supabase-storage.test.ts`
- Modify: `tests/unit/research-cache.test.ts`

**Finding preview contract:**

```ts
export interface FindingPreview {
  source: SourceName;
  url: string;
  title?: string;
  publisherName?: string;
  publishedAt?: string;
  publishedLabel?: string;
  excerpt: string;
  previewMode: PreviewMode;
  metadataMissing: Array<"publisher" | "author" | "published_at">;
}
```

`StreamEvent` changes `research:finding` to:

```ts
{
  event: "research:finding";
  data: { finding: FindingPreview };
}
```

**Persistence decision:**

- Rich citations remain inside `CompanyProfile.sources`.
- Claim evidence remains inside profile/report JSON.
- Existing `company_profiles.data` and `analysis_report` JSONB columns already store both.
- No new Supabase table, column, RPC parameter or migration is added.
- Full HTML and full article body are never passed to storage adapters.

- [ ] Write a reducer test proving one `FindingPreview` is appended without dropping publisher/date/policy.
- [ ] Write a workflow test proving transient HTML is absent from every emitted SSE event.
- [ ] Write an in-memory cache round-trip test for rich source citations and claim evidence.
- [ ] Write a Supabase adapter round-trip test proving RPC payload contains rich JSON but no `html` or body fixture phrase beyond the excerpt.
- [ ] Write a route cache-hit test proving profile/report citations are emitted unchanged.
- [ ] Write a legacy snapshot test lacking required provenance fields; expected behavior is the existing `cache_invalid` notice followed by live research, not a false “verified” state.
- [ ] Run:

```bash
npm test -- tests/unit/use-research-reducer.test.ts tests/unit/research-cache-route.test.ts tests/unit/research-cache.test.ts tests/unit/supabase-storage.test.ts
```

- [ ] Expected RED: stream/reducer/cache fixtures still use summary-only findings.
- [ ] Add a pure `toFindingPreview` mapper near the workflow event dispatch; cap excerpt at 800 characters again at the outbound boundary.
- [ ] Update reducer state to `findings: FindingPreview[]`.
- [ ] Keep route cache-hit flow unchanged: `profile:ready` and `analysis:ready` already contain persisted citations.
- [ ] Confirm Supabase RPC signatures are untouched.
- [ ] Run targeted tests; expected GREEN.
- [ ] Run `npm run typecheck`.
- [ ] Commit:

```bash
git add src/lib/types.ts src/modules/workflow/index.ts src/app/hooks/use-research.ts src/app/api/research/route.ts src/adapters/storage/memory.ts src/adapters/storage/supabase.ts tests/unit/use-research-reducer.test.ts tests/unit/research-cache-route.test.ts tests/unit/research-cache.test.ts tests/unit/supabase-storage.test.ts
git commit -m "feat(stream): preserve evidence previews"
```

**Acceptance:**

- Live and cached profiles expose the same citation model.
- Database schema remains unchanged.
- No raw article HTML crosses SSE or storage boundaries.

---

## Sprint 7 — In-app source dialog và loại Google fallbacks

**Outcome:** Clicking a claim opens evidence inside PartnerIQ; generic Google Search/Maps fallbacks disappear; missing evidence is explicit and non-clickable.

**Files:**

- Create: `src/app/components/evidence-dialog.tsx`
- Modify: `src/app/components/profile-card.tsx`
- Modify: `src/app/components/research-progress.tsx`
- Modify: `src/app/components/research-form.tsx`
- Create: `tests/unit/evidence-dialog.test.tsx`
- Create: `tests/unit/source-domain-policy.test.ts`
- Modify: `tests/unit/use-research-reducer.test.ts`

**Component interface:**

```tsx
interface EvidenceDialogProps {
  open: boolean;
  title: string;
  claimEvidence?: ClaimEvidence;
  citations: SourceCitation[];
  onClose: () => void;
}

export function EvidenceDialog(props: EvidenceDialogProps): React.ReactElement;
```

**Interaction rules:**

- Use native `HTMLDialogElement.showModal()` and `close()`.
- `onClose` handles native close/Cancel; Escape works without custom keyboard framework.
- Dialog has `aria-labelledby`, visible close button and focusable original-source links.
- React renders excerpt as text children; no HTML injection path exists.
- Each citation shows title, publisher/domain, author, publication/modified date, original URL, preview policy and source signals.
- `metadata_only` shows metadata plus “Không hiển thị nội dung do paywall hoặc chính sách publisher”.
- Missing fields show “Metadata không đầy đủ”, “Không xác định được tác giả” or “Không lấy được ngày xuất bản”.
- Claim header uses the Vietnamese status map from this ticket and displays independent publisher count.
- Original link uses `target="_blank"`, `rel="noopener noreferrer"` and `referrerPolicy="no-referrer"`.

**Profile click mapping:**

- Description → `fieldEvidence.description`.
- Founded year → `fieldEvidence.foundedYear`.
- Company size → `fieldEvidence.companySize`.
- Headquarters → `fieldEvidence.headquarters`.
- Key person row → `fieldEvidence.keyPeople`.
- Product chip → `fieldEvidence.products`.
- Market chip → `fieldEvidence.markets`.
- Activity row → its URL plus `fieldEvidence.recentActivities`.
- Fit criterion/risk/action/summary → their own `ClaimEvidence`.
- Website remains a direct official URL.
- Tax ID opens registry evidence; remove `masothue.com/Search` fallback.
- Address no longer opens Google Maps search.
- No evidence → render normal card with “Chưa có nguồn trực tiếp”; do not create a search URL.
- Advanced research form exposes `Tìm rộng | Ưu tiên domain | Chỉ các domain` plus one comma/newline-separated domain input. Submit normalized values through `CompanyInput.sourcePolicy`.

**Test fixture:**

```tsx
const citation: SourceCitation = {
  source: "news",
  url: "https://publisher.example/article",
  accessedAt: new Date("2026-08-28T00:00:00.000Z"),
  fieldsContributed: ["recentActivities"],
  publication: {
    title: "Company announces expansion",
    publisherName: "Publisher Example",
    publisherDomain: "publisher.example",
    authors: ["Reporter A"],
    publishedAt: "2026-08-27T08:00:00.000Z",
  },
  previewPolicy: {
    mode: "short_excerpt",
    paywallDetected: false,
    robotsDecision: "allowed",
  },
  signals: {
    primarySource: false,
    publisherIdentified: true,
    authorIdentified: true,
    publicationDateIdentified: true,
    duplicateClusterSize: 1,
  },
  excerpt: "<img src=x onerror=alert(1)> expansion details",
  fetchMethod: "server_extract",
};
```

- [ ] Write server-render tests for complete metadata, missing author/date, metadata-only paywall and claim status language.
- [ ] Write an XSS rendering test: output contains escaped `&lt;img` and no executable tag.
- [ ] Write a link test for `noopener noreferrer` and `no-referrer`.
- [ ] Write pure domain-policy tests for whitespace/comma parsing, lowercase normalization, duplicates, invalid paths and the 20-domain cap.
- [ ] Run:

```bash
npm test -- tests/unit/evidence-dialog.test.tsx tests/unit/use-research-reducer.test.ts
```

- [ ] Expected RED: dialog does not exist.
- [ ] Implement `EvidenceDialog` as a focused client component; no portal or dependency.
- [ ] Add domain controls inside the existing advanced section of `ResearchForm`; broad mode hides/disables the domain input.
- [ ] Add one selected-evidence state to `ProfileCard`; do not create state per field.
- [ ] Replace every `google.com/search` and `google.com/maps/search` anchor in `profile-card.tsx`.
- [ ] Reuse `EvidenceDialog` in `ResearchProgress` for live findings; adapt `FindingPreview` into display-only citation content without inventing missing fields.
- [ ] Run:

```bash
rg -n "google\.com/(search|maps/search)" src/app/components/profile-card.tsx src/app/components/research-progress.tsx
```

- [ ] Expected: no matches.
- [ ] Run targeted tests; expected GREEN.
- [ ] Run `npm run typecheck`.
- [ ] Visual verification at desktop 1440×900 and mobile 390×844:
  - open/close via button, backdrop and Escape;
  - long URL/excerpt wraps without horizontal page overflow;
  - focus returns to trigger;
  - paywall and incomplete metadata states are readable;
  - screenshot before/after saved to the task handoff.
- [ ] Commit:

```bash
git add src/app/components/evidence-dialog.tsx src/app/components/profile-card.tsx src/app/components/research-progress.tsx src/app/components/research-form.tsx tests/unit/evidence-dialog.test.tsx tests/unit/source-domain-policy.test.ts tests/unit/use-research-reducer.test.ts
git commit -m "feat(ui): show evidence inside the app"
```

**Acceptance:**

- No profile claim sends the user to a generated Google query.
- Direct external navigation exists only for official/original URLs.
- Missing provenance is visible rather than silently replaced by search.

---

## Sprint 8 — Security, visual, legal và release gate

**Outcome:** Integrated Task 4 passes all automated checks, real publisher smoke tests, visual review and release-policy review.

**Files:**

- Modify: `README.md`
- Modify: `docs/plan/ARCHITECTURE.md`
- Modify: `docs/plan/DEMO_SCRIPT.md`
- Modify: `docs/ticket/TASK.md`
- Modify: production/test files only when correcting a Task 4 regression discovered by this gate

**Automated gate:**

```bash
npm run lint
npm run typecheck
npm run typecheck:legacy
npm test
npm run build
```

- [ ] All commands exit 0; record current test counts instead of copying an older count.
- [ ] Run `codegraph sync .` and `codegraph status .`; index must be current.
- [ ] Run:

```bash
rg -n "google\.com/(search|maps/search)" src/app
rg -n "dangerouslySetInnerHTML|<iframe" src/app src/modules/research
rg -n "source: \"news\"" src/modules/analyst
```

- [ ] Expected: no generated Google fallback, no raw HTML/iframe rendering and no hard-coded analyst risk source.
- [ ] Re-run SSRF, scraper transport, crawl-policy, publication and XSS targeted suites together.
- [ ] Verify cache-hit and live-research screenshots show the same evidence dialog fields.

**Publisher smoke matrix:**

| Case | Expected |
|---|---|
| One Vietnamese publisher with author/date | Short excerpt + full metadata + original link |
| One publisher missing author/date | Transparent missing-metadata labels |
| One explicit paywall | Metadata-only; no extracted body |
| One robots disallow | Search metadata only; `disallowed` recorded |
| One unavailable article | Search snippet fallback |
| Two copied articles | Duplicate cluster; independent count not inflated |
| Registry + official website | Primary-source status |
| Two distinct publishers | Corroborated status |

- [ ] Use FPT, Vingroup and MISA as company flows; record selected URLs, provider, crawl decision, preview mode and duration in `docs/plan/DEMO_SCRIPT.md`.
- [ ] Confirm logs contain hostname/status only and no article body, API key, email or phone.
- [ ] Confirm no paywall/CAPTCHA bypass attempt occurs.

**Legal/product release checklist:**

- [ ] README states excerpts must comply with the user's jurisdiction and publisher terms.
- [ ] README states robots/snippet controls are policy signals, not copyright licenses.
- [ ] Publisher-specific licensed feeds take precedence when configured later.
- [ ] Product copy never promises fact-checking or legal verification.
- [ ] Human review is required before high-impact legal/financial decisions.

**AMP/Reader gate:**

- [ ] Measure server-extract success on at least 30 target news URLs.
- [ ] If useful extraction is at least 85%, keep AMP fetching deferred.
- [ ] If below 85% and discovered `ampUrl` would recover at least three failed target URLs, create a separate ticket for bounded AMP fallback.
- [ ] Do not add Mozilla Readability/DOM emulation unless a benchmark proves Cheerio + Jina misses the agreed threshold.

- [ ] Update `docs/ticket/TASK.md`: mark each Sprint 0–8 complete only after its commit and acceptance checks exist.
- [ ] Commit:

```bash
git add README.md docs/plan/ARCHITECTURE.md docs/plan/DEMO_SCRIPT.md docs/ticket/TASK.md
git commit -m "docs(evidence): document provenance operations"
```

**Acceptance:**

- Full verification is green.
- UI works for live and cached research.
- Security and publisher-intent fallbacks fail closed to metadata.
- Task documentation states implemented behavior and measured limitations.

---

## Rollback

- Disable article body extraction with `NEWS_ARTICLE_EXTRACTION_ENABLED=false`; Serper News metadata/snippets remain available.
- Set `ROBOTS_FAIL_MODE=metadata_only` as the only supported production fail mode.
- Revert Sprint 7 alone to restore non-clickable profile content; do not restore generated Google searches.
- If runtime schema causes cache instability, keep rich fields optional for reads but required for newly persisted live snapshots.
- Remove Cheerio/robots-parser only after publication/crawl modules are reverted and full verification passes.

## Explicitly deferred

- Binary fake-news classification.
- Numeric publisher reputation score.
- Paid domain trust provider.
- Full article archival.
- iframe article rendering.
- AMP fetching without the Sprint 8 benchmark gate.
- Mozilla Readability + JSDOM.
- C2PA verification.
- Distributed crawler queue, Redis rate limiter or scheduled monitoring.
- User-maintained global blacklist; Task 4 supports only request-level `broad | prefer | only` domain policy.

## Execution handoff

Execute one sprint at a time. Review the sprint diff and acceptance output before starting the next sprint. Sprint 7 must not begin until Sprint 6 proves citations survive both live and cached flows.
