# PartnerIQ Research Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm pipeline research đủ an toàn và ổn định cho demo AI Riser mà không xây lại research engine.

**Architecture:** Giữ nguyên `ResearchModule`, `SearchAdapter` và Serper. Thay scraper production hiện tại bằng chuỗi fallback `secure direct fetch -> Jina Reader -> TinyFish`, trong đó mọi tier thất bại phải trả lỗi thật, không tạo evidence giả; MST có adapter VietQR riêng và chỉ dùng khi input có `taxId`.

**Tech Stack:** Next.js 16.3.2, TypeScript 7, Node.js built-ins (`URL`, `node:dns`, `node:http`, `node:https`, `node:net`), Vitest 4, Jina Reader API, TinyFish API, VietQR Business API.

**Spec:** `docs/SPEC.md` — kế hoạch này chỉ thay phần thu thập dữ liệu và resource guards, không đổi profile, analyst, storage hay UI.

## Global Constraints

- Ưu tiên theo thứ tự: security -> demo reliability -> simplicity -> performance.
- Không bypass Cloudflare, DataDome, CAPTCHA hoặc cơ chế anti-bot.
- Giữ Serper; không thêm SearXNG, Common Crawl, Crawlee hoặc query planner.
- Không thêm Cheerio trước demo; tái sử dụng text extraction hiện có và để Jina xử lý trang khó.
- Không thêm Playwright trước demo. Chỉ triển khai sau benchmark nếu coverage chưa đạt ngưỡng ở Phase 2.
- Mọi lỗi scraping phải hiển thị là lỗi/không có finding; tuyệt đối không sinh nội dung doanh nghiệp giả.
- Chỉ cho phép `http:` và `https:`; cấm credentials trong URL và chặn IP loopback/private/link-local/multicast/metadata ở cả IPv4 lẫn IPv6.
- Direct fetch phải pin IP đã kiểm tra, tắt redirect tự động, kiểm tra lại từng redirect, tối đa 3 redirect, 8 giây/tier và 1 MiB response.
- Giới hạn 1 MiB phải được enforce khi stream từng chunk và đóng socket ngay khi vượt ngưỡng; không buffer toàn bộ response rồi mới kiểm tra.
- HTTPS phải giữ hostname gốc cho `Host`, SNI và certificate verification; cấm đặt `rejectUnauthorized: false`.
- Reject response có `Content-Disposition: attachment`, kể cả khi `Content-Type` khai báo là text.
- Dùng API key Jina miễn phí: tài liệu hiện tại ghi 20 RPM khi không có key và 500 RPM với free key.
- Jina trả 429 phải chuyển ngay sang TinyFish với outcome `jina_rate_limited`; không retry cùng tier.
- VietQR chỉ chạy khi có `taxId`; không đoán MST từ tên công ty trong Phase 1.
- Text scrape từ web là untrusted LLM input; structured output chỉ giới hạn schema, không ngăn prompt injection làm sai giá trị trong schema.

---

## Quyết định kỹ thuật

### Làm trước demo

```text
ResearchModule
├── web_search: Serper (giữ nguyên)
├── website/linkedin/registry scrape
│   └── TieredScraperAdapter
│       ├── SafeDirectScraperAdapter
│       ├── JinaReaderScraperAdapter
│       └── TinyFishScraperAdapter
└── registry
    ├── VietQrRegistryAdapter (khi có taxId)
    └── search/snippet fallback hiện tại
```

### Không làm trước demo

- Playwright: cần browser binary và system dependencies; crawl URL không tin cậy còn cần user/sandbox/container riêng.
- Cheerio: dependency mới chưa cần thiết để chứng minh fallback chain hoạt động.
- GDELT, sitemap/RSS discovery và composite search: độc lập với mục tiêu ổn định demo, chuyển sang Phase 2.
- Persistent cache: Phase 1 dùng cache process-local chỉ để giảm request lặp trong cùng warm-instance burst. Trên Vercel/serverless, TTL 7 ngày không phải cache bền vững vì cold start tạo process mới; chuyển sang Supabase tại Gate D.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/adapters/scraper/types.ts` | Modify | Kết quả scrape, metadata provider và lỗi chuẩn hóa |
| `src/adapters/scraper/url-safety.ts` | Create | Parse URL, phân loại IP, resolve và pin IP public |
| `src/adapters/scraper/direct.ts` | Create | HTTP(S) bounded fetch, manual redirect, text extraction |
| `src/adapters/scraper/jina.ts` | Create | Jina Reader API adapter |
| `src/adapters/scraper/tinyfish.ts` | Modify | Chỉ gọi TinyFish; bỏ direct fallback và evidence giả |
| `src/adapters/scraper/tiered.ts` | Create | Chạy fallback chain theo thứ tự và tổng hợp lỗi |
| `src/adapters/scraper/index.ts` | Modify | Export các adapter production mới |
| `src/adapters/registry/types.ts` | Create | Port tối thiểu cho tra cứu MST |
| `src/adapters/registry/vietqr.ts` | Create | VietQR lookup + cache process-local |
| `src/modules/research/sources/registry.ts` | Modify | VietQR trước, search fallback sau |
| `src/modules/research/index.ts` | Modify | Inject registry adapter; không đổi event contract |
| `src/config/index.ts` | Modify | Compose tiered scraper và registry adapter từ env |
| `.env.example` | Modify | Biến môi trường thực sự được dùng |
| `README.md` | Modify | Cấu hình provider và hành vi fallback |
| `tests/unit/scraper-security.test.ts` | Create | SSRF, redirect và response-limit tests |
| `tests/unit/tiered-scraper.test.ts` | Create | Thứ tự fallback, success và aggregate failure |
| `tests/unit/registry-adapter.test.ts` | Create | VietQR mapping, cache và fallback |
| `tests/unit/sources.test.ts` | Modify | Registry source với dependency mới |

---

## Phase 1 — trước demo (ước lượng 2 ngày)

### Task 1: Khóa contract và loại evidence giả

**Files:**

- Modify: `src/adapters/scraper/types.ts`
- Modify: `src/adapters/scraper/tinyfish.ts`
- Create: `tests/unit/tiered-scraper.test.ts`

**Interfaces:**

```ts
export type ScraperProvider = "direct" | "jina" | "tinyfish" | "mock";

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
    readonly code: "blocked" | "timeout" | "invalid_target" | "too_large" | "empty" | "rate_limited" | "upstream_error",
    readonly retryable = false,
  ) {
    super(message);
  }
}
```

- [ ] Viết test chứng minh TinyFish ném `ScrapeError` khi API non-2xx, content rỗng hoặc fetch lỗi.
- [ ] Chạy `npm test -- tests/unit/tiered-scraper.test.ts`; expected: FAIL vì TinyFish còn trả nội dung giả.
- [ ] Xóa direct-fetch fallback và object giả tại cuối `TinyFishScraperAdapter.extract()`.
- [ ] Gắn `metadata.provider = "tinyfish"` cho kết quả hợp lệ.
- [ ] Chạy lại test; expected: PASS.
- [ ] Commit:

```bash
git add src/adapters/scraper/types.ts src/adapters/scraper/tinyfish.ts tests/unit/tiered-scraper.test.ts
git commit -m "fix(scraper): remove fabricated fallback"
```

**Acceptance:** Không đường lỗi nào của production scraper tạo câu “Thông tin doanh nghiệp…” hoặc một finding không có evidence thật.

### Task 2: Xây SSRF guard và direct fetch an toàn

**Files:**

- Create: `src/adapters/scraper/url-safety.ts`
- Create: `src/adapters/scraper/direct.ts`
- Create: `tests/unit/scraper-security.test.ts`

**Interfaces:**

```ts
export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export async function resolvePublicTarget(rawUrl: string): Promise<ResolvedTarget>;
export function isPublicAddress(address: string): boolean;

export class SafeDirectScraperAdapter implements ScraperAdapter {
  constructor(private readonly limits: DirectScraperLimits);
  extract(url: string): Promise<ScrapedContent>;
}
```

```ts
export interface DirectScraperLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
}
```

- [ ] Viết bảng test cho `file:`, `ftp:`, URL có `user:pass@host`, `localhost`, IPv4 private/link-local/multicast, IPv6 loopback/link-local/ULA và IPv4-mapped IPv6.
- [ ] Khóa hành vi WHATWG URL canonicalization bằng test cho `http://2130706433/`, `http://0177.0.0.1/`, `http://0x7f000001/` và `http://[::ffff:127.0.0.1]/`; tất cả phải resolve thành địa chỉ không public và bị reject.
- [ ] Viết test DNS trả nhiều A/AAAA records, chỉ cần một địa chỉ private là reject toàn bộ hostname.
- [ ] Viết test redirect từ public URL sang private URL bị reject trước request kế tiếp.
- [ ] Viết test response chunked không có `Content-Length`: khi tổng chunk đạt `maxResponseBytes + 1`, adapter phải destroy response/request ngay, không nhận chunk tiếp theo và không tạo full-body buffer.
- [ ] Viết test `Content-Length` đã vượt 1 MiB bị reject trước khi đọc body; vẫn giữ streaming counter vì header có thể thiếu hoặc sai.
- [ ] Viết test timeout, redirect thứ 4, content-type ngoài `text/html`/`text/plain` và `Content-Disposition: attachment` đều fail closed.
- [ ] Viết test HTTPS request giữ hostname gốc trong request options, custom `lookup` trả pinned IP, `servername` vẫn là hostname gốc và `rejectUnauthorized` không được đặt thành `false`.
- [ ] Chạy `npm test -- tests/unit/scraper-security.test.ts`; expected: FAIL vì module chưa tồn tại.
- [ ] Implement bằng Node built-ins; gọi `http.request`/`https.request` với URL/hostname gốc và custom `lookup` trả đúng IP đã validate để tránh DNS TOCTOU. Không thay `hostname` bằng IP và không tắt TLS certificate verification.
- [ ] Trước khi buffer text, cộng `Buffer.byteLength(chunk)` theo từng `data` event; vượt limit thì gọi `res.destroy(scrapeError)` và `req.destroy(scrapeError)` ngay.
- [ ] Đặt `redirect: manual` theo hành vi tương đương: tự đọc `Location`, resolve URL mới, validate rồi mới gọi tiếp.
- [ ] Reject header `Content-Disposition` có disposition type `attachment` trước khi đọc body.
- [ ] Di chuyển text cleanup hiện có từ `tinyfish.ts` sang `direct.ts`; không thêm HTML parser trong Phase 1.
- [ ] Chạy lại test; expected: PASS.
- [ ] Commit:

```bash
git add src/adapters/scraper/url-safety.ts src/adapters/scraper/direct.ts tests/unit/scraper-security.test.ts
git commit -m "feat(scraper): add SSRF-safe direct fetch"
```

**Acceptance:** Không request nào được mở trước khi URL và toàn bộ DNS answers được xác nhận public; connection dùng IP đã xác nhận nhưng vẫn verify TLS theo hostname gốc; body bị cắt tại byte thứ `maxResponseBytes + 1` mà không buffer phần còn lại.

### Task 3: Thêm Jina và tiered fallback

**Files:**

- Create: `src/adapters/scraper/jina.ts`
- Create: `src/adapters/scraper/tiered.ts`
- Modify: `src/adapters/scraper/index.ts`
- Modify: `tests/unit/tiered-scraper.test.ts`

**Interfaces:**

```ts
export class JinaReaderScraperAdapter implements ScraperAdapter {
  constructor(private readonly apiKey: string, private readonly timeoutMs = 8_000);
  extract(url: string): Promise<ScrapedContent>;
}

export class TieredScraperAdapter implements ScraperAdapter {
  constructor(private readonly tiers: readonly ScraperAdapter[]);
  extract(url: string): Promise<ScrapedContent>;
}
```

- [ ] Viết test tier 1 success thì tier 2/3 không được gọi.
- [ ] Viết test direct `blocked`/`empty` thì Jina được gọi; Jina fail thì TinyFish được gọi.
- [ ] Viết test cả ba fail thì throw một `ScrapeError` chứa code/provider của từng tier, không trả empty object.
- [ ] Viết test Jina gửi `Authorization: Bearer <key>`, abort ở 8 giây và reject response quá ngắn.
- [ ] Viết test Jina trả 429 tạo `ScrapeError` với provider `jina`, code `rate_limited`, `retryable = false`; tiered adapter gọi TinyFish đúng một lần và không gọi lại Jina.
- [ ] Chạy test; expected: FAIL.
- [ ] Implement adapter theo đúng thứ tự `direct -> jina -> tinyfish`; map Jina 429 thành outcome log `jina_rate_limited` rồi chuyển tier ngay, không retry cùng tier.
- [ ] Chạy lại test; expected: PASS.
- [ ] Commit:

```bash
git add src/adapters/scraper/jina.ts src/adapters/scraper/tiered.ts src/adapters/scraper/index.ts tests/unit/tiered-scraper.test.ts
git commit -m "feat(scraper): add tiered fallback"
```

**Acceptance:** Một URL chỉ chuyển tier khi tier trước fail; provider thành công được lưu trong metadata để quan sát demo.

### Task 4: Wire production config và page budget

**Files:**

- Modify: `src/config/index.ts`
- Modify: `src/modules/research/index.ts`
- Modify: `src/modules/research/sources/website.ts`
- Modify: `.env.example`
- Modify: `tests/unit/sources.test.ts`
- Modify: `tests/integration/research-module.test.ts`

**Configuration:**

```dotenv
SCRAPER_PROVIDER=tiered
JINA_API_KEY=
TINYFISH_API_KEY=
SCRAPER_TIMEOUT_MS=8000
SCRAPER_MAX_RESPONSE_BYTES=1048576
SCRAPER_MAX_REDIRECTS=3
MAX_SCRAPE_PAGES_PER_RESEARCH=5
```

- [ ] Viết test `createScraperAdapter()` compose đúng ba tier khi provider là `tiered`.
- [ ] Viết test website source không scrape quá `maxScrapePagesPerResearch`, tính cả homepage.
- [ ] Chạy targeted tests; expected: FAIL.
- [ ] Tạo `TieredScraperAdapter` trong factory; thiếu Jina/TinyFish key thì bỏ đúng remote tier, không crash startup.
- [ ] Truyền page budget từ `ResourceGuards` vào website source và dừng loop khi hết budget.
- [ ] Đọc `MAX_SCRAPE_PAGES_PER_RESEARCH` từ env thay vì hard-code.
- [ ] Chạy targeted tests; expected: PASS.
- [ ] Commit:

```bash
git add src/config/index.ts src/modules/research/index.ts src/modules/research/sources/website.ts .env.example tests/unit/sources.test.ts tests/integration/research-module.test.ts
git commit -m "feat(config): wire tiered scraper limits"
```

**Acceptance:** Cấu hình mặc định demo không yêu cầu Playwright; page budget hiện có thực sự được enforce.

### Task 5: Tách MST thành adapter VietQR

**Files:**

- Create: `src/adapters/registry/types.ts`
- Create: `src/adapters/registry/vietqr.ts`
- Create: `src/adapters/registry/index.ts`
- Modify: `src/modules/research/sources/registry.ts`
- Modify: `src/modules/research/index.ts`
- Modify: `src/config/index.ts`
- Create: `tests/unit/registry-adapter.test.ts`
- Modify: `tests/unit/sources.test.ts`

**Interfaces:**

```ts
export interface RegistryRecord {
  taxId: string;
  name: string;
  internationalName?: string;
  shortName?: string;
  address?: string;
}

export interface RegistryAdapter {
  findByTaxId(taxId: string): Promise<RegistryRecord | null>;
}
```

- [ ] Viết test map response `GET https://api.vietqr.io/v2/business/{taxId}` vào `RegistryRecord`.
- [ ] Viết test code khác `00`, 404, 429, timeout và malformed JSON trả lỗi typed; source được phép fallback sang Serper.
- [ ] Viết test cùng MST gọi hai lần trên cùng process/warm instance chỉ hit API một lần trong TTL 7 ngày.
- [ ] Viết test input không có `taxId` không gọi VietQR và giữ fallback hiện tại.
- [ ] Chạy tests; expected: FAIL.
- [ ] Implement `VietQrRegistryAdapter` bằng `fetch`, cache `Map<string, { expiresAt; value }>` và timeout 5 giây. Thêm comment `ponytail: process-local cache only helps warm-instance bursts; move to Supabase at Gate D for cross-instance caching` ngay trên cache.
- [ ] Đổi `fetchRegistryData` thành `VietQR -> current aggregator/search fallback`; giữ confidence/citation rõ nguồn và log một structured event `registry_fallback` với reason khi VietQR không trả record dùng được.
- [ ] Chạy tests; expected: PASS.
- [ ] Commit:

```bash
git add src/adapters/registry src/modules/research/sources/registry.ts src/modules/research/index.ts src/config/index.ts tests/unit/registry-adapter.test.ts tests/unit/sources.test.ts
git commit -m "feat(registry): add VietQR tax lookup"
```

**Acceptance:** Có MST thì ưu tiên record có cấu trúc từ VietQR; VietQR hỏng không làm fail toàn research source; cache TTL chỉ được cam kết trong vòng đời warm instance.

### Task 6: Verify demo và cập nhật tài liệu

**Files:**

- Modify: `README.md`
- Modify: `docs/DEMO_SCRIPT.md`
- Modify: `docs/TASK.md`

- [ ] Chạy `npm test`; expected: toàn bộ suite PASS.
- [ ] Chạy `npx tsc --noEmit`; expected: 0 errors.
- [ ] Chạy `npm run lint`; expected: 0 errors.
- [ ] Chạy `npm run build`; expected: production build thành công.
- [ ] Smoke-test FPT, Vingroup và MISA; với từng công ty ghi URL, provider thắng (`direct`, `jina` hoặc `tinyfish`), duration và outcome vào `docs/DEMO_SCRIPT.md`.
- [ ] Chạy thêm một URL bị chặn để xác nhận không tier nào tạo finding; ghi outcome `blocked` riêng, không tính nó là một trong ba company cases.
- [ ] Chạy một HTTPS smoke test tới site có certificate hợp lệ; request phải thành công qua pinned IP mà không tắt certificate verification.
- [ ] Xác nhận URL `http://127.0.0.1`, `http://169.254.169.254`, `http://[::1]` không tạo outbound request và UI nhận error event thay vì evidence giả.
- [ ] Cập nhật README chỉ với env/provider đã triển khai; không ghi `jina` như provider độc lập nếu factory không hỗ trợ.
- [ ] Commit:

```bash
git add README.md docs/DEMO_SCRIPT.md docs/TASK.md
git commit -m "docs: add reliable research demo flow"
```

**Phase 1 exit criteria:**

- Security tests chặn đủ IPv4/IPv6 special ranges và redirect-to-private.
- 100% suite, typecheck, lint và build pass.
- Không còn fabricated evidence.
- Ba demo cases hoàn thành trong giới hạn 60–90 giây toàn pipeline.
- TinyFish chỉ xuất hiện khi direct và Jina đều fail.
- `docs/DEMO_SCRIPT.md` ghi rõ provider thắng và duration cho FPT, Vingroup, MISA.

---

## Phase 2 — sau demo, triển khai theo evidence

Phase 2 không bắt đầu theo lịch cố định. Mỗi workstream chỉ mở khi gate tương ứng đạt.

### Gate A: Có cần Playwright không?

**Mở khi:** benchmark tối thiểu 30 website mục tiêu cho thấy `direct + Jina` lấy được nội dung hữu ích dưới 85%, hoặc ít nhất một website bắt buộc của khách hàng/demo không thể đọc.

**Nếu mở:** tạo plan riêng cho `PlaywrightScraperAdapter`; chạy browser trong container/user riêng, bật Chromium sandbox, block service workers, intercept mọi request/subresource và chặn private network. Không nhúng Chromium trực tiếp vào Next.js runtime hiện tại.

### Gate B: Có cần GDELT không?

**Mở khi:** Serper news thiếu coverage hoặc chi phí news search trở thành vấn đề qua benchmark.

**Scope:** tạo `NewsSearchAdapter` riêng với hai implementation `SerperNewsSearchAdapter` và `GdeltNewsSearchAdapter`; dedupe theo canonical URL trong `searchNews`. Không biến GDELT thành search toàn cục vì nó chỉ phù hợp source `news`.

### Gate C: Có cần sitemap/RSS discovery không?

**Mở khi:** hard-coded subpages trong `website.ts` bỏ sót nội dung official ở ít nhất 20% benchmark sites.

**Scope:** đọc `/robots.txt`, sitemap được khai báo và `/sitemap.xml`; chỉ chọn URL cùng origin, giới hạn 5 pages/research, ưu tiên about/products/news. RSS chỉ dùng cho official company updates.

### Gate D: Có cần persistent cache không?

**Mở khi:** deploy nhiều instance, cache miss sau cold start gây 429, hoặc cùng MST được tra cứu lặp lại đủ nhiều để đo được chi phí.

**Scope:** chuyển cache VietQR sang Supabase với unique key `tax_id` và `expires_at`; không thêm Redis.

### Gate E: Giảm prompt injection từ scraped text

**Mở khi:** bắt buộc trước khi cho người dùng công khai nhập URL tùy ý hoặc trước production launch; không đợi xảy ra incident.

**Scope:** cập nhật system prompt của `ProfileModule` để tuyên bố rõ scraped content là dữ liệu không tin cậy, không phải hướng dẫn; đặt từng finding trong delimiter/data block; thêm adversarial test có câu “ignore previous instructions” và xác nhận model không coi câu đó là fact. Đây là defense-in-depth, không được mô tả là loại bỏ hoàn toàn indirect prompt injection.

---

## Rollout và rollback

- Deploy với `SCRAPER_PROVIDER=tiered`; giữ `tinyfish` và `mock` để rollback bằng env.
- Log tối thiểu: provider, duration, outcome code, hostname; không log API key, raw query string hoặc full response body.
- Nếu direct tier gây lỗi production, tắt bằng composition config và chạy `Jina -> TinyFish`; không revert SSRF guard.
- Nếu Jina trả 429, log `jina_rate_limited` và chuyển TinyFish ngay; nếu 429 kéo dài thì tắt tier Jina bằng composition config, không retry loop và không đẩy TinyFish lên đầu mặc định.
- Nếu VietQR 429, dùng cache hit hoặc search fallback; registry source không được làm fail toàn pipeline.

## Nguồn kỹ thuật đã kiểm chứng

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): kiểm tra toàn bộ A/AAAA, private/link-local và không tự động follow redirect.
- [Node.js HTTP API](https://nodejs.org/api/http.html): `http.request` hỗ trợ custom `lookup` để pin IP đã validate.
- [Jina Reader API](https://jina.ai/reader/): 20 RPM không key, 500 RPM với free API key.
- [VietQR Business API](https://www.vietqr.io/en/business/%3AtaxCode/): endpoint `GET /v2/business/{taxCode}` và response schema.
- [Playwright Docker guide](https://playwright.dev/docs/docker): browser/system dependencies và yêu cầu sandbox riêng khi crawl website không tin cậy.
- [GDELT DOC 2.0 API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/): nguồn news JSON đa ngôn ngữ để đánh giá ở Phase 2.
