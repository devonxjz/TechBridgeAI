// ═══════════════════════════════════════════════════════
// Research Budget & Concurrency Guard
// Enforces call, token, and provider concurrency limits before spend
// ═══════════════════════════════════════════════════════

import type { LLMBudget, LLMUsageLog } from "@/adapters/llm/types";

type ProviderType = "search" | "scraper" | "registry";

export class ResearchQueryBudgetExceededError extends Error {
  constructor(readonly maxQueries: number) {
    super(`Research search query budget exceeded (max: ${maxQueries})`);
    this.name = "ResearchQueryBudgetExceededError";
  }
}

export interface ResearchBudgetOptions {
  maxLLMCalls?: number;
  maxTokens?: number;
  maxQueries?: number;
  maxConcurrentProviderCalls?: number;
}

export interface ResearchBudget extends LLMBudget {
  claimModelCall(estimatedInputTokens: number): void;
  claimSearchQuery(): void;
  recordModelUsage(usage: LLMUsageLog): void;
  runWithProviderSlot<T>(
    provider: ProviderType,
    task: () => Promise<T>,
    signal?: AbortSignal,
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
  const maxQueries = options.maxQueries ?? 6;
  const maxConcurrentProviderCalls = options.maxConcurrentProviderCalls ?? 2;

  let callCount = 0;
  let tokensClaimed = 0;
  let tokensUsed = 0;
  let outstandingTokenClaims = 0;
  const pendingTokenClaims: number[] = [];
  let queryCount = 0;

  const activeProviderCalls: Record<ProviderType, number> = {
    search: 0,
    scraper: 0,
    registry: 0,
  };
  const waitingQueues: Record<ProviderType, Array<() => void>> = {
    search: [],
    scraper: [],
    registry: [],
  };

  const acquireProviderSlot = async (
    provider: ProviderType,
    signal?: AbortSignal,
  ): Promise<void> => {
    signal?.throwIfAborted();
    if (activeProviderCalls[provider] < maxConcurrentProviderCalls) {
      activeProviderCalls[provider]++;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const queue = waitingQueues[provider];
      const acquire = () => {
        signal?.removeEventListener("abort", onAbort);
        activeProviderCalls[provider]++;
        resolve();
      };
      const onAbort = () => {
        const index = queue.indexOf(acquire);
        if (index >= 0) queue.splice(index, 1);
        reject(signal?.reason ?? new DOMException("Execution aborted", "AbortError"));
      };

      queue.push(acquire);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  const releaseProviderSlot = (provider: ProviderType): void => {
    activeProviderCalls[provider]--;
    if (waitingQueues[provider].length > 0) {
      const next = waitingQueues[provider].shift();
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
      if (tokensUsed + outstandingTokenClaims + estimatedInputTokens > maxTokens) {
        throw new Error(
          `Research token budget exceeded (max: ${maxTokens}, used: ${tokensUsed}, reserved: ${outstandingTokenClaims}, requested: ${estimatedInputTokens})`
        );
      }
      callCount++;
      tokensClaimed += estimatedInputTokens;
      outstandingTokenClaims += estimatedInputTokens;
      pendingTokenClaims.push(estimatedInputTokens);
    },

    claimSearchQuery(): void {
      if (queryCount >= maxQueries) {
        throw new ResearchQueryBudgetExceededError(maxQueries);
      }
      queryCount++;
    },

    recordModelUsage(usage: LLMUsageLog): void {
      outstandingTokenClaims -= pendingTokenClaims.shift() ?? 0;
      tokensUsed += usage.totalTokens;
    },

    async runWithProviderSlot<T>(
      provider: ProviderType,
      task: () => Promise<T>,
      signal?: AbortSignal,
    ): Promise<T> {
      await acquireProviderSlot(provider, signal);
      try {
        signal?.throwIfAborted();
        return await task();
      } finally {
        releaseProviderSlot(provider);
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
