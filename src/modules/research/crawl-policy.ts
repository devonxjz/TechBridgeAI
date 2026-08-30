// ═══════════════════════════════════════════════════════
// Crawl Policy & Politeness Controller
// Respects robots.txt directives and process-local domain throttling
// ═══════════════════════════════════════════════════════

import robotsParser from "robots-parser";
import type { RobotsDecision } from "@/lib/types";
import { ScrapeError } from "@/adapters/scraper/types";

export interface CrawlDecision {
  robotsDecision: RobotsDecision;
  shouldExtract: boolean;
}

export interface CrawlPolicy {
  beforeFetch(url: string, signal?: AbortSignal): Promise<CrawlDecision>;
}

export interface CrawlPolicyOptions {
  userAgent: string;
  minDomainIntervalMs: number;
  robotsCacheTtlMs: number;
  now?: () => number;
}

interface RobotsCacheEntry {
  robotsText: string;
  loadedAt: number;
  status: "success" | "error";
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Execution aborted", "AbortError"));
  }
  if (ms <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;

    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new DOMException("Execution aborted", "AbortError"));
    };

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createCrawlPolicy(
  loadRobots: (robotsUrl: string, signal?: AbortSignal) => Promise<string>,
  options: CrawlPolicyOptions,
): CrawlPolicy {
  const now = options.now ?? Date.now;
  const robotsCache = new Map<string, RobotsCacheEntry>();
  const domainNextSlots = new Map<string, number>();

  return {
    async beforeFetch(url: string, signal?: AbortSignal): Promise<CrawlDecision> {
      if (signal?.aborted) {
        throw new DOMException("Execution aborted", "AbortError");
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(url);
      } catch {
        return { robotsDecision: "unknown", shouldExtract: false };
      }

      const origin = `${targetUrl.protocol}//${targetUrl.host}`;
      const hostname = targetUrl.hostname.toLowerCase();
      const robotsUrl = `${origin}/robots.txt`;

      let cacheEntry = robotsCache.get(origin);
      const currentTime = now();

      if (!cacheEntry || currentTime - cacheEntry.loadedAt > options.robotsCacheTtlMs) {
        try {
          const robotsText = await loadRobots(robotsUrl, signal);
          cacheEntry = {
            robotsText: robotsText ?? "",
            loadedAt: now(),
            status: "success",
          };
        } catch (err) {
          const isNotFound = err instanceof ScrapeError && (err.code === "not_found" || err.code === "empty");
          // Fallback string matching for older scrapers or fetch errors
          const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
          const looksLikeNotFound = errMsg.includes("404") || errMsg.includes("empty text") || errMsg.includes("not found");

          if (isNotFound || looksLikeNotFound) {
            cacheEntry = {
              robotsText: "",
              loadedAt: now(),
              status: "success",
            };
          } else {
            cacheEntry = {
              robotsText: "",
              loadedAt: now(),
              status: "error",
            };
          }
        }
        robotsCache.set(origin, cacheEntry);
      }

      if (cacheEntry.status === "error") {
        return { robotsDecision: "unknown", shouldExtract: false };
      }

      // Check robots rules
      if (cacheEntry.robotsText.trim()) {
        const robots = robotsParser(robotsUrl, cacheEntry.robotsText);
        const isAllowed = robots.isAllowed(url, options.userAgent);

        if (isAllowed === false) {
          return { robotsDecision: "disallowed", shouldExtract: false };
        }
      }

      // Throttling for allowed domain
      if (options.minDomainIntervalMs > 0) {
        const currentNow = now();
        const prevSlot = domainNextSlots.get(hostname) ?? currentNow;
        const currentSlot = Math.max(currentNow, prevSlot);
        domainNextSlots.set(hostname, currentSlot + options.minDomainIntervalMs);

        const waitMs = currentSlot - currentNow;
        if (waitMs > 0) {
          await delay(waitMs, signal);
        }
      }

      return { robotsDecision: "allowed", shouldExtract: true };
    },
  };
}
