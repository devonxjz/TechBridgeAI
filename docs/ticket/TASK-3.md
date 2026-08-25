# TASK-3 — PartnerIQ LangGraph Orchestration & Langfuse Cloud

> **Execution:** Implement ticket-by-ticket. Tickets in the same wave may run in parallel only when their file scopes do not overlap. Every ticket follows RED → GREEN → review → commit.

**Status:** Planned

**Branch:** `codex/partneriq-langgraph-langfuse`

**Goal:** Chuyển workflow research doanh nghiệp sang LangGraph song song có giới hạn, dùng LangChain tại LLM boundary và quan sát toàn bộ run bằng Langfuse Cloud mà không đổi UI/SSE contract.

**Design:** [`docs/superpowers/specs/2026-08-25-partneriq-langgraph-langfuse-design.md`](../superpowers/specs/2026-08-25-partneriq-langgraph-langfuse-design.md)

**Implementation plan:** [`docs/superpowers/plans/2026-08-25-partneriq-langgraph-langfuse.md`](../superpowers/plans/2026-08-25-partneriq-langgraph-langfuse.md)

## Global constraints

- Vercel hosts PartnerIQ; Langfuse Cloud only receives telemetry.
- Client disconnect cancels the run; no queue, durable resume, Agent Server, or checkpointer.
- Preserve existing `StreamEvent` names and payloads.
- Reuse current search, scraper, registry, profile, analyst, and storage modules.
- No `Send`, LLM query planner, `createAgent`, ReAct loop, vector store, or new provider in this epic.
- One retry owner per operation; retry only timeout, 429, 5xx, and network-reset failures.
- Enforce call, token, and concurrency limits before spending.
- Never export raw scraped pages, secrets, authorization/cookie headers, email, or phone to Langfuse.
- Each ticket stages and commits only its declared files.

## Dependency map

```text
T3.1
├── T3.2 ─┐
└── T3.3 ─┴── T3.4
                ├── T3.5
                └── T3.6 ─── T3.7 ─── T3.8
```

Recommended execution waves:

| Wave | Tickets | Parallel rule |
|---|---|---|
| 1 | T3.1 | Sequential compatibility gate |
| 2 | T3.2, T3.3 | Parallel after T3.1; coordinate the small `llm/types.ts` seam before merge |
| 3 | T3.4 | Integrates outputs of Wave 2 |
| 4 | T3.5, T3.6 | Parallel; profile files and route/stream files do not overlap |
| 5 | T3.7 | Starts after route integration is stable |
| 6 | T3.8 | Final integrated verification only |

---

## T3.1 — Runtime and dependency compatibility gate

**Depends on:** none

**Goal:** Pin the exact framework/telemetry versions and prove they compile with the repository's Next.js, Zod, and TypeScript setup before production code depends on them.

**Files:**

- `package.json`
- `package-lock.json`
- `tests/unit/langgraph-runtime.test.ts`

**Deliverables:**

- Exact dependencies:
  - `@langchain/langgraph@1.4.12`
  - `@langchain/core@1.2.9`
  - `@langchain/openai@1.5.10`
  - `@langfuse/tracing@5.10.1`
  - `@langfuse/otel@5.10.1`
  - `@langfuse/langchain@5.10.1`
  - `@opentelemetry/sdk-node@0.221.0`
- A minimal Zod-backed `StateGraph` compile/invoke regression test.
- Lockfile committed with no peer-dependency override.

**Acceptance:**

- `npm test -- tests/unit/langgraph-runtime.test.ts` passes.
- `npm run typecheck` passes.
- No dependency is installed with a floating range.

**Commit:** `chore(ai): pin graph and tracing packages`

---

## T3.2 — Evidence, coverage queries, and pre-spend budgets

**Depends on:** T3.1

**Goal:** Produce deterministic evidence regardless of parallel completion order, expand bounded coverage without an LLM planner, and enforce resource limits before provider/model calls.

**Files:**

- `src/lib/types.ts`
- `src/adapters/llm/types.ts`
- `src/config/index.ts`
- `src/modules/research/evidence.ts`
- `src/modules/research/queries.ts`
- `src/modules/research/budget.ts`
- `src/modules/research/sources/web-search.ts`
- `src/modules/research/sources/news.ts`
- `.env.example`
- `tests/unit/research-evidence.test.ts`
- `tests/unit/research-queries.test.ts`
- `tests/unit/research-budget.test.ts`
- `tests/unit/sources.test.ts`

**Deliverables:**

- `SourceExecutionResult` with `succeeded | failed | skipped`.
- URL validation, canonical deduplication, source-priority ordering, and `complete | partial | failed` outcome.
- Deterministic query categories capped at six: identity, products/services, leadership, recent activity, risk, tax/legal.
- `additionalKeywords` replaces a remaining slot; it never bypasses the cap.
- Per-run LLM call/token budget and FIFO provider-slot limiter.
- Config defaults:
  - `MAX_QUERIES_PER_RESEARCH=6`
  - `MAX_CONCURRENT_SOURCE_NODES=3`
  - `MAX_CONCURRENT_PROVIDER_CALLS=2`

**Acceptance:**

- Reordered source results produce identical prepared evidence order.
- Invalid/non-HTTP(S) URLs are removed.
- Duplicate canonical URLs keep the higher-confidence finding.
- A third provider call waits while two slots are occupied.
- A model call is rejected before exceeding call/token limits.
- Targeted evidence/query/budget/source tests pass.

**Commit:** `feat(research): enforce deterministic evidence budgets`

---

## T3.3 — LangChain-backed LLM adapter

**Depends on:** T3.1

**Goal:** Use LangChain for model invocation and structured output without leaking LangChain types into profile or analyst modules.

**Files:**

- `src/adapters/llm/types.ts`
- `src/adapters/llm/openai.ts`
- `tests/unit/langchain-llm.test.ts`
- `tests/integration/profile-module.test.ts`
- `tests/unit/analyst.test.ts`

**Deliverables:**

- Existing `LLMAdapter.complete`, `completeStructured`, and `stream` signatures remain the application port.
- `ChatOpenAI` is the default model implementation.
- `withStructuredOutput` consumes caller-owned Zod schemas.
- Abort signal, callbacks, normalized usage metadata, and `LLMBudget` are forwarded.
- Exactly one model retry layer.
- Injectable fake model factory for offline contract tests.

**Acceptance:**

- Plain, structured, streaming, cancellation, callbacks, and usage mapping tests pass.
- Profile and analyst tests pass without importing LangChain.
- No second output schema is introduced.

**Commit:** `refactor(llm): use langchain model contracts`

---

## T3.4 — Parallel LangGraph workflow

**Depends on:** T3.2, T3.3

**Goal:** Replace sequential research and route-owned business orchestration with a deterministic StateGraph that preserves partial success.

**Files:**

- `src/modules/research/index.ts`
- `src/modules/workflow/state.ts`
- `src/modules/workflow/index.ts`
- `tests/integration/research-module.test.ts`
- `tests/integration/research-workflow.test.ts`

**Deliverables:**

- Existing source functions exposed as source runners; provider logic is not rewritten.
- Static nodes: `web_search`, `website`, `news`, `registry`, `linkedin`.
- LinkedIn returns `skipped` when no URL exists.
- `sourceResults` append reducer; `prepare_evidence` alone writes final `findings`.
- Downstream order:

```text
prepare_evidence
→ load_existing_profile
→ build_profile
→ persist_profile
→ build_and_persist_diff
→ analyze
→ END
```

- Source errors become typed results after bounded retries; they do not escape the parallel superstep.
- Analyst failure is partial/non-fatal; profile or persistence failure is fatal.

**Acceptance:**

- More than one source runs concurrently.
- `dispatched = succeeded + failed + skipped` for every fixture.
- One source timeout preserves sibling findings and reaches a partial result.
- Zero findings produce no profile write.
- Source completion order does not change prepared evidence order.

**Commit:** `feat(research): orchestrate sources with langgraph`

---

## T3.5 — Untrusted-evidence and conflict policy

**Depends on:** T3.4

**Goal:** Make scraped content an explicit untrusted-data boundary and encode source precedence before profile synthesis.

**Files:**

- `src/modules/profile/index.ts`
- `tests/integration/profile-module.test.ts`

**Deliverables:**

- Every finding is wrapped in an `UNTRUSTED_SOURCE_DATA` delimiter.
- System prompt explicitly forbids following instructions found inside source data.
- Field-sensitive precedence:
  - legal identity: registry → official website → other evidence;
  - products/markets: official website → registry → other evidence;
  - recent activity/risk: news and official announcements remain cited evidence and never override legal identity.
- Existing per-finding content cap and Zod structured output remain.

**Acceptance:**

- Prompt-injection fixture remains visible as evidence but is inside the untrusted boundary.
- Conflict fixture places policy before evidence blocks.
- Profile and diff tests pass.

**Commit:** `fix(profile): isolate untrusted source evidence`

---

## T3.6 — Vercel SSE route and cancellation

**Depends on:** T3.4

**Goal:** Make the API route a thin graph-stream adapter and stop all work when the client aborts.

**Files:**

- `src/app/api/research/route.ts`
- `src/lib/stream.ts`
- Source adapters requiring abort propagation
- `tests/e2e/workflow-e2e.test.ts`

**Deliverables:**

- Route exports `runtime = "nodejs"` and `maxDuration = 300`.
- Workflow deadline is 285 seconds, leaving 15 seconds for terminal SSE and telemetry flush.
- One `researchRunId` per request.
- Request signal reaches graph, fetch-based adapters, and the Node direct scraper socket.
- One guarded writer close in `finally`; no intermediate branch closes the stream.
- Existing SSE events remain compatible.

**Acceptance:**

- A normal run emits `research:start`, profile, diff, analysis, and exactly one `done`.
- Invalid input remains HTTP 400.
- Provider errors retain their useful message.
- Aborted request saves no profile/diff and closes the stream once.
- E2E and typecheck pass.

**Commit:** `refactor(api): stream the research graph`

---

## T3.7 — Langfuse Cloud observability

**Depends on:** T3.6

**Goal:** Produce one privacy-minimized trace per research run with workflow/source/model hierarchy and deterministic quality scores.

**Files:**

- `src/instrumentation.ts`
- `src/observability/langfuse.ts`
- `src/modules/workflow/index.ts`
- `src/app/api/research/route.ts`
- `.env.example`
- `tests/unit/langfuse-observability.test.ts`

**Deliverables:**

- Next.js Node-only instrumentation startup.
- One `partneriq.research` trace with sibling `source.*` observations.
- LangChain/LangGraph callback captures model generations once; no duplicate manual generation span.
- Metadata: `researchRunId`, internal `companyId`, requested sources, app version.
- Client-side masking removes secrets, headers, contact data, and raw page content while preserving valid JSON.
- Root level: default for complete, warning for partial, error for failed/cancelled.
- Deterministic scores:
  - `source_coverage`
  - `profile_schema_valid`
  - `profile_confidence`
  - `analysis_schema_valid`
  - `research_success`
- One flush after root completion; no per-request SDK shutdown.
- Required `LANGFUSE_BASE_URL` comes from the selected Cloud project region; application code does not hard-code a region.

**Acceptance:**

- Unit tests make no network call.
- Trace-shape mock sees one root, source siblings, and nested model generations.
- Masking output contains no configured secret/contact/raw-content fixtures and remains JSON parseable.
- Partial run produces `source_coverage=0.75` for three successes, one failure, and one skipped source.

**Commit:** `feat(observability): trace research in langfuse`

---

## T3.8 — Release and preview verification

**Depends on:** T3.5, T3.7

**Goal:** Prove the integrated workflow is correct, faster than the sequential baseline, privacy-safe in Langfuse, and deployable on Vercel.

**Files:**

- `README.md`
- `docs/plan/ARCHITECTURE.md`
- Tests or production files required only to correct failures introduced by T3.1-T3.7

**Deliverables:**

- Updated architecture and operational setup.
- Vercel env/deadline/cancellation documentation.
- Langfuse Cloud endpoint, masking, trace lookup, and rollback documentation.
- Mock latency benchmark with source delays 100/200/300/400 ms:
  - parallel run under 650 ms;
  - sequential baseline approximately 1,000 ms.
- Fixture coverage checks for FPT, Vingroup, and MISA.
- One preview Langfuse trace reviewed manually.

**Acceptance:**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

All commands exit 0. The handoff records current test counts rather than copying the previous `102/102` result.

Preview verification confirms:

- one trace per research run;
- source observations are siblings;
- model usage/cost appears once;
- no raw scraped page, API key, email, or phone is exported;
- client abort creates no persisted profile version;
- `dispatched = succeeded + failed + skipped`.

**Commit:** `docs(research): document graph operations`

---

## Rollback

- Set `LANGFUSE_ENABLED=false` to disable export without changing workflow behavior.
- Revert T3.4 and T3.6 together to restore sequential orchestration; do not maintain two long-lived production orchestrators.
- Remove framework dependencies only after the old route is restored and the full suite passes.

## Deferred follow-up epic

An LLM query planner and `Send` map-reduce remain deferred. Open a separate epic only when a 20-50-company offline benchmark demonstrates that the deterministic six-query matrix misses the agreed field/citation threshold.
