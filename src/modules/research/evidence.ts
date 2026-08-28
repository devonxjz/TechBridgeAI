// ═══════════════════════════════════════════════════════
// Research Evidence Boundary
// Validates, canonicalizes, deduplicates, deterministically
// orders findings, normalizes rich citations, and evaluates claim evidence.
// ═══════════════════════════════════════════════════════

import type {
  ClaimEvidence,
  PreparedEvidence,
  RawFinding,
  ResearchOutcome,
  SourceCitation,
  SourceExecutionResult,
  SourceName,
  SourceSignals,
  VerificationStatus,
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

function getHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "unknown";
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

  // Deduplicate by canonical URL, keeping higher confidence or richer content
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
          (f.fetchMethod === "server_extract" && existing.fetchMethod !== "server_extract") ||
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

export function toSourceCitations(
  findings: readonly RawFinding[],
  companyWebsite?: string,
): SourceCitation[] {
  let companyHost = "";
  if (companyWebsite) {
    companyHost = getHostname(companyWebsite);
  }

  // Count fingerprint frequencies to calculate duplicate cluster sizes
  const fingerprintCounts = new Map<string, number>();
  for (const f of findings) {
    if (f.contentFingerprint) {
      fingerprintCounts.set(
        f.contentFingerprint,
        (fingerprintCounts.get(f.contentFingerprint) ?? 0) + 1
      );
    }
  }

  return findings.map((finding) => {
    const pubDomain = finding.publication?.publisherDomain || getHostname(finding.url);
    const isPrimary =
      finding.source === "registry" ||
      (Boolean(companyHost) && (pubDomain === companyHost || pubDomain.endsWith(`.${companyHost}`)));

    const duplicateClusterSize = finding.contentFingerprint
      ? fingerprintCounts.get(finding.contentFingerprint) ?? 1
      : 1;

    const signals: SourceSignals = {
      primarySource: isPrimary,
      publisherIdentified: Boolean(finding.publication?.publisherName),
      authorIdentified: Boolean(
        finding.publication?.authors && finding.publication.authors.length > 0
      ),
      publicationDateIdentified: Boolean(finding.publication?.publishedAt),
      duplicateClusterSize,
    };

    const title =
      finding.publication?.title ||
      (typeof finding.metadata?.title === "string" ? finding.metadata.title : undefined) ||
      "Untitled Source";

    return {
      source: finding.source,
      url: finding.url,
      title,
      snippet: (finding.excerpt || finding.content).slice(0, 500),
      confidence: finding.confidence,
      accessedAt: finding.extractedAt || new Date(),
      fieldsContributed: [],
      publication: finding.publication,
      previewPolicy: finding.previewPolicy,
      signals,
      excerpt: finding.excerpt,
      contentFingerprint: finding.contentFingerprint,
      fetchMethod: finding.fetchMethod || "search_snippet",
    };
  });
}

export interface ClaimEvidenceInput {
  supportingUrls: readonly string[];
  conflictingUrls?: readonly string[];
}

export function resolveVerificationStatus(
  hasConflict: boolean,
  hasPrimarySource: boolean,
  independentPublisherCount: number,
  supportingCount: number,
): VerificationStatus {
  if (hasConflict) return "conflicting";
  if (hasPrimarySource) return "primary_source";
  if (independentPublisherCount >= 2) return "corroborated";
  if (supportingCount > 0) return "single_source";
  return "insufficient";
}

export function buildClaimEvidence(
  input: ClaimEvidenceInput,
  citations: readonly SourceCitation[],
): ClaimEvidence {
  const citationMap = new Map(citations.map((c) => [c.url, c]));

  // 1. Sanitize conflicting URLs (must be in citationMap)
  const conflictingUrls: string[] = [];
  for (const rawUrl of input.conflictingUrls ?? []) {
    const canonical = canonicalizeUrl(rawUrl);
    if (canonical && citationMap.has(canonical) && !conflictingUrls.includes(canonical)) {
      conflictingUrls.push(canonical);
    }
  }

  // 2. Sanitize supporting URLs (must be in citationMap and NOT in conflictingUrls)
  const supportingUrls: string[] = [];
  for (const rawUrl of input.supportingUrls ?? []) {
    const canonical = canonicalizeUrl(rawUrl);
    if (
      canonical &&
      citationMap.has(canonical) &&
      !conflictingUrls.includes(canonical) &&
      !supportingUrls.includes(canonical)
    ) {
      supportingUrls.push(canonical);
    }
  }

  // 3. Check for primary source among supporting citations
  let hasPrimarySource = false;
  const supportingCitations: SourceCitation[] = [];
  for (const u of supportingUrls) {
    const c = citationMap.get(u);
    if (c) {
      supportingCitations.push(c);
      if (c.signals?.primarySource) {
        hasPrimarySource = true;
      }
    }
  }

  // 4. Calculate independentPublisherCount by collapsing identical fingerprints and domains
  const countedFingerprints = new Set<string>();
  const countedDomains = new Set<string>();
  let independentPublisherCount = 0;

  for (const c of supportingCitations) {
    const domain = c.publication?.publisherDomain || getHostname(c.url);
    const fp = c.contentFingerprint;

    if (fp) {
      if (countedFingerprints.has(fp)) {
        continue;
      }
      countedFingerprints.add(fp);
    }

    if (countedDomains.has(domain)) {
      continue;
    }
    countedDomains.add(domain);
    independentPublisherCount++;
  }

  const hasConflict = conflictingUrls.length > 0;
  const status = resolveVerificationStatus(
    hasConflict,
    hasPrimarySource,
    independentPublisherCount,
    supportingUrls.length,
  );

  return {
    status,
    independentPublisherCount,
    supportingUrls,
    conflictingUrls,
  };
}

