import { describe, expect, it } from "vitest";
import { createResearchBudget } from "@/modules/research/budget";

describe("ResearchBudget", () => {
  it("rejects before a model call exceeds the token budget", () => {
    const budget = createResearchBudget({
      maxLLMCalls: 5,
      maxTokens: 100,
      maxConcurrentProviderCalls: 2,
    });

    budget.claimModelCall(60);
    expect(() => budget.claimModelCall(60)).toThrow("Research token budget exceeded");
  });

  it("reconciles actual model usage before admitting the next call", () => {
    const budget = createResearchBudget({ maxLLMCalls: 3, maxTokens: 100 });

    budget.claimModelCall(10);
    budget.recordModelUsage({
      model: "test-model",
      promptTokens: 90,
      completionTokens: 5,
      totalTokens: 95,
      timestamp: new Date(),
    });

    expect(() => budget.claimModelCall(10)).toThrow("Research token budget exceeded");
  });

  it("rejects before a model call exceeds the call budget", () => {
    const budget = createResearchBudget({
      maxLLMCalls: 2,
      maxTokens: 10000,
      maxConcurrentProviderCalls: 2,
    });

    budget.claimModelCall(10);
    budget.claimModelCall(10);
    expect(() => budget.claimModelCall(10)).toThrow("Research LLM call budget exceeded");
  });

  it("limits concurrent provider calls using FIFO slots", async () => {
    const budget = createResearchBudget({
      maxLLMCalls: 5,
      maxTokens: 1000,
      maxConcurrentProviderCalls: 2,
    });

    let concurrent = 0;
    let maxConcurrent = 0;

    const task = async (delayMs: number) => {
      return budget.runWithProviderSlot("search", async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        concurrent--;
        return true;
      });
    };

    const p1 = task(50);
    const p2 = task(50);
    const p3 = task(50);

    await Promise.all([p1, p2, p3]);

    expect(maxConcurrent).toBe(2);
  });

  it("maintains an independent concurrency limit for each provider", async () => {
    const budget = createResearchBudget({ maxConcurrentProviderCalls: 1 });
    let activeCalls = 0;
    let maxActiveCalls = 0;
    const task = (provider: "search" | "scraper") =>
      budget.runWithProviderSlot(provider, async () => {
        activeCalls++;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeCalls--;
      });

    await Promise.all([task("search"), task("scraper")]);

    expect(maxActiveCalls).toBe(2);
  });
});
