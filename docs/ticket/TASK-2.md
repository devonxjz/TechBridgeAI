# TASK-2 — PartnerIQ Research Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan sprint-by-sprint. Every production change follows RED → GREEN → review → commit.

**Status:** Plan only. This ticket does not contain or authorize an implementation commit.

**Goal:** Nâng pipeline research hiện tại thành một luồng thu thập dữ liệu an toàn, có fallback quan sát được và đủ ổn định cho demo AI Riser mà không xây lại research engine.

**Architecture:** Giữ nguyên `ResearchModule`, `SearchAdapter`, Serper, event stream, profile, analyst, storage và UI. Thay scraper production bằng `SafeDirect → Jina Reader → TinyFish`; mọi tier thất bại phải trả lỗi thật, không tạo evidence giả. Registry ưu tiên VietQR khi input có `taxId`, sau đó mới dùng search/snippet fallback hiện tại.

**Tech Stack:** Next.js 16.3.2, TypeScript 7.0.2, Node.js 20 CI, Node built-ins (`URL`, `node:dns`, `node:http`, `node:https`, `node:net`), Vitest 4, Serper, Jina Reader, TinyFish và VietQR Business API.

**Spec:** `docs/plan/SPEC.md`. Ticket này chỉ thay collection adapters, dependency injection và resource guards; không đổi schema profile, analyst logic, storage contract hoặc UI.

## Global Constraints

- Thứ tự ưu tiên: security → demo reliability → simplicity → performance.
- Không bypass Cloudflare, DataDome, CAPTCHA hoặc cơ chế anti-bot.
- Giữ Serper; không thêm SearXNG, Common Crawl, Crawlee, query planner hoặc provider registry.
- Không thêm Cheerio hoặc Playwright trong Phase 1.
- Không sinh placeholder/fabricated evidence khi scraper lỗi.
- Chỉ nhận `http:` và `https:`; cấm credentials trong URL.
- Chặn loopback, private, link-local, carrier-grade NAT, multicast, metadata và IPv4-mapped IPv6.
- Direct tier phải validate toàn bộ A/AAAA, pin IP đã duyệt và validate lại từng redirect.
- Direct tier dùng deadline 8 giây cho toàn bộ DNS → redirects → headers → body; tối đa 3 redirects và 1 MiB raw response.
- HTTPS giữ hostname gốc cho `Host`, SNI và certificate verification; không đặt `rejectUnauthorized: false`.
- Response attachment, encoded body ngoài `identity`, duplicate/mâu thuẫn security headers hoặc non-text MIME đều fail closed.
- Jina 429 chuyển ngay sang TinyFish với outcome `jina_rate_limited`; không retry cùng tier.
- VietQR chỉ chạy khi có `taxId`; không suy đoán MST từ tên công ty.
- Scraped text là untrusted LLM input. Phase 1 không được tuyên bố structured output đã loại bỏ prompt injection.
- Log chỉ gồm event, provider, hostname, duration và outcome; không log API key, raw query string hoặc response body.
- Mỗi sprint chỉ sửa các file được liệt kê và kết thúc bằng targeted tests + full regression phù hợp.

---

## Kiến trúc đích

```text
ResearchModule
├── web_search: Serper (unchanged)
├── website / linkedin / aggregator page
│   └── TieredScraperAdapter
│       ├── SafeDirectScraperAdapter
│       ├── JinaReaderScraperAdapter       # enabled khi có key
│       └── TinyFishScraperAdapter         # enabled khi có key
└── registry
    ├── VietQrRegistryAdapter              # chỉ khi input.taxId tồn tại
    └── aggregator / registry search fallback hiện tại
```

### Luật chuyển tier

| Kết quả tier hiện tại | Hành vi |
|---|---|
| Success có text hữu ích | Short-circuit; không gọi tier sau |
| `invalid_target` | Dừng toàn chain; không dùng remote proxy cho target bị cấm |
| `blocked`, `timeout`, `too_large`, `empty`, `rate_limited`, `upstream_error` | Ghi outcome an toàn rồi chuyển tier tiếp theo |
| Jina 429 | Ghi `jina_rate_limited`, gọi TinyFish đúng một lần, không retry Jina |
| Tất cả tier fail | Throw aggregate `ScrapeError`; ResearchModule phát error event, không finding giả |

### Phạm vi không làm trong ticket

- Browser automation/Playwright.
- HTML parser/Cheerio.
- Sitemap, robots.txt hoặc RSS discovery.
- GDELT hoặc search provider mới.
- Persistent/Redis cache.
- Prompt-injection hardening trong ProfileModule.
- Refactor source execution sang parallel hoặc thay đổi SSE event contract.

---

## Sprint dependency và ước lượng

| Sprint | Deliverable | Estimate | Depends on |
|---|---|---:|---|
| 0 | Clean TypeScript 7 baseline | 0.5 giờ | — |
| 1 | Typed scraper errors; không fake evidence | 1.5 giờ | Sprint 0 |
| 2 | SSRF-safe direct fetch | 5 giờ | Sprint 1 |
| 3 | Jina + TinyFish fallback chain | 3 giờ | Sprint 2 |
| 4 | Production composition + page/time budgets | 2.5 giờ | Sprint 3 |
| 5 | VietQR registry adapter | 3 giờ | Sprint 4 |
| 6 | Full-flow verification + demo docs | 2.5 giờ | Sprint 5 |

**Tổng:** khoảng 18 giờ tập trung, tương đương 2 ngày triển khai và 0.5 ngày buffer cho external providers/smoke tests.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Chạy `next typegen` trước TypeScript 7 typecheck trên clean CI |
| `src/adapters/scraper/types.ts` | Modify | Provider metadata và typed scrape errors |
| `src/adapters/scraper/tinyfish.ts` | Modify | TinyFish-only adapter, bounded timeout, không fake fallback |
| `src/adapters/scraper/url-safety.ts` | Create | URL/IP/DNS validation và public target resolution |
| `src/adapters/scraper/direct.ts` | Create | Pinned HTTP(S), redirects, headers, stream limit, text cleanup |
| `src/adapters/scraper/jina.ts` | Create | Jina Reader adapter và 429 mapping |
| `src/adapters/scraper/tiered.ts` | Create | Ordered fallback, short-circuit, aggregate errors, safe logs |
| `src/adapters/scraper/index.ts` | Modify | Export production scraper adapters |
| `src/adapters/registry/types.ts` | Create | Registry port, record và typed errors |
| `src/adapters/registry/vietqr.ts` | Create | VietQR lookup + warm-instance cache |
| `src/adapters/registry/index.ts` | Create | Registry exports |
| `src/modules/research/sources/website.ts` | Modify | Enforce page budget, tính cả homepage |
| `src/modules/research/sources/registry.ts` | Modify | VietQR-first, search fallback |
| `src/modules/research/index.ts` | Modify | Inject registry adapter và guards, giữ event contract |
| `src/config/index.ts` | Modify | Compose enabled tiers/registry adapter từ env |
| `.env.example` | Modify | Chỉ ghi config thực sự được hỗ trợ |
| `tests/unit/tiered-scraper.test.ts` | Create | TinyFish, Jina và ordered fallback tests |
| `tests/unit/scraper-security.test.ts` | Create | SSRF, TLS, redirect, header và stream tests |
| `tests/integration/scraper-transport.test.ts` | Create | Real Node socket test cho pinned lookup/Host |
| `tests/unit/registry-adapter.test.ts` | Create | VietQR mapping, cache và typed failures |
| `tests/unit/sources.test.ts` | Modify | Page budget và registry fallback behavior |
| `tests/integration/research-module.test.ts` | Modify | DI và event contract không đổi |
| `README.md` | Modify | Provider/env/rollback đã triển khai |
| `docs/plan/DEMO_SCRIPT.md` | Modify | Provider thắng, duration và outcome của smoke cases |
| `docs/ticket/TASK.md` | Modify | Sprint completion checklist |

---

## Sprint 0 — Clean baseline và TypeScript 7 verification gate

**Outcome:** Clean install có thể typecheck bằng TypeScript 7 mà không phụ thuộc `.next/types` từ lần build trước.

**Files:**

- Modify: `package.json`
- Verify: `.github/workflows/ci.yml`

**Script đích:**

```json
{
  "scripts": {
    "typecheck": "next typegen && tsc --noEmit",
    "typecheck:legacy": "next typegen && tsc6 --noEmit"
  }
}
```

- [ ] Chạy `npm ci` trên clean worktree.
- [ ] Chạy `npm run typecheck`; expected RED hiện tại: `LayoutProps` chưa tồn tại nếu `.next/types` chưa được generate.
- [ ] Sửa hai scripts theo snippet trên; không sửa `src/app/layout.tsx` vì `LayoutProps` là Next route-aware global helper.
- [ ] Chạy `npm run typecheck`; expected GREEN: `next typegen` thành công và TypeScript 7 có 0 diagnostics.
- [ ] Chạy `npm run typecheck:legacy`; expected GREEN: TypeScript 6 compatibility cũng có 0 diagnostics.
- [ ] Chạy `npm test`; baseline trước feature phải pass.
- [ ] Xác nhận CI vẫn gọi `npm run typecheck` trước lint/test/build.
- [ ] Commit:

```bash
git add package.json
git commit -m "fix(toolchain): generate Next route types"
```

**Acceptance:** `npm ci && npm run typecheck` pass trên workspace không có `.next/`; không che lỗi bằng `ignoreBuildErrors`.

---

## Sprint 1 — Scraper contract và loại evidence giả

**Outcome:** Mọi production scraper trả nội dung có provider thật hoặc throw typed error; TinyFish không còn direct fallback hay placeholder.

**Files:**

- Modify: `src/adapters/scraper/types.ts`
- Modify: `src/adapters/scraper/tinyfish.ts`
- Create: `tests/unit/tiered-scraper.test.ts`

**Interfaces tạo ra:**

```ts
export type ScraperProvider = "direct" | "jina" | "tinyfish" | "mock";

export type ScrapeErrorCode =
  | "blocked"
  | "timeout"
  | "invalid_target"
  | "too_large"
  | "empty"
  | "rate_limited"
  | "upstream_error";

export interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown> & { provider?: ScraperProvider };
}

export class ScrapeError extends Error {
  constructor(
    message: string,
    readonly provider: ScraperProvider,
    readonly code: ScrapeErrorCode,
    readonly retryable = false,
  ) {
    super(message);
  }
}
```

**TinyFish constructor đích:**

```ts
constructor(
  apiKey: string,
  baseUrl = "https://api.tinyfish.app",
  timeoutMs = 8_000,
)
```

- [ ] Viết test non-2xx → `ScrapeError("tinyfish", "upstream_error")`.
- [ ] Viết test 429 → `ScrapeError("tinyfish", "rate_limited", false)`.
- [ ] Viết test response text `<= 50` ký tự → code `empty`.
- [ ] Viết test fetch reject → code `upstream_error`.
- [ ] Viết test timeout → code `timeout`; request dùng `AbortSignal.timeout(8_000)`.
- [ ] Viết test success gắn `metadata.provider = "tinyfish"` và giữ upstream metadata.
- [ ] Chạy `npm test -- tests/unit/tiered-scraper.test.ts`; expected RED: adapter đang trả fabricated object hoặc thiếu provider/typed errors.
- [ ] Xóa toàn bộ direct fetch và object `Thông tin doanh nghiệp...` khỏi `TinyFishScraperAdapter.extract()`.
- [ ] Không catch rồi nuốt `ScrapeError`; chỉ map lỗi fetch/abort không typed.
- [ ] Chạy targeted test; expected GREEN.
- [ ] Chạy `rg -n "Thông tin doanh nghiệp từ website|Trang web" src/adapters/scraper`; expected: không có fabricated fallback.
- [ ] Commit:

```bash
git add src/adapters/scraper/types.ts src/adapters/scraper/tinyfish.ts tests/unit/tiered-scraper.test.ts
git commit -m "fix(scraper): remove fabricated fallback"
```

**Acceptance:** Error path không tạo `ScrapedContent`; success path luôn xác định provider.

---

## Sprint 2 — SSRF-safe direct fetch

**Outcome:** Direct scraper chỉ kết nối tới IP public đã duyệt, giữ đúng TLS hostname và dừng body tại byte thứ `maxResponseBytes + 1`.

**Files:**

- Create: `src/adapters/scraper/url-safety.ts`
- Create: `src/adapters/scraper/direct.ts`
- Create: `tests/unit/scraper-security.test.ts`
- Create: `tests/integration/scraper-transport.test.ts`

**Interfaces tạo ra:**

```ts
export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export async function resolvePublicTarget(rawUrl: string): Promise<ResolvedTarget>;
export function isPublicAddress(address: string): boolean;

export interface DirectScraperLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
}

export class SafeDirectScraperAdapter implements ScraperAdapter {
  constructor(private readonly limits: DirectScraperLimits);
  extract(url: string): Promise<ScrapedContent>;
}
```

### 2.1 URL/IP test matrix

- [ ] Table-test reject: `file:`, `ftp:`, URL có `user:pass@host`, `localhost`, `*.localhost` và metadata hostnames.
- [ ] IPv4 reject: `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, documentation, benchmark, multicast và reserved ranges.
- [ ] IPv6 reject: `::`, `::1`, `fc00::/7`, `fe80::/10`, multicast, documentation, site-local, IPv4-mapped IPv6 và địa chỉ ngoài allocated global unicast `2000::/3`.
- [ ] WHATWG canonicalization reject:

```ts
const alternateLoopbacks = [
  "http://2130706433/",
  "http://0177.0.0.1/",
  "http://0x7f000001/",
  "http://[::ffff:127.0.0.1]/",
];
```

- [ ] Public controls phải pass classification: `8.8.8.8`, `1.1.1.1`, một IPv6 global hợp lệ.
- [ ] DNS `{ all: true, verbatim: true }` trả một public + một private phải reject toàn hostname trước `http.request`.
- [ ] DNS error hoặc zero answers phải trả `invalid_target`, không mở request.
- [ ] Chạy `npm test -- tests/unit/scraper-security.test.ts`; expected RED: modules chưa tồn tại.

### 2.2 Pinned transport, redirects và TLS

- [ ] Dùng `http.request`/`https.request` với hostname gốc và custom `lookup` chỉ trả IP đã validate.
- [ ] Đặt `agent: false` để socket pool không bypass lookup của request hiện tại.
- [ ] Với HTTPS, `servername` là hostname gốc; không truyền IP làm hostname và không set `rejectUnauthorized: false`.
- [ ] `Host` giữ hostname gốc và port nếu port khác mặc định.
- [ ] Không follow redirect tự động. Resolve `Location` bằng `new URL(location, currentUrl)`, gọi lại `resolvePublicTarget`, rồi mới mở request kế tiếp.
- [ ] Redirect thứ 4 khi `maxRedirects = 3` → code `blocked`.
- [ ] Redirect public → private → reject trước request thứ hai.
- [ ] `invalid_target` luôn terminal; không để tiered adapter chuyển target bị cấm sang remote proxy.

### 2.3 Response boundary

- [ ] Gửi `Accept-Encoding: identity`; response có `Content-Encoding` khác rỗng/`identity` → `blocked` trước body listener.
- [ ] Đọc `response.headersDistinct` khi có. Yêu cầu đúng một `Content-Type`; chỉ nhận `text/html` hoặc `text/plain`, cho phép charset parameter.
- [ ] Reject nếu bất kỳ distinct `Content-Disposition` value nào có disposition type `attachment`.
- [ ] Reject duplicate/mâu thuẫn `Content-Type`, `Content-Length` hoặc invalid `Content-Length`.
- [ ] Nếu declared `Content-Length > maxResponseBytes`, destroy request/response trước khi đọc body.
- [ ] Với chunked/missing header, cộng `Buffer.byteLength(chunk)` trước khi append; vượt limit thì destroy đồng bộ và không `Buffer.concat` full body.
- [ ] Deadline 8 giây bao trùm DNS, mọi redirect, header và body; dùng remaining time thay vì reset 8 giây sau mỗi redirect.
- [ ] Timeout/error/close chỉ settle promise một lần và clear timer/listeners.
- [ ] Cleanup HTML bằng forward scan tuyến tính; `<script>`/`<style>` không có closing tag phải consume tới EOF. Không dùng backtracking regex trên toàn document.
- [ ] Thêm regression với 256 KiB repeated unclosed `<script>` và `<style>`; mỗi case hoàn thành dưới 3 giây trên CI.
- [ ] Text sạch `<= 50` ký tự → `empty`; success gắn `metadata.provider = "direct"` và cap text 10,000 ký tự.

### 2.4 Real transport check

- [ ] Tạo local HTTP server chỉ trong integration test.
- [ ] Mock duy nhất `resolvePublicTarget()` để trả hostname test + pinned `127.0.0.1`; không mock `http.request`.
- [ ] Xác nhận real socket tới local server, server nhận `Host` là hostname gốc và response được đọc thành công.
- [ ] Xác nhận lookup pinning được gọi và `agent: false`; test này bổ sung, không thay thế SSRF unit matrix.
- [ ] Chạy:

```bash
npm test -- tests/unit/scraper-security.test.ts tests/integration/scraper-transport.test.ts
```

- [ ] Expected GREEN: toàn bộ matrix pass, không socket/timer leak.
- [ ] Commit:

```bash
git add src/adapters/scraper/url-safety.ts src/adapters/scraper/direct.ts tests/unit/scraper-security.test.ts tests/integration/scraper-transport.test.ts
git commit -m "feat(scraper): add SSRF-safe direct fetch"
```

**Acceptance:** Không outbound request trước public validation; redirect không bypass; TLS verify hostname gốc; memory/body bound được enforce trong stream.

---

## Sprint 3 — Jina Reader và ordered fallback chain

**Outcome:** Chain `direct → Jina → TinyFish` short-circuit đúng thứ tự, bounded theo tier và quan sát được khi demo.

**Files:**

- Create: `src/adapters/scraper/jina.ts`
- Create: `src/adapters/scraper/tiered.ts`
- Modify: `src/adapters/scraper/index.ts`
- Modify: `tests/unit/tiered-scraper.test.ts`

**Interfaces tạo ra:**

```ts
export interface ScrapeAttempt {
  provider: ScraperProvider;
  code: ScrapeErrorCode;
}

export class JinaReaderScraperAdapter implements ScraperAdapter {
  constructor(private readonly apiKey: string, private readonly timeoutMs = 8_000);
  extract(url: string): Promise<ScrapedContent>;
}

export class TieredScraperAdapter implements ScraperAdapter {
  constructor(private readonly tiers: readonly ScraperAdapter[]);
  extract(url: string): Promise<ScrapedContent>;
}
```

- [ ] Test tier 1 success → Jina/TinyFish không được gọi.
- [ ] Test direct `blocked`/`empty`/`timeout` → Jina được gọi; Jina fail → TinyFish được gọi.
- [ ] Test direct `invalid_target` → chain dừng, remote tiers không được gọi.
- [ ] Test ba tier fail → throw một `ScrapeError`; message/details ghi deterministic attempts `direct:<code> -> jina:<code> -> tinyfish:<code>`.
- [ ] Test Jina request dùng fixed origin `https://r.jina.ai`, `Authorization: Bearer <key>` và `AbortSignal.timeout(8_000)`.
- [ ] Test Jina non-2xx → `upstream_error`; short text → `empty`; timeout → `timeout`.
- [ ] Test Jina success → `metadata.provider = "jina"`.
- [ ] Test Jina 429 → provider `jina`, code `rate_limited`, `retryable = false`; TinyFish được gọi đúng một lần; Jina không retry.
- [ ] Spy log Jina 429; event phải chứa `outcome: "jina_rate_limited"`, provider và duration, nhưng không chứa key, raw URL/query hoặc body.
- [ ] Test mỗi tier log một structured outcome với hostname đã bỏ query string.
- [ ] Chạy targeted test; expected RED trước khi tạo Jina/tiered modules.
- [ ] Implement bằng loop đơn giản qua constructor order; không factory/registry/retry abstraction.
- [ ] Export `SafeDirectScraperAdapter`, `JinaReaderScraperAdapter`, `TinyFishScraperAdapter`, `TieredScraperAdapter` và types từ `src/adapters/scraper/index.ts`.
- [ ] Chạy targeted test và full regression.
- [ ] Commit:

```bash
git add src/adapters/scraper/jina.ts src/adapters/scraper/tiered.ts src/adapters/scraper/index.ts tests/unit/tiered-scraper.test.ts
git commit -m "feat(scraper): add tiered fallback"
```

**Acceptance:** Success provider có metadata; 429 không retry; target invalid không được chuyển qua remote; aggregate failure không tạo empty result.

---

## Sprint 4 — Production composition, rollback flags và budgets

**Outcome:** Factory compose đúng enabled tiers; thiếu key không crash; website source không vượt page budget; source timeout đủ cho ba tier.

**Files:**

- Modify: `src/config/index.ts`
- Modify: `src/modules/research/index.ts`
- Modify: `src/modules/research/sources/website.ts`
- Modify: `.env.example`
- Modify: `tests/unit/sources.test.ts`
- Modify: `tests/integration/research-module.test.ts`

**Environment đích:**

```dotenv
SCRAPER_PROVIDER=tiered
SCRAPER_DIRECT_ENABLED=true
SCRAPER_JINA_ENABLED=true
SCRAPER_TINYFISH_ENABLED=true
JINA_API_KEY=
TINYFISH_API_KEY=
SCRAPER_TIMEOUT_MS=8000
SCRAPER_MAX_RESPONSE_BYTES=1048576
SCRAPER_MAX_REDIRECTS=3
MAX_SCRAPE_PAGES_PER_RESEARCH=5
SOURCE_TIMEOUT_MS=30000
VIETQR_ENABLED=true
```

**Composition rules:**

```text
tiered + direct enabled                    => SafeDirect
tiered + Jina enabled + JINA_API_KEY       => append Jina
tiered + TinyFish enabled + TINYFISH_KEY   => append TinyFish
tinyfish                                   => explicit rollback provider; key required
mock                                       => tests/local demo
```

- [ ] Test default/tiered compose order `direct, jina, tinyfish` khi đủ keys.
- [ ] Test thiếu Jina key bỏ Jina; thiếu TinyFish key bỏ TinyFish; startup vẫn chạy với direct.
- [ ] Test `SCRAPER_DIRECT_ENABLED=false` tạo rollback chain `Jina → TinyFish`.
- [ ] Test tất cả tiers disabled/missing key → throw config error rõ ràng tại factory, không chờ tới request.
- [ ] Test legacy `SCRAPER_PROVIDER=tinyfish` và `mock` vẫn hoạt động.
- [ ] Test numeric env invalid/zero/negative dùng safe fallback; production defaults đúng 8,000 ms, 1,048,576 bytes, 3 redirects, 5 pages và 30,000 ms source timeout.
- [ ] Thay hard-code `maxScrapePagesPerResearch: 5` bằng env parser trong `getGuards()`.
- [ ] Đổi `scrapeWebsite()` nhận `maxPages: number`; mỗi lần gọi `scraper.extract()` tăng budget, homepage tính là page đầu tiên.
- [ ] Dừng loop trước request thứ `maxPages + 1`, kể cả các page trước fail.
- [ ] Truyền `deps.guards.maxScrapePagesPerResearch` từ `ResearchModule`; không đổi event names/status.
- [ ] Integration test xác nhận source fail vẫn phát `error`, `progress:failed` và cuối cùng vẫn có `complete`.
- [ ] Chạy:

```bash
npm test -- tests/unit/sources.test.ts tests/unit/tiered-scraper.test.ts tests/integration/research-module.test.ts
```

- [ ] Expected RED trước composition/budget changes; GREEN sau implementation.
- [ ] Commit:

```bash
git add src/config/index.ts src/modules/research/index.ts src/modules/research/sources/website.ts .env.example tests/unit/sources.test.ts tests/integration/research-module.test.ts
git commit -m "feat(config): wire tiered scraper limits"
```

**Acceptance:** Max 5 scrape attempts gồm homepage; worst-case three-tier chain có 30 giây source envelope; từng tier tắt được bằng env mà không revert code.

---

## Sprint 5 — VietQR registry adapter và controlled fallback

**Outcome:** Có MST thì dùng structured VietQR record trước; VietQR lỗi/rate-limit không làm fail research và không thay đổi behavior khi thiếu `taxId`.

**Files:**

- Create: `src/adapters/registry/types.ts`
- Create: `src/adapters/registry/vietqr.ts`
- Create: `src/adapters/registry/index.ts`
- Modify: `src/modules/research/sources/registry.ts`
- Modify: `src/modules/research/index.ts`
- Modify: `src/config/index.ts`
- Create: `tests/unit/registry-adapter.test.ts`
- Modify: `tests/unit/sources.test.ts`
- Modify: `tests/integration/research-module.test.ts`

**Interfaces tạo ra:**

```ts
export interface RegistryRecord {
  taxId: string;
  name: string;
  internationalName?: string;
  shortName?: string;
  address?: string;
}

export type RegistryErrorCode =
  | "timeout"
  | "rate_limited"
  | "not_found"
  | "invalid_response"
  | "upstream_error";

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly code: RegistryErrorCode,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface RegistryAdapter {
  findByTaxId(taxId: string): Promise<RegistryRecord | null>;
}
```

- [ ] Test `GET https://api.vietqr.io/v2/business/{encodeURIComponent(taxId)}`.
- [ ] Test response `code: "00"` map `data.id/name/internationalName/shortName/address` vào `RegistryRecord`.
- [ ] Test missing/malformed `data`, malformed JSON và non-success `code` → `invalid_response` hoặc `not_found` theo response.
- [ ] Test HTTP 404 → `not_found`; 429 → `rate_limited`; fetch reject → `upstream_error`; abort ở 5 giây → `timeout`.
- [ ] Cache chỉ valid record trong instance `Map`; TTL `7 * 24 * 60 * 60 * 1000`; lookup cùng MST hai lần trong TTL chỉ hit API một lần.
- [ ] Không cache timeout, 429, malformed response hoặc upstream error.
- [ ] Đặt comment ngay trên cache:

```ts
// ponytail: process-local cache only helps warm-instance bursts; move to Supabase at Gate D for cross-instance caching.
```

- [ ] Test input không có `taxId` không gọi VietQR và giữ aggregator/search flow hiện tại.
- [ ] Test có `taxId` + VietQR success trả một `RawFinding` confidence cao hơn aggregator, URL/citation là VietQR endpoint và metadata `via: "vietqr"`.
- [ ] Test VietQR null/error → log `registry_fallback` với reason rồi chạy aggregator/search hiện tại.
- [ ] Log không chứa full response body; registry source không throw khi fallback còn hoạt động.
- [ ] Thêm `registry: RegistryAdapter` vào `ResearchDeps`; dùng object stub trong integration tests, không tạo production mock class chỉ để test.
- [ ] `createRegistryAdapter()` tạo singleton `VietQrRegistryAdapter` khi `VIETQR_ENABLED=true`; disabled dùng adapter trả `null` tối thiểu hoặc bỏ lookup tại source composition.
- [ ] Chạy:

```bash
npm test -- tests/unit/registry-adapter.test.ts tests/unit/sources.test.ts tests/integration/research-module.test.ts
```

- [ ] Expected RED trước new adapter/DI; GREEN sau implementation.
- [ ] Commit:

```bash
git add src/adapters/registry src/modules/research/sources/registry.ts src/modules/research/index.ts src/config/index.ts tests/unit/registry-adapter.test.ts tests/unit/sources.test.ts tests/integration/research-module.test.ts
git commit -m "feat(registry): add VietQR tax lookup"
```

**Acceptance:** VietQR là enrichment có kiểm soát, không phải single point of failure; cache chỉ cam kết trong warm process.

---

## Sprint 6 — Verify từng flow, smoke test và tài liệu

**Outcome:** Tất cả automated flows pass trên clean install; ba company demo cases ghi provider thắng thật và blocked cases không tạo evidence.

**Files:**

- Modify: `README.md`
- Modify: `docs/plan/DEMO_SCRIPT.md`
- Modify: `docs/ticket/TASK.md`

### 6.1 Automated verification

- [ ] Clean dependency flow:

```bash
npm ci
npm ls --depth=0
npx tsc --version
npx tsc6 --version
```

Expected: TypeScript primary `7.0.2`, legacy `6.0.2`, dependency tree không invalid.

- [ ] Compiler/lint/build flow:

```bash
npm run typecheck
npm run typecheck:legacy
npm run lint
npm run build
```

Expected: 0 diagnostics/errors; `next typegen` chạy trước compiler trên clean workspace.

- [ ] Feature test flows:

```bash
npm test -- tests/unit/tiered-scraper.test.ts
npm test -- tests/unit/scraper-security.test.ts
npm test -- tests/integration/scraper-transport.test.ts
npm test -- tests/unit/registry-adapter.test.ts
npm test -- tests/unit/sources.test.ts
npm test -- tests/integration/research-module.test.ts
npm test -- tests/e2e/workflow-e2e.test.ts
npm test
```

Expected: từng targeted flow và full suite pass; không test `.skip`, `.only`, placeholder assertion hoặc snapshot rỗng.

### 6.2 Security smoke flow

- [ ] `http://127.0.0.1`, `http://169.254.169.254`, `http://[::1]` và alternate loopback forms fail trước outbound request.
- [ ] Public URL redirect sang private fail trước request thứ hai.
- [ ] HTTPS public site certificate hợp lệ success qua pinned IP; không tắt certificate verification.
- [ ] Attachment, gzip/br response và over-limit chunked body trả typed error; không finding.
- [ ] UI/API stream nhận `error` + `progress:failed`, sau đó research vẫn đi tới `complete` với findings từ sources khác.

### 6.3 Demo company matrix

Smoke FPT, Vingroup và MISA bằng config production-like. Không ép provider cụ thể phải thắng; ghi đúng kết quả quan sát được.

| Company | Input/URL | Provider thắng | Duration | Outcome | Evidence hợp lệ |
|---|---|---|---:|---|---|
| FPT | ghi URL thực tế đã dùng | `direct` / `jina` / `tinyfish` | ms | success/failure code | URL + text thật |
| Vingroup | ghi URL thực tế đã dùng | `direct` / `jina` / `tinyfish` | ms | success/failure code | URL + text thật |
| MISA | ghi URL thực tế đã dùng | `direct` / `jina` / `tinyfish` | ms | success/failure code | URL + text thật |

- [ ] Với mỗi case, ghi tier attempts theo thứ tự; TinyFish chỉ xuất hiện sau direct và Jina fail.
- [ ] Ghi riêng một blocked URL case; không tính vào ba company cases.
- [ ] Tổng pipeline mỗi company nằm trong 60–90 giây hoặc ghi rõ bottleneck trước khi demo.
- [ ] Nếu thiếu `JINA_API_KEY`/`TINYFISH_API_KEY`, ghi tier bị skip; không tuyên bố provider đó đã được smoke-tested.
- [ ] Jina 429 phải hiện `jina_rate_limited`, không có retry cùng tier.
- [ ] VietQR hit/fallback ratio được ghi qua `registry_fallback`; không dùng tên công ty để đoán MST.

### 6.4 Documentation và commit

- [ ] README chỉ liệt kê `tiered`, `tinyfish`, `mock` nếu factory chỉ hỗ trợ ba provider values đó; Jina là tier, không phải standalone provider.
- [ ] README giải thích enable flags, missing-key behavior, timeout/page budget và rollback.
- [ ] `docs/plan/DEMO_SCRIPT.md` chứa bảng smoke results đã đo, không điền provider giả định.
- [ ] `docs/ticket/TASK.md` đánh dấu sprint complete chỉ sau khi command tương ứng đã chạy.
- [ ] Commit:

```bash
git add README.md docs/plan/DEMO_SCRIPT.md docs/ticket/TASK.md
git commit -m "docs: add reliable research demo flow"
```

**Acceptance:** Clean CI + unit + integration + E2E + build pass; demo matrix có provider/duration/outcome thật; không fabricated evidence.

---

## Definition of Done — Phase 1

- [ ] TypeScript 7 và TypeScript 6 compatibility typecheck đều 0 diagnostics trên clean install.
- [ ] Không còn production path tạo fabricated scrape content.
- [ ] SSRF tests chặn IPv4/IPv6 special ranges, mixed DNS answers và redirect-to-private.
- [ ] Direct transport pin IP nhưng giữ Host/SNI/certificate hostname.
- [ ] Response limit được enforce trong stream; encoded/attachment/duplicate headers fail closed.
- [ ] Direct/Jina/TinyFish đều có timeout 8 giây; source envelope là 30 giây.
- [ ] Jina 429 không retry; TinyFish chỉ chạy sau tier trước fail.
- [ ] Page budget tối đa 5, tính cả homepage và failed attempts.
- [ ] VietQR chỉ chạy khi có `taxId`; lỗi VietQR fallback được, không fail toàn pipeline.
- [ ] Unit, integration, E2E, lint, typecheck và build pass.
- [ ] FPT, Vingroup, MISA có smoke record thật: URL, provider, duration, outcome.
- [ ] Blocked URL tạo error event, không evidence.
- [ ] Rollback từng tier thực hiện được bằng env flags, không revert security code.

---

## Rollout và rollback

### Rollout

1. Deploy staging với `SCRAPER_PROVIDER=tiered` và cả ba enabled flags.
2. Chạy security smoke trước company smoke.
3. Chạy FPT/Vingroup/MISA; so sánh provider/duration với local.
4. Chỉ promote khi không có fabricated finding, SSRF regression hoặc source vượt 30 giây.

### Rollback không revert code

| Sự cố | Env action | Chain sau rollback |
|---|---|---|
| Direct gây regression | `SCRAPER_DIRECT_ENABLED=false` | Jina → TinyFish |
| Jina 429 kéo dài | `SCRAPER_JINA_ENABLED=false` | Direct → TinyFish |
| TinyFish outage/cost issue | `SCRAPER_TINYFISH_ENABLED=false` | Direct → Jina |
| Tiered composition lỗi | `SCRAPER_PROVIDER=tinyfish` | TinyFish-only tạm thời |
| VietQR 429/outage | `VIETQR_ENABLED=false` | Existing registry search fallback |
| Demo external providers đều lỗi | `SCRAPER_PROVIDER=mock` | Chỉ dùng cho controlled demo, phải ghi rõ mock |

Không rollback bằng cách bỏ SSRF guard, bật auto-redirect hoặc tắt TLS verification.

---

## Phase 2 — chỉ mở theo evidence

### Gate A — Playwright

Mở khi benchmark tối thiểu 30 target websites cho thấy `direct + Jina` lấy useful content dưới 85%, hoặc một mandatory customer/demo site không đọc được. Tạo ticket riêng; chạy browser trong isolated container/user, bật Chromium sandbox và chặn private network cho mọi subresource.

### Gate B — GDELT

Mở khi Serper news thiếu coverage hoặc chi phí news search trở thành bottleneck có số liệu. GDELT chỉ là `NewsSearchAdapter`, không thành global search provider.

### Gate C — Sitemap/RSS

Mở khi hard-coded subpages bỏ sót official content ở ít nhất 20% benchmark sites. Chỉ follow same-origin URL và vẫn giữ tổng page budget 5.

### Gate D — Persistent VietQR cache

Mở khi cold start/multi-instance làm cache miss gây 429 hoặc có repeated MST volume đo được. Chuyển sang Supabase với unique `tax_id` + `expires_at`; không thêm Redis.

### Gate E — Prompt injection defense-in-depth

Bắt buộc trước public URL input hoặc production launch. Mark scraped content là untrusted data trong system prompt, đặt findings trong delimiter/data blocks và thêm adversarial tests. Không mô tả đây là biện pháp loại bỏ hoàn toàn indirect prompt injection.

---

## Nguồn kỹ thuật

- [Next.js TypeScript/typegen local docs](../../node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Node.js HTTP API](https://nodejs.org/api/http.html)
- [Jina Reader API](https://jina.ai/reader/): Reader endpoint `https://r.jina.ai`; bảng hiện tại ghi 20 RPM không key và 500 RPM với free key. Luôn xử lý 429 thay vì dựa tuyệt đối vào quota.
- [VietQR Business API](https://www.vietqr.io/en/business/%3AtaxCode/): `GET https://api.vietqr.io/v2/business/{taxCode}`, success `code: "00"`, có 429 response.

---

## Thứ tự thực hiện khuyến nghị

Không chạy song song các sprint có chung files. Thực hiện `0 → 1 → 2 → 3 → 4 → 5 → 6`; review diff sau từng sprint. Sprint 2 là security gate: không chuyển sang Sprint 3 nếu còn finding về DNS pinning, redirects, TLS hoặc response bounds. Sprint 6 chỉ ghi “complete” sau khi chạy lại toàn bộ commands trên chính commit cuối.
