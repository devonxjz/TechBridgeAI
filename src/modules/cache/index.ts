import type { CompanyInput } from "@/lib/types";

const TAX_ID_PATTERN = /^\d{10}(?:\d{3})?$/;

export interface NormalizedCompanyIdentity {
  taxId: string | null;
  domain: string | null;
  name: string;
}

export interface IdentityCandidate {
  companyId: string;
  taxId: string | null;
  domain: string | null;
  name: string;
}

export type CacheDecision =
  | { kind: "hit"; companyId: string; matchedBy: "tax_id" | "domain" }
  | { kind: "suggestions"; companyIds: string[] }
  | { kind: "miss" }
  | { kind: "conflict"; taxCompanyId: string; domainCompanyIds: string[] };

export function normalizeTaxId(value?: string): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/[\s.-]/g, "");
  if (!TAX_ID_PATTERN.test(normalized)) {
    throw new Error("Mã số thuế phải có 10 hoặc 13 chữ số");
  }
  return normalized;
}

export function normalizeDomain(website?: string): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ");
}

export function normalizeCompanyIdentity(input: CompanyInput): NormalizedCompanyIdentity {
  return {
    taxId: normalizeTaxId(input.taxId),
    domain: normalizeDomain(input.website),
    name: normalizeName(input.name),
  };
}

export function decideCacheLookup(
  identity: NormalizedCompanyIdentity,
  candidates: readonly IdentityCandidate[]
): CacheDecision {
  const taxMatches = identity.taxId
    ? candidates.filter((c) => c.taxId === identity.taxId)
    : [];

  const domainMatches = identity.domain
    ? candidates.filter((c) => c.domain === identity.domain)
    : [];

  // 1. Tax ID lookup
  if (identity.taxId && taxMatches.length > 0) {
    const taxCompanyId = taxMatches[0].companyId;
    if (identity.domain && domainMatches.length > 0) {
      const domainCompanyIds = Array.from(
        new Set(domainMatches.map((c) => c.companyId))
      ).sort();
      if (!domainCompanyIds.includes(taxCompanyId)) {
        return {
          kind: "conflict",
          taxCompanyId,
          domainCompanyIds,
        };
      }
    }
    return {
      kind: "hit",
      companyId: taxCompanyId,
      matchedBy: "tax_id",
    };
  }

  // 2. Domain lookup
  if (identity.domain && domainMatches.length > 0) {
    const domainCompanyIds = Array.from(
      new Set(domainMatches.map((c) => c.companyId))
    ).sort();
    if (domainCompanyIds.length === 1) {
      return {
        kind: "hit",
        companyId: domainCompanyIds[0],
        matchedBy: "domain",
      };
    }
    return {
      kind: "suggestions",
      companyIds: domainCompanyIds,
    };
  }

  // 3. Name lookup
  const nameMatches = candidates.filter((c) => c.name === identity.name);
  if (nameMatches.length > 0) {
    const nameCompanyIds = Array.from(
      new Set(nameMatches.map((c) => c.companyId))
    ).sort();
    return {
      kind: "suggestions",
      companyIds: nameCompanyIds,
    };
  }

  // 4. Miss
  return { kind: "miss" };
}
