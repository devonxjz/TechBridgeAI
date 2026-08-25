import type { z } from "zod";
import type { LLMAdapter, LLMOptions } from "@/adapters/llm/types";
import type { SearchAdapter, SearchOptions, SearchResult } from "@/adapters/search/types";
import {
  ScrapeError,
  type ScraperAdapter,
  type ScrapedContent,
} from "@/adapters/scraper/types";

export class MockLLMAdapter implements LLMAdapter {
  private responses: Map<string, string> = new Map();
  public callLog: { prompt: string; options?: LLMOptions }[] = [];

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
    options?: LLMOptions,
  ): Promise<T> {
    const raw = await this.complete(prompt, options);
    return schema.parse(JSON.parse(raw));
  }

  async *stream(
    prompt: string,
    options?: LLMOptions,
  ): AsyncGenerator<string, void, unknown> {
    const response = await this.complete(prompt, options);
    for (const word of response.split(" ")) {
      yield word + " ";
    }
  }
}

export class MockSearchAdapter implements SearchAdapter {
  private results: Map<string, SearchResult[]> = new Map();
  public callLog: { query: string; options?: SearchOptions }[] = [];

  setResults(querySubstring: string, results: SearchResult[]): void {
    this.results.set(querySubstring, results);
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    this.callLog.push({ query, options });
    for (const [key, value] of this.results) {
      if (query.toLowerCase().includes(key.toLowerCase())) {
        return value.slice(0, options?.maxResults ?? 10);
      }
    }
    return [];
  }
}

export class MockScraperAdapter implements ScraperAdapter {
  private pages: Map<string, ScrapedContent> = new Map();
  public callLog: string[] = [];

  setPage(url: string, content: ScrapedContent): void {
    this.pages.set(url, content);
  }

  async extract(url: string): Promise<ScrapedContent> {
    this.callLog.push(url);
    const page = this.pages.get(url);
    if (page) return page;
    throw new ScrapeError(`No mock page registered for ${url}`, "direct", "empty");
  }
}
