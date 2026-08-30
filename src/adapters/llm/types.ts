// ═══════════════════════════════════════════════════════
// LLM Adapter — Interface
// ═══════════════════════════════════════════════════════

import { z } from "zod";

export interface LLMBudget {
  claimModelCall(estimatedInputTokens: number): void;
  recordModelUsage(usage: LLMUsageLog): void;
}

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

export interface LLMUsageLog {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: Date;
}

export interface LLMAdapter {
  completeStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMOptions
  ): Promise<T>;
}
