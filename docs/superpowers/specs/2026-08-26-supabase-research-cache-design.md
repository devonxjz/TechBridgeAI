# Supabase Research Cache Design

**Date:** 2026-08-26

**Status:** Draft for final review

**Scope:** Shared, non-expiring research cache backed by Supabase

## 1. Goal

Return previously completed company research without running Serper, scraping,
profile synthesis, or analysis again. When no safe cache match exists, run the
current research pipeline and persist a complete snapshot for later requests.

Cache entries do not expire. A user refreshes a cached company explicitly when
new research is required.

## 2. Current Context

The research endpoint streams a LangGraph workflow over SSE. The workflow
currently loads and writes versioned `CompanyProfile` and `ProfileDiff` records
through `StorageAdapter`, but it still executes all source and LLM work before
loading the previous profile. Supabase stores profiles and diffs; it does not
store `AnalysisReport`. Company identity currently falls back to
`slugify(input.name)`, which is not safe as a canonical identifier.

Relevant code:

- `src/app/api/research/route.ts`
- `src/app/hooks/use-research.ts`
- `src/app/page.tsx`
- `src/modules/workflow/index.ts`
- `src/adapters/storage/types.ts`
- `src/adapters/storage/supabase.ts`
- `src/adapters/storage/memory.ts`
- `src/config/index.ts`
- `src/lib/types.ts`
- `src/observability/langfuse.ts`

## 3. Architectural Decision

Use a read-through flow at the research route with a dedicated research-cache
module. The cache module is the seam between request identity, Supabase lookup,
and complete research snapshots.

The route performs cache resolution before constructing the LLM, search,
scraper, registry, profile, analyst, or workflow modules. A cache hit therefore
does not require provider credentials and cannot accidentally call a paid
provider.

The cache module exposes the minimum interface needed by callers:

- Resolve an input into a hit, suggestions, a miss, or an identity conflict.
- Resolve or create the canonical identity used by a pipeline run.
- Persist one complete profile/report/diff snapshot.

Supabase remains the persistent shared store. No browser `localStorage` cache
and no additional in-process LRU cache are part of this change.

## 4. Data Model

### 4.1 `company_identities`

Add one canonical identity row per known company:

| Column | Type | Rules |
|---|---|---|
| `id` | `text` | Primary key. Existing IDs are retained; new IDs are UUID strings. |
| `tax_id` | `text` | Nullable normalized tax ID. |
| `normalized_domain` | `text` | Nullable normalized hostname. Not unique. |
| `normalized_name` | `text` | Required normalized company name. Not unique. |
| `created_at` | `timestamptz` | Creation time. |
| `updated_at` | `timestamptz` | Last identity metadata change, not research freshness. |

Required indexes and constraints:

- Primary key on `id`.
- Partial unique index on `tax_id` where `tax_id IS NOT NULL`.
- Non-unique index on `normalized_domain`.
- Non-unique index on `normalized_name`.

`normalized_domain` is intentionally non-unique because multiple legal entities
may use one corporate domain. `normalized_name` is never used as an automatic
cache hit.

### 4.2 `company_profiles`

Keep versioned rows keyed by `(id, version)` and add:

- `analysis_report JSONB NULL`.
- Foreign key `id → company_identities(id)` after existing data is backfilled.
- Partial lookup index `(id, version DESC) WHERE analysis_report IS NOT NULL`.

`company_profiles.updated_at` is the research synchronization time exposed to
the client as `lastSyncedAt`. It is distinct from
`company_identities.updated_at`.

A row is cacheable only when `analysis_report IS NOT NULL`. The current analyst
produces one structured report after a single `completeStructured` call; partial
report streaming is not supported. Therefore a separate completion-status
column is unnecessary.

### 4.3 `company_diffs`

Keep the existing table and add a foreign key from `company_id` to
`company_identities(id)`. A cached snapshot includes only the diff whose
`to_version` equals the selected profile version; version 1 returns `null`.

### 4.4 Backfill

Backfill one `company_identities` row for each existing distinct profile ID.
Derive identity fields from the latest profile version. Preserve every existing
profile ID so existing profile/diff references remain valid. New companies use
`crypto.randomUUID()` converted to a string; `slugify(name)` is no longer an
identity source.

## 5. Normalization Rules

Normalization happens at the cache trust boundary before lookup or persistence.
Input and pipeline-derived identity values use the same functions.

### Tax ID

- Trim surrounding whitespace.
- Remove spaces, dots, and hyphens.
- Accept only 10 or 13 decimal digits after normalization.
- Return `null` for an absent value; reject a present malformed value.

### Domain

- Parse the already URL-validated website with the platform `URL` class.
- Use `hostname`, lowercase it, remove a trailing dot, and remove one leading
  `www.`.
- Ignore scheme, credentials, port, path, query, and fragment.
- Return `null` when no website is supplied.

### Company name

- Apply Unicode NFKC normalization.
- Trim, lowercase using the Vietnamese locale, and collapse consecutive
  whitespace.
- Retain Vietnamese diacritics, punctuation, and legal suffixes such as `TNHH`
  and `CP`.
- Never use a name match as an automatic cache hit.

## 6. Lookup Rules

Lookup uses the following order:

1. `taxId`
2. normalized domain
3. normalized name

Decision rules:

| Condition | Result |
|---|---|
| Tax ID resolves to one identity and supplied domain is compatible | Automatic hit |
| Domain resolves to exactly one identity and no tax ID conflicts | Automatic hit |
| Domain resolves to multiple identities | Suggestions requiring confirmation |
| Name resolves to one or more identities | Suggestions requiring confirmation |
| No layer resolves | Miss; run the pipeline immediately |
| Supplied tax ID and domain resolve to different identities | `identity_conflict` |
| Cached profile/report/diff fails runtime validation | `cache_invalid`; treat as miss |

When a tax ID resolves to identity A, a supplied domain is compatible when it
has no candidates or when every domain candidate set used for this request
contains A. A domain candidate set that excludes A is an identity conflict. A
multi-candidate domain without a tax ID remains a suggestion result.

No automatic identity merge is permitted. Conflicts require corrected user
input or later manual/admin resolution.

## 7. Request Contract

The request is a discriminated union:

```typescript
type ResearchRequest =
  | { input: CompanyInput; cache?: undefined }
  | {
      input: CompanyInput;
      cache: { action: "select"; companyId: string };
    }
  | {
      input: CompanyInput;
      cache: { action: "refresh"; companyId: string };
    }
  | {
      input: CompanyInput;
      cache: { action: "bypass" };
    };
```

`select` validation recomputes the full suggestion candidate set from the
supplied input, including ambiguous-domain and normalized-name candidates, and
accepts the requested `companyId` only when it belongs to that set. Merely
checking that the ID exists is insufficient.

`refresh` resolves the supplied input through the same tax ID → domain → name
chain. The selected `companyId` must be compatible with the result. A mismatch
returns an explicit conflict; it never silently falls back to bypass.

`bypass` is used only after a user rejects non-empty suggestions. A normal
zero-result lookup starts the pipeline immediately without an extra client
round trip.

## 8. SSE Contract

Add these events while retaining the existing profile, diff, analysis, error,
and done events:

```typescript
type CacheHitMatchedBy = "tax_id" | "domain" | "selected";

type CacheSuggestion = {
  companyId: string;
  officialName: string;
  taxId?: string;
  domain?: string;
  lastSyncedAt: string;
};

type CacheStreamEvent =
  | {
      event: "cache:hit";
      data: {
        companyId: string;
        matchedBy: CacheHitMatchedBy;
        version: number;
        lastSyncedAt: string;
      };
    }
  | {
      event: "cache:suggestions";
      data: { suggestions: CacheSuggestion[] };
    };
```

A cache hit streams, in order:

1. `cache:hit`
2. `profile:ready`
3. `diff:ready`
4. `analysis:ready`
5. `done`

Every SSE execution path terminates explicitly. A fatal streaming failure emits
`error` and then `done`; the server never silently closes a stream it has
started.

Extend the existing error event:

```typescript
type ResearchErrorCode =
  | "identity_conflict"
  | "cache_invalid"
  | "persist_failed"
  | "research_failed";

type ResearchErrorEvent = {
  event: "error";
  data: {
    code?: ResearchErrorCode;
    message: string;
    source?: SourceName;
  };
};
```

`cache_invalid` is recoverable: emit the error event, continue with a cache
miss, and finish with the pipeline's normal final events. `persist_failed` and
post-pipeline `identity_conflict` are fatal: emit the error event followed by
`done`, with no profile/diff/analysis final events.

## 9. Server Flow

### Default lookup

1. Parse and validate `ResearchRequest`.
2. Construct only the storage/cache dependencies.
3. Normalize input and perform lookup.
4. Return HTTP errors that occur before SSE starts.
5. On hit, validate and stream the complete snapshot without constructing paid
   providers.
6. On suggestions, stream the candidates and `done`.
7. On an empty lookup, resolve/create an identity and run the pipeline.

### Pipeline miss

1. Resolve or create a canonical identity.
2. Construct LLM, search, scraper, registry, profile, analyst, and workflow
   modules only after the miss is confirmed.
3. Pass `companyId` and `existingProfile` into the workflow. The workflow does
   not derive identity with `slugify(name)` and does not repeat the cache read.
4. Stream source and build progress only; hold final profile/diff/analysis
   events until validation and persistence succeed.
5. Normalize the tax ID/domain/name found in the completed profile and validate
   them against `company_identities` again.
6. Persist identity metadata, profile, report, and matching diff atomically.
7. Stream final profile, diff, analysis, and done events.

### Refresh

1. Revalidate the client-provided company ID against the current input.
2. Load its latest complete snapshot as the previous profile.
3. Bypass the cache response and run the pipeline under the same canonical ID.
4. Persist the next version and its diff.

### Post-pipeline conflict

If newly discovered identity values belong to another company, do not merge,
persist, or stream the completed result. Record conflict telemetry, emit
`error.code = "identity_conflict"`, then emit `done`.

## 10. Database Concurrency

Use database RPCs because `supabase-js` cannot group multiple PostgREST calls
into one client-controlled transaction.

### Resolve/create identity RPC

The RPC uses separate branches:

- With tax ID: rely on the partial unique index and `INSERT ... ON CONFLICT`
  behavior. Re-read and validate the winning identity; do not overwrite or
  merge conflicting domain/name data automatically.
- Without tax ID but with domain: acquire
  `pg_advisory_xact_lock(hashtext(normalized_domain))`, recheck the domain/name,
  and insert or reuse inside the same transaction.
- Name only: create a UUID identity after suggestions have been rejected or no
  suggestions exist. Duplicate name-only identities remain possible because a
  name is intentionally not treated as unique.

The lock is transaction-scoped and releases automatically on commit or
rollback. A session-level advisory lock is forbidden.

The identity lock prevents duplicate identity rows; it does not prevent two
simultaneous cache misses from both running the expensive pipeline. Profile and
diff upserts preserve database integrity if this occurs, but duplicate provider
cost remains a documented ceiling.

### Persist snapshot RPC

Persist the identity metadata update, complete profile/report row, and matching
diff in one transaction. Revalidate pipeline-derived keys in this transaction
before writing. Any conflict or write failure rolls back the whole snapshot.

## 11. Runtime Validation

Validate Supabase JSONB before it crosses the cache interface. The runtime
schema covers the complete `CompanyProfile`, `AnalysisReport`, and optional
`ProfileDiff`, including version/company-ID agreement.

An invalid snapshot:

1. Emits `cache_invalid` telemetry.
2. Emits a recoverable SSE error when the stream has started.
3. Is treated as a miss.
4. Is never returned to the client as a cache hit.

## 12. HTTP Error Contract

Errors detected before the SSE response use JSON:

```typescript
type ResearchHttpError = {
  error: {
    code:
      | "invalid_request"
      | "invalid_cache_selection"
      | "identity_conflict"
      | "cache_unavailable";
    message: string;
  };
};
```

| Status | Code | Behavior |
|---|---|---|
| `400` | `invalid_request` | Malformed input or cache action. |
| `400` | `invalid_cache_selection` | Existing company ID is not a candidate for the current input. |
| `409` | `identity_conflict` | Strong identifiers disagree. No provider is constructed or called. |
| `503` | `cache_unavailable` | Supabase lookup/RPC is unavailable. No provider is constructed or called. |

The client handles JSON errors before opening/consuming SSE and handles SSE
errors after a stream begins. In both cases it reaches an explicit terminal UI
state.

## 13. Telemetry

Reuse the existing Langfuse integration. Do not add a logger or observability
dependency.

Record:

- `cacheOutcome`: `hit`, `miss`, `suggestions`, `refresh`, `bypass`, `conflict`,
  or `invalid`.
- `matchedBy`: `tax_id`, `domain`, `normalized_name`, or `selected`.
- Resolved company ID, selected profile version, last synchronization time, and
  lookup duration.
- On conflict: both company IDs, key type, and a keyed fingerprint. Never emit
  the raw tax ID or domain.

Use Node's built-in `crypto.createHmac("sha256", secret)` with the dedicated
server secret `CACHE_TELEMETRY_HMAC_SECRET`. A plain SHA-256 hash is forbidden
for tax IDs because their input space is small. Use the same HMAC helper for
domains for consistency. If the secret is absent, omit the fingerprint rather
than logging the raw value or failing the research request.

## 14. Client Experience

- A cache hit displays the existing result immediately, its last synchronized
  time, and a visible “Cập nhật lại” action.
- Name or ambiguous-domain suggestions show company name, tax ID when present,
  domain, and last synchronized time.
- Selecting a suggestion submits `action: "select"`.
- Rejecting non-empty suggestions submits `action: "bypass"`.
- Refresh submits `action: "refresh"` for the currently displayed company.
- Recoverable `cache_invalid` informs the user that cached data was unusable and
  that fresh research is running.
- Fatal errors stop loading and show the server message.

## 15. Verification Strategy

Use the existing Vitest suite and its current mock-adapter patterns. Do not add
a test framework.

### Unit tests

- Tax ID, domain, and name normalization.
- Lookup priority and decision table.
- Tax/domain conflict detection.
- Ambiguous domain and name suggestions.
- Complete-snapshot runtime validation.
- Latest complete profile selection and diff `to_version` matching.
- HMAC fingerprint determinism, secret separation, and omission without a
  secret.

### Route tests

- Cache hit streams the complete event sequence and never constructs/calls LLM,
  Serper, or scraper adapters.
- Supabase/RPC failure returns `503 cache_unavailable` and never
  constructs/calls paid providers.
- A corrupt snapshot emits `cache_invalid`, becomes a miss, and runs the
  pipeline.
- `select` rejects an existing, valid company ID that is not in the current
  input's suggestion set.
- `refresh` rejects an existing, valid company ID belonging to an unrelated
  company.
- An empty lookup starts the pipeline without a bypass round trip.
- A pre-stream identity conflict returns `409`.
- A post-pipeline conflict emits `error.code = "identity_conflict"`, then
  `done`, and emits no final profile/diff/analysis events.
- Persist failure emits `error.code = "persist_failed"`, then `done`, and emits
  no final profile/diff/analysis events.

### Workflow tests

- Workflow uses the supplied canonical company ID and previous profile.
- Refresh creates the next version and a diff whose `toVersion` matches it.
- Workflow no longer reads existing data via `slugify(name)`.

### Database integration tests

- Two genuinely separate database clients/connections invoke the domain-only
  resolve/create RPC concurrently for the same normalized domain and name.
- Assert both calls return the same identity and only one matching identity row
  exists.
- A sequential or same-connection test is insufficient because it cannot prove
  the advisory lock works under concurrent transactions.
- Verify tax-ID `ON CONFLICT`, transactional rollback, the partial complete-row
  index query, and snapshot/diff foreign-key integrity.

### UI verification

- Verify name suggestions, rejecting suggestions, selecting a cached company,
  last-synchronized time, recoverable cache-invalid state, and refresh.
- Capture before/after screenshots for the changed UI states.

### Final verification

- Full Vitest suite.
- Lint.
- Typecheck.
- Production build.

## 16. Security Properties

- Client-supplied company IDs are always rebound to the current normalized
  input before read or refresh.
- Strong-identifier conflicts fail closed and never merge identities.
- Cached JSONB is runtime-validated before use.
- Paid providers are not constructed on hit, invalid selection, conflict, or
  cache-backend failure.
- Advisory locks are transaction-scoped.
- Telemetry never stores raw tax IDs or domains.
- Database functions use `SECURITY INVOKER` by default, explicitly qualify
  referenced schemas, and receive only the grants required by the server role.
- Existing Supabase keys remain server-only; no service-role key is exposed to
  the browser.

## 17. Deferred Scope

- TTL or automatic freshness invalidation.
- In-process LRU/cache layer in front of Supabase.
- Automatic identity merge or an admin merge interface.
- Resuming analysis from partially persisted findings/profile data.
- Full cache-stampede prevention for concurrent first misses.
- Refresh rate limiting. Until a later phase adds per-user/company limits, the
  existing global research guards remain the only cost ceiling; this risk must
  be revisited before exposing refresh to untrusted high-volume traffic.

## 18. Acceptance Criteria

The design is complete when all of the following are true:

1. A safe cache hit returns profile, matching diff, and analysis without
   constructing or calling paid providers.
2. A miss runs the existing pipeline and atomically stores a complete reusable
   snapshot.
3. Name matches and ambiguous domains require server-validated user selection.
4. Refresh is explicit, server-bound to the supplied input, and creates a new
   version/diff.
5. Identity conflicts never auto-merge and always produce observable terminal
   errors.
6. Supabase failure cannot trigger an expensive uncached run.
7. Concurrent domain-only identity creation is verified with independent
   database connections.
8. Every SSE path ends with `done`, including fatal errors.
9. The UI displays cache age and offers manual refresh.
10. Existing research, export, observability, and storage tests continue to
    pass.
