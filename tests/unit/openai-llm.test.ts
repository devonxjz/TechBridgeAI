import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAIAdapter } from "@/adapters/llm/openai";

describe("OpenAI structured LLM adapter", () => {
  it("parses structured output and records the actual token usage", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: { name: "FPT" },
      usage: { input_tokens: 10, output_tokens: 15, total_tokens: 25 },
    });
    const adapter = new OpenAIAdapter("test-key", {
      client: { responses: { parse } },
    });
    const recordModelUsage = vi.fn();
    const claimModelCall = vi.fn();
    const signal = new AbortController().signal;

    await expect(
      adapter.completeStructured("extract company", z.object({ name: z.string() }), {
        systemPrompt: "Return company data",
        model: "gpt-test",
        maxTokens: 200,
        temperature: 0.1,
        schemaName: "company_profile",
        context: {
          signal,
          budget: { claimModelCall, recordModelUsage },
        },
      }),
    ).resolves.toEqual({ name: "FPT" });

    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-test",
        input: [
          { role: "system", content: "Return company data" },
          { role: "user", content: "extract company" },
        ],
        max_output_tokens: 200,
        temperature: 0.1,
        text: { format: expect.objectContaining({ name: "company_profile" }) },
      }),
      { signal },
    );
    expect(claimModelCall).toHaveBeenCalledWith(expect.any(Number));
    expect(recordModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-test",
        promptTokens: 10,
        completionTokens: 15,
        totalTokens: 25,
      }),
    );
  });

  it("records usage before rejecting a response without parsed output", async () => {
    const recordModelUsage = vi.fn();
    const adapter = new OpenAIAdapter("test-key", {
      client: {
        responses: {
          parse: vi.fn().mockResolvedValue({
            output_parsed: null,
            usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
          }),
        },
      },
    });

    await expect(
      adapter.completeStructured("extract", z.object({ name: z.string() }), {
        context: {
          budget: {
            claimModelCall: vi.fn(),
            recordModelUsage,
          },
        },
      }),
    ).rejects.toThrow("Structured output parsing failed");
    expect(recordModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({ totalTokens: 6 }),
    );
  });
});
