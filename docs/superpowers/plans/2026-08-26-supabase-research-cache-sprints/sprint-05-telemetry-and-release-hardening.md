# Sprint 05 — Telemetry and Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cache outcomes observable without leaking identifiers, close the
remaining negative-path coverage, verify database permissions/concurrency, and
prepare the complete feature for release.

**Architecture:** Extend the existing Langfuse wrapper with one cache-outcome
metadata function and one HMAC fingerprint helper. Keep route/storage behavior
unchanged except for telemetry calls; finish with security, database, UI, and
full repository verification.

**Tech Stack:** Node.js `crypto`, Langfuse JS/TS 5.10.1,
`@langfuse/tracing` 5.10.1, Vitest 4.1.11, Supabase CLI 2.115.0,
Next.js 16.3.2.

**Spec:** `docs/superpowers/specs/2026-08-26-supabase-research-cache-design.md`

## Global Constraints

- Use HMAC-SHA256 with a dedicated server secret; plain SHA-256 is forbidden
  for low-entropy tax IDs.
- Never log raw tax IDs, domains, credentials, or request bodies.
- Missing HMAC secret omits the fingerprint and does not fail research.
- Reuse Langfuse; do not add a logger, metrics SDK, or telemetry dependency.
- Cache telemetry must also exist for hits/suggestions that never create paid
  providers.
- Do not change cache lookup/persistence semantics while adding telemetry.
- Verify anon/authenticated cannot call cache RPCs or access cache tables.
- Refresh rate limiting remains explicitly deferred.
- Stage only files named by each task.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `.env.example` | Modify | Dedicated HMAC secret documentation |
| `src/observability/langfuse.ts` | Modify | HMAC fingerprint and cache outcome metadata |
| `src/app/api/research/route.ts` | Modify | Record lookup outcomes across every route branch |
| `tests/unit/langfuse-observability.test.ts` | Modify | Fingerprint and cache metadata tests |
| `tests/unit/research-cache-route.test.ts` | Modify | Final negative-path and telemetry matrix |
| `tests/integration/supabase-cache-concurrency.test.ts` | Modify | Data API grants/RLS and rollback verification |
| `README.md` | Modify | Cache behavior, configuration, and operational caveats |
| `docs/superpowers/specs/2026-08-26-supabase-research-cache-design.md` | Read only | Acceptance checklist source |

### Task 1: Add non-reversible cache-key fingerprints

**Files:**

- Modify: `.env.example`
- Modify: `src/observability/langfuse.ts`
- Modify: `tests/unit/langfuse-observability.test.ts`

**Interfaces:**

```ts
export function fingerprintCacheKey(
  keyType: "tax_id" | "domain",
  value: string,
  secret?: string,
): string | undefined;

export interface ResearchCacheTelemetry {
  cacheOutcome:
    | "hit"
    | "miss"
    | "suggestions"
    | "refresh"
    | "bypass"
    | "conflict"
    | "invalid";
  matchedBy?: "tax_id" | "domain" | "normalized_name" | "selected";
  companyId?: string;
  version?: number;
  lastSyncedAt?: string;
  lookupDurationMs: number;
  conflictingCompanyIds?: string[];
  keyType?: "tax_id" | "domain";
  keyFingerprint?: string;
}

export function updateResearchCacheOutcome(
  telemetry: ResearchCacheTelemetry,
): void;
```

- [ ] **Step 1: Write failing HMAC tests**

```ts
it("fingerprints low-entropy tax IDs with a keyed HMAC", () => {
  const first = fingerprintCacheKey("tax_id", "0101248141", "secret-a");
  const second = fingerprintCacheKey("tax_id", "0101248141", "secret-b");

  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(first).not.toContain("0101248141");
  expect(second).not.toBe(first);
  expect(fingerprintCacheKey("tax_id", "0101248141", undefined)).toBeUndefined();
});

it("separates key types in the authenticated message", () => {
  expect(fingerprintCacheKey("tax_id", "example.vn", "secret"))
    .not.toBe(fingerprintCacheKey("domain", "example.vn", "secret"));
});
```

- [ ] **Step 2: Run and verify the helper is missing**

Run: `npm test -- tests/unit/langfuse-observability.test.ts`

Expected: FAIL because `fingerprintCacheKey` is not exported.

- [ ] **Step 3: Implement HMAC with Node's standard library**

```ts
import { createHmac } from "node:crypto";

export function fingerprintCacheKey(
  keyType: "tax_id" | "domain",
  value: string,
  secret = process.env.CACHE_TELEMETRY_HMAC_SECRET,
): string | undefined {
  if (!secret) return undefined;
  return createHmac("sha256", secret)
    .update(`${keyType}\0${value}`)
    .digest("hex");
}
```

Document in `.env.example`:

```dotenv
# Server-only HMAC secret for cache-key telemetry fingerprints
CACHE_TELEMETRY_HMAC_SECRET=replace-with-random-server-secret
```

Do not prefix it with `NEXT_PUBLIC_` and do not reuse a Supabase/Langfuse key.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npm test -- tests/unit/langfuse-observability.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the fingerprint helper**

```bash
git add .env.example src/observability/langfuse.ts tests/unit/langfuse-observability.test.ts
git commit -m "feat(observability): protect cache identifiers"
```

### Task 2: Record every cache outcome in the existing trace

**Files:**

- Modify: `src/observability/langfuse.ts`
- Modify: `src/app/api/research/route.ts`
- Modify: `tests/unit/langfuse-observability.test.ts`
- Modify: `tests/unit/research-cache-route.test.ts`

**Interfaces:** `updateResearchCacheOutcome(telemetry)` updates active Langfuse
observation metadata and is a no-op when Langfuse is disabled.

- [ ] **Step 1: Write failing metadata tests**

Mock `updateActiveObservation` and assert:

```ts
updateResearchCacheOutcome({
  cacheOutcome: "hit",
  matchedBy: "tax_id",
  companyId: "company-a",
  version: 3,
  lastSyncedAt: "2026-08-26T08:00:00.000Z",
  lookupDurationMs: 12,
});

expect(updateActiveObservation).toHaveBeenCalledWith({
  metadata: expect.objectContaining({
    cacheOutcome: "hit",
    matchedBy: "tax_id",
    companyId: "company-a",
    cacheVersion: 3,
    cacheLookupDurationMs: 12,
  }),
});
```

Add a conflict test proving metadata contains only company IDs, key type, and
HMAC fingerprint—not the raw key.

- [ ] **Step 2: Implement metadata-only updates**

Call:

```ts
updateActiveObservation({
  metadata: {
    cacheOutcome: telemetry.cacheOutcome,
    matchedBy: telemetry.matchedBy,
    companyId: telemetry.companyId,
    cacheVersion: telemetry.version,
    cacheLastSyncedAt: telemetry.lastSyncedAt,
    cacheLookupDurationMs: telemetry.lookupDurationMs,
    conflictingCompanyIds: telemetry.conflictingCompanyIds,
    cacheKeyType: telemetry.keyType,
    cacheKeyFingerprint: telemetry.keyFingerprint,
  },
});
```

Reuse the existing Langfuse enabled check. Do not put cache metadata into
`output`, because workflow outcome updates already own that field.

- [ ] **Step 3: Start the trace before cache lookup and instrument branches**

Allow `ResearchTraceContext.companyId` to be optional at trace start. Wrap cache
lookup in the existing `traceResearch` scope, measure duration with
`performance.now()`, then call `updateResearchCacheOutcome` for hit, miss,
suggestions, select, refresh, bypass, conflict, and corrupt-cache recovery.

Create LangChain/LangGraph callbacks only in the miss/refresh pipeline branch
after the company ID is resolved. A hit still gets one research trace without
provider spans.

- [ ] **Step 4: Add route telemetry assertions**

For hit, suggestions, miss, refresh, conflict, and invalid cache, assert exactly
one call containing the expected `cacheOutcome`. For a conflict, assert the
mock received an HMAC fingerprint and never received the raw test tax ID/domain.

- [ ] **Step 5: Run observability/route suites**

Run:

```bash
npm test -- tests/unit/langfuse-observability.test.ts \
  tests/unit/research-cache-route.test.ts \
  tests/unit/research-route-observability.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit cache telemetry**

```bash
git add src/observability/langfuse.ts src/app/api/research/route.ts \
  tests/unit/langfuse-observability.test.ts tests/unit/research-cache-route.test.ts
git commit -m "feat(observability): trace cache outcomes"
```

### Task 3: Close the security/error regression matrix

**Files:**

- Modify: `tests/unit/research-cache-route.test.ts`
- Modify: `tests/integration/supabase-cache-concurrency.test.ts`

**Interfaces:** No production interface change; this task proves approved
negative-path contracts.

- [ ] **Step 1: Verify route tests contain all named regressions**

Add any missing test so the suite explicitly contains these behaviors:

1. `503 cache_unavailable` and zero paid-provider factory calls.
2. Corrupt JSONB emits `cache_invalid`, then runs/persists fresh research.
3. `select` rejects an existing unrelated company ID.
4. `refresh` rejects an existing unrelated company ID.
5. Pre-stream strong-key conflict returns `409`.
6. Post-pipeline conflict emits `error(identity_conflict)` then `done`, with no
   final profile/diff/analysis events.
7. Persistence failure emits `error(persist_failed)` then `done`, with no final
   profile/diff/analysis events.
8. Every successful hit/miss/suggestion path emits exactly one `done`.

Use provider-construction spies in cases 1, 3, 4, and 5.

- [ ] **Step 2: Verify Data API permissions with anon and service clients**

In the local Supabase integration suite, create separate anon and service-role
clients. Assert anon cannot select/insert/update cache tables and cannot execute
the three cache RPCs. Assert the service client can execute the intended RPCs.
Check PostgREST error codes rather than matching English error text.

- [ ] **Step 3: Rerun concurrency and rollback checks**

Run two independent service clients concurrently as defined in Sprint 02. Also
force a post-pipeline tax-ID conflict inside `persist_research_snapshot` and
assert profile, report, diff, and identity update all roll back.

- [ ] **Step 4: Run focused security gates**

Run:

```bash
npm test -- tests/unit/research-cache-route.test.ts
eval "$(npx supabase status -o env)"
SUPABASE_TEST_URL="$API_URL" SUPABASE_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
SUPABASE_TEST_ANON_KEY="$ANON_KEY" npm run test:db
npx supabase db advisors --local
```

Expected: all regression, permission, concurrency, rollback, and advisor checks
pass.

- [ ] **Step 5: Commit the hardening tests**

```bash
git add tests/unit/research-cache-route.test.ts tests/integration/supabase-cache-concurrency.test.ts
git commit -m "test(cache): cover security failure paths"
```

### Task 4: Document operations and execute release verification

**Files:**

- Modify: `README.md`

**Interfaces:** Documents supported configuration and operator-visible cache
behavior; no runtime interface change.

- [ ] **Step 1: Document cache configuration and behavior**

Add concise README sections covering:

- Required `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optional
  `CACHE_TELEMETRY_HMAC_SECRET`.
- Cache hit/miss/suggestions/manual refresh behavior.
- Tax ID/domain/name matching safety rules.
- Local Supabase start/reset/database-test commands.
- Cache entries have no TTL.
- Identity merge, first-miss stampede prevention, partial pipeline resume, and
  refresh rate limiting are not implemented.
- Raw service-role/HMAC secrets are server-only.

- [ ] **Step 2: Run the complete repository gate**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npx supabase migration list --local
npx supabase db advisors --local
eval "$(npx supabase status -o env)"
SUPABASE_TEST_URL="$API_URL" SUPABASE_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
SUPABASE_TEST_ANON_KEY="$ANON_KEY" npm run test:db
git diff --check
```

Expected: every command passes with no warning attributable to the cache
feature.

- [ ] **Step 3: Repeat visual acceptance checks**

Use the local app and local Supabase to verify:

1. First query miss persists a complete snapshot.
2. Second safe query hit performs no provider call and displays freshness.
3. Name-only query shows suggestions and requires confirmation.
4. Rejecting suggestions starts new research.
5. Refresh creates the next version/diff.
6. Invalid cache recovers visibly; fatal persistence stops cleanly.

Capture final screenshots and compare them with Sprint 04 screenshots for
unexpected layout regressions.

- [ ] **Step 4: Commit operational documentation**

```bash
git add README.md
git commit -m "docs(cache): document operations and limits"
```

## Sprint 05 release gate

The feature is ready for branch integration only when:

- all Sprint 05 commands pass;
- Supabase advisors are clean;
- anon/authenticated direct access is denied;
- service-role access is server-only;
- HMAC telemetry contains no raw keys;
- hit/miss/suggestion/refresh/error traces are observable;
- all SSE paths terminate;
- final UI screenshots are reviewed;
- `git status --short` is empty.

Skipped by design: refresh rate limiting, full first-miss stampede prevention,
TTL, automatic identity merge, and partial pipeline resume. Add them only in a
separate approved spec when production evidence justifies the extra machinery.
