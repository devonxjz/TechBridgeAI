# Project Handoff — PartnerIQ (TechBridgeAI)

> **Repository**: [devonxjz/TechBridgeAI](https://github.com/devonxjz/TechBridgeAI)  
> **Current Version**: `0.0.2`  
> **Branch**: `codex/partneriq-langgraph-langfuse`  
> **Status**: ✅ **LangGraph StateGraph & Langfuse Cloud Observability Fully Integrated** (155/155 tests passing across 23 test suites; latest UI/query-budget fixes are uncommitted).

### Current Session Handoff

- TASK-3 quality work is implemented in the working tree but has not been committed or pushed. Do not reset or discard existing changes in `.gitignore` or this handoff file.
- Website-source behavior was corrected: when website discovery has no remaining search-query budget, it returns `skipped`/`0 results` instead of a source failure. A supplied URL still uses the direct scraper path.
- The result form now preserves the last submitted company name and website, so the UI does not fall back to the `https://fpt.com.vn` placeholder after submit.
- The profile result column/card now uses `min-w-0` to prevent long profile content from expanding beyond the viewport.
- Latest verification: `npm test` passed 155/155; `npm run lint` passed with one pre-existing `@next/next/no-img-element` warning in `src/app/page.tsx`; `npm run typecheck` and `npm run build` passed.
- Key files for the latest fixes: `src/modules/research/budget.ts`, `src/modules/workflow/index.ts`, `src/app/hooks/use-research.ts`, `src/app/components/research-form.tsx`, `src/app/page.tsx`, `src/app/components/profile-card.tsx`, and `tests/integration/research-workflow.test.ts`.
- Next recommended check: run the app in a browser and verify both cases—(1) no website URL, where Website should show skipped/0 results without a fatal error; (2) a real submitted URL, where Website should scrape directly. Inspect the request payload if the second case still reports query-budget exhaustion.

---

## 1. Project Overview & Architecture

**PartnerIQ (TechBridgeAI)** is an AI-powered corporate intelligence and partnership assessment platform tailored for Vietnamese enterprises. It provides:
1. **Multi-Source Parallel Autonomous Research**: Gathers corporate intelligence across 5 bounded parallel sources (*VietQR/MST Registry, Official Website, Business News, Web Search, Key People/LinkedIn*).
2. **Deterministic Evidence Engine**: Sanitizes URLs, deduplicates findings, scores confidence, and deterministically sorts evidence.
3. **AI Structured Profile Synthesis**: Builds typed, schema-validated `CompanyProfile` documents using LangChain-backed LLM adapters (`gpt-4o-mini`).
4. **Collaboration Fit Scoring (AnalystModule)**: Evaluates partnership potential (0–100) across 5 weighted criteria (*Industry Alignment 30%, Recent Activity 20%, Size Match 20%, Geographic Relevance 15%, Digital Maturity 15%*) with risk flags and prioritized actionable steps.
5. **"What Changed?" Diff Engine**: Computes schema-level diffs across profile iterations.
6. **Supabase PostgreSQL Multi-Versioning**: Persists versioned snapshots (`company_profiles`, `company_diffs`) using subcollection-style JSONB columns.
7. **Langfuse Cloud Tracing & Privacy Minimization**: End-to-end tracing via OpenTelemetry (`@langfuse/otel`), LangChain callbacks (`@langfuse/langchain`), client-side PII masking, and deterministic quality scoring.

```mermaid
flowchart TD
    START([POST /api/research]) --> FanOut{Parallel Fan-Out\nmaxConcurrency: 3}
    FanOut --> WebSearch[source.web_search\nSerper API]
    FanOut --> Website[source.website\nTiered Scraper]
    FanOut --> News[source.news\nSerper News]
    FanOut --> Registry[source.registry\nVietQR MST API]
    FanOut --> LinkedIn[source.linkedin\nProfile Search]
    
    WebSearch --> FanIn[evidence.prepare\nURL Canonicalization & Dedup]
    Website --> FanIn
    News --> FanIn
    Registry --> FanIn
    LinkedIn --> FanIn
    
    FanIn --> LoadProfile[profile.load\nSupabase Storage]
    LoadProfile --> BuildProfile[profile.build\nLLM Structured Output]
    BuildProfile --> PersistProfile[profile.persist\nSave v(n) to Supabase]
    PersistProfile --> DiffProfile[profile.diff\nCompute Diff vs Existing]
    DiffProfile --> Analyze[analyst.analyze\n5-factor Fit Score]
    Analyze --> EndNode([SSE Stream End & Langfuse Flush])

    subgraph Observability ["🔭 Langfuse Observability & Privacy Boundary"]
        OTel[NodeSDK + LangfuseSpanProcessor]
        Tracing[traceResearch: partneriq.research]
        Masking[maskPartnerIqTelemetryData: Redact PII / Secrets / Raw text]
        Scores[emitResearchScores: source_coverage, profile_confidence, schemas, outcome]
    end
```

---

## 2. Work Completed & Current Status

| Component / Layer | Implementation Details | Verification Status |
| :--- | :--- | :---: |
| **LangGraph Workflow** | `src/modules/workflow/index.ts` StateGraph with 5 fan-out nodes, deterministic fan-in, custom SSE event dispatching. | ✅ 155/155 tests passing |
| **Budget & Guard Rails** | `src/modules/research/budget.ts` tracking LLM token limits, call counts, provider concurrency. | ✅ Tested & verified |
| **Research Matrix & Evidence** | `src/modules/research/queries.ts` & `src/modules/research/evidence.ts` with deterministic ordering & query allocation. | ✅ Tested & verified |
| **Tiered Scraper Engine** | `SafeDirectScraperAdapter` -> `JinaReaderScraperAdapter` -> `TinyFishScraperAdapter` with SSRF protection. | ✅ Tested & verified |
| **Registry Adapter** | `VietQrRegistryAdapter` for official Vietnamese tax code (MST) lookup. | ✅ Tested & verified |
| **Langfuse Cloud Tracing** | `@langfuse/otel` (NodeSDK in `instrumentation.ts`), `@langfuse/langchain` (`CallbackHandler`), `@langfuse/tracing`, deterministic scoring. | ✅ Live trace tested |
| **Privacy Minimization** | Client-side PII redactor (`maskPartnerIqTelemetry`) masking tokens, emails, phone numbers, raw source dumps. | ✅ Tested & verified |
| **Storage & Multi-versioning** | `SupabaseStorageAdapter` with JSONB tables (`company_profiles`, `company_diffs`). | ✅ Tested & verified |
| **UI & Real-Time SSE** | Dark mode glassmorphism UI with real-time SSE progress, profile cards, PDF export. | ✅ Operational |

---

## 3. Directory Layout & Key Files

```
src/
├── adapters/                       # Swappable Hexagonal Ports & Adapters
│   ├── llm/                        # OpenAIAdapter (LangChain ChatOpenAI with structured output)
│   ├── registry/                   # VietQrRegistryAdapter (Vietnamese MST/Registry API)
│   ├── scraper/                    # TieredScraperAdapter (Direct -> Jina -> TinyFish)
│   ├── search/                     # SerperSearchAdapter (Google Search & News)
│   └── storage/                    # SupabaseStorageAdapter & MemoryStorageAdapter
├── app/
│   ├── api/research/route.ts       # Thin SSE Orchestration Route with Langfuse Tracing
│   ├── components/                 # ResearchForm, ResearchProgress, ProfileCard, ExportButtons
│   ├── hooks/use-research.ts       # Real-time SSE state dispatcher
│   ├── globals.css                 # Dark Glassmorphism CSS design system
│   └── page.tsx                    # Main 2-column layout (Form + Real-time Results)
├── config/index.ts                 # Adapter Factory (DI via environment variables) & ResourceGuards
├── instrumentation.ts              # Next.js Node.js runtime hook for Langfuse OpenTelemetry
├── lib/
│   ├── export.ts & export-pdf.tsx  # Markdown, JSON & React-PDF Exporters
│   ├── stream.ts                   # SSE Streaming utilities
│   └── types.ts                    # Zod Schemas & Domain Interfaces
├── modules/
│   ├── analyst/                    # 5-factor Fit Score calculator & risk detector
│   ├── profile/                    # Profile builder & Diff engine
│   ├── research/                   # Query matrix (`queries.ts`), evidence processor (`evidence.ts`), budget (`budget.ts`)
│   └── workflow/                   # LangGraph StateGraph workflow (`index.ts`, `state.ts`)
└── observability/
    └── langfuse.ts                 # Tracing wrapper, PII masking, deterministic scores & OTel SDK
```

---

## 4. Environment & Provider Configuration

- **Configuration Files**: `.env`, `.env.local`
- **Active Providers**:
  - `LLM_PROVIDER=openai` (using `gpt-4o-mini`)
  - `SEARCH_PROVIDER=serper`
  - `SCRAPER_PROVIDER=tiered` (`SCRAPER_DIRECT_ENABLED=true`, `SCRAPER_JINA_ENABLED=true`, `SCRAPER_TINYFISH_ENABLED=true`)
  - `STORAGE_PROVIDER=supabase`
  - `LANGFUSE_ENABLED=true` (`LANGFUSE_BASE_URL=https://us.cloud.langfuse.com`, `LANGFUSE_TRACING_ENVIRONMENT=development`)
- **Secrets & Keys Policy**:
  - All API keys (`OPENAI_API_KEY`, `SERPER_API_KEY`, `JINA_API_KEY`, `TINYFISH_API_KEY`, `SUPABASE_ANON_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`) are managed via `.env.local` and redacted in logs/telemetry.

---

## 5. Verification & Test Suite

- **Vitest Suite**: **155/155 tests passing across 23 test suites** (`npm test`):
  - `tests/unit/`: LangGraph runtime, LangChain LLM, Langfuse observability, evidence preparation, query matrix, tiered scraper, security, registry, types validation, diff engine, export, storage.
  - `tests/integration/`: Research workflow, scraper transport, profile module.
  - `tests/e2e/`: Full SSE streaming pipeline.
- **Type Checking**: TypeScript 7.0.2 / Next.js typegen passing with 0 errors (`npm run typecheck`).
- **Live Query Verification**: Successfully executed live end-to-end query for *Công ty Cổ phần VNG* via `/api/research`, validating SSE event stream, profile synthesis, 5-factor fit score, and trace transmission to Langfuse Cloud.

---

## 6. Next Steps & Recommended Actions

1. **Production Deployment**:
   - Deploy to Vercel or Docker container (`Dockerfile` multi-stage build).
   - Configure production environment variables and set `LANGFUSE_TRACING_ENVIRONMENT=production`.
2. **Langfuse Cloud Monitoring & Dashboards**:
   - Monitor `partneriq.research` traces in [Langfuse Cloud Dashboard](https://us.cloud.langfuse.com/).
   - Set up evaluation dashboards for deterministic scores (`source_coverage`, `profile_confidence`, `research_success`).
3. **Enterprise Extensions**:
   - Add custom criteria weights per user industry in `AnalystModule`.
   - Expand registry connectors for regional registries beyond Vietnam.

---

## 7. Suggested Skills for the Next Agent

- **`code-review`**: For reviewing future PRs or features against established standards.
- **`gsap-core` / `high-end-visual-design`**: For enhancing frontend UI micro-animations and dashboard polish.
- **`diagnosing-bugs`**: For diagnosing any external API rate limits or third-party scraper timeouts.
- **`github-workflow`**: For managing GitHub issues, releases, and CI/CD pipelines.
