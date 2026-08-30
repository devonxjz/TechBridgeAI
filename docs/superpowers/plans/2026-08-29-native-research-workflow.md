# Native Research Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LangGraph/LangChain with native TypeScript orchestration and the OpenAI SDK without changing research behavior.

**Architecture:** One native executor owns state and emits the existing `StreamEvent` union through a callback. Source runners execute through a bounded worker pool backed by `Promise.allSettled()`; `run()` uses a no-op emitter and `stream()` bridges the same executor to a small async queue. OpenAI structured responses use `responses.parse()` with the caller's Zod schema while existing Langfuse observations remain active around workflow steps.

**Tech Stack:** TypeScript, OpenAI SDK, Zod, Vitest, Langfuse tracing, OpenTelemetry

**Spec:** `docs/superpowers/specs/2026-08-29-native-research-workflow-design.md`

## Global Constraints

- Preserve `ResearchWorkflow.run()` and `ResearchWorkflow.stream()` public behavior.
- Preserve SSE payloads, abort propagation, retry/timeout rules, budgets, RRF/evidence, cache, storage, export, and UI behavior.
- Keep Langfuse manual observations, scores, masking, OTel startup, and flush.
- Remove `@langchain/langgraph`, `@langchain/core`, `@langchain/openai`, and `@langfuse/langchain` only.
- Do not add a replacement framework, event bus, agent loop, checkpoint store, or queue dependency.

---

### Task 1: Native OpenAI structured adapter

**Files:**
- Modify: `src/adapters/llm/types.ts`
- Modify: `src/adapters/llm/openai.ts`
- Modify: `src/adapters/llm/index.ts`
- Modify: `tests/helpers/mock-adapters.ts`
- Delete: `tests/unit/langchain-llm.test.ts`
- Create: `tests/unit/openai-llm.test.ts`

**Interfaces:**
- Produces: `LLMAdapter.completeStructured<T>(prompt, schema, options): Promise<T>`.
- Produces: `LLMOptions.schemaName?: string` and `LLMInvocationContext` containing only `signal` and `budget`.

- [ ] Write native-client tests proving Zod parsing, system/user input, abort forwarding, estimated-budget claim, actual usage recording, and null parsed-output rejection.
- [ ] Run `npm test -- tests/unit/openai-llm.test.ts` and confirm it fails because the adapter still expects LangChain.
- [ ] Replace the model factory with an injected minimal OpenAI client exposing `responses.parse()`; call `zodTextFormat(schema, schemaName)` and record `input_tokens`, `output_tokens`, and `total_tokens`.
- [ ] Remove unused free-text completion, model streaming, callback context, and usage-log storage from the interface, adapter, and mock.
- [ ] Run adapter, Profile, Analyst, and budget tests until green.

### Task 2: Native concurrent workflow executor

**Files:**
- Modify: `src/modules/workflow/state.ts`
- Modify: `src/modules/workflow/index.ts`
- Delete: `tests/unit/langgraph-runtime.test.ts`
- Create: `tests/unit/native-workflow-runtime.test.ts`
- Modify: `tests/integration/research-workflow.test.ts`

**Interfaces:**
- Consumes: unchanged source runners and `ResearchBudget`.
- Produces: one `executeWorkflow(input, options, deps, runners, emit)` path used by both `run()` and `stream()`.

- [ ] Add tests with controlled source promises proving overlap, `maxConcurrentSourceNodes`, early finding delivery, partial success after one rejection, abort propagation, exactly-once completion, and equivalent `run()`/`stream()` final state.
- [ ] Run the new workflow tests and confirm they fail against the graph implementation.
- [ ] Convert `ResearchWorkflowState` to a plain interface and delete `Annotation` state/reducers.
- [ ] Implement a minimal bounded mapper that submits active source jobs, collects results via `Promise.allSettled()`, and preserves the skipped LinkedIn result.
- [ ] Replace `dispatchCustomEvent()` with an injected async emitter; preserve the existing retry, timeout, query-budget, source-error, evidence, profile, diff, and analyst logic.
- [ ] Implement a local async event queue for `stream()` and a no-op emitter for `run()`; propagate executor errors once and close once.
- [ ] Run workflow unit/integration/e2e tests until green.

### Task 3: Keep Langfuse without LangChain callbacks

**Files:**
- Modify: `src/observability/langfuse.ts`
- Modify: `src/app/api/research/route.ts`
- Modify: `tests/unit/langfuse-observability.test.ts`
- Modify: `tests/unit/research-route-observability.test.ts`
- Modify: `tests/unit/research-cache-route.test.ts`

**Interfaces:**
- Consumes: existing `traceResearch()`, `observeResearchStep()`, scores, masking, and flush functions.
- Produces: route calls workflow without a `callbacks` option.

- [ ] Update tests to remove `createLangfuseCallback()` mocks/assertions while retaining observation, masking, score, failure, and flush coverage.
- [ ] Run observability and route tests and confirm they fail while callback plumbing remains.
- [ ] Delete the `CallbackHandler` import and `createLangfuseCallback()` function.
- [ ] Remove callback creation and forwarding from the research route; leave the manual root/source/Profile/Analyst observation flow unchanged.
- [ ] Run observability, cache-route, and research-route tests until green.

### Task 4: Dependency cleanup and release verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: any test names/descriptions that still claim LangGraph/LangChain behavior

**Interfaces:**
- Produces: dependency tree with native `openai`, Zod, Langfuse, and OTel only.

- [ ] Run `npm uninstall @langchain/langgraph @langchain/core @langchain/openai @langfuse/langchain`.
- [ ] Run `rg -n '@langchain|@langfuse/langchain|createLangfuseCallback|callbacks:' src tests package.json package-lock.json` and require no production matches.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [ ] Run `git diff --check` and review the diff against every acceptance criterion in the spec.
