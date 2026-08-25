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
  callbacks?: readonly unknown[];
  budget?: LLMBudget;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  context?: LLMInvocationContext;
}

export interface LLMUsageLog {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: Date;
}

export interface LLMAdapter {
  complete(prompt: string, options?: LLMOptions): Promise<string>;
  completeStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMOptions
  ): Promise<T>;
  stream(
    prompt: string,
    options?: LLMOptions
  ): AsyncGenerator<string, void, unknown>;
  getUsageLogs?(): LLMUsageLog[];
}

