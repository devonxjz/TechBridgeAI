// ═══════════════════════════════════════════════════════
// Research Evidence Boundary
// Validates, canonicalizes, deduplicates, and deterministically
// orders findings across parallel source executions.
// ═══════════════════════════════════════════════════════

import type {
  PreparedEvidence,
  RawFinding,
  ResearchOutcome,
  SourceExecutionResult,
  SourceName,
} from "@/lib/types";

const SOURCE_ORDER: Record<SourceName, number> = {
  registry: 0,
  website: 1,
  news: 2,
  web_search: 3,
  linkedin: 4,
};

function canonicalizeUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function prepareEvidence(
  results: readonly SourceExecutionResult[]
): PreparedEvidence {
  const activeResults = results.filter((r) => r.status !== "skipped");
  const succeededResults = activeResults.filter((r) => r.status === "succeeded");

  const sourceCoverage =
    activeResults.length > 0
      ? succeededResults.length / activeResults.length
      : 0;

  // Flatten and process all findings from succeeded sources
  const candidateFindings: RawFinding[] = [];
  for (const res of succeededResults) {
    for (const finding of res.findings) {
      if (!finding.content || !finding.content.trim()) continue;
      const canonical = canonicalizeUrl(finding.url);
      if (!canonical) continue;

      candidateFindings.push({
        ...finding,
        url: canonical,
      });
    }
  }

  // Deduplicate by canonical URL, keeping higher confidence
  const dedupedMap = new Map<string, RawFinding>();
  for (const f of candidateFindings) {
    const existing = dedupedMap.get(f.url);
    if (!existing) {
      dedupedMap.set(f.url, f);
    } else {
      if (f.confidence > existing.confidence) {
        dedupedMap.set(f.url, f);
      } else if (
        f.confidence === existing.confidence &&
        (SOURCE_ORDER[f.source] < SOURCE_ORDER[existing.source] ||
          f.content.length > existing.content.length)
      ) {
        dedupedMap.set(f.url, f);
      }
    }
  }

  // Deterministically sort by source order, then canonical URL
  const sortedFindings = Array.from(dedupedMap.values()).sort((a, b) => {
    const orderDiff = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
    if (orderDiff !== 0) return orderDiff;
    return a.url.localeCompare(b.url);
  });

  let outcome: Exclude<ResearchOutcome, "running">;
  if (sortedFindings.length === 0 || succeededResults.length === 0) {
    outcome = "failed";
  } else if (succeededResults.length === activeResults.length) {
    outcome = "complete";
  } else {
    outcome = "partial";
  }

  return {
    findings: sortedFindings,
    sourceCoverage,
    outcome,
  };
}
