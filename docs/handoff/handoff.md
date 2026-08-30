# Project Handoff — PartnerIQ (TechBridgeAI)

> **Repository**: [devonxjz/TechBridgeAI](https://github.com/devonxjz/TechBridgeAI)  
> **Current Version**: `0.0.2`  
> **Status**: ✅ **TASK-4: Evidence Provenance & In-App Source Preview Fully Implemented & Verified** (239/239 tests passing across 31 test suites, Next.js build clean, TypeScript typecheck clean).

### Current Session Handoff

- **Task 4 (Sprints 0–8)** has been completely implemented, tested, and verified.
- **Sprint 0 (`feat(evidence): define provenance contracts`)**: Runtime types and Zod schemas for `VerificationStatus`, `PreviewMode`, `RobotsDecision`, `FetchMethod`, `PublicationMetadata`, `PreviewPolicy`, `SourceSignals`, `ClaimEvidence`, `SourceDomainPolicy`, `ProfileField`.
- **Sprint 1 (`feat(news): extract publication metadata`)**: Serper News vertical integration (`/news` endpoint), `SafeDirectScraperAdapter` transient HTML support, publication metadata normalizer (`cheerio@1.2.0`, JSON-LD extraction, OpenGraph, Canonical & AMP URLs, paywall detection, snippet control enforcement).
- **Sprint 2 (`feat(crawl): respect publisher fetch policy`)**: `CrawlPolicy` politeness engine (`robots-parser@3.0.1`, 24h origin cache, process-local domain throttling interval, abort signal propagation).
- **Sprint 3 (`feat(evidence): normalize citations and count independent sources`)**: `prepareEvidence`, `toSourceCitations`, SHA-256 content fingerprint deduplication, `buildClaimEvidence` with independent publisher counting.
- **Sprint 4 (`feat(profile): integrate field-level evidence and provenance citations`)**: `ProfileModule` field-level claim validation, `fieldsContributed` attribution on citations, fallback claim resolution.
- **Sprint 5 (`feat(analyst): resolve claim evidence for fit criteria and risk flags`)**: `AnalystModule` claim evidence resolution across Collaboration Fit Score criteria, Risk Flags, and Suggested Actions.
- **Sprint 6 (`feat(serialization): preserve rich provenance in cache and export payloads`)**: JSONB snapshot multi-version cache serialization, markdown & PDF export preservation.
- **Sprint 7 (`feat(ui): add in-app source preview dialog and field provenance`)**: In-app `SourcePreviewDialog` modal dialog, `EvidenceBadge` status indicators, field provenance inspection, interactive citation preview.
- **Sprint 8 (`docs(evidence): complete TASK-4 evidence provenance and in-app preview`)**: Full test suite green (239 tests in 31 suites), Next.js production build verified, release gates green.

---

## 1. Project Overview & Architecture

**PartnerIQ (TechBridgeAI)** is an AI-powered corporate intelligence and partnership assessment platform tailored for Vietnamese enterprises. It provides:
1. **Multi-Source Parallel Autonomous Research**: Gathers corporate intelligence across 5 bounded parallel sources (*VietQR/MST Registry, Official Website, Business News via Serper News, Web Search, Key People/LinkedIn*).
2. **Polite Crawling & Provenance Engine**: Respects `robots.txt` directives, per-domain throttle spacing, paywall and `nosnippet` policies, and content fingerprinting.
3. **Deterministic Evidence Engine**: Sanitizes URLs, deduplicates findings, scores confidence, counts independent publisher domains, and deterministically sorts evidence.
4. **AI Structured Profile Synthesis**: Builds typed, schema-validated `CompanyProfile` documents with field-level claim evidence using LangChain-backed LLM adapters (`gpt-4o-mini`).
5. **Collaboration Fit Scoring (AnalystModule)**: Evaluates partnership potential (0–100) across 5 weighted criteria (*Industry Alignment 30%, Recent Activity 20%, Size Match 20%, Geographic Relevance 15%, Digital Maturity 15%*) with risk flags and actionable steps backed by claim evidence.
6. **In-App Source Preview**: Inspects article excerpts, publisher metadata, paywall notices, and direct links without speculative Google fallbacks.
7. **"What Changed?" Diff Engine**: Computes schema-level diffs across profile iterations.
8. **Supabase PostgreSQL Multi-Versioning**: Persists versioned snapshots (`company_profiles`, `company_diffs`) using subcollection-style JSONB columns.
9. **Langfuse Cloud Tracing & Privacy Minimization**: End-to-end tracing via OpenTelemetry (`@langfuse/otel`), LangChain callbacks (`@langfuse/langchain`), client-side PII masking, and deterministic quality scoring.

```mermaid
flowchart TD
    START([POST /api/research]) --> FanOut{Parallel Fan-Out\nmaxConcurrency: 3}
    FanOut --> WebSearch[source.web_search\nSerper API]
    FanOut --> Website[source.website\nTiered Scraper]
    FanOut --> News[source.news\nSerper News + CrawlPolicy]
    FanOut --> Registry[source.registry\nVietQR MST API]
    FanOut --> LinkedIn[source.linkedin\nProfile Search]
    
    WebSearch --> FanIn[evidence.prepare\nURL Canonicalization & Dedup & Fingerprints]
    Website --> FanIn
    News --> FanIn
    Registry --> FanIn
    LinkedIn --> FanIn
    
    FanIn --> LoadProfile[profile.load\nSupabase Storage]
    LoadProfile --> BuildProfile[profile.build\nLLM Structured Output + Field Evidence]
    BuildProfile --> PersistProfile[profile.persist\nSave v(n) to Supabase]
    PersistProfile --> DiffProfile[profile.diff\nCompute Diff vs Existing]
    DiffProfile --> Analyze[analyst.analyze\n5-factor Fit Score + Claim Evidence]
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
| **Evidence Provenance (TASK-4)** | Serper News, `CrawlPolicy`, `normalizePublication`, `buildClaimEvidence`, `SourcePreviewDialog`, `EvidenceBadge`. | ✅ 239/239 tests passing |
| **LangGraph Workflow** | `src/modules/workflow/index.ts` StateGraph with 5 fan-out nodes, deterministic fan-in, custom SSE event dispatching. | ✅ Tested & verified |
| **Budget & Guard Rails** | `src/modules/research/budget.ts` tracking LLM token limits, call counts, provider concurrency. | ✅ Tested & verified |
| **Research Matrix & Evidence** | `src/modules/research/queries.ts` & `src/modules/research/evidence.ts` with domain policies & query allocation. | ✅ Tested & verified |
| **Tiered Scraper Engine** | `SafeDirectScraperAdapter` -> `JinaReaderScraperAdapter` -> `TinyFishScraperAdapter` with SSRF protection. | ✅ Tested & verified |
| **Registry Adapter** | `VietQrRegistryAdapter` for official Vietnamese tax code (MST) lookup. | ✅ Tested & verified |
| **Langfuse Cloud Tracing** | `@langfuse/otel` (NodeSDK in `instrumentation.ts`), `@langfuse/langchain` (`CallbackHandler`), `@langfuse/tracing`, deterministic scoring. | ✅ Live trace tested |
| **Privacy Minimization** | Client-side PII redactor (`maskPartnerIqTelemetry`) masking tokens, emails, phone numbers, raw source dumps. | ✅ Tested & verified |
| **Storage & Multi-versioning** | `SupabaseStorageAdapter` with JSONB tables (`company_profiles`, `company_diffs`). | ✅ Tested & verified |
| **UI & Real-Time SSE** | Dark mode glassmorphism UI with real-time SSE progress, profile cards, source preview dialog, PDF export. | ✅ Operational |

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
