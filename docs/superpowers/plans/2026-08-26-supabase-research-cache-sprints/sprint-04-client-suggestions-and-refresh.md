# Sprint 04 — Client Suggestions and Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users safely confirm name/domain cache suggestions, see cache
freshness, reject incorrect suggestions, and explicitly refresh a cached
company.

**Architecture:** Keep network and SSE state in the existing `useResearch`
client hook. Add one inline suggestion component and a pure exported reducer so
state transitions are testable under the existing Node Vitest environment
without installing a DOM test framework.

**Tech Stack:** React 19.2.8 Client Components, Next.js 16.3.2 App Router,
TypeScript, existing Tailwind CSS styles, Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-08-26-supabase-research-cache-design.md`

## Global Constraints

- Do not use localStorage, browser cache APIs, or client-side Supabase.
- Never decide whether a selected company is valid in the browser; the server
  remains authoritative.
- Use one inline accessible panel, not a modal dependency.
- Display official name, available tax ID/domain, and last synchronized time.
- Make “Không phải các công ty trên” and “Cập nhật lại” explicit actions.
- A recoverable `cache_invalid` is a notice while fresh research continues; it
  is not a terminal error.
- Fatal errors and every `done` event must leave the UI out of loading state.
- Preserve existing research progress and profile rendering.
- Do not redesign unrelated page/header/form/profile styles.
- Stage only files named by each task.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/app/hooks/use-research.ts` | Modify | Cache-aware request builder, reducer, actions, and SSE state |
| `src/app/components/cache-suggestions.tsx` | Create | Accessible inline candidate selection |
| `src/app/page.tsx` | Modify | Render suggestions, freshness, bypass, and refresh controls |
| `tests/unit/use-research-state.test.ts` | Create | Pure request/reducer state-transition tests |

### Task 1: Make cache request and SSE transitions pure and testable

**Files:**

- Modify: `src/app/hooks/use-research.ts`
- Create: `tests/unit/use-research-state.test.ts`

**Interfaces:**

```ts
export interface CacheState {
  hit: boolean;
  matchedBy: CacheHitMatchedBy | null;
  lastSyncedAt: string | null;
  suggestions: CacheSuggestion[];
}

export interface ResearchState {
  status: "idle" | "researching" | "choosing" | "building" | "done" | "error";
  // existing fields remain
  cache: CacheState;
  notice: string | null;
}

export function buildResearchRequest(
  input: CompanyInput,
  cache?: ResearchRequest["cache"],
): ResearchRequest;

export function reduceResearchEvent(
  state: ResearchState,
  event: StreamEvent,
): ResearchState;
```

- [ ] **Step 1: Write failing request-builder tests**

```ts
it("builds default, selected, bypass, and refresh requests", () => {
  const input = { name: "FPT" };

  expect(buildResearchRequest(input)).toEqual({ input });
  expect(buildResearchRequest(input, { action: "select", companyId: "fpt" }))
    .toEqual({ input, cache: { action: "select", companyId: "fpt" } });
  expect(buildResearchRequest(input, { action: "bypass" }))
    .toEqual({ input, cache: { action: "bypass" } });
  expect(buildResearchRequest(input, { action: "refresh", companyId: "fpt" }))
    .toEqual({ input, cache: { action: "refresh", companyId: "fpt" } });
});
```

- [ ] **Step 2: Write failing cache-event reducer tests**

```ts
it("enters choosing state when suggestions arrive and stays there on done", () => {
  const suggested = reduceResearchEvent(researchingState, {
    event: "cache:suggestions",
    data: { suggestions: [suggestion] },
  });
  const finished = reduceResearchEvent(suggested, { event: "done", data: {} });

  expect(finished.status).toBe("choosing");
  expect(finished.cache.suggestions).toEqual([suggestion]);
});

it("records cache metadata before applying cached final results", () => {
  const next = reduceResearchEvent(researchingState, {
    event: "cache:hit",
    data: {
      companyId: "fpt",
      matchedBy: "tax_id",
      version: 2,
      lastSyncedAt: "2026-08-26T08:00:00.000Z",
    },
  });

  expect(next.cache).toMatchObject({
    hit: true,
    matchedBy: "tax_id",
    lastSyncedAt: "2026-08-26T08:00:00.000Z",
  });
});

it("treats cache_invalid as recoverable and persist_failed as terminal", () => {
  const recoverable = reduceResearchEvent(researchingState, {
    event: "error",
    data: { code: "cache_invalid", message: "Cache không hợp lệ" },
  });
  expect(recoverable.status).toBe("researching");
  expect(recoverable.notice).toBe("Cache không hợp lệ");

  const fatal = reduceResearchEvent(researchingState, {
    event: "error",
    data: { code: "persist_failed", message: "Không thể lưu kết quả" },
  });
  expect(fatal.status).toBe("error");
});
```

- [ ] **Step 3: Run and verify exports are missing**

Run: `npm test -- tests/unit/use-research-state.test.ts`

Expected: FAIL because the request builder/reducer/cache state do not exist.

- [ ] **Step 4: Implement the pure builder and reducer**

Move the current `handleSSEEvent` switch into `reduceResearchEvent`. Keep all
existing progress/finding/profile/diff/report behavior and add:

- `cache:hit` → set cache metadata.
- `cache:suggestions` → clear result fields, store suggestions, set `choosing`.
- `error(cache_invalid)` → set `notice`, keep active research state.
- Other `error` codes → set terminal error status/message.
- `done` with suggestions → `choosing`.
- `done` with profile → `done`.
- Other `done` with fatal error → `error`.

`handleSSEEvent` becomes one `setState(prev => reduceResearchEvent(prev,
event))` call. Keep malformed JSON handling unchanged.

- [ ] **Step 5: Run focused state tests and typecheck**

Run:

```bash
npm test -- tests/unit/use-research-state.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit state behavior**

```bash
git add src/app/hooks/use-research.ts tests/unit/use-research-state.test.ts
git commit -m "feat(ui): handle cache research states"
```

### Task 2: Expose safe select, bypass, and refresh hook actions

**Files:**

- Modify: `src/app/hooks/use-research.ts`
- Modify: `tests/unit/use-research-state.test.ts`

**Interfaces:**

```ts
export interface UseResearchResult {
  state: ResearchState;
  research(input: CompanyInput): Promise<void>;
  selectSuggestion(companyId: string): Promise<void>;
  researchNewCompany(): Promise<void>;
  refresh(): Promise<void>;
  reset(): void;
}
```

- [ ] **Step 1: Add request-action tests**

Test the action-to-request mapping through `buildResearchRequest`:

- `selectSuggestion("company-a")` uses current `state.input` and action
  `select`.
- `researchNewCompany()` uses current input and action `bypass`.
- `refresh()` uses current input/profile ID and action `refresh`.
- Missing input/profile produces a resolved no-op and no fetch.

Do not install a hook rendering library. Keep network execution in one internal
`runResearch(input, cacheAction?)` callback and cover the pure request builder.

- [ ] **Step 2: Implement one shared network path**

Refactor current `research` so it delegates to:

```ts
const runResearch = useCallback(async (
  input: CompanyInput,
  cache?: ResearchRequest["cache"],
) => {
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;

  setState({
    ...INITIAL_STATE,
    input,
    status: "researching",
  });

  try {
    const response = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildResearchRequest(input, cache)),
      signal: controller.signal,
    });

    await consumeResearchStream(response, setState);
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    setState((current) => ({
      ...current,
      status: "error",
      error: (error as Error).message,
    }));
  }
}, []);
```

Extract the current response-status check, reader loop, and SSE parsing into
`consumeResearchStream`; replace its state mutations with
`setState((current) => reduceResearchEvent(current, event))`. This is a move of
existing behavior, not a second network implementation.

The public actions read current state only to construct the approved action and
then call `runResearch`. Clear previous suggestions when select, bypass, or
refresh starts. Keep abort behavior for repeated clicks.

- [ ] **Step 3: Run state tests and typecheck**

Run:

```bash
npm test -- tests/unit/use-research-state.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit hook actions**

```bash
git add src/app/hooks/use-research.ts tests/unit/use-research-state.test.ts
git commit -m "feat(ui): add cache selection actions"
```

### Task 3: Render accessible cache suggestions

**Files:**

- Create: `src/app/components/cache-suggestions.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**

```ts
interface CacheSuggestionsProps {
  suggestions: CacheSuggestion[];
  disabled: boolean;
  onSelect(companyId: string): void;
  onReject(): void;
}
```

- [ ] **Step 1: Create the inline semantic panel**

Use this structure without a modal or new dependency:

```tsx
<section aria-labelledby="cache-suggestions-title" className="glass-card p-5 space-y-4">
  <div>
    <h2 id="cache-suggestions-title" className="font-semibold">
      Chọn đúng doanh nghiệp
    </h2>
    <p className="text-sm text-muted mt-1">
      Chúng tôi tìm thấy dữ liệu đã lưu có tên tương tự.
    </p>
  </div>
  <ul className="space-y-2">
    {suggestions.map((suggestion) => (
      <li key={suggestion.companyId}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect(suggestion.companyId)}
          className="w-full glass-card p-4 text-left hover:border-accent/40 disabled:opacity-50"
        >
          <span className="block font-medium">{suggestion.officialName}</span>
          {suggestion.taxId && <span className="block text-xs text-muted">MST: {suggestion.taxId}</span>}
          {suggestion.domain && <span className="block text-xs text-muted">{suggestion.domain}</span>}
          <span className="block text-xs text-muted">
            Cập nhật: {new Date(suggestion.lastSyncedAt).toLocaleString("vi-VN")}
          </span>
        </button>
      </li>
    ))}
  </ul>
  <button type="button" disabled={disabled} onClick={onReject}>
    Không phải các công ty trên — nghiên cứu mới
  </button>
</section>
```

Reuse existing focus styles or add visible `focus-visible` utilities to both
button types. Do not remove native button semantics.

- [ ] **Step 2: Wire choosing state into the page**

Destructure `selectSuggestion` and `researchNewCompany` from the hook. When
`state.status === "choosing"`, render `CacheSuggestions` in the result area
instead of research progress/profile. Preserve the left-side form and current
input so the user can correct identifiers instead.

- [ ] **Step 3: Run lint/typecheck/build**

Run:

```bash
npm run lint
npm run typecheck
npm run build
```

Expected: PASS with no client/server boundary violation.

- [ ] **Step 4: Commit suggestions UI**

```bash
git add src/app/components/cache-suggestions.tsx src/app/page.tsx
git commit -m "feat(ui): confirm cached companies"
```

### Task 4: Display cache freshness and manual refresh

**Files:**

- Modify: `src/app/page.tsx`
- Modify: `tests/unit/use-research-state.test.ts`

**Interfaces:** Uses `state.cache.lastSyncedAt`, `state.profile.id`, and the
hook's `refresh()` action.

- [ ] **Step 1: Add refresh state expectations**

Extend reducer/request tests to prove refresh:

- clears previous suggestions/notices;
- sets status to `researching`;
- sends the displayed profile ID;
- a subsequent result replaces cache metadata and profile version.

- [ ] **Step 2: Add the freshness/refresh controls above the profile**

When a profile and `lastSyncedAt` exist, render:

```tsx
<div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
  <span>
    Cập nhật lần cuối: {new Date(state.cache.lastSyncedAt).toLocaleString("vi-VN")}
  </span>
  <button
    type="button"
    onClick={refresh}
    disabled={isLoading}
    className="rounded-lg px-3 py-1.5 text-accent hover:bg-surface disabled:opacity-50"
  >
    Cập nhật lại
  </button>
</div>
```

Show `state.notice` as a neutral/warning callout, distinct from the existing
fatal error callout.

- [ ] **Step 3: Run focused and full UI compilation checks**

Run:

```bash
npm test -- tests/unit/use-research-state.test.ts
npm run lint
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 4: Verify visually**

Run `npm run dev`, then use the in-app browser workflow to capture before/after
screenshots for:

1. Multiple cache suggestions.
2. Cached profile with last-synchronized time.
3. Refresh in progress with disabled button.
4. Recoverable cache-invalid notice.

Check keyboard focus order, readable timestamps, narrow viewport wrapping, and
that selecting/rejecting suggestions reaches the intended server request.

- [ ] **Step 5: Commit freshness UI**

```bash
git add src/app/page.tsx tests/unit/use-research-state.test.ts
git commit -m "feat(ui): show cache freshness and refresh"
```

## Sprint 04 review gate

Run:

```bash
npm test -- tests/unit/use-research-state.test.ts \
  tests/unit/research-cache-route.test.ts \
  tests/e2e/workflow-e2e.test.ts
npm run lint
npm run typecheck
npm run build
git status --short
```

Expected: state/action/server contract tests pass, all four UI states are
visually verified, accessibility basics work by keyboard, and the worktree is
clean before Sprint 05.
