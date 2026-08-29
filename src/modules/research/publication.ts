// ═══════════════════════════════════════════════════════
// Publication Normalizer
// Extracts metadata, canonical/AMP URLs, paywall indicators,
// snippet directives, and safe excerpts from scraped publications.
// ═══════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import crypto from "node:crypto";
import type { SearchResult } from "@/adapters/search/types";
import type { ScrapedContent } from "@/adapters/scraper/types";
import type {
  FetchMethod,
  PreviewMode,
  PreviewPolicy,
  PublicationMetadata,
  RobotsDecision,
} from "@/lib/types";

export interface NormalizedPublication {
  publication: PublicationMetadata;
  previewPolicy: PreviewPolicy;
  excerpt?: string;
  contentFingerprint?: string;
  fetchMethod: FetchMethod;
}

import { getHostname, resolveHttpUrl } from "./url-utils";

function parseIsoDate(val: unknown): string | undefined {
  if (typeof val !== "string" || !val.trim()) return undefined;
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }
  return undefined;
}

export function normalizePublication(
  result: SearchResult,
  scraped: ScrapedContent | null,
  robotsDecision: RobotsDecision,
): NormalizedPublication {
  const originUrl = scraped?.url || result.url;
  const publisherDomain = getHostname(originUrl);

  let title = result.title;
  let publisherName = result.publisherName;
  const authors: string[] = [];
  let publishedAt: string | undefined;
  const publishedLabel = result.publishedLabel;
  let modifiedAt: string | undefined;
  let canonicalUrl: string | undefined;
  let ampUrl: string | undefined;

  let paywallDetected = false;
  let isAccessibleForFree: boolean | undefined = undefined;
  let robotsNoSnippet = false;
  let maxSnippetLength: number | undefined = undefined;

  let extractedRawText = "";
  let fetchMethod: FetchMethod = "search_snippet";

  if (scraped?.html) {
    const $ = cheerio.load(scraped.html);

    if (scraped.title) {
      title = scraped.title;
    }

    // 1. Canonical and AMP
    const canonicalHref = $('link[rel="canonical"]').attr("href");
    if (canonicalHref) {
      canonicalUrl = resolveHttpUrl(canonicalHref, originUrl);
    }

    const ampHref = $('link[rel="amphtml"]').attr("href");
    if (ampHref) {
      ampUrl = resolveHttpUrl(ampHref, originUrl);
    }

    // 2. Meta tags for publisher, author, date, robots
    const ogSiteName = $('meta[property="og:site_name"]').attr("content");
    if (ogSiteName?.trim()) {
      publisherName = ogSiteName.trim();
    }

    const metaAuthor =
      $('meta[name="author"]').attr("content") ||
      $('meta[property="article:author"]').attr("content");
    if (metaAuthor?.trim()) {
      authors.push(metaAuthor.trim());
    }

    const metaPublished =
      $('meta[property="article:published_time"]').attr("content") ||
      $('meta[name="pubdate"]').attr("content") ||
      $('meta[name="publish_date"]').attr("content");
    const parsedPublished = parseIsoDate(metaPublished);
    if (parsedPublished) {
      publishedAt = parsedPublished;
    }

    const metaModified = $('meta[property="article:modified_time"]').attr("content");
    const parsedModified = parseIsoDate(metaModified);
    if (parsedModified) {
      modifiedAt = parsedModified;
    }

    const metaRobots =
      $('meta[name="robots"]').attr("content") ||
      $('meta[name="googlebot"]').attr("content") ||
      "";
    if (metaRobots) {
      const directives = metaRobots.toLowerCase().split(",").map((s) => s.trim());
      for (const dir of directives) {
        if (dir === "nosnippet") {
          robotsNoSnippet = true;
        } else if (dir.startsWith("max-snippet:")) {
          const num = parseInt(dir.slice("max-snippet:".length), 10);
          if (!isNaN(num)) {
            maxSnippetLength = num;
          }
        }
      }
    }

    // 3. JSON-LD structured data extraction
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const text = $(el).text();
        if (!text.trim()) return;
        const json: unknown = JSON.parse(text);
        let items: Record<string, unknown>[] = [];
        if (Array.isArray(json)) {
          items = json.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === "object",
          );
        } else if (json && typeof json === "object") {
          const record = json as Record<string, unknown>;
          if (Array.isArray(record["@graph"])) {
            items = record["@graph"].filter(
              (item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === "object",
            );
          } else {
            items = [record];
          }
        }

        for (const item of items) {
          // Check paywall
          if (item.isAccessibleForFree === false || item.isAccessibleForFree === "False" || item.isAccessibleForFree === "false") {
            paywallDetected = true;
            isAccessibleForFree = false;
          } else if (item.isAccessibleForFree === true || item.isAccessibleForFree === "True" || item.isAccessibleForFree === "true") {
            isAccessibleForFree = true;
          }

          if (item.hasPart && typeof item.hasPart === "object") {
            const hasPart = item.hasPart as { isAccessibleForFree?: boolean | string };
            if (hasPart.isAccessibleForFree === false || hasPart.isAccessibleForFree === "False" || hasPart.isAccessibleForFree === "false") {
              paywallDetected = true;
              isAccessibleForFree = false;
            }
          }

          // Check publisher
          if (item.publisher && typeof item.publisher === "object") {
            const pubName = (item.publisher as { name?: string }).name;
            if (typeof pubName === "string" && pubName.trim()) {
              publisherName = pubName.trim();
            }
          } else if (typeof item.publisher === "string" && item.publisher.trim()) {
            publisherName = item.publisher.trim();
          }

          // Check author
          if (item.author) {
            const rawAuthors = Array.isArray(item.author) ? item.author : [item.author];
            for (const a of rawAuthors) {
              if (typeof a === "string" && a.trim() && !authors.includes(a.trim())) {
                authors.push(a.trim());
              } else if (a && typeof a === "object" && typeof (a as { name?: string }).name === "string") {
                const name = (a as { name: string }).name.trim();
                if (name && !authors.includes(name)) {
                  authors.push(name);
                }
              }
            }
          }

          // Check dates
          if (item.datePublished && !publishedAt) {
            const parsed = parseIsoDate(item.datePublished);
            if (parsed) publishedAt = parsed;
          }
          if (item.dateModified && !modifiedAt) {
            const parsed = parseIsoDate(item.dateModified);
            if (parsed) modifiedAt = parsed;
          }
        }
      } catch {
        // Continue on malformed JSON-LD
      }
    });

    // 4. Safe plain text body extraction
    $("script, style, noscript, [data-nosnippet]").remove();

    const mainContainer = $("article").length > 0 ? $("article") : $("[role='main']").length > 0 ? $("[role='main']") : $("#content").length > 0 ? $("#content") : $("main").length > 0 ? $("main") : $("body");
    extractedRawText = mainContainer.text().replace(/\s+/g, " ").trim();
    if (extractedRawText.length > 0) {
      fetchMethod = "server_extract";
    }
  }

  // Preview mode resolution
  let mode: PreviewMode = "short_excerpt";
  if (robotsNoSnippet || paywallDetected || (maxSnippetLength !== undefined && maxSnippetLength <= 0)) {
    mode = "metadata_only";
  }

  // Snippet cap (max 800 Unicode code points)
  let effectiveCap = 800;
  if (maxSnippetLength !== undefined && maxSnippetLength > 0) {
    effectiveCap = Math.min(effectiveCap, maxSnippetLength);
  }

  let excerpt: string | undefined = undefined;
  if (mode !== "metadata_only") {
    const raw = extractedRawText || result.snippet || "";
    if (raw) {
      excerpt = Array.from(raw).slice(0, effectiveCap).join("").trim();
    }
  }

  let contentFingerprint: string | undefined = undefined;
  const hashText = extractedRawText || excerpt;
  if (hashText) {
    contentFingerprint = crypto
      .createHash("sha256")
      .update(hashText.toLowerCase())
      .digest("hex");
  }

  const publication: PublicationMetadata = {
    title,
    publisherName: publisherName || publisherDomain,
    publisherDomain,
    authors,
    publishedAt,
    publishedLabel,
    modifiedAt,
    canonicalUrl: canonicalUrl || (scraped ? scraped.url : result.url),
    ampUrl,
  };

  const previewPolicy: PreviewPolicy = {
    mode,
    paywallDetected,
    isAccessibleForFree,
    robotsDecision,
    maxSnippetLength,
  };

  return {
    publication,
    previewPolicy,
    excerpt,
    contentFingerprint,
    fetchMethod: excerpt && fetchMethod === "server_extract" ? "server_extract" : "search_snippet",
  };
}
