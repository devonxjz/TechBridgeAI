// ═══════════════════════════════════════════════════════
// OpenAI LLM Adapter
// ═══════════════════════════════════════════════════════

import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type { LLMAdapter, LLMOptions, LLMUsageLog } from "./types";

const DEFAULT_MODEL = "gpt-4o-mini";

export class OpenAIAdapter implements LLMAdapter {
  private client: OpenAI;
  private usageLogs: LLMUsageLog[] = [];

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? DEFAULT_MODEL,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens,
      messages: [
        ...(options?.systemPrompt
          ? [{ role: "system" as const, content: options.systemPrompt }]
          : []),
        { role: "user" as const, content: prompt },
      ],
    });

    this.logUsage(response, options?.model ?? DEFAULT_MODEL);
    return response.choices[0]?.message?.content ?? "";
  }

  async completeStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMOptions
  ): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? DEFAULT_MODEL,
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens,
      messages: [
        ...(options?.systemPrompt
          ? [{ role: "system" as const, content: options.systemPrompt }]
          : []),
        { role: "user" as const, content: prompt },
      ],
      response_format: zodResponseFormat(schema as z.ZodType, "structured_output"),
    });

    this.logUsage(response, options?.model ?? DEFAULT_MODEL);
    const raw = response.choices[0]?.message?.content ?? "{}";
    return schema.parse(JSON.parse(raw));
  }

  async *stream(
    prompt: string,
    options?: LLMOptions
  ): AsyncGenerator<string, void, unknown> {
    const stream = await this.client.chat.completions.create({
      model: options?.model ?? DEFAULT_MODEL,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens,
      messages: [
        ...(options?.systemPrompt
          ? [{ role: "system" as const, content: options.systemPrompt }]
          : []),
        { role: "user" as const, content: prompt },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  getUsageLogs(): LLMUsageLog[] {
    return [...this.usageLogs];
  }

  private logUsage(
    response: OpenAI.Chat.Completions.ChatCompletion,
    model: string
  ): void {
    if (response.usage) {
      const log: LLMUsageLog = {
        model,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
        timestamp: new Date(),
      };
      this.usageLogs.push(log);
      console.log(
        `[LLM] ${model}: ${log.promptTokens}+${log.completionTokens}=${log.totalTokens} tokens`
      );
    }
  }
}
