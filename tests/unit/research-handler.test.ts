import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorageAdapter } from "@/adapters/storage/memory";

const providerMocks = vi.hoisted(() => ({
  llm: vi.fn(),
  search: vi.fn(),
  scraper: vi.fn(),
  registry: vi.fn(),
}));
const observabilityMocks = vi.hoisted(() => ({
  flushLangfuse: vi.fn(async () => undefined),
  updateResearchObservationOutcome: vi.fn(),
}));

let storage = new MemoryStorageAdapter();
let workflowSignal: AbortSignal | undefined;
let workflowStarted: (() => void) | undefined;

vi.mock("@/config", () => ({
  createLLMAdapter: () => {
    providerMocks.llm();
    return {};
  },
  createSearchAdapter: () => {
    providerMocks.search();
    return {};
  },
  createScraperAdapter: () => {
    providerMocks.scraper();
    return {};
  },
  createRegistryAdapter: () => {
    providerMocks.registry();
    return {};
  },
  createStorageAdapter: () => storage,
  createCrawlPolicyAdapter: () => ({}),
  getGuards: () => ({}),
}));
vi.mock("@/modules/profile", () => ({ createProfileModule: () => ({}) }));
vi.mock("@/modules/analyst", () => ({ createAnalystModule: () => ({}) }));
vi.mock("@/modules/workflow", () => ({
  createResearchWorkflow: () => ({
    stream: async function* (
      _input: unknown,
      options: { signal: AbortSignal },
    ) {
      workflowSignal = options.signal;
      workflowStarted?.();
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) {
          resolve();
          return;
        }
        options.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    },
  }),
}));
vi.mock("@/observability/langfuse", () => ({
  emitResearchScores: vi.fn(async () => undefined),
  flushLangfuse: observabilityMocks.flushLangfuse,
  traceResearch: async (
    _context: unknown,
    task: (traceId: string) => Promise<void>,
  ) => task("trace-id"),
  updateResearchCacheOutcome: vi.fn(),
  updateResearchObservationOutcome:
    observabilityMocks.updateResearchObservationOutcome,
  updateResearchTraceOutcome: vi.fn(),
}));

import { handleResearchRequest } from "@/modules/research/handler";

const trustedContext = {
  tenantId: "tenant-test",
  userId: "user-test",
  requestId: "request-test",
};

function researchRequest(signal?: AbortSignal) {
  return new Request("http://localhost/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { name: "FPT" },
      cache: { action: "bypass" },
    }),
    signal,
  });
}

async function waitForWorkflowStart(): Promise<void> {
  if (workflowSignal) return;
  await new Promise<void>((resolve) => {
    workflowStarted = resolve;
  });
}

describe("framework-neutral research handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage = new MemoryStorageAdapter();
    workflowSignal = undefined;
    workflowStarted = undefined;
  });

  it("handles a Web Request without initializing providers during validation", async () => {
    const response = await handleResearchRequest(
      new Request("http://localhost/api/research", {
        method: "POST",
        body: "invalid-json",
      }),
      trustedContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON in request body",
    });
    expect(providerMocks.search).not.toHaveBeenCalled();
    expect(providerMocks.llm).not.toHaveBeenCalled();
  });

  it("aborts live work when the request is aborted", async () => {
    const requestController = new AbortController();
    const response = await handleResearchRequest(
      researchRequest(requestController.signal),
      trustedContext,
    );

    await waitForWorkflowStart();
    requestController.abort();
    await response.text();

    expect(workflowSignal?.aborted).toBe(true);
    expect(
      observabilityMocks.updateResearchObservationOutcome,
    ).toHaveBeenCalledWith("cancelled");
    expect(observabilityMocks.flushLangfuse).toHaveBeenCalledOnce();
  });

  it("aborts live work when the response stream is cancelled", async () => {
    const response = await handleResearchRequest(researchRequest(), trustedContext);

    await waitForWorkflowStart();
    await response.body?.cancel();
    await vi.waitFor(() => {
      expect(workflowSignal?.aborted).toBe(true);
      expect(observabilityMocks.flushLangfuse).toHaveBeenCalledOnce();
    });

    expect(
      observabilityMocks.updateResearchObservationOutcome,
    ).toHaveBeenCalledWith("cancelled");
  });
});
