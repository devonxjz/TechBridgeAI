// ═══════════════════════════════════════════════════════
// Config — Adapter Factory + Resource Guards
// DI without framework: swap provider = change env var
// ═══════════════════════════════════════════════════════

import type { LLMAdapter } from "@/adapters/llm/types";
import type { SearchAdapter } from "@/adapters/search/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";
import type { StorageAdapter } from "@/adapters/storage/types";
import type { RegistryAdapter } from "@/adapters/registry/types";

import { OpenAIAdapter } from "@/adapters/llm/openai";
import { MockLLMAdapter } from "@/adapters/llm/mock";
import { SerperSearchAdapter } from "@/adapters/search/serper";
import { MockSearchAdapter } from "@/adapters/search/mock";
import {
  SafeDirectScraperAdapter,
  JinaReaderScraperAdapter,
  TinyFishScraperAdapter,
  TieredScraperAdapter,
  MockScraperAdapter,
} from "@/adapters/scraper";
import { VietQrRegistryAdapter } from "@/adapters/registry";
import { MemoryStorageAdapter } from "@/adapters/storage/memory";
import { SupabaseStorageAdapter } from "@/adapters/storage/supabase";

// ─── Resource Guards ───

export interface ResourceGuards {
  maxConcurrentResearch: number;
  sourceTimeoutMs: number;
  maxRetriesPerSource: number;
  maxTokensPerResearch: number;
  maxLLMCallsPerResearch: number;
  scraperDelayMs: number;
  maxScrapePagesPerResearch: number;
  maxResearchPerDay: number;
  maxTokensPerDay: number;
}

export function getGuards(): ResourceGuards {
  return {
    maxConcurrentResearch: int(process.env.MAX_CONCURRENT_RESEARCH, 1),
    sourceTimeoutMs: int(process.env.SOURCE_TIMEOUT_MS, 30_000),
    maxRetriesPerSource: 2,
    maxTokensPerResearch: 50_000,
    maxLLMCallsPerResearch: 10,
    scraperDelayMs: 1_000,
    maxScrapePagesPerResearch: int(process.env.MAX_SCRAPE_PAGES_PER_RESEARCH, 5),
    maxResearchPerDay: int(process.env.MAX_RESEARCH_PER_DAY, 50),
    maxTokensPerDay: int(process.env.MAX_TOKENS_PER_DAY, 500_000),
  };
}

// ─── Adapter Factories ───

// Singletons per process (Next.js API routes share process)
let _llm: LLMAdapter | null = null;
let _search: SearchAdapter | null = null;
let _scraper: ScraperAdapter | null = null;
let _registry: RegistryAdapter | null = null;
let _storage: StorageAdapter | null = null;

export function createLLMAdapter(): LLMAdapter {
  if (_llm) return _llm;

  switch (process.env.LLM_PROVIDER) {
    case "openai":
      _llm = new OpenAIAdapter(process.env.OPENAI_API_KEY!);
      break;
    case "mock":
      _llm = new MockLLMAdapter();
      break;
    default:
      _llm = new OpenAIAdapter(process.env.OPENAI_API_KEY!);
  }
  return _llm;
}

export function createSearchAdapter(): SearchAdapter {
  if (_search) return _search;

  switch (process.env.SEARCH_PROVIDER) {
    case "serper":
      _search = new SerperSearchAdapter(process.env.SERPER_API_KEY!);
      break;
    case "mock":
      _search = new MockSearchAdapter();
      break;
    default:
      _search = new SerperSearchAdapter(process.env.SERPER_API_KEY!);
  }
  return _search;
}

export function createScraperAdapter(): ScraperAdapter {
  if (_scraper) return _scraper;

  const provider = process.env.SCRAPER_PROVIDER || "tiered";

  if (provider === "mock") {
    _scraper = new MockScraperAdapter();
    return _scraper;
  }

  if (provider === "tinyfish") {
    const key = process.env.TINYFISH_API_KEY;
    if (!key) {
      throw new Error("TINYFISH_API_KEY is required when SCRAPER_PROVIDER=tinyfish");
    }
    const timeoutMs = int(process.env.SCRAPER_TIMEOUT_MS, 8_000);
    _scraper = new TinyFishScraperAdapter(key, undefined, timeoutMs);
    return _scraper;
  }

  if (provider === "tiered") {
    const tiers: ScraperAdapter[] = [];
    const directEnabled = process.env.SCRAPER_DIRECT_ENABLED !== "false";
    const jinaEnabled = process.env.SCRAPER_JINA_ENABLED !== "false";
    const tinyfishEnabled = process.env.SCRAPER_TINYFISH_ENABLED !== "false";

    const scraperTimeoutMs = int(process.env.SCRAPER_TIMEOUT_MS, 8_000);
    const maxResponseBytes = int(process.env.SCRAPER_MAX_RESPONSE_BYTES, 1_048_576);
    const maxRedirects = int(process.env.SCRAPER_MAX_REDIRECTS, 3);

    if (directEnabled) {
      tiers.push(
        new SafeDirectScraperAdapter({
          timeoutMs: scraperTimeoutMs,
          maxResponseBytes,
          maxRedirects,
        }),
      );
    }

    if (jinaEnabled && process.env.JINA_API_KEY) {
      tiers.push(new JinaReaderScraperAdapter(process.env.JINA_API_KEY, scraperTimeoutMs));
    }

    if (tinyfishEnabled && process.env.TINYFISH_API_KEY) {
      tiers.push(
        new TinyFishScraperAdapter(
          process.env.TINYFISH_API_KEY,
          undefined,
          scraperTimeoutMs,
        ),
      );
    }

    if (tiers.length === 0) {
      throw new Error(
        "No scraper tiers enabled or available with valid API keys for TieredScraperAdapter",
      );
    }

    _scraper = new TieredScraperAdapter(tiers);
    return _scraper;
  }

  throw new Error(`Unknown SCRAPER_PROVIDER: ${provider}`);
}

export function createRegistryAdapter(): RegistryAdapter {
  if (_registry) return _registry;

  const enabled = process.env.VIETQR_ENABLED !== "false";
  if (enabled) {
    _registry = new VietQrRegistryAdapter();
  } else {
    _registry = {
      findByTaxId: async () => null,
    };
  }
  return _registry;
}

export function createStorageAdapter(): StorageAdapter {
  if (_storage) return _storage;

  switch (process.env.STORAGE_PROVIDER) {
    case "memory":
      _storage = new MemoryStorageAdapter();
      break;
    case "supabase":
      _storage = new SupabaseStorageAdapter(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      );
      break;
    default:
      _storage = new MemoryStorageAdapter();
  }
  return _storage;
}

// Reset singletons (for testing)
export function resetAdapters(): void {
  _llm = null;
  _search = null;
  _scraper = null;
  _registry = null;
  _storage = null;
}

// ─── Helpers ───

function int(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}
