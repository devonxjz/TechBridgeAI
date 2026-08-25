# PartnerIQ — Task Board (Agile)

## Task 1: MVP Foundation & Pipeline ✅ COMPLETE

### Sprint 1: Foundation ✅ COMPLETE
- [x] S1.0: Next.js project init + TypeScript + dependencies
- [x] S1.1: Domain types — all interfaces in `src/lib/types.ts`
- [x] S1.2: LLM adapter — interface + OpenAI + mock
- [x] S1.3: Scraper adapter — interface + tinyfish + mock
- [x] S1.4: Search adapter — interface + Serper + mock
- [x] S1.5: Storage adapter — interface + in-memory
- [x] S1.6: Config + Guards + SSE utils

### Sprint 2: Core Pipeline ✅ COMPLETE
- [x] S2.1: ResearchModule — 5 sources (web_search, website, news, registry, linkedin)
- [x] S2.2: ProfileModule — LLM-powered profile builder + diff engine
- [x] S2.3: API route — SSE streaming endpoint `/api/research`

### Sprint 3: UI + E2E ✅ COMPLETE
- [x] S3.1: Research page — input form + streaming progress
- [x] S3.2: Profile display — company card + citations
- [x] S3.3: E2E integration — dev server test

### Sprint 4: Differentiation ✅ COMPLETE
- [x] S4.1: AnalystModule — Collaboration Fit Score (5 weighted criteria), Risk Flags, Suggested Actions, Executive Summary
- [x] S4.2: ProfileCard UI enhancement — Fit score meter, 5-criteria breakdown, risk badges, action badges
- [x] S4.3: Firestore / Supabase storage adapter with versioning
- [x] S4.4: Profile export utility — `src/lib/export.ts`

### Sprint 5: Polish & Deployment Preparation ✅ COMPLETE
- [x] S5.1: UI polish — micro-animations, copy button toast feedback, responsive layout
- [x] S5.2: Production build verification — `npm run build` compiled successfully in Next.js Turbopack
- [x] S5.3: Containerization — `Dockerfile`
- [x] S5.4: Demo Script — `docs/plan/DEMO_SCRIPT.md`

---

## Task 2: Research Reliability & Tiered Scraper (TASK-2) ✅ COMPLETE

### Sprint 0: Clean Baseline & TypeScript 7 Verification Gate ✅ COMPLETE
- [x] S0.1: Align package.json `typecheck` and `typecheck:legacy` scripts with `next typegen`
- [x] S0.2: Verify TypeScript 7 compiler (`7.0.2`) and TypeScript 6 legacy compatibility (`6.0.3`)

### Sprint 1: Scraper Contract & Remove Fabricated Evidence ✅ COMPLETE
- [x] S1.1: Typed `ScrapeError`, `ScraperProvider`, `ScrapeErrorCode` in `src/adapters/scraper/types.ts`
- [x] S1.2: Refactor `TinyFishScraperAdapter` with bounded timeout, typed errors, and remove all placeholder/fabricated evidence
- [x] S1.3: Unit test coverage in `tests/unit/tiered-scraper.test.ts`

### Sprint 2: SSRF-Safe Direct Fetch ✅ COMPLETE
- [x] S2.1: Implement `src/adapters/scraper/url-safety.ts` (IPv4/IPv6 classification, DNS resolution & pinning)
- [x] S2.2: Implement `src/adapters/scraper/direct.ts` (`SafeDirectScraperAdapter` with SNI/Host pinning, redirect limits, stream limit, linear HTML cleaner)
- [x] S2.3: Unit & transport security tests (`tests/unit/scraper-security.test.ts`, `tests/integration/scraper-transport.test.ts`)

### Sprint 3: Jina Reader & Ordered Fallback Chain ✅ COMPLETE
- [x] S3.1: Implement `JinaReaderScraperAdapter` in `src/adapters/scraper/jina.ts`
- [x] S3.2: Implement `TieredScraperAdapter` in `src/adapters/scraper/tiered.ts` with short-circuit, terminal invalid_target, and sanitized logging
- [x] S3.3: Unit test coverage for Jina and Tiered fallback in `tests/unit/tiered-scraper.test.ts`

### Sprint 4: Production Composition, Rollback Flags & Budgets ✅ COMPLETE
- [x] S4.1: Wire tiered scraper factory & guards in `src/config/index.ts`
- [x] S4.2: Enforce `maxPages` budget (including homepage) in `src/modules/research/sources/website.ts`
- [x] S4.3: Update `.env.example` and integration tests

### Sprint 5: VietQR Registry Adapter & Controlled Fallback ✅ COMPLETE
- [x] S5.1: Implement `VietQrRegistryAdapter` in `src/adapters/registry/vietqr.ts` with 7-day in-memory cache
- [x] S5.2: Integrate VietQR into `fetchRegistryData` in `src/modules/research/sources/registry.ts` with aggregator/search fallback
- [x] S5.3: Inject registry adapter into `ResearchModule` and `src/app/api/research/route.ts`
- [x] S5.4: Unit tests in `tests/unit/registry-adapter.test.ts` and `tests/unit/sources.test.ts`

### Sprint 6: Full Verification, Smoke Test & Documentation ✅ COMPLETE
- [x] S6.1: Clean verification: typecheck, typecheck:legacy, lint, build, and 14 test suites (102 tests passed)
- [x] S6.2: Security smoke validation (blocked IP/loopback, redirects, content limits, TLS/SNI verification)
- [x] S6.3: Demo company matrix measured smoke benchmarks in `README.md` and `docs/plan/DEMO_SCRIPT.md`

**Final Status**: All Sprints Completed & Verified (102/102 Tests Passed + Build Clean + Lint Clean + Types Clean) 🚀

---

## Task 3: LangGraph Orchestration & Langfuse Cloud (TASK-3) ✅ COMPLETE

### Wave 1: Runtime foundation ✅ COMPLETE
- [x] T3.1: Pin LangGraph/LangChain/Langfuse/OTel dependencies and prove Next.js + Zod + TypeScript compatibility

### Wave 2: Independent foundations ✅ COMPLETE
- [x] T3.2: Deterministic evidence, bounded query matrix, call/token/concurrency budgets
- [x] T3.3: LangChain-backed `LLMAdapter` with existing structured-output contract

### Wave 3: Workflow orchestration ✅ COMPLETE
- [x] T3.4: Parallel LangGraph fan-out/fan-in with typed partial failure

### Wave 4: Independent integration paths ✅ COMPLETE
- [x] T3.5: Untrusted-evidence prompt boundary and source-priority policy
- [x] T3.6: Thin SSE route, Vercel runtime deadline, and cancellation propagation

### Wave 5: Observability ✅ COMPLETE
- [x] T3.7: Langfuse Cloud tracing, masking, deterministic scores, and flush lifecycle

### Wave 6: Release gate ✅ COMPLETE
- [x] T3.8: Full regression, parallelism benchmark, preview privacy check, and operational documentation

**Branch:** `codex/partneriq-langgraph-langfuse`

**Detailed tickets:** [`docs/ticket/TASK-3.md`](TASK-3.md)

**Final Status**: All Waves Completed & Verified (23 Suites | 136/136 Tests Passed + Build Clean + Lint Clean + Types Clean) 🚀

