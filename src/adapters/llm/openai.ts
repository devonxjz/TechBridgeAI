// ═══════════════════════════════════════════════════════
// OpenAI LLM Adapter — LangChain Implementation
// Implements LLMAdapter using @langchain/openai and @langchain/core
// ═══════════════════════════════════════════════════════

import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import { z } from "zod";
import type { LLMAdapter, LLMOptions, LLMUsageLog } from "./types";

const DEFAULT_MODEL = "gpt-4o-mini";

export interface OpenAIAdapterOptions {
  modelFactory?: (options?: LLMOptions) => BaseChatModel;
}

export class OpenAIAdapter implements LLMAdapter {
  private apiKey: string;
  private usageLogs: LLMUsageLog[] = [];
  private modelFactory?: (options?: LLMOptions) => BaseChatModel;

  constructor(apiKey: string, options?: OpenAIAdapterOptions) {
    this.apiKey = apiKey;
    this.modelFactory = options?.modelFactory;
  }

  private getModel(options?: LLMOptions, defaultTemp = 0.3): BaseChatModel {
    if (this.modelFactory) {
      return this.modelFactory(options);
    }

    return new ChatOpenAI({
      apiKey: this.apiKey,
      modelName: options?.model ?? DEFAULT_MODEL,
      temperature: options?.temperature ?? defaultTemp,
      maxTokens: options?.maxTokens,
      maxRetries: 2,
    });
  }

  private buildMessages(prompt: string, options?: LLMOptions): BaseMessage[] {
    const messages: BaseMessage[] = [];
    if (options?.systemPrompt) {
      messages.push(new SystemMessage(options.systemPrompt));
    }
    messages.push(new HumanMessage(prompt));
    return messages;
  }

  private estimateTokens(messages: BaseMessage[]): number {
    let charCount = 0;
    for (const msg of messages) {
      charCount += typeof msg.content === "string" ? msg.content.length : 100;
    }
    return Math.max(10, Math.ceil(charCount / 4));
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const model = this.getModel(options, 0.3);
    const messages = this.buildMessages(prompt, options);

    options?.context?.budget?.claimModelCall(this.estimateTokens(messages));

    const response = await model.invoke(messages, {
      signal: options?.context?.signal,
      callbacks: options?.context?.callbacks as Callbacks,
    });

    const modelName = options?.model ?? DEFAULT_MODEL;
    this.logUsage(response, modelName, options);

    return typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  }

  async completeStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMOptions
  ): Promise<T> {
    const model = this.getModel(options, 0.2);
    const messages = this.buildMessages(prompt, options);

    options?.context?.budget?.claimModelCall(this.estimateTokens(messages));

    const structuredModel = model.withStructuredOutput(schema);
    const result = await structuredModel.invoke(messages, {
      signal: options?.context?.signal,
      callbacks: options?.context?.callbacks as Callbacks,
    });

    // If structured output returned object with schema, log default usage if available
    const modelName = options?.model ?? DEFAULT_MODEL;
    this.logUsage(result, modelName, options);

    return result as T;
  }

  async *stream(
    prompt: string,
    options?: LLMOptions
  ): AsyncGenerator<string, void, unknown> {
    const model = this.getModel(options, 0.3);
    const messages = this.buildMessages(prompt, options);

    options?.context?.budget?.claimModelCall(this.estimateTokens(messages));

    const stream = await model.stream(messages, {
      signal: options?.context?.signal,
      callbacks: options?.context?.callbacks as Callbacks,
    });

    for await (const chunk of stream) {
      if (chunk.content) {
        yield typeof chunk.content === "string"
          ? chunk.content
          : JSON.stringify(chunk.content);
      }
    }
  }

  getUsageLogs(): LLMUsageLog[] {
    return [...this.usageLogs];
  }

  private logUsage(
    response: unknown,
    model: string,
    options?: LLMOptions
  ): void {
    if (
      response &&
      typeof response === "object" &&
      "usage_metadata" in response &&
      response.usage_metadata
    ) {
      const usage = (response as AIMessage).usage_metadata;
      if (usage) {
        const log: LLMUsageLog = {
          model,
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.total_tokens,
          timestamp: new Date(),
        };
        this.usageLogs.push(log);
        options?.context?.budget?.recordModelUsage(log);
        console.log(
          `[LLM] ${model}: ${log.promptTokens}+${log.completionTokens}=${log.totalTokens} tokens`
        );
      }
    }
  }
}
