import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { ChatGeneration, ChatResult } from "@langchain/core/outputs";
import { RunnableLambda } from "@langchain/core/runnables";
import type { ChatOpenAI } from "@langchain/openai";
import { OpenAIAdapter } from "@/adapters/llm/openai";
import type { LLMOptions } from "@/adapters/llm/types";

class FakeChatModel extends BaseChatModel {
  lastSignal?: AbortSignal;
  lastCallbacks?: unknown;
  responses: AIMessage[];

  constructor(responses: AIMessage[] = []) {
    super({});
    this.responses = responses;
  }

  _llmType(): string {
    return "fake";
  }

  async _generate(
    _messages: BaseMessage[],
    options?: { signal?: AbortSignal; callbacks?: unknown }
  ): Promise<ChatResult> {
    this.lastSignal = options?.signal;
    this.lastCallbacks = options?.callbacks;
    const next = this.responses.shift() ?? new AIMessage({
      content: "default response",
      usage_metadata: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
    });
    return {
      generations: [{ message: next, text: next.content as string } as ChatGeneration],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override withStructuredOutput(schema: any): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return RunnableLambda.from(async (_input: any, options?: any) => {
      this.lastSignal = options?.signal;
      this.lastCallbacks = options?.callbacks;
      const msg = this.responses.shift();
      const text = msg ? (msg.content as string) : '{"name":"FPT"}';
      return (schema as z.ZodSchema).parse(JSON.parse(text));
    });
  }
}

describe("LangChain-backed LLM Adapter", () => {
  it("completes plain text and logs usage", async () => {
    const fakeModel = new FakeChatModel([
      new AIMessage({
        content: "plain response",
        usage_metadata: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
      }),
    ]);

    const adapter = new OpenAIAdapter("test-key", {
      modelFactory: () => fakeModel as unknown as ChatOpenAI,
    });

    const result = await adapter.complete("hello");
    expect(result).toBe("plain response");
    expect(adapter.getUsageLogs()[0].totalTokens).toBe(12);
  });

  it("completes structured output with caller Zod schema", async () => {
    const schema = z.object({ name: z.string() });
    const fakeModel = new FakeChatModel([
      new AIMessage({
        content: JSON.stringify({ name: "FPT" }),
        usage_metadata: { input_tokens: 10, output_tokens: 15, total_tokens: 25 },
      }),
    ]);

    const adapter = new OpenAIAdapter("test-key", {
      modelFactory: () => fakeModel as unknown as ChatOpenAI,
    });

    const result = await adapter.completeStructured("extract company", schema);
    expect(result).toEqual({ name: "FPT" });
  });

  it("forwards signal, callbacks, and claims budget", async () => {
    const fakeModel = new FakeChatModel();
    const adapter = new OpenAIAdapter("test-key", {
      modelFactory: () => fakeModel as unknown as ChatOpenAI,
    });

    const controller = new AbortController();
    let claimed = 0;
    const budget = {
      claimModelCall: (tokens: number) => {
        claimed += tokens;
      },
      recordModelUsage: () => {
        // no-op
      },
    };

    const callback = {
      name: "test_handler",
      handleLLMStart: () => {},
    };

    const options: LLMOptions = {
      context: {
        signal: controller.signal,
        callbacks: [callback],
        budget,
      },
    };

    await adapter.complete("test prompt", options);

    expect(fakeModel.lastSignal).toBe(controller.signal);
    expect(claimed).toBeGreaterThan(0);
  });
});
