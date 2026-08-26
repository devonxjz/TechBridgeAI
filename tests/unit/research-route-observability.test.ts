import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorageAdapter } from "@/adapters/storage/memory";

const observabilityMocks = vi.hoisted(() => ({
  emitResearchScores: vi.fn(async () => undefined),
  flushLangfuse: vi.fn(async () => undefined),
  updateResearchObservationOutcome: vi.fn(),
}));

let mockStorage = new MemoryStorageAdapter();

vi.mock("@/config", () => ({
  createLLMAdapter: () => ({}),
  createSearchAdapter: () => ({}),
  createScraperAdapter: () => ({}),
  createRegistryAdapter: () => ({}),
  createStorageAdapter: () => mockStorage,
  getGuards: () => ({}),
}));
vi.mock("@/modules/profile", () => ({ createProfileModule: () => ({}) }));
vi.mock("@/modules/analyst", () => ({ createAnalystModule: () => ({}) }));
vi.mock("@/modules/workflow", () => ({
  createResearchWorkflow: () => ({
    stream: async function* () {
      throw new Error("Unexpected workflow failure");
    },
  }),
}));
vi.mock("@/observability/langfuse", () => ({
  createLangfuseCallback: () => null,
  emitResearchScores: observabilityMocks.emitResearchScores,
  flushLangfuse: observabilityMocks.flushLangfuse,
  traceResearch: async (
    _context: unknown,
    task: (traceId: string) => Promise<void>,
  ) => task("trace-failure"),
  updateResearchObservationOutcome:
    observabilityMocks.updateResearchObservationOutcome,
  updateResearchTraceOutcome: vi.fn(),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/research/route";

describe("Research route observability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = new MemoryStorageAdapter();
  });

  it("marks and scores an unexpected workflow failure", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { name: "FPT" } }),
      }),
    );

    const body = await response.text();

    expect(body).toContain("event: error");
    expect(
      observabilityMocks.updateResearchObservationOutcome,
    ).toHaveBeenCalledOnce();
    expect(observabilityMocks.emitResearchScores).toHaveBeenCalledWith(
      "trace-failure",
      expect.objectContaining({ outcome: "failed" }),
    );
  });
});
