# Sprint 01 — Cache Contracts and Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the runtime-validated request, SSE, snapshot, normalization,
and pure cache-decision contracts without changing the research route behavior.

**Architecture:** Add domain contracts to `src/lib/types.ts` and one focused
cache module containing pure normalization, snapshot validation, and lookup
decision logic. No Supabase I/O belongs in this sprint. Upgrade the production
container to Node.js 22 because current Supabase client releases no longer
support Node.js 20.

**Tech Stack:** Next.js 16.3.2, TypeScript, Zod 4.4.3, Vitest 4.1.11, Node.js 22,
platform `URL` and `crypto.randomUUID()` APIs.

**Spec:** `docs/superpowers/specs/2026-08-26-supabase-research-cache-design.md`

## Global Constraints

- Do not change the current `/api/research` runtime flow in this sprint.
- Do not add a cache dependency, localStorage, Redis, or an LRU.
- Preserve Vietnamese diacritics and legal suffixes in normalized names.
- A normalized name never creates an automatic hit.
- Runtime schemas must reject malformed cached JSONB instead of casting it.
- Do not emit raw tax IDs or domains to logs or telemetry.
- Match the existing Zod/type style in `src/lib/types.ts`.
- Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
  before later route work; no Next.js route change occurs in this sprint.
- Stage only files named by each task.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `Dockerfile` | Modify | Move production runtime from Node 20 to Node 22 |
| `src/lib/types.ts` | Modify | Request, cache, snapshot, and SSE runtime contracts |
| `src/modules/cache/index.ts` | Create | Pure identity normalization, snapshot validation, and cache decision logic |
| `tests/unit/types-validation.test.ts` | Modify | Request-union and complete-snapshot schema coverage |
| `tests/unit/research-cache.test.ts` | Create | Normalization and lookup decision coverage |

### Task 1: Define request and SSE contracts

**Files:**

- Modify: `src/lib/types.ts`
- Modify: `tests/unit/types-validation.test.ts`

**Interfaces:**

- Consumes: existing `CompanyInputSchema`, `CompanyProfile`, `ProfileDiff`,
  `AnalysisReport`, and `StreamEvent`.
- Produces:

```ts
export const CacheActionSchema: z.ZodType<
  | { action: "select"; companyId: string }
  | { action: "refresh"; companyId: string }
  | { action: "bypass" }
>;

export const ResearchRequestSchema: z.ZodType<{
  input: CompanyInput;
  cache?: z.infer<typeof CacheActionSchema>;
}>;

export type ResearchErrorCode =
  | "identity_conflict"
  | "cache_invalid"
  | "persist_failed"
  | "research_failed";

export type CacheHitMatchedBy = "tax_id" | "domain" | "selected";
```

- [ ] **Step 1: Write failing request-union tests**

Append these cases to `tests/unit/types-validation.test.ts`:

```ts
import {
  ResearchRequestSchema,
  type ResearchRequest,
} from "@/lib/types";

it("accepts default, select, refresh, and bypass research requests", () => {
  const requests: ResearchRequest[] = [
    { input: { name: "FPT" } },
    { input: { name: "FPT" }, cache: { action: "select", companyId: "fpt" } },
    { input: { name: "FPT" }, cache: { action: "refresh", companyId: "fpt" } },
    { input: { name: "FPT" }, cache: { action: "bypass" } },
  ];

  expect(requests.every((request) => ResearchRequestSchema.safeParse(request).success))
    .toBe(true);
});

it("rejects cache actions with missing or unexpected company IDs", () => {
  expect(
    ResearchRequestSchema.safeParse({
      input: { name: "FPT" },
      cache: { action: "select" },
    }).success,
  ).toBe(false);
  expect(
    ResearchRequestSchema.safeParse({
      input: { name: "FPT" },
      cache: { action: "bypass", companyId: "injected" },
    }).success,
  ).toBe(false);
});
```

- [ ] **Step 2: Run the request tests and confirm the missing exports fail**

Run: `npm test -- tests/unit/types-validation.test.ts`

Expected: FAIL because `ResearchRequestSchema` and `ResearchRequest` do not
exist.

- [ ] **Step 3: Implement the request schemas and stream-event additions**

Add to `src/lib/types.ts`:

```ts
export const CacheActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), companyId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("refresh"), companyId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("bypass") }).strict(),
]);

export const ResearchRequestSchema = z.object({
  input: CompanyInputSchema,
  cache: CacheActionSchema.optional(),
}).strict();

export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;
export type ResearchErrorCode =
  | "identity_conflict"
  | "cache_invalid"
  | "persist_failed"
  | "research_failed";
export type CacheHitMatchedBy = "tax_id" | "domain" | "selected";

export interface CacheSuggestion {
  companyId: string;
  officialName: string;
  taxId?: string;
  domain?: string;
  lastSyncedAt: string;
}
```

Extend `StreamEvent` with `cache:hit` and `cache:suggestions`, and extend the
existing error payload with optional `code: ResearchErrorCode`. Use the exact
payloads from spec section 8.

- [ ] **Step 4: Run focused validation and type checks**

Run:

```bash
npm test -- tests/unit/types-validation.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit the request boundary**

```bash
git add src/lib/types.ts tests/unit/types-validation.test.ts
git commit -m "feat(cache): define cache request contracts"
```

### Task 2: Add complete snapshot runtime schemas

**Files:**

- Modify: `src/lib/types.ts`
- Modify: `tests/unit/types-validation.test.ts`

**Interfaces:**

- Produces:

```ts
export interface ResearchSnapshot {
  profile: CompanyProfile;
  report: AnalysisReport;
  diff: ProfileDiff | null;
  lastSyncedAt: string;
}

export const ResearchSnapshotSchema: z.ZodType<ResearchSnapshot>;
```

- [ ] **Step 1: Write failing complete/corrupt snapshot tests**

Use the existing valid profile fixtures or construct the minimum full objects:

```ts
it("parses a complete research snapshot and restores dates", () => {
  const result = ResearchSnapshotSchema.parse({
    profile: validProfileJson,
    report: validReportJson,
    diff: null,
    lastSyncedAt: "2026-08-26T08:00:00.000Z",
  });

  expect(result.profile.lastUpdated).toBeInstanceOf(Date);
  expect(result.report.generatedAt).toBeInstanceOf(Date);
});

it("rejects mismatched and incomplete snapshots", () => {
  expect(() => ResearchSnapshotSchema.parse({
    profile: validProfileJson,
    report: { ...validReportJson, companyId: "other-company" },
    diff: null,
    lastSyncedAt: "2026-08-26T08:00:00.000Z",
  })).toThrow();
});
```

Define `validProfileJson` with every current `CompanyProfile` field and
`validReportJson` with every current `AnalysisReport` field. Do not cast a
partial object to bypass the schema.

- [ ] **Step 2: Run and verify the schema test fails**

Run: `npm test -- tests/unit/types-validation.test.ts`

Expected: FAIL because `ResearchSnapshotSchema` is absent.

- [ ] **Step 3: Implement runtime schemas that mirror the domain types**

Add Zod schemas for `Address`, `Person`, `Activity`, `SourceCitation`,
`CompanyProfile`, `FieldChange`, `ProfileDiff`, `FitScore`, `RiskFlag`,
`SuggestedAction`, `AnalysisReport`, and `ResearchSnapshot`. Use
`z.coerce.date()` for persisted date values, numeric bounds already enforced by
the analyst/profile modules, and `.strict()` on trust-boundary objects.

Add this final cross-object validation:

```ts
export const ResearchSnapshotSchema = z.object({
  profile: CompanyProfileSchema,
  report: AnalysisReportSchema,
  diff: ProfileDiffSchema.nullable(),
  lastSyncedAt: z.string().datetime(),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.report.companyId !== snapshot.profile.id) {
    ctx.addIssue({
      code: "custom",
      path: ["report", "companyId"],
      message: "Analysis report companyId must match profile id",
    });
  }
  if (
    snapshot.diff &&
    (snapshot.diff.companyId !== snapshot.profile.id ||
      snapshot.diff.toVersion !== snapshot.profile.version)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["diff"],
      message: "Profile diff must match profile id and version",
    });
  }
});
```

- [ ] **Step 4: Run validation tests and typecheck**

Run:

```bash
npm test -- tests/unit/types-validation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit runtime snapshot validation**

```bash
git add src/lib/types.ts tests/unit/types-validation.test.ts
git commit -m "feat(cache): validate cached research snapshots"
```

### Task 3: Normalize identity and decide cache outcomes

**Files:**

- Create: `src/modules/cache/index.ts`
- Create: `tests/unit/research-cache.test.ts`

**Interfaces:**

```ts
export interface NormalizedCompanyIdentity {
  taxId: string | null;
  domain: string | null;
  name: string;
}

export interface IdentityCandidate {
  companyId: string;
  taxId: string | null;
  domain: string | null;
  name: string;
}

export type CacheDecision =
  | { kind: "hit"; companyId: string; matchedBy: "tax_id" | "domain" }
  | { kind: "suggestions"; companyIds: string[] }
  | { kind: "miss" }
  | { kind: "conflict"; taxCompanyId: string; domainCompanyIds: string[] };

export function normalizeCompanyIdentity(input: CompanyInput): NormalizedCompanyIdentity;
export function decideCacheLookup(
  identity: NormalizedCompanyIdentity,
  candidates: readonly IdentityCandidate[],
): CacheDecision;
```

- [ ] **Step 1: Write failing normalization tests**

```ts
it("normalizes tax ID, domain, and Vietnamese name without dropping legal suffixes", () => {
  expect(normalizeCompanyIdentity({
    name: "  CÔNG TY  CP Ánh Dương  ",
    taxId: "0101-245.486",
    website: "https://WWW.Example.VN:443/about?q=1",
  })).toEqual({
    taxId: "0101245486",
    domain: "example.vn",
    name: "công ty cp ánh dương",
  });
});

it("rejects a malformed supplied tax ID", () => {
  expect(() => normalizeCompanyIdentity({ name: "FPT", taxId: "abc" }))
    .toThrow("Mã số thuế phải có 10 hoặc 13 chữ số");
});
```

- [ ] **Step 2: Write failing decision-table tests**

Cover these exact cases:

```ts
expect(decideCacheLookup(withTaxAndDomain, candidatesForSameCompany)).toEqual({
  kind: "hit", companyId: "company-a", matchedBy: "tax_id",
});
expect(decideCacheLookup(withConflictingKeys, conflictingCandidates)).toEqual({
  kind: "conflict",
  taxCompanyId: "company-a",
  domainCompanyIds: ["company-b"],
});
expect(decideCacheLookup(domainOnly, twoDomainCandidates)).toEqual({
  kind: "suggestions", companyIds: ["company-a", "company-b"],
});
expect(decideCacheLookup(nameOnly, oneNameCandidate)).toEqual({
  kind: "suggestions", companyIds: ["company-a"],
});
expect(decideCacheLookup(nameOnly, [])).toEqual({ kind: "miss" });
```

- [ ] **Step 3: Run and verify the new test fails**

Run: `npm test -- tests/unit/research-cache.test.ts`

Expected: FAIL because `@/modules/cache` does not exist.

- [ ] **Step 4: Implement normalization with platform APIs**

Use these rules directly:

```ts
const TAX_ID_PATTERN = /^\d{10}(?:\d{3})?$/;

function normalizeTaxId(value?: string): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/[\s.-]/g, "");
  if (!TAX_ID_PATTERN.test(normalized)) {
    throw new Error("Mã số thuế phải có 10 hoặc 13 chữ số");
  }
  return normalized;
}

function normalizeDomain(website?: string): string | null {
  if (!website) return null;
  return new URL(website).hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

function normalizeName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ");
}
```

Implement `decideCacheLookup` as the spec decision table. Sort and deduplicate
suggestion IDs before returning them so database row order cannot affect output.

- [ ] **Step 5: Run cache tests and typecheck**

Run:

```bash
npm test -- tests/unit/research-cache.test.ts tests/unit/types-validation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit pure cache behavior**

```bash
git add src/modules/cache/index.ts tests/unit/research-cache.test.ts
git commit -m "feat(cache): normalize and resolve identities"
```

### Task 4: Align the production runtime with supported Node.js

**Files:**

- Modify: `Dockerfile`

**Interfaces:**

- Consumes: the existing multi-stage Docker build.
- Produces: the same image layout running Node.js 22 Alpine.

- [ ] **Step 1: Confirm the current base is unsupported**

Read `Dockerfile` and confirm it currently contains:

```dockerfile
FROM node:20-alpine AS base
```

The Supabase 2026 changelog states current client libraries dropped Node.js 20
support. CI already uses Node.js 22.

- [ ] **Step 2: Make the one-line runtime update**

```dockerfile
FROM node:22-alpine AS base
```

- [ ] **Step 3: Verify production compilation**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands pass under the development environment; the Docker
stages remain otherwise unchanged.

- [ ] **Step 4: Commit the runtime prerequisite**

```bash
git add Dockerfile
git commit -m "chore(runtime): move production to node 22"
```

## Sprint 01 review gate

Run:

```bash
npm test -- tests/unit/types-validation.test.ts tests/unit/research-cache.test.ts
npm run lint
npm run typecheck
npm run build
git status --short
```

Expected: all checks pass and the worktree contains no uncommitted Sprint 01
files. Review the exported types before starting Sprint 02; later sprint plans
use these names exactly.
