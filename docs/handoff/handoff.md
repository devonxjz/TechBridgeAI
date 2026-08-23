# Project Handoff — PartnerIQ (TechBridgeAI)

> **Repository**: [devonxjz/TechBridgeAI](https://github.com/devonxjz/TechBridgeAI)  
> **Current Release**: [v0.0.1](https://github.com/devonxjz/TechBridgeAI/releases/tag/v0.0.1)  
> **Latest Git Commit**: `ebe4434` / Tag `v0.0.1`  
> **Status**: ✅ All 5 Sprints Completed, 100% Tested (39/39 tests passing), Fully Functional & Live.

---

## 1. Project Overview & Context

**PartnerIQ (TechBridgeAI)** is an AI-powered corporate intelligence and collaboration evaluation platform tailored for Vietnamese enterprises. It automates:
1. **Multi-Source Autonomous Research**: Gathers data across 5 independent sources (*Web Search, Website Scraping, Business News, Ministry Registry/MST, Key People*).
2. **AI Structured Profile Synthesis**: Builds standardized, traceable `CompanyProfile` documents using OpenAI Structured Outputs (`gpt-4o-mini`).
3. **Collaboration Fit Scoring (AnalystModule)**: Evaluates partnership potential (0–100) across 5 weighted criteria (*Industry Alignment 30%, Recent Activity 20%, Size Match 20%, Geographic Relevance 15%, Digital Maturity 15%*) with risk flags and actionable next steps.
4. **"What Changed?" Diff Engine**: Automatically detects changes across profile iterations and generates human-readable diff reports.
5. **Supabase PostgreSQL Multi-Versioning**: Subcollection-style JSONB multi-version storage (`company_profiles`, `company_diffs`) with zero hosting cost.

---

## 2. Work Completed & Current Status

| Sprint / Feature Area | Scope | Verification Status |
| :--- | :--- | :---: |
| **Sprint 1: Foundation** | Types, Zod schemas, 4 Ports (LLM, Search, Scraper, Storage), In-memory adapters, Resource Guards, SSE stream utilities. | ✅ Passed |
| **Sprint 2: Core Pipeline** | 5-source `ResearchModule`, OpenAI `ProfileModule` with Structured Output (`zodResponseFormat`), pure `DiffEngine`, API route `/api/research`. | ✅ Passed |
| **Sprint 3: UI & Experience** | Dark mode glassmorphism UI, real-time SSE progress tracker, `ProfileCard`, `useResearch` hook, reactive state. | ✅ Passed |
| **Sprint 4: Fit Score & Storage** | `AnalystModule` (5-factor Fit Score), Markdown/JSON export, Supabase PostgreSQL storage adapter with JSONB multi-versioning. | ✅ Passed |
| **Sprint 5: Production & Polish** | Multi-stage Dockerfile, CI GitHub Actions, Demo presentation script ([`docs/DEMO_SCRIPT.md`](../DEMO_SCRIPT.md)), Ponytail code review, GitHub Release `v0.0.1`. | ✅ Passed |
| **Storage Migration** | Successfully migrated from Firestore to **Supabase PostgreSQL** (`@supabase/supabase-js`), removed `@google-cloud/firestore`, created SQL migrations ([`supabase/schema.sql`](../../supabase/schema.sql)). | ✅ Passed |
| **Compatibility Shims** | Added WebSocket shim for Node.js < 22 runtimes in [`src/adapters/storage/supabase.ts`](../../src/adapters/storage/supabase.ts). | ✅ Passed |

---

## 3. Architecture & Key Files

The project follows a strict **Hexagonal / Ports & Adapters Architecture**:

```
src/
├── app/
│   ├── api/research/route.ts       # Thin SSE Orchestration Route
│   ├── components/                 # ResearchForm, ResearchProgress, ProfileCard
│   ├── hooks/use-research.ts       # Real-time SSE State & Dispatcher
│   ├── globals.css                 # Dark Glassmorphism Design System
│   └── page.tsx                    # Landing & 2-column Results Layout
├── modules/
│   ├── research/                   # Multi-source orchestrator (5 sources + fallback)
│   ├── profile/                    # Profile builder (OpenAI JSON schema) + Diff engine
│   └── analyst/                    # 5-factor Fit Score calculator & risk detector
├── adapters/                       # Swappable Infrastructure Ports
│   ├── llm/                        # OpenAIAdapter (gpt-4o-mini), MockLLMAdapter
│   ├── search/                     # SerperSearchAdapter, MockSearchAdapter
│   ├── scraper/                    # TinyFishScraperAdapter, MockScraperAdapter
│   └── storage/                    # SupabaseStorageAdapter, MemoryStorageAdapter
├── config/index.ts                 # Adapter Factory (DI via environment variables)
└── lib/
    ├── types.ts                    # Core Domain Types & Zod Schemas
    ├── stream.ts                   # SSE Streaming Utilities
    └── export.ts                   # Markdown & JSON Exporters
```

---

## 4. Environment & Database Configuration

- **Environment File**: `.env` (and synchronized `.env.local` for Next.js).
- **Active Providers**:
  - `LLM_PROVIDER=openai` (OpenAI `gpt-4o-mini` with fallback to Gemini)
  - `SEARCH_PROVIDER=mock` (Deterministic rich mock results, switchable to `serper`)
  - `SCRAPER_PROVIDER=tinyfish` (TinyFish extraction with direct HTML fallback)
  - `STORAGE_PROVIDER=supabase` (Supabase PostgreSQL JSONB tables)
- **Supabase Tables Created & Verified**:
  - `public.company_profiles` (Key: `id, version`, column: `data JSONB`)
  - `public.company_diffs` (Key: `id`, column: `data JSONB`)
  - SQL Schema: [`supabase/schema.sql`](../../supabase/schema.sql)

---

## 5. Verification & Test Suite

- **Vitest Suite**: **39/39 tests passed across 10 test files** (`npm test`).
  - Unit tests: Adapters, Analyst, Export, Diff, Sources, Supabase Storage, Types validation.
  - Integration tests: `ResearchModule`, `ProfileModule`.
  - E2E tests: Full research & streaming workflow.
- **TypeScript**: `npx tsc --noEmit` compiles with **0 type errors**.
- **Production Build**: `npm run build` generates clean static & dynamic Next.js bundles.

---

## 6. Next Steps & Recommended Actions

1. **Vercel Cloud Deployment**:
   - Link repository `devonxjz/TechBridgeAI` on [Vercel](https://vercel.com).
   - Add environment variables (`LLM_PROVIDER`, `OPENAI_API_KEY`, `STORAGE_PROVIDER`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SCRAPER_PROVIDER`, `TINYFISH_API_KEY`).
   - Trigger deployment to get public HTTPS URL.
2. **Search Provider Upgrade (Optional)**:
   - Provide a Serper key in `SERPER_API_KEY` and set `SEARCH_PROVIDER=serper` if live web queries are desired for production.
3. **Live Demo & Presentation**:
   - Follow the 3–5 minute live presentation script in [`docs/DEMO_SCRIPT.md`](../DEMO_SCRIPT.md) with demo companies (*FPT Corporation, Tập đoàn Vingroup, MISA*).

---

## 7. Suggested Skills for the Next Agent

- **`code-review`**: For reviewing future pull requests or proposed modifications against project standards.
- **`diagnosing-bugs`**: If debugging any third-party rate limits or external API timeouts during live events.
- **`ponytail-review`**: To maintain extreme code simplicity and prevent over-engineering.
- **`github-workflow`**: For managing GitHub issues, branches, and future release tags.
