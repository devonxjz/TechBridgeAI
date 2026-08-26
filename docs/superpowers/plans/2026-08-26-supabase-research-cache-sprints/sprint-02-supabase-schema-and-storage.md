# Sprint 02 — Supabase Schema and Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the canonical company identity schema, transactional database
functions, complete-snapshot persistence, and matching memory/Supabase storage
behavior without changing the research route.

**Architecture:** Keep `StorageAdapter` as the existing persistence seam and
deepen it with identity/cache methods. Supabase implements multi-statement
identity creation and snapshot persistence through transaction-scoped RPCs;
the memory adapter provides deterministic parity for route/workflow tests.

**Tech Stack:** PostgreSQL 17-compatible SQL, Supabase Data API/PostgREST,
`@supabase/supabase-js` 2.112.x, pinned Supabase CLI 2.115.0, TypeScript,
Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-08-26-supabase-research-cache-design.md`

## Global Constraints

- Sprint 01 types and function names are fixed inputs.
- Use `pg_advisory_xact_lock`; session-level advisory locks are forbidden.
- Tax IDs are unique only when non-null; domains and names are not unique.
- Never auto-merge identities or overwrite conflicting identity metadata.
- Persist profile, report, diff, and identity metadata in one transaction.
- Cache reads accept only profile rows with non-null `analysis_report`.
- Database functions use `SECURITY INVOKER`, an empty search path, and fully
  qualified relation names.
- Revoke Data API access from `anon` and `authenticated`; grant only the
  server-side `service_role` the required table/function access.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` through `NEXT_PUBLIC_*` or client
  modules.
- Create migrations with `supabase migration new`; do not hand-name migration
  files.
- Stage only files named by each task.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Pin Supabase CLI and add the database test command |
| `package-lock.json` | Modify | Lock CLI binaries and package graph |
| `supabase/config.toml` | Create via CLI | Local Supabase project configuration |
| `supabase/migrations/<CLI-generated>_research_cache.sql` | Create via CLI | Existing-database migration and RPC definitions |
| `supabase/schema.sql` | Modify | Canonical fresh-project schema matching the migration |
| `.env.example` | Modify | Server-only service-role configuration |
| `src/adapters/storage/types.ts` | Modify | Identity and complete-snapshot storage interface |
| `src/adapters/storage/memory.ts` | Modify | Test/development implementation |
| `src/adapters/storage/supabase.ts` | Modify | RPC and complete-snapshot implementation |
| `src/config/index.ts` | Modify | Require the server-only key for Supabase storage |
| `tests/unit/adapters.test.ts` | Modify | Memory cache/storage parity |
| `tests/unit/supabase-storage.test.ts` | Modify | RPC mapping and service-key validation |
| `tests/integration/supabase-cache-concurrency.test.ts` | Create | Real transaction/concurrency verification |
| `.github/workflows/ci.yml` | Modify | Run local Supabase database checks in CI |

### Task 1: Pin and initialize the database toolchain

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create via CLI: `supabase/config.toml`

**Interfaces:**

- Consumes: Node.js 22 from Sprint 01 and Docker on developer/CI hosts.
- Produces: reproducible `npx supabase` commands at version 2.115.0.

- [ ] **Step 1: Install the stable CLI version verified for this plan**

Run:

```bash
npm install --save-dev --save-exact supabase@2.115.0
npx supabase --version
npx supabase migration new --help
npx supabase db advisors --help
```

Expected: version `2.115.0`; help lists `migration new` and local database
advisor support. Stop and update this sprint document if the pinned commands do
not match the installed help.

- [ ] **Step 2: Initialize local Supabase configuration**

Run:

```bash
npx supabase init
```

Expected: `supabase/config.toml` is created without replacing
`supabase/schema.sql`.

- [ ] **Step 3: Add an explicit database-test script**

Add to `package.json`:

```json
"test:db": "vitest run tests/integration/supabase-cache-concurrency.test.ts"
```

- [ ] **Step 4: Verify package integrity and commit**

Run:

```bash
npm ci
npx supabase --version
```

Expected: clean install and CLI `2.115.0`.

```bash
git add package.json package-lock.json supabase/config.toml
git commit -m "chore(db): pin supabase cli"
```

### Task 2: Add identity and complete-snapshot schema

**Files:**

- Create via CLI: `supabase/migrations/<CLI-generated>_research_cache.sql`
- Modify: `supabase/schema.sql`

**Interfaces:**

- Produces tables/indexes described in spec section 4 and these RPCs:

```sql
public.lookup_company_identities(text, text, text)
public.resolve_company_identity(text, text, text, text)
public.persist_research_snapshot(text, text, text, text, integer, jsonb, jsonb, jsonb)
```

- [ ] **Step 1: Create the migration through the CLI**

Run:

```bash
npx supabase migration new research_cache
```

Expected: CLI prints the exact new path under `supabase/migrations`. Use that
printed path for every remaining migration edit and commit; do not rename it.

- [ ] **Step 2: Add the identity table and profile/diff constraints**

Write these statements into the generated migration and mirror them in
`supabase/schema.sql` for fresh projects:

```sql
create table if not exists public.company_identities (
  id text primary key,
  tax_id text,
  normalized_domain text,
  normalized_name text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists idx_company_identities_tax_id
  on public.company_identities (tax_id)
  where tax_id is not null;
create index if not exists idx_company_identities_domain
  on public.company_identities (normalized_domain);
create index if not exists idx_company_identities_name
  on public.company_identities (normalized_name);

alter table public.company_profiles
  add column if not exists analysis_report jsonb;

create index if not exists idx_company_profiles_complete
  on public.company_profiles (id, version desc)
  where analysis_report is not null;
```

Backfill `company_identities` from the latest row per existing profile ID before
adding foreign keys. Use `data->>'taxId'`, `data->>'website'`, and
`data->>'officialName'` with the same digit/domain/lowercase whitespace rules
as Sprint 01. Invalid legacy tax IDs become null; never fail the migration on
one malformed JSONB value.

Then add foreign keys:

```sql
alter table public.company_profiles
  add constraint company_profiles_identity_fk
  foreign key (id) references public.company_identities(id);

alter table public.company_diffs
  add constraint company_diffs_identity_fk
  foreign key (company_id) references public.company_identities(id);
```

Guard each named constraint with a `pg_constraint` existence check so rerunning
the canonical schema is idempotent.

- [ ] **Step 3: Replace broad public policies with server-only access**

Drop the two existing “Allow anon read/write” policies, enable RLS on all three
tables, revoke table access from `anon`/`authenticated`, and grant the minimum
table privileges to `service_role`:

```sql
drop policy if exists "Allow anon read/write company_profiles"
  on public.company_profiles;
drop policy if exists "Allow anon read/write company_diffs"
  on public.company_diffs;

alter table public.company_identities enable row level security;
alter table public.company_profiles enable row level security;
alter table public.company_diffs enable row level security;

revoke all on public.company_identities from anon, authenticated;
revoke all on public.company_profiles from anon, authenticated;
revoke all on public.company_diffs from anon, authenticated;

grant select, insert, update on public.company_identities to service_role;
grant select, insert, update on public.company_profiles to service_role;
grant select, insert, update on public.company_diffs to service_role;
```

No browser/client code receives the service-role key.

- [ ] **Step 4: Add the read-only lookup RPC**

Implement `public.lookup_company_identities(p_tax_id text, p_domain text,
p_name text)` as `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''`.
Return distinct identity rows matching any non-null supplied key. Fully qualify
`public.company_identities` and order by `id` for deterministic adapter output.

Revoke default execute and grant only server execution:

```sql
revoke execute on function public.lookup_company_identities(text, text, text)
  from public, anon, authenticated;
grant execute on function public.lookup_company_identities(text, text, text)
  to service_role;
```

- [ ] **Step 5: Add the transactional resolve/create RPC**

Implement `public.resolve_company_identity` with these exact branches:

```plpgsql
if p_tax_id is not null then
  insert into public.company_identities (
    id, tax_id, normalized_domain, normalized_name
  ) values (
    p_candidate_id, p_tax_id, p_domain, p_name
  ) on conflict (tax_id) where tax_id is not null do nothing;

  select id into resolved_id
  from public.company_identities
  where tax_id = p_tax_id;
elsif p_domain is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_domain));

  select id into resolved_id
  from public.company_identities
  where normalized_domain = p_domain
    and normalized_name = p_name
  order by id
  limit 1;

  if resolved_id is null then
    insert into public.company_identities (
      id, normalized_domain, normalized_name
    ) values (
      p_candidate_id, p_domain, p_name
    ) returning id into resolved_id;
  end if;
else
  insert into public.company_identities (id, normalized_name)
  values (p_candidate_id, p_name)
  returning id into resolved_id;
end if;
```

Before returning, detect supplied tax/domain disagreement and raise a stable
exception marker `identity_conflict`. Do not update an existing identity's keys
inside the tax-ID conflict branch.

Declare the function `SECURITY INVOKER SET search_path = ''`, revoke execution
from `public`, `anon`, and `authenticated`, and grant it to `service_role`.

- [ ] **Step 6: Add atomic snapshot persistence RPC**

Implement `public.persist_research_snapshot` as one PL/pgSQL transaction that:

1. Locks the target `company_identities` row with `FOR UPDATE`.
2. Rechecks the pipeline-derived tax ID and domain against other identities.
3. Raises `identity_conflict` before mutation when either key belongs to a
   different identity under the approved conflict rules.
4. Updates only the target identity's non-conflicting normalized metadata.
5. Upserts `company_profiles(id, version, official_name, data,
   analysis_report, updated_at)` on `(id, version)`.
6. Upserts the supplied diff when non-null; version 1 accepts null.
7. Returns the authoritative `updated_at` value.

Use `SECURITY INVOKER SET search_path = ''`, explicit schema qualification,
server-only execute grants, and no dynamic SQL.

- [ ] **Step 7: Apply and inspect the local schema**

Run:

```bash
npx supabase start
npx supabase db reset
npx supabase migration list --local
npx supabase db advisors --local
```

Expected: migration is applied, no duplicate/failed migration, and advisors
report no security/performance issue introduced by these objects.

- [ ] **Step 8: Commit schema and RPCs**

```bash
git add supabase/schema.sql supabase/migrations
git commit -m "feat(db): add research cache schema"
```

### Task 3: Deepen the storage interface and memory adapter

**Files:**

- Modify: `src/adapters/storage/types.ts`
- Modify: `src/adapters/storage/memory.ts`
- Modify: `tests/unit/adapters.test.ts`

**Interfaces:**

Add these methods while retaining existing profile/diff methods until Sprint 03
migrates the workflow:

```ts
findIdentityCandidates(
  identity: NormalizedCompanyIdentity,
  options?: StorageReadOptions,
): Promise<IdentityCandidate[]>;

getLatestCompleteSnapshot(
  companyId: string,
  options?: StorageReadOptions,
): Promise<ResearchSnapshot | null>;

resolveOrCreateIdentity(
  identity: NormalizedCompanyIdentity,
  candidateId: string,
  options?: StorageWriteOptions,
): Promise<string>;

persistResearchSnapshot(
  identity: NormalizedCompanyIdentity,
  snapshot: Omit<ResearchSnapshot, "lastSyncedAt">,
  options?: StorageWriteOptions,
): Promise<ResearchSnapshot>;
```

- [ ] **Step 1: Write failing memory-adapter tests**

Add tests proving:

```ts
await storage.resolveOrCreateIdentity(identity, "company-a");
await storage.persistResearchSnapshot(identity, draft);

await expect(storage.findIdentityCandidates(identity)).resolves.toEqual([
  expect.objectContaining({ companyId: "company-a" }),
]);
await expect(storage.getLatestCompleteSnapshot("company-a")).resolves
  .toMatchObject({ profile: { id: "company-a" }, report: { companyId: "company-a" } });
```

Add an invalid selection/conflicting tax-ID case and a version-2 snapshot whose
diff matches `toVersion: 2`.

- [ ] **Step 2: Run and verify interface failures**

Run: `npm test -- tests/unit/adapters.test.ts`

Expected: FAIL because the new methods do not exist.

- [ ] **Step 3: Implement the minimum in-memory parity**

Store identities in a `Map<string, IdentityCandidate>` and complete snapshots
in the existing company/version maps. Reuse Sprint 01's `decideCacheLookup`
rules; do not create a second normalization implementation. Return cloned
arrays/objects where mutation would leak across tests.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npm test -- tests/unit/adapters.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the storage seam**

```bash
git add src/adapters/storage/types.ts src/adapters/storage/memory.ts tests/unit/adapters.test.ts
git commit -m "feat(storage): add complete cache snapshots"
```

### Task 4: Implement Supabase storage and server-only credentials

**Files:**

- Modify: `.env.example`
- Modify: `src/config/index.ts`
- Modify: `src/adapters/storage/supabase.ts`
- Modify: `tests/unit/supabase-storage.test.ts`

**Interfaces:** Implements all Sprint 02 `StorageAdapter` methods via
`.rpc(...)`, complete-row selection, and exact-version diff selection.

- [ ] **Step 1: Write failing service-key and RPC mapping tests**

Mock the Supabase client boundary and assert:

- Supabase storage refuses startup without `SUPABASE_SERVICE_ROLE_KEY`.
- Identity lookup calls `lookup_company_identities` with normalized values.
- Identity creation calls `resolve_company_identity`.
- Snapshot persistence calls `persist_research_snapshot`.
- Complete snapshot selection filters `analysis_report` non-null, orders version
  descending, then fetches diff by exact `company_id` and `to_version`.
- Abort signals propagate to all PostgREST/RPC builders that support them.

- [ ] **Step 2: Run and verify tests fail**

Run: `npm test -- tests/unit/supabase-storage.test.ts`

Expected: FAIL against the old adapter constructor/method set.

- [ ] **Step 3: Require the server-only credential**

Document in `.env.example`:

```dotenv
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=server-only-secret
```

Remove the Supabase storage path's use of `SUPABASE_ANON_KEY` in
`createStorageAdapter`. The adapter constructor accepts URL and service-role key
only. Do not rename the key with a `NEXT_PUBLIC_` prefix.

- [ ] **Step 4: Implement RPC and snapshot mapping**

Call the three exact RPC names from Task 2. Parse every JSONB response through
`ResearchSnapshotSchema`; do not use `as CompanyProfile` or
`as AnalysisReport`. Convert known RPC conflict markers to a typed
`IdentityConflictError` exported from `src/modules/cache/index.ts`; convert
transport errors to a storage error without provider fallback.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/unit/supabase-storage.test.ts tests/unit/adapters.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Supabase adapter behavior**

```bash
git add .env.example src/config/index.ts src/adapters/storage/supabase.ts tests/unit/supabase-storage.test.ts
git commit -m "feat(storage): use transactional supabase cache"
```

### Task 5: Prove transaction-level concurrency with two clients

**Files:**

- Create: `tests/integration/supabase-cache-concurrency.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:** Uses `SUPABASE_TEST_URL` and
`SUPABASE_TEST_SERVICE_ROLE_KEY`; never uses production credentials.

- [ ] **Step 1: Write the real concurrent RPC test**

Create two independent `createClient` instances, start both RPC calls before
awaiting either, and assert one identity:

```ts
const first = createClient(testUrl, serviceKey, clientOptions);
const second = createClient(testUrl, serviceKey, clientOptions);
const domain = `race-${crypto.randomUUID()}.example`;
const name = `race ${crypto.randomUUID()}`;

const [a, b] = await Promise.all([
  first.rpc("resolve_company_identity", {
    p_tax_id: null,
    p_domain: domain,
    p_name: name,
    p_candidate_id: crypto.randomUUID(),
  }),
  second.rpc("resolve_company_identity", {
    p_tax_id: null,
    p_domain: domain,
    p_name: name,
    p_candidate_id: crypto.randomUUID(),
  }),
]);

expect(a.error).toBeNull();
expect(b.error).toBeNull();
expect(a.data).toBe(b.data);
```

Query `company_identities` with the service-role test client and assert exactly
one row for that domain/name. Add a rollback test for post-pipeline conflict so
no profile/diff row survives a failed persistence RPC.

- [ ] **Step 2: Run against local Supabase**

Run:

```bash
eval "$(npx supabase status -o env)"
SUPABASE_TEST_URL="$API_URL" \
SUPABASE_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
npm run test:db
```

Expected: both concurrent calls return the same ID and all database integration
tests pass.

- [ ] **Step 3: Add the same local database gate to CI**

After `npm ci`, add CI steps that run `npx supabase start`, export local API URL
and service key only within the database-test step, run `npm run test:db`, then
stop the stack with `npx supabase stop --no-backup`. Do not print service keys.

- [ ] **Step 4: Commit concurrency verification**

```bash
git add tests/integration/supabase-cache-concurrency.test.ts .github/workflows/ci.yml
git commit -m "test(db): verify cache identity locking"
```

## Sprint 02 review gate

Run:

```bash
npx supabase db reset
npx supabase migration list --local
npx supabase db advisors --local
eval "$(npx supabase status -o env)"
SUPABASE_TEST_URL="$API_URL" SUPABASE_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" npm run test:db
npm test -- tests/unit/adapters.test.ts tests/unit/supabase-storage.test.ts
npm run lint
npm run typecheck
git status --short
```

Expected: migration/advisors pass, independent-client concurrency passes, unit
tests pass, and the worktree is clean before Sprint 03.
