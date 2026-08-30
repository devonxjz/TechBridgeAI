# Architecture — PartnerIQ

> Company Intelligence Agent — tự động tạo + cập nhật hồ sơ doanh nghiệp Việt Nam.

## Constraints

| Constraint       | Value                                              |
| ---------------- | -------------------------------------------------- |
| Cuộc thi         | Google AI Hackathon, < 2 tuần còn lại              |
| Team             | Solo developer                                     |
| Language          | TypeScript (full stack)                             |
| Framework        | Next.js (App Router — frontend + API routes)       |
| LLM              | Vendor-agnostic adapter (OpenAI SDK default, swap Gemini/Claude) |
| Database         | Firestore                                          |
| Scraping         | tinyfish.app                                       |
| Target market    | Công ty Việt Nam                                   |
| Streaming        | Yes — real-time progress + partial results          |
| Max concurrency  | 1–2 concurrent research jobs (solo demo budget)     |

---

## 1. Module Map

Hệ thống gồm **3 deep modules** + **1 thin orchestration layer**. Mỗi module có interface nhỏ, implementation sâu.

```
┌──────────────────────────────────────────────────────────┐
│                    Next.js App Router                     │
│                                                          │
│  ┌─────────────┐  ┌──────────────────────────────────┐  │
│  │  Frontend    │  │  API Routes (/api/research/*)    │  │
│  │  (React)     │←→│  Thin orchestration layer        │  │
│  └─────────────┘  └──────────┬───────────────────────┘  │
│                              │                           │
└──────────────────────────────┼───────────────────────────┘
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
            ┌─────────┐ ┌──────────┐ ┌─────────┐
            │Research  │ │ Profile  │ │ Analyst │
            │Module    │ │ Module   │ │ Module  │
            └────┬────┘ └──────────┘ └─────────┘
                 │
        ┌────────┼────────┬────────┐
        ▼        ▼        ▼        ▼
    ┌───────┐┌───────┐┌───────┐┌───────┐
    │Search ││Scraper││Registry││LLM    │
    │Adapter││Adapter││Adapter ││Adapter│
    └───────┘└───────┘└───────┘└───────┘
```

### Module Interfaces

```typescript
// ═══════════════════════════════════════════════════════
// ResearchModule — gathers raw data from multiple sources
// ═══════════════════════════════════════════════════════
interface ResearchModule {
  research(input: CompanyInput): AsyncGenerator<ResearchEvent>
}

// Events streamed during research
type ResearchEvent =
  | { type: "progress"; source: SourceName; status: "started" | "done" | "failed" }
  | { type: "finding"; finding: RawFinding }
  | { type: "complete"; findings: RawFinding[] }
  | { type: "error"; source: SourceName; error: string }

// ═══════════════════════════════════════════════════════
// ProfileModule — builds structured profile from raw data
// ═══════════════════════════════════════════════════════
interface ProfileModule {
  buildProfile(findings: RawFinding[]): Promise<CompanyProfile>
  diffProfiles(current: CompanyProfile, previous: CompanyProfile): ProfileDiff
}

// ═══════════════════════════════════════════════════════
// AnalystModule — analyzes profile and produces insights
// ═══════════════════════════════════════════════════════
interface AnalystModule {
  analyze(profile: CompanyProfile, context?: AnalysisContext): Promise<AnalysisReport>
}
```

### Thin Orchestration Layer (API Route & LangGraph)

API route **chỉ là adapter mỏng** (`runtime = "nodejs"`, `maxDuration = 300`) — khởi tạo `createResearchWorkflow(deps)` và stream sự kiện Server-Sent Events qua `stream(input, options)`.

```typescript
// /api/research/route.ts — pseudocode
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const input = CompanyInputSchema.parse(await req.json());
  const workflow = createResearchWorkflow(deps);
  const { stream, writer } = createSSEStream();

  const langfuseCallback = createLangfuseCallback({
    researchRunId,
    companyId: slugify(input.name),
    requestedSources,
  });

  (async () => {
    try {
      for await (const event of workflow.stream(input, {
        researchRunId,
        signal: controller.signal,
        callbacks: langfuseCallback ? [langfuseCallback] : undefined,
      })) {
        writer.write(event);
      }
    } finally {
      await flushLangfuse();
      writer.close();
    }
  })();

  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}
```

### LangGraph Parallel StateGraph Architecture

Đồ thị trạng thái (`StateGraph`) điều phối việc thu thập và phân tích dữ liệu một cách độc lập và song song:

```
                  ┌───────────────┐
                  │     START     │
                  └───────┬───────┘
          ┌───────────────┼───────────────┬───────────────┬───────────────┐
          ▼               ▼               ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
    │web_search │   │  website  │   │   news    │   │ registry  │   │ linkedin  │
    └─────┬─────┘   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
          └───────────────┼───────────────┴───────────────┴───────────────┘
                          ▼
                ┌──────────────────┐
                │ prepare_evidence │ (Deterministic Canonicalization & Deduplication)
                └─────────┬────────┘
                          ▼
                ┌──────────────────┐
                │load_exist_profile│
                └─────────┬────────┘
                          ▼
                ┌──────────────────┐
                │  build_profile   │ (LLM with Untrusted-Data Delimiters)
                └─────────┬────────┘
                          ▼
                ┌──────────────────┐
                │ persist_profile  │
                └─────────┬────────┘
                          ▼
                ┌──────────────────┐
                │build_persist_diff│
                └─────────┬────────┘
                          ▼
                ┌──────────────────┐
                │     analyze      │ (Analyst Module)
                └─────────┬────────┘
                          ▼
                  ┌───────────────┐
                  │      END      │
                  └───────────────┘
```

---

## 2. Domain Model (Data Schemas)

```typescript
// ═══════════════════════════════════════
// Input
// ═══════════════════════════════════════
interface CompanyInput {
  name: string                    // Tên công ty (bắt buộc)
  website?: string                // URL website
  taxId?: string                  // Mã số thuế
  linkedinUrl?: string            // LinkedIn Company URL (optional, user-provided)
  additionalKeywords?: string[]   // Từ khóa bổ sung
}

// ═══════════════════════════════════════
// Raw findings from sources
// ═══════════════════════════════════════
type SourceName = "web_search" | "website" | "registry" | "news" | "linkedin"

interface RawFinding {
  source: SourceName
  url: string
  content: string                 // Raw extracted text
  extractedAt: Date
  confidence: number              // 0.0 – 1.0
  metadata?: Record<string, unknown>
}

// ═══════════════════════════════════════
// Structured Company Profile
// ═══════════════════════════════════════
interface CompanyProfile {
  id: string                      // Firestore doc ID
  version: number                 // Auto-increment
  createdAt: Date
  input: CompanyInput             // Original input that produced this

  // Core fields
  officialName: string
  tradingNames: string[]          // Aliases, abbreviations
  taxId?: string
  industry: string[]
  description: string             // 2-3 paragraph summary
  foundedYear?: number
  headquarters?: Address
  website?: string

  // People
  keyPeople: Person[]

  // Business
  products: string[]
  markets: string[]               // Geographic markets
  companySize?: CompanySize
  revenue?: RevenueRange

  // Activity
  recentActivities: Activity[]    // News, events, announcements
  lastUpdated: Date

  // Meta
  sources: SourceCitation[]       // Every fact traceable to a source
  overallConfidence: number       // Weighted average
}

interface Person {
  name: string
  title: string
  source: SourceName
  confidence: number
}

interface Activity {
  date: Date
  title: string
  summary: string
  url: string
  source: SourceName
}

interface SourceCitation {
  source: SourceName
  url: string
  accessedAt: Date
  fieldsContributed: string[]     // Which profile fields this source informed
}

type CompanySize = "1-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1000+"
type RevenueRange = "< 1B VND" | "1-10B VND" | "10-100B VND" | "100B-1T VND" | "> 1T VND"

// ═══════════════════════════════════════
// Profile Diff
// ═══════════════════════════════════════
interface ProfileDiff {
  companyId: string
  fromVersion: number
  toVersion: number
  changes: FieldChange[]
  summary: string                 // LLM-generated human-readable summary
}

interface FieldChange {
  field: string                   // Dot-path, e.g. "keyPeople[0].title"
  oldValue: unknown
  newValue: unknown
  changeType: "added" | "removed" | "modified"
  significance: "high" | "medium" | "low"  // LLM-assessed
}

// ═══════════════════════════════════════
// Analysis Report
// ═══════════════════════════════════════
interface AnalysisReport {
  companyId: string
  generatedAt: Date
  fitScore?: FitScore
  riskFlags: RiskFlag[]
  suggestedActions: SuggestedAction[]
  executiveSummary: string
}

interface FitScore {
  score: number                   // 0-100
  reasoning: string
  criteria: { name: string; score: number; weight: number }[]
}

interface RiskFlag {
  type: "legal" | "financial" | "reputation" | "operational"
  description: string
  severity: "high" | "medium" | "low"
  source: SourceName
}

interface SuggestedAction {
  action: string
  priority: "high" | "medium" | "low"
  reasoning: string
}

interface AnalysisContext {
  previousProfile?: CompanyProfile
  sponsorCriteria?: string        // What the sponsor looks for in partners
}
```

---

## 3. Seam Placement

Áp dụng nguyên tắc: **"Two adapters means a real seam"** — chỉ tạo interface/adapter cho dependency thực sự cần swap.

### Real Seams (≥ 2 adapters)

```
┌─────────────┐     ┌─────────────────────────┐
│  LLMAdapter │     │ Production: OpenAI SDK   │
│             │────→│ Alt: Gemini API          │
│  (Port)     │     │ Alt: Anthropic API       │
│             │     │ Test: Deterministic mock  │
└─────────────┘     └─────────────────────────┘

┌─────────────┐     ┌─────────────────────────┐
│SearchAdapter│     │ Production: Google Search│
│             │────→│ Alt: Serper / Tavily     │
│  (Port)     │     │ Test: Cached results     │
└─────────────┘     └─────────────────────────┘

┌─────────────┐     ┌─────────────────────────┐
│ScraperAdapter│    │ Production: tinyfish.app │
│             │────→│ Alt: Jina / Firecrawl    │
│  (Port)     │     │ Test: HTML fixtures      │
└─────────────┘     └─────────────────────────┘

┌─────────────┐     ┌─────────────────────────┐
│StorageAdapter│    │ Production: Firestore    │
│             │────→│ Alt: PostgreSQL          │
│  (Port)     │     │ Test: In-memory Map      │
└─────────────┘     └─────────────────────────┘
```

### Adapter Interfaces

```typescript
// ─── LLM ───
interface LLMAdapter {
  complete(prompt: string, options?: LLMOptions): Promise<string>
  completeStructured<T>(prompt: string, schema: ZodSchema<T>, options?: LLMOptions): Promise<T>
  stream(prompt: string, options?: LLMOptions): AsyncGenerator<string>
}

interface LLMOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

// ─── Search ───
interface SearchAdapter {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>
}

interface SearchResult {
  title: string
  url: string
  snippet: string
}

// ─── Scraper ───
interface ScraperAdapter {
  extract(url: string): Promise<ScrapedContent>
}

interface ScrapedContent {
  url: string
  title: string
  text: string                    // Cleaned text content
  html?: string                   // Raw HTML if needed
  metadata?: Record<string, string>
}

// ─── Storage ───
interface StorageAdapter {
  saveProfile(profile: CompanyProfile): Promise<void>
  getProfile(companyId: string, version?: number): Promise<CompanyProfile | null>
  getLatestProfile(companyId: string): Promise<CompanyProfile | null>
  listProfiles(): Promise<CompanyProfile[]>
  saveDiff(diff: ProfileDiff): Promise<void>
  getDiffs(companyId: string): Promise<ProfileDiff[]>
}
```

### No Seam Needed (in-process, pure computation)

Những module này **test trực tiếp qua interface** — không cần adapter:

- **Entity Resolution** — fuzzy matching + LLM verify → pure function `resolveEntities(findings) → ResolvedFindings`
- **Diff Engine** — so sánh 2 profiles → pure function `diffProfiles(a, b) → ProfileDiff`
- **Profile Normalization** — chuẩn hóa schema → pure function `normalize(rawData) → Partial<CompanyProfile>`

---

## 4. Directory Structure

```
TechBridgeAI/
├── SPEC.md
├── ARCHITECTURE.md
├── package.json
├── tsconfig.json
├── next.config.ts
│
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # Landing / dashboard
│   │   ├── research/
│   │   │   └── page.tsx              # Research UI (input + results)
│   │   ├── profile/
│   │   │   └── [id]/
│   │   │       └── page.tsx          # Profile view + diff
│   │   └── api/
│   │       └── research/
│   │           └── route.ts          # Streaming endpoint (thin orchestration)
│   │
│   ├── modules/                      # Deep modules
│   │   ├── research/
│   │   │   ├── index.ts              # ResearchModule interface + factory
│   │   │   ├── research.ts           # Implementation
│   │   │   └── sources/              # Per-source extraction logic
│   │   │       ├── web-search.ts
│   │   │       ├── website.ts
│   │   │       ├── registry.ts
│   │   │       ├── news.ts
│   │   │       └── linkedin.ts       # Optional, user-provided URL only
│   │   │
│   │   ├── profile/
│   │   │   ├── index.ts              # ProfileModule interface + factory
│   │   │   ├── profile-builder.ts    # Build profile from findings
│   │   │   ├── entity-resolution.ts  # Pure function, no seam
│   │   │   ├── normalizer.ts         # Pure function, no seam
│   │   │   └── diff-engine.ts        # Pure function, no seam
│   │   │
│   │   └── analyst/
│   │       ├── index.ts              # AnalystModule interface + factory
│   │       ├── analyst.ts            # Analysis implementation
│   │       ├── fit-score.ts          # Scoring logic
│   │       └── prompts.ts            # LLM prompt templates
│   │
│   ├── adapters/                     # Seam implementations
│   │   ├── llm/
│   │   │   ├── types.ts              # LLMAdapter interface
│   │   │   ├── openai.ts             # OpenAI SDK adapter
│   │   │   ├── gemini.ts             # Gemini API adapter
│   │   │   └── mock.ts               # Test adapter
│   │   │
│   │   ├── search/
│   │   │   ├── types.ts              # SearchAdapter interface
│   │   │   ├── google.ts             # Google Search adapter
│   │   │   ├── serper.ts             # Serper adapter (nếu cần)
│   │   │   └── mock.ts               # Test adapter
│   │   │
│   │   ├── scraper/
│   │   │   ├── types.ts              # ScraperAdapter interface
│   │   │   ├── tinyfish.ts           # tinyfish.app adapter
│   │   │   └── mock.ts               # Test adapter
│   │   │
│   │   └── storage/
│   │       ├── types.ts              # StorageAdapter interface
│   │       ├── firestore.ts          # Firestore adapter
│   │       └── memory.ts             # In-memory adapter (test + dev)
│   │
│   ├── config/
│   │   └── index.ts                  # Adapter selection, env vars
│   │
│   └── lib/
│       ├── stream.ts                 # SSE / streaming utilities
│       └── types.ts                  # Shared domain types (re-exported)
│
├── tests/
│   ├── modules/
│   │   ├── research.test.ts          # Test with mock adapters
│   │   ├── profile.test.ts           # Test pure functions directly
│   │   ├── entity-resolution.test.ts # Pure function tests
│   │   ├── diff-engine.test.ts       # Pure function tests
│   │   └── analyst.test.ts           # Test with mock LLM
│   │
│   ├── adapters/
│   │   ├── openai.test.ts            # Integration test (needs API key)
│   │   └── firestore.test.ts         # Integration test (needs emulator)
│   │
│   └── fixtures/
│       ├── fpt-corporation.json      # Pre-scraped test data
│       └── vingroup.json
│
└── .env.example
```

---

## 5. Error Contracts

### Source-level errors

Mỗi source trong ResearchModule có thể fail. Contract:

```typescript
// Một source fail → KHÔNG fail toàn bộ research
// Trả finding với confidence = 0 + error metadata

type SourceResult =
  | { ok: true; findings: RawFinding[] }
  | { ok: false; error: SourceError }

interface SourceError {
  source: SourceName
  type: "timeout" | "blocked" | "empty" | "parse_error" | "network_error"
  message: string
  retryable: boolean
}
```

### Retry policy

| Error type    | Retry | Max attempts | Backoff      |
| ------------- | ----- | ------------ | ------------ |
| timeout       | Yes   | 2            | 1s, 3s       |
| network_error | Yes   | 2            | 1s, 3s       |
| blocked       | No    | —            | —            |
| empty         | No    | —            | —            |
| parse_error   | No    | —            | —            |

### Profile confidence threshold

```
overallConfidence = weighted average of all findings' confidence
  - web_search:  weight 0.2
  - website:     weight 0.3
  - registry:    weight 0.3
  - news:        weight 0.15
  - linkedin:    weight 0.05

Nếu overallConfidence < 0.3 → trả profile với flag lowConfidence = true
Nếu không có finding nào succeed → trả error, KHÔNG tạo profile
```

### Cost & Rate Limit Guards

```typescript
// src/config/guards.ts

interface ResourceGuards {
  // Per-research limits
  maxConcurrentResearch: number       // Default: 1 (solo demo)
  sourceTimeoutMs: number             // Default: 15_000 (15s per source)
  maxRetriesPerSource: number         // Default: 2

  // LLM budget
  maxTokensPerResearch: number        // Default: 50_000 (across all LLM calls in 1 research)
  maxLLMCallsPerResearch: number      // Default: 10

  // Scraper throttle
  scraperDelayMs: number              // Default: 1_000 (1s between scrape requests)
  maxScrapePagesPerResearch: number   // Default: 5

  // Daily caps (protect against runaway costs)
  maxResearchPerDay: number           // Default: 50
  maxTokensPerDay: number             // Default: 500_000
}

const DEFAULT_GUARDS: ResourceGuards = {
  maxConcurrentResearch: 1,
  sourceTimeoutMs: 15_000,
  maxRetriesPerSource: 2,
  maxTokensPerResearch: 50_000,
  maxLLMCallsPerResearch: 10,
  scraperDelayMs: 1_000,
  maxScrapePagesPerResearch: 5,
  maxResearchPerDay: 50,
  maxTokensPerDay: 500_000,
}
```

**Token usage logging**: Mỗi LLM call log `{ model, promptTokens, completionTokens, cost }` vào console + optional Firestore `usage_logs` collection. Cho phép theo dõi chi phí real-time.

**Circuit breaker**: Nếu 3 LLM calls liên tiếp fail (rate limit / 5xx) → dừng research, trả partial result + error event qua SSE.

---

## 6. Streaming Strategy

Client ↔ Server communication dùng **Server-Sent Events (SSE)**:

```typescript
// Server → Client events (qua SSE)
type StreamEvent =
  | { event: "research:start"; data: { sources: SourceName[] } }
  | { event: "research:progress"; data: { source: SourceName; status: string } }
  | { event: "research:finding"; data: { source: SourceName; summary: string } }
  | { event: "profile:building"; data: { message: string } }
  | { event: "profile:ready"; data: { profile: CompanyProfile } }
  | { event: "diff:ready"; data: { diff: ProfileDiff | null } }
  | { event: "analysis:ready"; data: { report: AnalysisReport } }
  | { event: "error"; data: { message: string; source?: SourceName } }
  | { event: "done"; data: {} }
```

Frontend hiển thị real-time:
1. "Đang tìm kiếm trên web..." → "✓ Tìm thấy 5 kết quả"
2. "Đang đọc website công ty..." → "✓ Đã trích xuất thông tin"
3. "Đang tra cứu đăng ký doanh nghiệp..." → "✓ / ✗"
4. "Đang tổng hợp hồ sơ..." → Profile card hiện dần
5. "Đang phân tích..." → Analysis report

---

## 7. Testing Strategy

### Phân loại tests theo module depth

| Layer | What | How | Adapter needed? |
|-------|------|-----|-----------------|
| Pure functions | entity-resolution, diff-engine, normalizer | Direct function call, assert output | No |
| Deep modules | ResearchModule, ProfileModule, AnalystModule | Inject mock adapters | Mock LLM, Mock Search, etc. |
| Adapters | OpenAI, Firestore, tinyfish | Integration test (needs real API) | N/A — they ARE the adapter |
| E2E | Full pipeline | Mock all external, assert final profile | All mocks |

### Test fixtures

Chuẩn bị sẵn test data cho 3-5 công ty VN:
- **FPT Corporation** — công ty lớn, nhiều thông tin
- **VinGroup** — tập đoàn, nhiều subsidiaries
- **1 startup nhỏ** — ít thông tin, test low-confidence path
- **1 công ty đổi tên** — test entity resolution

### Priority cho solo dev (< 2 tuần)

1. ✅ Unit tests cho pure functions (entity resolution, diff) — **chạy nhanh, giá trị cao**
2. ✅ Integration test cho LLM adapter (1 test golden path) — **catch API changes**
3. ⚠️ E2E test — **nice to have**, tập trung manual testing cho demo

---

## 7.5. Firestore Data Model

### Versioning strategy: Subcollection

Mỗi company là 1 document, mỗi version là 1 subdocument trong subcollection `versions`.

```
Firestore structure:

companies/
  {companyId}/
    latestVersion: 3                    # Denormalized for quick reads
    input: CompanyInput                 # Original input
    createdAt: Timestamp
    updatedAt: Timestamp
    │
    └── versions/                       # Subcollection
        1/ → CompanyProfile (version 1)
        2/ → CompanyProfile (version 2)
        3/ → CompanyProfile (version 3)
    │
    └── diffs/                          # Subcollection
        1-2/ → ProfileDiff (v1 → v2)
        2-3/ → ProfileDiff (v2 → v3)
```

**Lý do chọn subcollection thay vì array**:
- Profile lớn (nhiều fields, citations, activities) → array trong 1 document sẽ vượt 1MB limit
- Query từng version riêng lẻ dễ hơn
- Firestore charges per document read, nhưng profile thường chỉ đọc latest → không tốn thêm

---

## 8. Adapter Factory (DI without framework)

```typescript
// src/config/index.ts
import { LLMAdapter } from "@/adapters/llm/types"
import { OpenAIAdapter } from "@/adapters/llm/openai"
import { GeminiAdapter } from "@/adapters/llm/gemini"
import { MockLLMAdapter } from "@/adapters/llm/mock"

export function createLLMAdapter(): LLMAdapter {
  switch (process.env.LLM_PROVIDER) {
    case "openai":  return new OpenAIAdapter(process.env.OPENAI_API_KEY!)
    case "gemini":  return new GeminiAdapter(process.env.GEMINI_API_KEY!)
    case "mock":    return new MockLLMAdapter()
    default:        return new OpenAIAdapter(process.env.OPENAI_API_KEY!)
  }
}

// Tương tự cho search, scraper, storage adapters
// Modules nhận adapters qua constructor (dependency injection)

export function createResearchModule(): ResearchModule {
  return new ResearchModuleImpl(
    createLLMAdapter(),
    createSearchAdapter(),
    createScraperAdapter()
  )
}
```

**Swap provider = thay 1 env var.** Không cần sửa code.

---

## 9. Environment Variables

```bash
# .env.example

# LLM — swap bằng cách đổi LLM_PROVIDER
LLM_PROVIDER=openai              # openai | gemini | mock
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...

# Search
SEARCH_PROVIDER=google            # google | serper | mock
GOOGLE_SEARCH_API_KEY=...
GOOGLE_SEARCH_CX=...

# Scraper
SCRAPER_PROVIDER=tinyfish          # tinyfish | jina | mock
TINYFISH_API_KEY=...

# Storage
STORAGE_PROVIDER=firestore         # firestore | memory
GOOGLE_PROJECT_ID=...

# App
NODE_ENV=development

# Rate limit guards (optional overrides)
MAX_CONCURRENT_RESEARCH=1
SOURCE_TIMEOUT_MS=15000
MAX_RESEARCH_PER_DAY=50
MAX_TOKENS_PER_DAY=500000
```

---

## 9.5. Security Basics

### Input sanitization

```typescript
// Validate + sanitize all user input before passing to modules
function sanitizeCompanyInput(raw: unknown): CompanyInput {
  // 1. Zod schema validation (type + length limits)
  const parsed = CompanyInputSchema.parse(raw)

  // 2. Sanitize strings — strip HTML, limit length
  return {
    name: sanitizeString(parsed.name, { maxLength: 200 }),
    website: parsed.website ? sanitizeUrl(parsed.website) : undefined,
    taxId: parsed.taxId ? sanitizeTaxId(parsed.taxId) : undefined,
    linkedinUrl: parsed.linkedinUrl ? sanitizeUrl(parsed.linkedinUrl) : undefined,
    additionalKeywords: parsed.additionalKeywords?.map(k => sanitizeString(k, { maxLength: 100 })).slice(0, 5),
  }
}
```

### API rate limiting

```typescript
// Simple in-memory rate limiter for API routes
// Next.js middleware hoặc per-route check
const RATE_LIMIT = {
  windowMs: 60_000,      // 1 minute window
  maxRequests: 10,        // Max 10 research requests per minute
}
```

### Key security

- **NEVER** expose API keys ở client-side code
- Tất cả LLM/Search/Scraper calls đi qua API routes (server-side only)
- `.env.local` trong `.gitignore`
- Sử dụng `NEXT_PUBLIC_` prefix CHỈ cho non-sensitive config (app name, feature flags)

---

## 11. Fit Score — Tiêu chí & Trọng số

Fit Score đánh giá tiềm năng hợp tác dựa trên **5 tiêu chí cố định** với trọng số có thể điều chỉnh:

```typescript
interface FitCriteria {
  name: string
  weight: number          // 0.0 – 1.0, tổng = 1.0
  score: number           // 0 – 100, LLM-assessed
  reasoning: string       // 1-2 câu giải thích
}

const DEFAULT_FIT_CRITERIA = [
  { name: "Industry Alignment",   weight: 0.30 },  // Ngành có liên quan/bổ trợ không?
  { name: "Company Size Match",   weight: 0.20 },  // Quy mô phù hợp hợp tác không?
  { name: "Geographic Relevance", weight: 0.15 },  // Địa bàn hoạt động overlap không?
  { name: "Digital Maturity",     weight: 0.15 },  // Mức độ số hóa (website, online presence)?
  { name: "Recent Activity",      weight: 0.20 },  // Có hoạt động gần đây không? Đang phát triển/thu hẹp?
]

// Final score = Σ (criteria[i].score × criteria[i].weight)
// Interpretation:
//   80-100: Tiềm năng cao — nên liên hệ
//   60-79:  Tiềm năng trung bình — cần tìm hiểu thêm
//   40-59:  Tiềm năng thấp — có rủi ro
//   0-39:   Không phù hợp
```

**Sponsor criteria (optional)**: Nếu user cung cấp mô tả sponsor ("chúng tôi là công ty fintech, tìm đối tác logistics"), LLM sẽ điều chỉnh scoring dựa trên context đó thay vì dùng default.

---

## 12. Registry Source — Risk Assessment

> [!WARNING]
> Cổng thông tin đăng ký doanh nghiệp Việt Nam (dangkykinhdoanh.gov.vn) **không có API công khai ổn định**. Đây là nguồn giá trị cao nhất cho công ty VN nhưng cũng rủi ro cao nhất.

### Prototype strategy (Ngày 1-2)

```
Ngày 1-2: Thử 3 approach theo thứ tự
  1. tinyfish.app scrape dangkykinhdoanh.gov.vn → OK? → Dùng luôn
  2. Google Search "[tên công ty] mã số thuế site:dangkykinhdoanh.gov.vn" → Parse snippet
  3. Tìm dịch vụ trung gian (thongtindoanhnghiep.co, masothue.com) → Scrape

Nếu cả 3 fail hoặc quá unstable:
  → Hạ xuống "nice-to-have", ghi rõ trong demo:
    "Registry integration planned, currently using web search as fallback"
  → Tăng weight web_search lên 0.35, giảm registry về 0.15
```

### Fallback chain

```typescript
// Trong ResearchModule, registry source có fallback tích hợp:
async function fetchRegistryData(input: CompanyInput): Promise<SourceResult> {
  // 1. Try official registry scrape
  const official = await tryOfficialRegistry(input.taxId ?? input.name)
  if (official.ok) return official

  // 2. Fallback: search aggregator sites
  const aggregator = await tryAggregatorSites(input.name)
  if (aggregator.ok) return { ...aggregator, confidence: aggregator.confidence * 0.8 }  // Lower confidence

  // 3. Fallback: Google Search for registry info
  const searchFallback = await trySearchForRegistry(input.name)
  if (searchFallback.ok) return { ...searchFallback, confidence: searchFallback.confidence * 0.6 }

  return { ok: false, error: { source: "registry", type: "empty", message: "No registry data found", retryable: false } }
}
```

---

## 13. MVP Scope Prioritization (< 2 tuần, solo)

> [!IMPORTANT]
> Timeline thực tế cho 1 người. Không lạc quan hóa.

### Days 1-2: Foundation + Registry Prototype

- [ ] Project setup (Next.js, TypeScript, path aliases)
- [ ] Domain types (`src/lib/types.ts`) — tất cả interfaces
- [ ] LLM adapter (OpenAI — 1 file)
- [ ] **Registry prototype** — thử scrape/search, quyết định feasibility

### Days 3-5: Core Research Pipeline

- [ ] Search adapter (Serper hoặc Google Search)
- [ ] Scraper adapter (tinyfish)
- [ ] ResearchModule — web_search + website sources
- [ ] ProfileModule — basic profile builder (LLM-powered)
- [ ] Storage: **in-memory adapter** (chưa Firestore)
- [ ] API route with SSE streaming (basic)

### Days 6-7: Minimal UI + E2E Working

- [ ] UI tối giản — input form + streaming progress log + profile card
- [ ] E2E hoạt động: nhập tên → thấy profile
- [ ] **Checkpoint: demo được cho chính mình**

---

### Days 8-9: Differentiation Features

- [ ] News source
- [ ] Registry source (nếu prototype thành công) hoặc skip
- [ ] Diff engine ("What changed?") — pure function
- [ ] Firestore adapter (thay in-memory)

### Days 10-11: Analysis + Polish

- [ ] AnalystModule — executive summary + fit score (5 criteria)
- [ ] Diff view UI
- [ ] Citations panel (mỗi fact → link nguồn)
- [ ] Profile export (Markdown, PDF nếu dư sức)

### Days 12-13: Deploy + Demo Prep

- [ ] Deploy (Vercel hoặc Cloud Run)
- [ ] UI polish — responsive, animations, loading states
- [ ] Entity resolution (nếu dư sức) hoặc skip
- [ ] Demo script viết sẵn + 2-3 công ty test
- [ ] Record demo video

### Cắt bỏ nếu hết thời gian (theo thứ tự ưu tiên cắt)

1. ~~Entity resolution~~ → LLM tự handle inline, không cần module riêng
2. ~~PDF export~~ → Markdown export đủ
3. ~~Registry source~~ → Nếu prototype fail, dùng Google Search fallback
4. ~~Fit Score~~ → Giữ executive summary, bỏ numeric scoring
