// ═══════════════════════════════════════════════════════
// Research Budget & Concurrency Guard
// Enforces call, token, and provider concurrency limits before spend
// ═══════════════════════════════════════════════════════

import type { LLMBudget, LLMUsageLog } from "@/adapters/llm/types";

export interface ResearchBudgetOptions {
  maxLLMCalls?: number;
  maxTokens?: number;
  maxConcurrentProviderCalls?: number;
}

export interface ResearchBudget extends LLMBudget {
  claimModelCall(estimatedInputTokens: number): void;
  recordModelUsage(usage: LLMUsageLog): void;
  runWithProviderSlot<T>(
    provider: "search" | "scraper" | "registry",
    task: () => Promise<T>
  ): Promise<T>;
  getStats(): {
    calls: number;
    tokensClaimed: number;
    tokensUsed: number;
  };
}

export function createResearchBudget(
  options: ResearchBudgetOptions = {}
): ResearchBudget {
  const maxLLMCalls = options.maxLLMCalls ?? 10;
  const maxTokens = options.maxTokens ?? 50_000;
  const maxConcurrentProviderCalls = options.maxConcurrentProviderCalls ?? 2;

  let callCount = 0;
  let tokensClaimed = 0;
  let tokensUsed = 0;

  // FIFO provider slot queue
  let activeProviderCalls = 0;
  const waitingQueue: (() => void)[] = [];

  const acquireProviderSlot = async (): Promise<void> => {
    if (activeProviderCalls < maxConcurrentProviderCalls) {
      activeProviderCalls++;
      return;
    }

    return new Promise<void>((resolve) => {
      waitingQueue.push(() => {
        activeProviderCalls++;
        resolve();
      });
    });
  };

  const releaseProviderSlot = (): void => {
    activeProviderCalls--;
    if (waitingQueue.length > 0) {
      const next = waitingQueue.shift();
      if (next) {
        next();
      }
    }
  };

  return {
    claimModelCall(estimatedInputTokens: number): void {
      if (callCount >= maxLLMCalls) {
        throw new Error(
          `Research LLM call budget exceeded (max: ${maxLLMCalls}, current: ${callCount})`
        );
      }
      if (tokensClaimed + estimatedInputTokens > maxTokens) {
        throw new Error(
          `Research token budget exceeded (max: ${maxTokens}, claimed: ${tokensClaimed}, requested: ${estimatedInputTokens})`
        );
      }
      callCount++;
      tokensClaimed += estimatedInputTokens;
    },

    recordModelUsage(usage: LLMUsageLog): void {
      tokensUsed += usage.totalTokens;
    },

    async runWithProviderSlot<T>(
      _provider: "search" | "scraper" | "registry",
      task: () => Promise<T>
    ): Promise<T> {
      await acquireProviderSlot();
      try {
        return await task();
      } finally {
        releaseProviderSlot();
      }
    },

    getStats() {
      return {
        calls: callCount,
        tokensClaimed,
        tokensUsed,
      };
    },
  };
}
