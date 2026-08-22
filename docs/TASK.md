# PartnerIQ — Task Board (Agile)

## Sprint 1: Foundation ✅ COMPLETE

- [x] S1.0: Next.js project init + TypeScript + dependencies
- [x] S1.1: Domain types — all interfaces in `src/lib/types.ts`
- [x] S1.2: LLM adapter — interface + OpenAI + mock
- [x] S1.3: Scraper adapter — interface + tinyfish + mock
- [x] S1.4: Search adapter — interface + Serper + mock
- [x] S1.5: Storage adapter — interface + in-memory
- [x] S1.6: Config + Guards + SSE utils

**Verify**: `tsc --noEmit` → 0 errors ✅

---

## Sprint 2: Core Pipeline ✅ COMPLETE

- [x] S2.1: ResearchModule — 5 sources (web_search, website, news, registry, linkedin)
- [x] S2.2: ProfileModule — LLM-powered profile builder + diff engine
- [x] S2.3: API route — SSE streaming endpoint `/api/research`

**Verify**: `tsc --noEmit` → 0 errors ✅

---

## Sprint 3: UI + E2E ✅ COMPLETE

- [x] S3.1: Research page — input form + streaming progress
- [x] S3.2: Profile display — company card + citations
- [x] S3.3: E2E integration — dev server test

**Verify**: Dev server running (HTTP 200) + E2E tests pass ✅

---

## Sprint 4: Differentiation ✅ COMPLETE

- [x] S4.1: AnalystModule — Collaboration Fit Score (5 weighted criteria), Risk Flags, Suggested Actions, Executive Summary
- [x] S4.2: ProfileCard UI enhancement — Fit score meter, 5-criteria breakdown, risk badges, action badges
- [x] S4.3: Firestore adapter — `src/adapters/storage/firestore.ts` with subcollection versioning
- [x] S4.4: Profile export utility — `src/lib/export.ts` (Download Markdown, Copy Markdown, Download JSON)

**Verify**: Unit tests for Analyst & Export pass (37/37 tests total) ✅

---

## Sprint 5: Polish & Deployment Preparation ✅ COMPLETE

- [x] S5.1: UI polish — micro-animations, copy button toast feedback, responsive layout
- [x] S5.2: Production build verification — `npm run build` compiled successfully in Next.js Turbopack
- [x] S5.3: Containerization — `Dockerfile` for Google Cloud Run / Docker deployment
- [x] S5.4: Demo Script — `docs/DEMO_SCRIPT.md` (3-5 minute live hackathon presentation flow with sample Vietnamese companies)

**Final Status**: All 5 Sprints Completed & Verified (37/37 Tests Passed + Build Clean) 🚀
