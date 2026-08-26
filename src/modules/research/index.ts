// ═══════════════════════════════════════════════════════
// Research source runners used by the LangGraph workflow.
// ═══════════════════════════════════════════════════════

import type {
  CompanyInput,
  RawFinding,
  SourceName,
} from "@/lib/types";
import type { SearchAdapter } from "@/adapters/search/types";
import type { ScraperAdapter } from "@/adapters/scraper/types";
import type { RegistryAdapter } from "@/adapters/registry/types";
import type { ResourceGuards } from "@/config";
import { searchWeb } from "./sources/web-search";
import { scrapeWebsite } from "./sources/website";
import { searchNews } from "./sources/news";
import { fetchRegistryData } from "./sources/registry";
import { scrapeLinkedIn } from "./sources/linkedin";
import { buildResearchQueries } from "./queries";
import type { ResearchBudget } from "./budget";

export interface ResearchSourceContext {
  budget: ResearchBudget;
  signal?: AbortSignal;
}

export type ResearchSourceRunner = (
  input: CompanyInput,
  context: ResearchSourceContext,
) => Promise<RawFinding[]>;

export interface ResearchDeps {
  search: SearchAdapter;
  scraper: ScraperAdapter;
  registry: RegistryAdapter;
  guards: ResourceGuards;
}

export function createResearchSourceRunners(
  deps: ResearchDeps
): Record<SourceName, ResearchSourceRunner> {
  return {
    web_search: (input, context) =>
      searchWeb(
        input,
        bindSearchAdapter(deps.search, context),
        buildResearchQueries(input, deps.guards.maxQueriesPerResearch).web,
      ),
    website: (input, context) =>
      scrapeWebsite(
        input,
        bindScraperAdapter(deps.scraper, context),
        bindSearchAdapter(deps.search, context),
        deps.guards.maxScrapePagesPerResearch,
      ),
    news: (input, context) =>
      searchNews(
        input,
        bindSearchAdapter(deps.search, context),
        buildResearchQueries(input, deps.guards.maxQueriesPerResearch).news,
      ),
    registry: (input, context) =>
      fetchRegistryData(
        input,
        bindSearchAdapter(deps.search, context),
        bindScraperAdapter(deps.scraper, context),
        bindRegistryAdapter(deps.registry, context),
      ),
    linkedin: (input, context) =>
      scrapeLinkedIn(input, bindScraperAdapter(deps.scraper, context)),
  };
}

function bindSearchAdapter(
  adapter: SearchAdapter,
  context: ResearchSourceContext,
): SearchAdapter {
  return {
    search: (query, options) => {
      context.budget.claimSearchQuery();
      return context.budget.runWithProviderSlot(
        "search",
        () => adapter.search(query, { ...options, signal: context.signal }),
        context.signal,
      );
    },
  };
}

function bindScraperAdapter(
  adapter: ScraperAdapter,
  context: ResearchSourceContext,
): ScraperAdapter {
  return {
    extract: (url) =>
      context.budget.runWithProviderSlot(
        "scraper",
        () => adapter.extract(url, { signal: context.signal }),
        context.signal,
      ),
  };
}

function bindRegistryAdapter(
  adapter: RegistryAdapter,
  context: ResearchSourceContext,
): RegistryAdapter {
  return {
    findByTaxId: (taxId) =>
      context.budget.runWithProviderSlot(
        "registry",
        () => adapter.findByTaxId(taxId, { signal: context.signal }),
        context.signal,
      ),
  };
}
