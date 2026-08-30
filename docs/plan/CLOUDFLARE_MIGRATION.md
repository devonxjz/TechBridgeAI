# Kế hoạch migration Cloudflare Workers theo hướng Gateway-first

## 1. Kiến trúc mục tiêu

Giữ **Next.js + research workflow + scraper** trên Node.js/Cloud Run. Cloudflare Worker chỉ làm:

- Supabase Auth
- Xác định tenant
- Quota admission qua Supabase RPC
- Ký internal request
- Proxy SSE đến Node origin

```text
Browser
  ├── UI → Next.js/Cloud Run
  └── POST /api/research
          ↓
     Cloudflare Worker
       1. Verify Supabase JWT
       2. Resolve tenant
       3. Reserve quota bằng Supabase RPC
       4. Ký internal request
       5. Proxy SSE
          ↓
     Next.js Node origin
       6. Verify gateway signature
       7. Chạy research workflow
       8. Stream SSE về browser
```

`Dockerfile` vẫn được giữ làm artifact triển khai Node origin. Không dùng nó để deploy Worker.

## 2. Tiêu chí hoàn thành

1. Thiếu hoặc sai Supabase JWT trả `401`.
2. `tenant_id` không bao giờ được tin từ body/header do client gửi.
3. Quota được trừ atomically trước khi gọi origin.
4. Hết quota trả `429`; Node origin không được gọi.
5. Request retry không bị trừ quota hai lần.
6. Node origin từ chối request trực tiếp không có gateway signature.
7. SSE được stream xuyên qua Worker, không bị buffer toàn bộ.
8. Tenant A không thể đọc, select, refresh hoặc ghi cache tenant B.
9. Có staging/production, CI dry-run, smoke test và rollback.

---

## 3. Phase 0 — Baseline và contract tests

Trước khi sửa:

- Chạy:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
- Ghi nhận các lỗi có sẵn.
- Không reset các thay đổi đang tồn tại trong working tree.
- Viết contract tests cho:
  - API `/api/research`
  - SSE event sequence
  - Cache hit/miss/select/refresh/bypass
  - Public errors
  - Abort và client disconnect
  - Admission/quota hiện có

Định nghĩa internal contract giữa Worker và Node origin:

```text
x-internal-tenant-id
x-internal-user-id
x-internal-request-id
x-internal-timestamp
x-internal-signature
```

**Gate:** baseline rõ ràng và contract tests chạy được trước refactor.

---

## 4. Phase 1 — Tách research handler khỏi Next.js route

Hiện tại `src/app/api/research/route.ts` chứa cả:

- HTTP parsing
- Cache resolution
- Workflow orchestration
- SSE lifecycle
- Observability
- Persistence

Cần tách thành:

```text
Next.js route adapter
    ↓
Framework-neutral research handler
    ↓
Research services/workflow
```

Next.js route vẫn giữ:

```ts
export const runtime = "nodejs";
```

Không refactor scraper trong phase này.

### TDD

- Test handler bằng Web `Request`/`Response`.
- Test route adapter giữ nguyên contract cũ.
- So sánh SSE events trước và sau refactor.

**Gate:** route Next.js trở thành adapter mỏng, toàn bộ contract cũ vẫn pass.

---

## 5. Phase 2 — Supabase Auth và tenant identity

### Nguồn `tenant_id`

Ưu tiên theo thứ tự:

1. Custom JWT claim do backend quản lý.
2. Nếu một user có nhiều tenant: JWT chứa user identity, Worker lookup membership.
3. Không nhận `tenant_id` trực tiếp từ client như nguồn chân lý.

Worker phải verify:

- Chữ ký JWT qua Supabase JWKS
- `iss`
- `aud`
- `exp`
- User status
- Tenant membership

JWKS có thể cache theo TTL, nhưng verification phải fail closed.

### Signed gateway context

Sau khi verify, Worker tạo signed context:

```text
tenantId
userId
requestId
timestamp
HTTP method
pathname
body digest
```

Worker phải xóa mọi `x-internal-*` do browser gửi trước khi tạo header mới.

Node origin verify:

- HMAC signature
- Timestamp/replay window
- Method/path/body digest
- Key ID khi hỗ trợ rotation

### TDD

- Token hết hạn
- Sai issuer/audience
- Sai signature
- Thiếu tenant
- User không thuộc tenant
- Forged tenant header
- Signature bị sửa
- Signature quá cũ
- Request body bị sửa sau khi ký

**Gate:** research workflow không thể bắt đầu nếu identity chưa hợp lệ.

---

## 6. Phase 3 — Tenant-isolated cache

Audit toàn bộ storage/cache API hiện tại và thêm `tenantId` vào mọi operation:

```ts
lookup(tenantId, input)
select(tenantId, input, companyId)
prepareRefresh(tenantId, input, companyId)
resolveMiss(tenantId, input)
persist(tenantId, identity, snapshot)
```

### Supabase schema

Các bảng cache cần có `tenant_id` và index/constraint theo tenant, ví dụ về mặt logic:

```sql
unique (tenant_id, company_id, version)
unique (tenant_id, normalized_tax_id)
```

Không được tạo tenant mặc định âm thầm cho dữ liệu cũ. Migration phải:

- Backfill bằng mapping xác định được; hoặc
- Đánh dấu dữ liệu legacy cần xử lý; hoặc
- Từ chối migration nếu không xác định được tenant.

### RLS

Ưu tiên RLS nếu request sử dụng user JWT.

Nếu Node origin dùng service-role key:

- RLS có thể bị bypass.
- Application-level tenant filter trở thành bắt buộc.
- Supabase RPC phải yêu cầu tenant context đã ký/xác thực.
- Integration test phải chứng minh không có cross-tenant access.

### TDD

- Hai tenant dùng cùng một tax ID vẫn có cache độc lập.
- Tenant A không select company của tenant B.
- Tenant A không refresh snapshot tenant B.
- Persist đồng thời không ghi nhầm tenant.
- RPC không trả dữ liệu nếu tenant không khớp.

**Gate:** Supabase integration tests chứng minh không có cross-tenant read/write.

---

## 7. Phase 4 — Quota atomic qua Supabase RPC

Tạo một RPC duy nhất, ví dụ:

```text
reserve_research_quota(
  tenant_id,
  user_id,
  operation,
  idempotency_key,
  cost
)
```

Kết quả:

```json
{
  "allowed": true,
  "reservation_id": "...",
  "remaining": 17,
  "reset_at": "..."
}
```

### Yêu cầu

- Transaction atomic.
- Lock/counter update an toàn khi concurrent.
- `idempotency_key` unique trong tenant.
- Retry cùng request không trừ quota lần hai.
- Quota backend lỗi thì trả `503`, không gọi origin.
- Hết quota trả `429`.

Nếu business rule yêu cầu hoàn quota khi workflow thất bại, bổ sung:

```text
release_research_quota(reservation_id)
```

Không tự động hoàn quota nếu chưa chốt business rule, vì client có thể cố ý ngắt stream sau khi công việc tốn phí đã chạy.

### TDD

- Burst concurrent
- Duplicate request
- Exhausted quota
- RPC timeout/unavailable
- Worker retry
- Duplicate release
- Không gọi origin khi admission thất bại

**Gate:** DB concurrency tests pass và origin spy xác nhận không có call khi quota bị từ chối.

---

## 8. Phase 5 — Xây Worker gateway

Tạo Worker entrypoint độc lập. Worker không được import dependency graph của Next.js Node.

### Cấu hình

Thêm `wrangler.jsonc`:

- Compatibility date hiện hành
- `staging` và `production`
- Non-secret variables
- Observability
- Origin URL theo environment

Secrets không commit:

- Supabase configuration nhạy cảm nếu có
- Internal gateway signing keys
- Các key phục vụ server-to-server

Sau khi cấu hình ổn định:

```bash
wrangler types
```

Không viết tay interface `Env`.

### Request pipeline

```text
1. Validate route/method
2. Validate content type và body size
3. Verify Supabase token
4. Resolve tenant
5. Reserve quota
6. Generate signed internal headers
7. Fetch Node origin
8. Return origin Response.body trực tiếp
```

### SSE

Worker phải stream:

```ts
return new Response(originResponse.body, {
  status: originResponse.status,
  headers: filteredHeaders,
});
```

Không dùng:

```ts
await originResponse.text();
```

Các yêu cầu khác:

- Forward cancellation signal.
- Không lưu request-scoped state trong module globals.
- Không để floating promise.
- Redact token và secrets khỏi logs.
- Log JSON với `requestId`, outcome auth/quota/origin.
- Không cache SSE response.

### TDD

- Auth success/failure
- Quota success/failure
- Header sanitization
- Signed context
- SSE chunk được nhận dần, không buffer
- Client cancellation abort origin fetch
- Origin timeout và 5xx
- Supabase timeout

**Gate:**

```bash
wrangler types --check
npm test
wrangler deploy --dry-run
wrangler check startup
```

---

## 9. Phase 6 — Khóa Node origin

Node endpoint `/api/research` phải verify internal signature trước khi:

- Resolve cache
- Gọi Supabase
- Khởi tạo LLM/search/scraper
- Chạy workflow

Direct public request không có chữ ký trả `401` hoặc `403`.

### Key rotation

Hỗ trợ ngắn hạn hai key:

```text
GATEWAY_SIGNING_KEY_CURRENT
GATEWAY_SIGNING_KEY_PREVIOUS
```

Worker ký bằng current key. Origin chấp nhận current và previous trong cửa sổ rotation.

### Network security

Nếu Cloud Run cho phép:

- Hạn chế ingress phù hợp.
- Không coi network restriction là thay thế cho chữ ký.
- Không để origin URL trở thành cơ chế bảo mật duy nhất.

**Gate:** direct request vào Node research endpoint bị từ chối, request qua Worker hoạt động.

---

## 10. Phase 7 — CI/CD và rollout

### Pull request CI

Chạy:

1. Node unit/integration tests
2. Worker runtime tests
3. Typecheck
4. Lint
5. Next.js build
6. Generated Worker binding check
7. Wrangler dry-run
8. Supabase migration validation

### Staging

Worker staging trỏ tới:

- Node staging origin
- Supabase staging
- Staging signing keys

Smoke tests:

- JWT hợp lệ/không hợp lệ
- Quota allow/deny
- Cache tenant isolation
- SSE streaming
- Client cancellation
- Origin unavailable

### Production rollout

1. Deploy origin có signature verification ở chế độ dual-accept/observe.
2. Deploy Worker nhưng chưa gắn production route.
3. Test qua preview URL.
4. Route traffic nội bộ/canary.
5. Theo dõi:
   - `401`, `403`, `429`, `5xx`
   - Supabase RPC latency
   - Origin handshake latency
   - SSE completion/cancellation
   - Quota duplicate rate
6. Tăng traffic dần.
7. Chuyển origin sang signed-only.

### Rollback

- Rollback Worker version hoặc route.
- Tạm thời dùng cửa sổ dual-accept tại origin.
- Không rollback migration tenant nếu hệ thống đã ghi dữ liệu theo schema mới.
- Giữ khả năng disable quota enforcement bằng cấu hình chỉ trong rollout window, không giữ vĩnh viễn.

---

## 11. Phase 8 — Native Workers là project riêng

Sau khi gateway ổn định mới đánh giá chuyển toàn bộ workload sang Workers.

Các blocker phải xử lý:

- Thay `node:http`, `node:https`, `node:dns` trong scraper.
- Thiết kế lại SSRF/DNS rebinding protection cho Workers.
- Kiểm tra OpenAI SDK hoặc chuyển sang REST bằng `fetch`.
- Kiểm tra Supabase SDK bundle/runtime.
- Thay OpenTelemetry Node và Langfuse lifecycle.
- Đưa job dài sang Cloudflare Workflows/Queues nếu phù hợp.
- Đánh giá OpenNext cho UI.
- Benchmark CPU, memory, subrequests và streaming duration.

`nodejs_compat` có thể hỗ trợ một số thư viện, nhưng không được xem là cách giữ nguyên toàn bộ kiến trúc Node hiện tại.

---

## 12. Thứ tự thay đổi dự kiến

### Tạo mới

- Worker entrypoint
- `wrangler.jsonc`
- Generated Worker environment types
- Supabase JWT verification module
- Internal signing module
- Worker tests
- Supabase quota migration/RPC

### Sửa

- `src/app/api/research/route.ts`
- Storage/cache interfaces
- `src/adapters/storage/supabase.ts`
- Supabase schema và migrations
- `.env.example`
- CI/release workflows
- Deployment documentation

### Giữ lại

- `Dockerfile` cho Node origin
- Node-only scraper trong gateway-first phase
- `runtime = "nodejs"` cho research route tại origin

---

## 13. Ước lượng

| Nhóm công việc | Ước lượng |
|---|---:|
| Baseline và handler extraction | 1–2 ngày |
| Supabase Auth và signed context | 1–2 ngày |
| Tenant-isolated cache | 1–2 ngày |
| Atomic quota RPC | 1–2 ngày |
| Worker gateway và tests | 2–3 ngày |
| Origin lockdown, CI/CD, staging | 1–3 ngày |
| **Tổng gateway-first** | **7–14 ngày** |

Native Workers là migration riêng, không nên gộp vào delivery này.

## 14. Ba thông tin cần khóa trước implementation

1. URL Node origin cho staging và production.
2. `tenant_id` sẽ nằm trong Supabase JWT custom claim hay được resolve từ bảng membership.
3. Quota có được hoàn khi workflow thất bại/client ngắt stream hay không.

Khuyến nghị cho mục 3: **không hoàn quota sau khi origin đã bắt đầu tác vụ tính phí**; chỉ hoàn nếu lỗi xảy ra trước lần gọi provider đầu tiên.