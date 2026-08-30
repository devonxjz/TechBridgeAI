import type {
  CompanyInput,
  CacheSuggestion,
  ResearchSnapshot,
} from "@/lib/types";
import type {
  StorageAdapter,
  StorageContext,
  StorageReadOptions,
  StorageWriteOptions,
} from "@/adapters/storage/types";

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

export type CacheResolution =
  | {
      kind: "hit";
      snapshot: ResearchSnapshot;
      matchedBy: "tax_id" | "domain";
    }
  | { kind: "suggestions"; suggestions: CacheSuggestion[] }
  | {
      kind: "miss";
      identity: NormalizedCompanyIdentity;
      cacheInvalid: boolean;
    }
  | {
      kind: "conflict";
      taxCompanyId: string;
      domainCompanyIds: string[];
    };

export interface ResearchCache {
  lookup(
    context: StorageContext,
    input: CompanyInput,
    options?: StorageReadOptions,
  ): Promise<CacheResolution>;
  select(
    context: StorageContext,
    input: CompanyInput,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot>;
  prepareRefresh(
    context: StorageContext,
    input: CompanyInput,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot>;
  resolveMiss(
    context: StorageContext,
    input: CompanyInput,
    options?: StorageWriteOptions,
  ): Promise<{ companyId: string; identity: NormalizedCompanyIdentity }>;
  persist(
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    snapshot: Omit<ResearchSnapshot, "lastSyncedAt">,
    options?: StorageWriteOptions,
  ): Promise<ResearchSnapshot>;
}

export class IdentityConflictError extends Error {
  readonly code = "identity_conflict";
  constructor(message = "Thông tin định danh công ty mâu thuẫn.") {
    super(message);
    this.name = "IdentityConflictError";
  }
}

export class CacheInvalidError extends Error {
  readonly code = "cache_invalid";
  constructor(message = "Dữ liệu cache không hợp lệ.") {
    super(message);
    this.name = "CacheInvalidError";
  }
}

export class InvalidCacheSelectionError extends Error {
  readonly code = "invalid_cache_selection";
  constructor(message = "Lựa chọn cache không hợp lệ với dữ liệu nhập.") {
    super(message);
    this.name = "InvalidCacheSelectionError";
  }
}

export class CacheUnavailableError extends Error {
  readonly code = "cache_unavailable";
  constructor(message = "Dịch vụ cache tạm thời không khả dụng.") {
    super(message);
    this.name = "CacheUnavailableError";
  }
}

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

export function createResearchCache(storage: StorageAdapter): ResearchCache {
  return {
    async lookup(
      context: StorageContext,
      input: CompanyInput,
      options?: StorageReadOptions,
    ): Promise<CacheResolution> {
      const identity = normalizeCompanyIdentity(input);
      const candidates = await storage.findIdentityCandidates(context, identity, options);
      const decision = decideCacheLookup(identity, candidates);

      switch (decision.kind) {
        case "hit": {
          try {
            const snapshot = await storage.getLatestCompleteSnapshot(context, decision.companyId, options);
            if (!snapshot) {
              return { kind: "miss", identity, cacheInvalid: false };
            }
            return {
              kind: "hit",
              snapshot,
              matchedBy: decision.matchedBy,
            };
          } catch (err) {
            if (err instanceof CacheInvalidError) {
              return { kind: "miss", identity, cacheInvalid: true };
            }
            throw err;
          }
        }
        case "suggestions": {
          const suggestions: CacheSuggestion[] = [];
          for (const id of decision.companyIds) {
            try {
              const snapshot = await storage.getLatestCompleteSnapshot(context, id, options);
              if (snapshot) {
                const candidate = candidates.find((c) => c.companyId === id);
                suggestions.push({
                  companyId: id,
                  officialName: snapshot.profile.officialName,
                  taxId: snapshot.profile.taxId ?? candidate?.taxId ?? undefined,
                  domain: candidate?.domain ?? (snapshot.profile.website ? normalizeDomain(snapshot.profile.website) ?? undefined : undefined),
                  lastSyncedAt: snapshot.lastSyncedAt,
                });
              }
            } catch {
              // Ignore corrupt candidates in suggestions
            }
          }
          if (suggestions.length === 0) {
            return { kind: "miss", identity, cacheInvalid: false };
          }
          return { kind: "suggestions", suggestions };
        }
        case "conflict": {
          return {
            kind: "conflict",
            taxCompanyId: decision.taxCompanyId,
            domainCompanyIds: decision.domainCompanyIds,
          };
        }
        case "miss":
        default: {
          return { kind: "miss", identity, cacheInvalid: false };
        }
      }
    },

    async select(
      context: StorageContext,
      input: CompanyInput,
      companyId: string,
      options?: StorageReadOptions
    ): Promise<ResearchSnapshot> {
      const resolution = await this.lookup(context, input, options);
      if (
        resolution.kind !== "suggestions" ||
        !resolution.suggestions.some((s) => s.companyId === companyId)
      ) {
        throw new InvalidCacheSelectionError();
      }

      const snapshot = await storage.getLatestCompleteSnapshot(context, companyId, options);
      if (!snapshot) {
        throw new InvalidCacheSelectionError();
      }
      return snapshot;
    },

    async prepareRefresh(
      context: StorageContext,
      input: CompanyInput,
      companyId: string,
      options?: StorageReadOptions
    ): Promise<ResearchSnapshot> {
      const identity = normalizeCompanyIdentity(input);
      const candidates = await storage.findIdentityCandidates(context, identity, options);
      const decision = decideCacheLookup(identity, candidates);

      if (decision.kind === "conflict") {
        throw new IdentityConflictError();
      }
      if (decision.kind === "hit" && decision.companyId !== companyId) {
        throw new IdentityConflictError();
      }
      if (decision.kind === "suggestions" && !decision.companyIds.includes(companyId)) {
        throw new IdentityConflictError();
      }

      const snapshot = await storage.getLatestCompleteSnapshot(context, companyId, options);
      if (!snapshot) {
        throw new IdentityConflictError("Không tìm thấy dữ liệu công ty để làm mới.");
      }
      return snapshot;
    },

    async resolveMiss(
      context: StorageContext,
      input: CompanyInput,
      options?: StorageWriteOptions
    ): Promise<{ companyId: string; identity: NormalizedCompanyIdentity }> {
      const identity = normalizeCompanyIdentity(input);
      const candidateId = crypto.randomUUID();
      const companyId = await storage.resolveOrCreateIdentity(
        context,
        identity,
        candidateId,
        options,
      );
      return { companyId, identity };
    },

    async persist(
      context: StorageContext,
      identity: NormalizedCompanyIdentity,
      snapshot: Omit<ResearchSnapshot, "lastSyncedAt">,
      options?: StorageWriteOptions
    ): Promise<ResearchSnapshot> {
      return await storage.persistResearchSnapshot(
        context,
        identity,
        snapshot,
        options,
      );
    },
  };
}
