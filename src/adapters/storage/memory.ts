// ═══════════════════════════════════════════════════════
// In-Memory Storage Adapter — for development & testing
// ═══════════════════════════════════════════════════════

import type {
  CompanyProfile,
  ProfileDiff,
  ResearchSnapshot,
} from "@/lib/types";
import {
  type IdentityCandidate,
  type NormalizedCompanyIdentity,
  IdentityConflictError,
} from "@/modules/cache";
import type {
  StorageAdapter,
  StorageContext,
  StorageReadOptions,
  StorageWriteOptions,
} from "./types";

interface TenantStorage {
  identities: Map<string, IdentityCandidate>;
  profiles: Map<string, Map<number, CompanyProfile>>;
  reports: Map<string, Map<number, ResearchSnapshot["report"]>>;
  timestamps: Map<string, Map<number, string>>;
  diffs: Map<string, ProfileDiff[]>;
}

function createTenantStorage(): TenantStorage {
  return {
    identities: new Map(),
    profiles: new Map(),
    reports: new Map(),
    timestamps: new Map(),
    diffs: new Map(),
  };
}

const LEGACY_TENANT_ID = "__legacy__";

type ResearchSnapshotDraft = Omit<ResearchSnapshot, "lastSyncedAt">;

export class MemoryStorageAdapter implements StorageAdapter {
  private tenants: Map<string, TenantStorage> = new Map();

  private tenant(tenantId: string): TenantStorage {
    let storage = this.tenants.get(tenantId);
    if (!storage) {
      storage = createTenantStorage();
      this.tenants.set(tenantId, storage);
    }
    return storage;
  }

  async saveProfile(
    context: StorageContext,
    profile: CompanyProfile,
    options?: StorageWriteOptions,
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    const { profiles } = this.tenant(context.tenantId);
    if (!profiles.has(profile.id)) {
      profiles.set(profile.id, new Map());
    }
    profiles.get(profile.id)!.set(profile.version, structuredClone(profile));
  }

  async getProfile(
    context: StorageContext,
    companyId: string,
    version?: number
  ): Promise<CompanyProfile | null> {
    const versions = this.tenant(context.tenantId).profiles.get(companyId);
    if (!versions) return null;

    if (version !== undefined) {
      const p = versions.get(version);
      return p ? structuredClone(p) : null;
    }

    return this.getLatestProfile(context, companyId);
  }

  async getLatestProfile(
    context: StorageContext,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<CompanyProfile | null> {
    options?.signal?.throwIfAborted();
    const versions = this.tenant(context.tenantId).profiles.get(companyId);
    if (!versions || versions.size === 0) return null;

    const maxVersion = Math.max(...versions.keys());
    const p = versions.get(maxVersion);
    return p ? structuredClone(p) : null;
  }

  async listProfiles(context: StorageContext): Promise<CompanyProfile[]> {
    const result: CompanyProfile[] = [];
    for (const versions of this.tenant(context.tenantId).profiles.values()) {
      const maxVersion = Math.max(...versions.keys());
      const latest = versions.get(maxVersion);
      if (latest) result.push(structuredClone(latest));
    }
    return result;
  }

  async saveDiff(
    context: StorageContext,
    diff: ProfileDiff,
    options?: StorageWriteOptions,
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    const { diffs } = this.tenant(context.tenantId);
    if (!diffs.has(diff.companyId)) {
      diffs.set(diff.companyId, []);
    }
    diffs.get(diff.companyId)!.push(structuredClone(diff));
  }

  async getDiffs(context: StorageContext, companyId: string): Promise<ProfileDiff[]> {
    const d = this.tenant(context.tenantId).diffs.get(companyId) ?? [];
    return structuredClone(d);
  }

  async findIdentityCandidates(
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    options?: StorageReadOptions,
  ): Promise<IdentityCandidate[]> {
    options?.signal?.throwIfAborted();
    const result: IdentityCandidate[] = [];
    for (const cand of this.tenant(context.tenantId).identities.values()) {
      const matchTax = identity.taxId !== null && cand.taxId === identity.taxId;
      const matchDomain = identity.domain !== null && cand.domain === identity.domain;
      const matchName = cand.name === identity.name;
      if (matchTax || matchDomain || matchName) {
        result.push(structuredClone(cand));
      }
    }
    return result.sort((a, b) => a.companyId.localeCompare(b.companyId));
  }

  async getLatestCompleteSnapshot(
    context: StorageContext,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot | null> {
    options?.signal?.throwIfAborted();
    const storage = this.tenant(context.tenantId);
    const profileMap = storage.profiles.get(companyId);
    const reportMap = storage.reports.get(companyId);
    if (!profileMap || !reportMap) return null;

    const completeVersions = Array.from(profileMap.keys())
      .filter((v) => reportMap.has(v))
      .sort((a, b) => b - a);

    if (completeVersions.length === 0) return null;
    const latestVersion = completeVersions[0];
    const profile = structuredClone(profileMap.get(latestVersion)!);
    const report = structuredClone(reportMap.get(latestVersion)!);
    const companyDiffs = storage.diffs.get(companyId) ?? [];
    const diff = companyDiffs.find((d) => d.toVersion === latestVersion) ?? null;
    const lastSyncedAt =
      storage.timestamps.get(companyId)?.get(latestVersion) ??
      profile.lastUpdated.toISOString();

    return {
      profile,
      report,
      diff: diff ? structuredClone(diff) : null,
      lastSyncedAt,
    };
  }

  async resolveOrCreateIdentity(
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    candidateId: string,
    options?: StorageWriteOptions,
  ): Promise<string> {
    options?.signal?.throwIfAborted();
    const { identities } = this.tenant(context.tenantId);
    if (identity.taxId) {
      let taxOwnerId: string | null = null;
      for (const cand of identities.values()) {
        if (cand.taxId === identity.taxId) {
          taxOwnerId = cand.companyId;
          break;
        }
      }

      if (taxOwnerId && identity.domain) {
        const domainMatches = Array.from(identities.values()).filter(
          (c) => c.domain === identity.domain
        );
        if (
          domainMatches.length > 0 &&
          !domainMatches.some((c) => c.companyId === taxOwnerId)
        ) {
          throw new IdentityConflictError();
        }
      }

      if (taxOwnerId) {
        return taxOwnerId;
      }

      identities.set(candidateId, {
        companyId: candidateId,
        taxId: identity.taxId,
        domain: identity.domain,
        name: identity.name,
      });
      return candidateId;
    }

    if (identity.domain) {
      for (const cand of identities.values()) {
        if (cand.domain === identity.domain && cand.name === identity.name) {
          return cand.companyId;
        }
      }

      identities.set(candidateId, {
        companyId: candidateId,
        taxId: null,
        domain: identity.domain,
        name: identity.name,
      });
      return candidateId;
    }

    identities.set(candidateId, {
      companyId: candidateId,
      taxId: null,
      domain: null,
      name: identity.name,
    });
    return candidateId;
  }

  async persistResearchSnapshot(
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    snapshot: ResearchSnapshotDraft,
    options?: StorageWriteOptions,
  ): Promise<ResearchSnapshot>;
  async persistResearchSnapshot(
    identity: NormalizedCompanyIdentity,
    snapshot: ResearchSnapshotDraft,
    options?: StorageWriteOptions,
  ): Promise<ResearchSnapshot>;
  async persistResearchSnapshot(
    contextOrIdentity: StorageContext | NormalizedCompanyIdentity,
    identityOrSnapshot: NormalizedCompanyIdentity | ResearchSnapshotDraft,
    snapshotOrOptions?: ResearchSnapshotDraft | StorageWriteOptions,
    maybeOptions?: StorageWriteOptions,
  ): Promise<ResearchSnapshot> {
    const contextCall = "tenantId" in contextOrIdentity && "userId" in contextOrIdentity;
    const tenantId = contextCall ? contextOrIdentity.tenantId : LEGACY_TENANT_ID;
    const identity = contextCall ? identityOrSnapshot as NormalizedCompanyIdentity : contextOrIdentity;
    const snapshot = (contextCall ? snapshotOrOptions : identityOrSnapshot) as ResearchSnapshotDraft;
    const options = contextCall ? maybeOptions : snapshotOrOptions as StorageWriteOptions | undefined;

    options?.signal?.throwIfAborted();
    const storage = this.tenant(tenantId);
    const companyId = snapshot.profile.id;

    if (identity.taxId) {
      for (const cand of storage.identities.values()) {
        if (cand.taxId === identity.taxId && cand.companyId !== companyId) {
          throw new IdentityConflictError();
        }
      }
    }

    const existingIdentity = storage.identities.get(companyId);
    storage.identities.set(companyId, {
      companyId,
      taxId: identity.taxId ?? existingIdentity?.taxId ?? null,
      domain: identity.domain ?? existingIdentity?.domain ?? null,
      name: identity.name || existingIdentity?.name || "",
    });

    const nowIso = new Date().toISOString();
    const version = snapshot.profile.version;

    if (!storage.profiles.has(companyId)) {
      storage.profiles.set(companyId, new Map());
    }
    const profileToSave = {
      ...snapshot.profile,
      lastUpdated: new Date(nowIso),
    };
    storage.profiles.get(companyId)!.set(version, structuredClone(profileToSave));

    if (!storage.reports.has(companyId)) {
      storage.reports.set(companyId, new Map());
    }
    storage.reports.get(companyId)!.set(version, structuredClone(snapshot.report));

    if (!storage.timestamps.has(companyId)) {
      storage.timestamps.set(companyId, new Map());
    }
    storage.timestamps.get(companyId)!.set(version, nowIso);

    if (snapshot.diff) {
      if (!storage.diffs.has(companyId)) {
        storage.diffs.set(companyId, []);
      }
      const existingDiffIndex = storage.diffs
        .get(companyId)!
        .findIndex((d) => d.toVersion === version);
      if (existingDiffIndex >= 0) {
        storage.diffs.get(companyId)![existingDiffIndex] = structuredClone(snapshot.diff);
      } else {
        storage.diffs.get(companyId)!.push(structuredClone(snapshot.diff));
      }
    }

    return {
      profile: structuredClone(profileToSave),
      report: structuredClone(snapshot.report),
      diff: snapshot.diff ? structuredClone(snapshot.diff) : null,
      lastSyncedAt: nowIso,
    };
  }

  clear(): void {
    this.tenants.clear();
  }

  getProfileCount(tenantId?: string): number {
    let count = 0;
    const tenants = tenantId
      ? [this.tenant(tenantId)]
      : Array.from(this.tenants.values());
    for (const storage of tenants) {
      for (const versions of storage.profiles.values()) {
        count += versions.size;
      }
    }
    return count;
  }
}
