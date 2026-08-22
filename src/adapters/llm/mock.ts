// ═══════════════════════════════════════════════════════
// Mock LLM Adapter — for testing
// ═══════════════════════════════════════════════════════

import type { z } from "zod";
import type { LLMAdapter, LLMOptions } from "./types";

export class MockLLMAdapter implements LLMAdapter {
  private responses: Map<string, string> = new Map();
  public callLog: { prompt: string; options?: LLMOptions }[] = [];

  /**
   * Set a canned response for any prompt containing the given substring.
   */
  setResponse(promptSubstring: string, response: string): void {
    this.responses.set(promptSubstring, response);
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    this.callLog.push({ prompt, options });
    for (const [key, value] of this.responses) {
      if (prompt.includes(key)) return value;
    }
    return '{"result": "mock response"}';
  }

  async completeStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMOptions
  ): Promise<T> {
    const raw = await this.complete(prompt, options);
    return schema.parse(JSON.parse(raw));
  }

  async *stream(
    prompt: string,
    options?: LLMOptions
  ): AsyncGenerator<string, void, unknown> {
    const response = await this.complete(prompt, options);
    // Simulate streaming by yielding word by word
    for (const word of response.split(" ")) {
      yield word + " ";
    }
  }
}
