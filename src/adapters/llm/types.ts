// ═══════════════════════════════════════════════════════
// LLM Adapter — Interface
// ═══════════════════════════════════════════════════════

import { z } from "zod";

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
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
}
