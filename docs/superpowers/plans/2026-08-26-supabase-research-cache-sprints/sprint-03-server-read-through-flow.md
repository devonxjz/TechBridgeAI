# Sprint 03 — Server Read-Through Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the complete Supabase snapshot in front of the expensive research
pipeline, bind every client selection to current input, and persist misses or
refreshes atomically under a canonical company ID.

**Architecture:** Deepen the pure cache module into a storage-backed research
cache, then keep the route as the orchestration point. The workflow becomes
storage-independent: it receives canonical identity/previous profile, produces
a terminal state, and leaves final SSE emission/persistence to the route.

**Tech Stack:** Next.js 16.3.2 Node Route Handler, Web Streams/SSE, LangGraph
1.4.12, Zod 4.4.3, Supabase storage seam, Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-08-26-supabase-research-cache-design.md`

## Global Constraints

- Read the installed Next.js 16 route-handler and streaming guides before
  editing `route.ts`.
- Construct only storage/cache dependencies before cache resolution.
- Paid provider factories must remain untouched on hit, invalid selection,
  identity conflict, and cache-backend failure.
- Recompute candidates server-side for every `select` and `refresh` request.
- Never derive canonical identity with `slugify(name)`.
- Workflow owns research computation; route owns persistence and final SSE
  events.
- Every started SSE stream ends with `done`.
- A corrupt cache is recoverable; a persist failure or post-pipeline identity
  conflict is fatal.
- Do not add a queue, background job, rate limiter, TTL, or LRU.
- Stage only files named by each task.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/modules/cache/index.ts` | Modify | Storage-backed lookup, selection, refresh binding, and persistence interface |
| `src/modules/workflow/state.ts` | Modify | Canonical ID and supplied previous profile in initial state |
| `src/modules/workflow/index.ts` | Modify | Remove storage reads/writes and final result emission |
| `src/app/api/research/route.ts` | Modify | Cache-first orchestration, HTTP/SSE errors, lazy providers, atomic persist |
| `src/lib/stream.ts` | Modify only if required | Preserve explicit error/done ordering and close-once behavior |
| `tests/unit/research-cache.test.ts` | Modify | Storage-backed selection/refresh/cache-invalid behavior |
| `tests/integration/research-workflow.test.ts` | Modify | Storage-independent canonical workflow behavior |
| `tests/unit/research-cache-route.test.ts` | Create | Hit/miss/selection/conflict/provider-construction route coverage |
| `tests/unit/research-route-observability.test.ts` | Modify | New request body and route terminal behavior |
| `tests/e2e/workflow-e2e.test.ts` | Modify | New request body and final SSE ownership |

### Task 1: Build the storage-backed research cache module

**Files:**

- Modify: `src/modules/cache/index.ts`
- Modify: `tests/unit/research-cache.test.ts`

**Interfaces:**

```ts
export type CacheResolution =
  | {
      kind: "hit";
      snapshot: ResearchSnapshot;
      matchedBy: "tax_id" | "domain";
    }
  | { kind: "suggestions"; suggestions: CacheSuggestion[] }
  | {
      kind: "miss";
      identity: NormalizedCompanyIdentity;
      cacheInvalid: boolean;
    }
  | {
      kind: "conflict";
      taxCompanyId: string;
      domainCompanyIds: string[];
    };

export interface ResearchCache {
  lookup(input: CompanyInput, options?: StorageReadOptions): Promise<CacheResolution>;
  select(
    input: CompanyInput,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot>;
  prepareRefresh(
    input: CompanyInput,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot>;
  resolveMiss(
    input: CompanyInput,
    options?: StorageWriteOptions,
  ): Promise<{ companyId: string; identity: NormalizedCompanyIdentity }>;
  persist(
    identity: NormalizedCompanyIdentity,
    snapshot: Omit<ResearchSnapshot, "lastSyncedAt">,
    options?: StorageWriteOptions,
  ): Promise<ResearchSnapshot>;
}

export function createResearchCache(storage: StorageAdapter): ResearchCache;
```

- [ ] **Step 1: Write failing hit/suggestion/miss tests**

Use `MemoryStorageAdapter` and prove:

```ts
await expect(cache.lookup({ name: "FPT", taxId: "0101248141" }))
  .resolves.toMatchObject({
    kind: "hit",
    matchedBy: "tax_id",
    snapshot: { profile: { id: "company-a" } },
  });

await expect(cache.lookup({ name: "FPT" })).resolves.toMatchObject({
  kind: "suggestions",
  suggestions: [expect.objectContaining({ companyId: "company-a" })],
});

await expect(cache.lookup({ name: "Unknown" })).resolves.toEqual({
  kind: "miss",
  identity: { taxId: null, domain: null, name: "unknown" },
  cacheInvalid: false,
});
```

- [ ] **Step 2: Write the real unrelated-existing-ID tests**

Seed complete snapshots for company A and company B. Assert:

```ts
await expect(cache.select({ name: "Company A" }, "company-b"))
  .rejects.toMatchObject({ code: "invalid_cache_selection" });

await expect(cache.prepareRefresh(
  { name: "Company A", taxId: "tax-a" },
  "company-b",
)).rejects.toMatchObject({ code: "identity_conflict" });
```

The rejected IDs must exist and have valid snapshots; a nonexistent ID does not
cover the input-binding vulnerability.

- [ ] **Step 3: Write a corrupt-snapshot recovery test**

Make `getLatestCompleteSnapshot` throw `CacheInvalidError` and assert `lookup`
returns the same normalized miss with `cacheInvalid: true`. Transport/storage
errors must propagate instead of becoming a miss.

- [ ] **Step 4: Run and verify missing module behavior fails**

Run: `npm test -- tests/unit/research-cache.test.ts`

Expected: FAIL because `createResearchCache` and the typed cache errors are not
implemented.

- [ ] **Step 5: Implement the minimum cache orchestration**

`lookup` calls `findIdentityCandidates`, passes the result to
`decideCacheLookup`, then loads complete snapshots only for the chosen hit or
suggestion IDs. Drop identities without a complete snapshot from suggestions.
If no complete candidate remains, return a miss and retain the normalized
identity for `resolveMiss`.

`select` reruns the full lookup and accepts `companyId` only when it appears in
the current suggestion set. `prepareRefresh` reruns lookup and accepts the ID
only when the hit/suggestion set contains it without a strong-key conflict.

`resolveMiss` calls:

```ts
storage.resolveOrCreateIdentity(
  normalizeCompanyIdentity(input),
  crypto.randomUUID(),
  options,
);
```

`persist` delegates once to `persistResearchSnapshot` and returns the database
timestamped snapshot.

- [ ] **Step 6: Run focused cache tests**

Run:

```bash
npm test -- tests/unit/research-cache.test.ts tests/unit/adapters.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the cache module**

```bash
git add src/modules/cache/index.ts tests/unit/research-cache.test.ts
git commit -m "feat(cache): bind cache decisions to input"
```

### Task 2: Make the workflow canonical-ID driven and storage independent

**Files:**

- Modify: `src/modules/workflow/state.ts`
- Modify: `src/modules/workflow/index.ts`
- Modify: `tests/integration/research-workflow.test.ts`

**Interfaces:**

Change workflow options/state initialization to require:

```ts
export interface ResearchWorkflowOptions {
  researchRunId: string;
  companyId: string;
  existingProfile: CompanyProfile | null;
  signal?: AbortSignal;
  callbacks?: readonly unknown[];
  sessionId?: string;
  onComplete?: (state: ResearchWorkflowState) => void | Promise<void>;
}
```

Remove `storage` from `ResearchWorkflowDeps` after all workflow reads/writes are
deleted.

- [ ] **Step 1: Rewrite failing workflow tests around supplied identity**

Replace storage-failure tests with these assertions:

```ts
const state = await workflow.run(
  { name: "Different Display Name" },
  {
    researchRunId: "canonical-id",
    companyId: "stable-company-id",
    existingProfile,
  },
);

expect(state.profile?.id).toBe("stable-company-id");
expect(state.profile?.version).toBe(existingProfile.version + 1);
expect(state.diff).toMatchObject({
  companyId: "stable-company-id",
  fromVersion: existingProfile.version,
  toVersion: existingProfile.version + 1,
});
```

Add a stream test proving source/progress/build events still appear but
`profile:ready`, `diff:ready`, `analysis:ready`, and `done` do not; the route
will own those final events.

- [ ] **Step 2: Run and verify old workflow behavior fails the new assertions**

Run: `npm test -- tests/integration/research-workflow.test.ts`

Expected: FAIL because options do not accept canonical identity and the graph
still reads/writes storage/emits final events.

- [ ] **Step 3: Remove storage nodes and derive state from options**

Initialize state with:

```ts
{
  researchRunId: options.researchRunId,
  input,
  existingProfile: options.existingProfile,
  // existing source/findings/profile/diff/report/outcome defaults remain
}
```

Build the profile with `options.companyId`; calculate diff without saving it.
Remove `load_existing_profile` and `persist_profile` nodes/edges. Remove final
result custom events from diff/analyze nodes and remove the workflow-level
`done` yield. Keep fatal/source error events and always invoke `onComplete` with
the terminal state.

- [ ] **Step 4: Delete storage from workflow callers/tests**

Remove `storage` from `ResearchWorkflowDeps`, workflow construction, and test
builders. Keep storage tests in the adapter/cache suites.

- [ ] **Step 5: Run workflow tests and typecheck**

Run:

```bash
npm test -- tests/integration/research-workflow.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit workflow isolation**

```bash
git add src/modules/workflow/state.ts src/modules/workflow/index.ts tests/integration/research-workflow.test.ts
git commit -m "refactor(workflow): accept canonical cache state"
```

### Task 3: Put cache lookup before all paid providers

**Files:**

- Modify: `src/app/api/research/route.ts`
- Create: `tests/unit/research-cache-route.test.ts`
- Modify: `tests/unit/research-route-observability.test.ts`

**Interfaces:**

- HTTP errors use `{ error: { code, message } }` and the status table from spec
  section 12.
- Started SSE streams use `cache:*`, current progress events, explicit error
  codes, final result events, and `done`.

- [ ] **Step 1: Write a cache-hit route test that forbids provider construction**

Mock `createStorageAdapter` with a complete cached snapshot and define
`createLLMAdapter`, `createSearchAdapter`, and `createScraperAdapter` as spies
that throw if called. POST:

```json
{ "input": { "name": "FPT", "taxId": "0101248141" } }
```

Assert status 200 and this event order:

```ts
expect(body.indexOf("event: cache:hit")).toBeLessThan(body.indexOf("event: profile:ready"));
expect(body.indexOf("event: profile:ready")).toBeLessThan(body.indexOf("event: diff:ready"));
expect(body.indexOf("event: diff:ready")).toBeLessThan(body.indexOf("event: analysis:ready"));
expect(body.trimEnd()).toContain("event: done");
expect(createLLMAdapter).not.toHaveBeenCalled();
expect(createSearchAdapter).not.toHaveBeenCalled();
expect(createScraperAdapter).not.toHaveBeenCalled();
```

- [ ] **Step 2: Write pre-stream failure tests**

Cover:

- Existing unrelated `companyId` on `select` → `400 invalid_cache_selection`.
- Strong-key disagreement → `409 identity_conflict`.
- Storage/RPC transport failure → `503 cache_unavailable`.

For every case, assert paid provider factories have zero calls.

- [ ] **Step 3: Write miss and corrupt-cache tests**

- Empty lookup: assert identity resolves and workflow/provider factories are
  constructed without a second bypass request.
- Corrupt snapshot: assert SSE contains `error.code = cache_invalid`, then
  progress/persisted final events and `done`.

- [ ] **Step 4: Run route tests and verify they fail**

Run: `npm test -- tests/unit/research-cache-route.test.ts`

Expected: FAIL against the current eager-provider route.

- [ ] **Step 5: Implement cache-first route branching**

Parse `ResearchRequestSchema`, create storage/cache, and resolve the cache before
calling any paid-provider factory. Use these branches:

```ts
switch (resolution.kind) {
  case "hit":
    return streamCachedSnapshot(resolution);
  case "suggestions":
    return streamSuggestions(resolution.suggestions);
  case "conflict":
    return jsonError(409, "identity_conflict", "Thông tin định danh công ty mâu thuẫn.");
  case "miss":
    break;
}
```

Handle `select`, `refresh`, and `bypass` before default lookup. `bypass` skips
returning suggestions but still calls `resolveMiss`; it never accepts a client
company ID.

Only after identity resolution succeeds, construct providers/workflow and start
the long-running SSE flow.

- [ ] **Step 6: Centralize final events after atomic persistence**

Capture workflow terminal state through `onComplete`. If it has profile/report
and no fatal error, call `cache.persist` once. On success write:

```ts
writer.write({ event: "profile:ready", data: { profile: persisted.profile } });
writer.write({ event: "diff:ready", data: { diff: persisted.diff } });
writer.write({ event: "analysis:ready", data: { report: persisted.report } });
writer.write({ event: "done", data: {} });
```

On persistence conflict write `error(code: identity_conflict)` then `done`; on
other persistence errors write `error(code: persist_failed)` then `done`. Do not
write profile/diff/analysis first. Preserve abort/deadline cleanup and close the
writer exactly once in `finally`.

- [ ] **Step 7: Run route tests and typecheck**

Run:

```bash
npm test -- tests/unit/research-cache-route.test.ts tests/unit/research-route-observability.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit route orchestration**

```bash
git add src/app/api/research/route.ts tests/unit/research-cache-route.test.ts tests/unit/research-route-observability.test.ts
git commit -m "feat(api): serve research through cache"
```

### Task 4: Preserve end-to-end SSE behavior

**Files:**

- Modify: `tests/e2e/workflow-e2e.test.ts`
- Modify only if tests require it: `src/lib/stream.ts`

**Interfaces:** Existing SSE serialization plus new explicit cache/error events.

- [ ] **Step 1: Update E2E requests and assertions**

Send nested `{ input }` request bodies. Add one seeded cache hit and one miss.
Assert both terminate with exactly one `done`; hit has no source progress and
miss retains research progress before final events.

- [ ] **Step 2: Add fatal terminal-path assertions**

For post-pipeline conflict and persistence failure, assert:

```ts
expect(events.at(-2)).toMatchObject({ event: "error" });
expect(events.at(-1)).toEqual({ event: "done", data: {} });
expect(events.some(({ event }) => event === "profile:ready")).toBe(false);
```

- [ ] **Step 3: Run E2E and full focused server suites**

Run:

```bash
npm test -- tests/e2e/workflow-e2e.test.ts \
  tests/unit/research-cache-route.test.ts \
  tests/integration/research-workflow.test.ts
```

Expected: PASS. Change `src/lib/stream.ts` only if close-once or event-order
behavior cannot be expressed with its current interface.

- [ ] **Step 4: Commit E2E contract**

```bash
git add tests/e2e/workflow-e2e.test.ts
git diff -- src/lib/stream.ts
git commit -m "test(api): cover cache sse outcomes"
```

If `src/lib/stream.ts` changed, include it in `git add`; otherwise leave it
untouched.

## Sprint 03 review gate

Run:

```bash
npm test -- tests/unit/research-cache.test.ts \
  tests/unit/research-cache-route.test.ts \
  tests/unit/research-route-observability.test.ts \
  tests/integration/research-workflow.test.ts \
  tests/e2e/workflow-e2e.test.ts
npm run lint
npm run typecheck
npm run build
git status --short
```

Expected: cache hit never touches paid factories; all HTTP/SSE failure paths are
terminal; miss/refresh persist only complete snapshots; worktree is clean before
Sprint 04.
