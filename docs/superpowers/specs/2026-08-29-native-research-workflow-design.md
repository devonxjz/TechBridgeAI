# Native Research Workflow Design

**Date:** 2026-08-29

**Status:** Approved direction; implementation pending

## Goal

Replace LangGraph and LangChain with native TypeScript orchestration and the
OpenAI SDK while preserving parallel research, SSE progress, cancellation,
partial failure, budgets, evidence provenance, RRF ranking, and Langfuse/OTel
observability.

This design supersedes only the orchestration and model-integration decisions
in `2026-08-25-partneriq-langgraph-langfuse-design.md`. Existing evidence,
security, storage, cache, export, and UI behavior remains unchanged.

## Decisions

1. Remove `@langchain/langgraph`, `@langchain/core`, `@langchain/openai`, and
   `@langfuse/langchain`.
2. Keep `openai`, Zod, `@langfuse/client`, `@langfuse/tracing`,
   `@langfuse/otel`, and `@opentelemetry/sdk-node`.
3. Keep the public `ResearchWorkflow.run()` and `ResearchWorkflow.stream()`
   interface so the API route and cache flow do not need a redesign.
4. Execute active source runners concurrently with `Promise.allSettled()`.
5. Keep the existing provider-slot guard, per-source retry, timeout, query
   budget, model-call budget, and abort propagation.
6. Keep the LLM seam, but reduce it to the one production operation actually
   used: `completeStructured()`.
7. Use `OpenAI.responses.parse()` with `zodTextFormat()` for structured output.
8. Keep Langfuse manual workflow/source/profile/analyst observations, scores,
   masking, OTel initialization, and flush. Remove only the LangChain callback.
9. Do not add an agent loop, tool framework, checkpoint store, event bus
   dependency, queue, or replacement orchestration framework.

## Native workflow

```text
web_search ─┐
website ────┤
news ───────┼─ Promise.allSettled ─ evidence/RRF ─ profile ─ diff ─ analyst
registry ───┤
linkedin ───┘
```

All active source tasks are submitted before awaiting any one result. A small
native worker pool runs at most `maxConcurrentSourceNodes` tasks at once;
`maxConcurrentProviderCalls` continues to limit search, scraper, and registry
calls inside those runners.

Each runner emits `started`, findings, and `done` or `failed` through an
in-process callback. `stream()` bridges that callback to its existing async
generator with a minimal local queue. `run()` uses the same execution function
with a no-op emitter. There is one orchestration implementation, not separate
run and stream pipelines.

`Promise.allSettled()` is required rather than `Promise.all()` so a failed
source cannot cancel successful siblings. Source failures are converted to the
existing `SourceExecutionResult`; evidence preparation runs after all active
sources settle.

## State and event contracts

`ResearchWorkflowState` becomes a plain TypeScript interface. Delete the
LangGraph `Annotation` schema and reducers. The native executor owns state
updates directly and preserves these invariants:

- `sourceResults` contains exactly one result per active source, plus a skipped
  LinkedIn result when no LinkedIn URL was supplied.
- `findings` is written once from `prepareEvidence(sourceResults)`.
- Profile runs only when prepared findings exist.
- Diff runs only after a profile exists.
- Analyst failure produces a partial outcome and does not discard the profile.
- `onComplete` runs exactly once with final state.
- Abort stops pending waits/provider calls and does not emit a success event.

The existing `StreamEvent` union remains unchanged.

## Structured LLM seam

```ts
export interface LLMInvocationContext {
  signal?: AbortSignal;
  budget?: LLMBudget;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  context?: LLMInvocationContext;
  schemaName?: string;
}

export interface LLMAdapter {
  completeStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMOptions,
  ): Promise<T>;
}
```

`OpenAIAdapter` accepts an injected minimal OpenAI client in tests and creates
the real SDK client in production. It builds system/user input, claims the
existing estimated token budget before the call, passes the abort signal, and
records actual `input_tokens`, `output_tokens`, and `total_tokens` afterward.
Missing parsed output is an error.

No generic `complete()`, model streaming method, LangChain message type,
callback array, or usage-log getter remains because production does not use
them.

## Langfuse

Keep:

- `traceResearch()` root trace;
- `observeResearchStep()` around each concurrent source and downstream step;
- deterministic scores and cache telemetry;
- privacy masking and hashed company identifiers;
- OTel startup in `src/instrumentation.ts`;
- `flushLangfuse()` at request completion.

Remove `createLangfuseCallback()` and all `CallbackHandler` plumbing. Native
OpenAI calls execute inside the existing active Profile/Analyst observation;
no second tracing framework is introduced.

## Error handling

- Preserve current retry classification and per-source timeout behavior.
- Preserve `ResearchQueryBudgetExceededError` as a skipped source result.
- Preserve fatal profile errors and partial analyst errors.
- Queue consumers receive the original thrown error once; completion closes
  the queue once.
- Langfuse initialization or export failure remains non-fatal.

## Verification

Migration is accepted only when tests prove:

1. At least two controlled source promises overlap before either resolves, and
   active source count never exceeds `maxConcurrentSourceNodes`.
2. A finding event is observable before all sources finish.
3. One rejected source still yields successful sibling findings and a partial
   outcome.
4. Abort reaches active source/provider operations.
5. `run()` and `stream()` produce equivalent final state.
6. OpenAI structured output parses through the supplied Zod schema and records
   budget usage.
7. Langfuse root/source/Profile/Analyst observations, masking, scores, and flush
   still work without a LangChain callback.
8. No `@langchain/*` or `@langfuse/langchain` import remains.

## Non-goals

- Fix unrelated current UI, crawl-policy, or provenance worktree changes.
- Add AI tools or an agent loop.
- Change SSE payloads, database schema, cache behavior, UI, or evidence ranking.
- Replace Langfuse/OTel.

## Rollback

The migration is one focused dependency/orchestration change. Rollback restores
the previous workflow, state annotation, LangChain OpenAI adapter, callback
creation, and removed dependencies together; do not run mixed native and graph
orchestration paths behind a feature flag.
