import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type { LLMAdapter, LLMOptions, LLMUsageLog } from "./types";

const DEFAULT_MODEL = "gpt-4o-mini";

interface ParsedResponse {
  output_parsed: unknown | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  } | null;
}

interface OpenAIClientLike {
  responses: {
    parse(
      body: unknown,
      options?: { signal?: AbortSignal },
    ): Promise<ParsedResponse>;
  };
}

export interface OpenAIAdapterOptions {
  client?: OpenAIClientLike;
}

export class OpenAIAdapter implements LLMAdapter {
  private readonly client: OpenAIClientLike;

  constructor(apiKey: string, options?: OpenAIAdapterOptions) {
    this.client = options?.client ?? (new OpenAI({ apiKey }) as unknown as OpenAIClientLike);
  }

  async completeStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMOptions,
  ): Promise<T> {
    const input = [
      ...(options?.systemPrompt
        ? [{ role: "system" as const, content: options.systemPrompt }]
        : []),
      { role: "user" as const, content: prompt },
    ];
    const model = options?.model ?? DEFAULT_MODEL;

    options?.context?.budget?.claimModelCall(estimateTokens(input));

    const response = await this.client.responses.parse(
      {
        model,
        input,
        temperature: options?.temperature,
        max_output_tokens: options?.maxTokens,
        text: {
          format: zodTextFormat(
            schema,
            options?.schemaName ?? "structured_output",
          ),
        },
      },
      { signal: options?.context?.signal },
    );

    if (response.usage) {
      const usage: LLMUsageLog = {
        model,
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
        timestamp: new Date(),
      };
      options?.context?.budget?.recordModelUsage(usage);
    }

    if (response.output_parsed === null) {
      throw new Error("Structured output parsing failed");
    }

    return response.output_parsed as T;
  }
}

function estimateTokens(
  input: ReadonlyArray<{ content: string }>,
): number {
  const characterCount = input.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  return Math.max(10, Math.ceil(characterCount / 4));
}
