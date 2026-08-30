# Supabase Research Cache Sprint Roadmap

**Spec:** [`../../specs/2026-08-26-supabase-research-cache-design.md`](../../specs/2026-08-26-supabase-research-cache-design.md)

This roadmap splits the approved cache design into dependency-ordered,
independently reviewable deliverables. A sprint is a technical delivery slice,
not a calendar estimate. Execute and review one sprint before starting its
successor.

## Sprint sequence

| Sprint | Deliverable | Depends on | Completion gate |
|---|---|---|---|
| [01 — Contracts and normalization](./sprint-01-contracts-and-normalization.md) | Typed request/SSE/snapshot contracts, safe identity normalization, pure lookup decisions | Approved spec | Focused unit tests, typecheck, Node 22 build |
| [02 — Supabase schema and storage](./sprint-02-supabase-schema-and-storage.md) | Identity schema, transactional RPCs, complete-snapshot storage adapter | Sprint 01 | Local database reset, adapter tests, two-client concurrency test |
| [03 — Server read-through flow](./sprint-03-server-read-through-flow.md) | Cache-first route, lazy paid providers, canonical workflow identity, atomic persist | Sprint 02 | Route/workflow tests prove hit/miss/conflict/error behavior |
| [04 — Client suggestions and refresh](./sprint-04-client-suggestions-and-refresh.md) | Safe company confirmation, cache metadata, manual refresh UI | Sprint 03 | State-transition tests plus visual before/after verification |
| [05 — Telemetry and release hardening](./sprint-05-telemetry-and-release-hardening.md) | HMAC telemetry, remaining negative-path coverage, advisors and release checks | Sprint 04 | Full test/lint/typecheck/build and database advisor pass |

## Dependency flow

```text
contracts → database/storage → server/workflow → client/UI → hardening/release
```

## Cross-sprint constraints

- Supabase remains the only shared persistent cache. Do not add localStorage,
  Redis, or an in-process LRU.
- Cache entries do not expire. Only explicit refresh creates a new version.
- Tax ID may auto-match; a unique domain may auto-match; a normalized name
  only produces suggestions.
- Never trust a client-provided company ID without rebinding it to the current
  normalized input.
- Never auto-merge identities.
- A cache hit, invalid selection, identity conflict, or unavailable cache must
  not construct or call LLM, Serper, or scraper adapters.
- Every started SSE stream ends with `done`, including fatal failures.
- Runtime-validate cached JSONB before returning it.
- Use `pg_advisory_xact_lock`, never a session advisory lock.
- Use HMAC-SHA256 for telemetry fingerprints; never emit raw tax IDs/domains.
- No refresh rate limiter is added in these sprints. The spec records it as a
  later security/cost control.

## Execution rule

Each sprint document is a standalone implementation plan. The executor reads
the approved spec and the selected sprint only, performs its test-first tasks,
and stops at that sprint's review gate. Do not batch multiple sprint commits
without review.
