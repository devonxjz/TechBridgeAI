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
  StorageReadOptions,
  StorageWriteOptions,
} from "./types";

export class MemoryStorageAdapter implements StorageAdapter {
  private identities: Map<string, IdentityCandidate> = new Map();
  private profiles: Map<string, Map<number, CompanyProfile>> = new Map();
  private reports: Map<string, Map<number, ResearchSnapshot["report"]>> = new Map();
  private timestamps: Map<string, Map<number, string>> = new Map();
  private diffs: Map<string, ProfileDiff[]> = new Map();

  async saveProfile(
    profile: CompanyProfile,
    options?: StorageWriteOptions,
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    if (!this.profiles.has(profile.id)) {
      this.profiles.set(profile.id, new Map());
    }
    this.profiles.get(profile.id)!.set(profile.version, structuredClone(profile));
  }

  async getProfile(
    companyId: string,
    version?: number
  ): Promise<CompanyProfile | null> {
    const versions = this.profiles.get(companyId);
    if (!versions) return null;

    if (version !== undefined) {
      const p = versions.get(version);
      return p ? structuredClone(p) : null;
    }

    return this.getLatestProfile(companyId);
  }

  async getLatestProfile(
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<CompanyProfile | null> {
    options?.signal?.throwIfAborted();
    const versions = this.profiles.get(companyId);
    if (!versions || versions.size === 0) return null;

    const maxVersion = Math.max(...versions.keys());
    const p = versions.get(maxVersion);
    return p ? structuredClone(p) : null;
  }

  async listProfiles(): Promise<CompanyProfile[]> {
    const result: CompanyProfile[] = [];
    for (const versions of this.profiles.values()) {
      const maxVersion = Math.max(...versions.keys());
      const latest = versions.get(maxVersion);
      if (latest) result.push(structuredClone(latest));
    }
    return result;
  }

  async saveDiff(
    diff: ProfileDiff,
    options?: StorageWriteOptions,
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    if (!this.diffs.has(diff.companyId)) {
      this.diffs.set(diff.companyId, []);
    }
    this.diffs.get(diff.companyId)!.push(structuredClone(diff));
  }

  async getDiffs(companyId: string): Promise<ProfileDiff[]> {
    const d = this.diffs.get(companyId) ?? [];
    return structuredClone(d);
  }

  async findIdentityCandidates(
    identity: NormalizedCompanyIdentity,
    options?: StorageReadOptions,
  ): Promise<IdentityCandidate[]> {
    options?.signal?.throwIfAborted();
    const result: IdentityCandidate[] = [];
    for (const cand of this.identities.values()) {
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
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot | null> {
    options?.signal?.throwIfAborted();
    const profileMap = this.profiles.get(companyId);
    const reportMap = this.reports.get(companyId);
    if (!profileMap || !reportMap) return null;

    const completeVersions = Array.from(profileMap.keys())
      .filter((v) => reportMap.has(v))
      .sort((a, b) => b - a);

    if (completeVersions.length === 0) return null;
    const latestVersion = completeVersions[0];
    const profile = structuredClone(profileMap.get(latestVersion)!);
    const report = structuredClone(reportMap.get(latestVersion)!);
    const companyDiffs = this.diffs.get(companyId) ?? [];
    const diff = companyDiffs.find((d) => d.toVersion === latestVersion) ?? null;
    const lastSyncedAt =
      this.timestamps.get(companyId)?.get(latestVersion) ??
      profile.lastUpdated.toISOString();

    return {
      profile,
      report,
      diff: diff ? structuredClone(diff) : null,
      lastSyncedAt,
    };
  }

  async resolveOrCreateIdentity(
    identity: NormalizedCompanyIdentity,
    candidateId: string,
    options?: StorageWriteOptions,
  ): Promise<string> {
    options?.signal?.throwIfAborted();
    // 1. If taxId provided
    if (identity.taxId) {
      let taxOwnerId: string | null = null;
      for (const cand of this.identities.values()) {
        if (cand.taxId === identity.taxId) {
          taxOwnerId = cand.companyId;
          break;
        }
      }

      if (taxOwnerId && identity.domain) {
        const domainMatches = Array.from(this.identities.values()).filter(
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

      this.identities.set(candidateId, {
        companyId: candidateId,
        taxId: identity.taxId,
        domain: identity.domain,
        name: identity.name,
      });
      return candidateId;
    }

    // 2. If domain provided
    if (identity.domain) {
      for (const cand of this.identities.values()) {
        if (cand.domain === identity.domain && cand.name === identity.name) {
          return cand.companyId;
        }
      }

      this.identities.set(candidateId, {
        companyId: candidateId,
        taxId: null,
        domain: identity.domain,
        name: identity.name,
      });
      return candidateId;
    }

    // 3. Name only
    this.identities.set(candidateId, {
      companyId: candidateId,
      taxId: null,
      domain: null,
      name: identity.name,
    });
    return candidateId;
  }

  async persistResearchSnapshot(
    identity: NormalizedCompanyIdentity,
    snapshot: Omit<ResearchSnapshot, "lastSyncedAt">,
    options?: StorageWriteOptions,
  ): Promise<ResearchSnapshot> {
    options?.signal?.throwIfAborted();
    const companyId = snapshot.profile.id;

    // Check conflict
    if (identity.taxId) {
      for (const cand of this.identities.values()) {
        if (cand.taxId === identity.taxId && cand.companyId !== companyId) {
          throw new IdentityConflictError();
        }
      }
    }

    // Update / insert identity
    const existingIdentity = this.identities.get(companyId);
    this.identities.set(companyId, {
      companyId,
      taxId: identity.taxId ?? existingIdentity?.taxId ?? null,
      domain: identity.domain ?? existingIdentity?.domain ?? null,
      name: identity.name || existingIdentity?.name || "",
    });

    const nowIso = new Date().toISOString();
    const version = snapshot.profile.version;

    // Save profile
    if (!this.profiles.has(companyId)) {
      this.profiles.set(companyId, new Map());
    }
    const profileToSave = {
      ...snapshot.profile,
      lastUpdated: new Date(nowIso),
    };
    this.profiles.get(companyId)!.set(version, structuredClone(profileToSave));

    // Save report
    if (!this.reports.has(companyId)) {
      this.reports.set(companyId, new Map());
    }
    this.reports.get(companyId)!.set(version, structuredClone(snapshot.report));

    // Save timestamp
    if (!this.timestamps.has(companyId)) {
      this.timestamps.set(companyId, new Map());
    }
    this.timestamps.get(companyId)!.set(version, nowIso);

    // Save diff
    if (snapshot.diff) {
      if (!this.diffs.has(companyId)) {
        this.diffs.set(companyId, []);
      }
      const existingDiffIndex = this.diffs
        .get(companyId)!
        .findIndex((d) => d.toVersion === version);
      if (existingDiffIndex >= 0) {
        this.diffs.get(companyId)![existingDiffIndex] = structuredClone(snapshot.diff);
      } else {
        this.diffs.get(companyId)!.push(structuredClone(snapshot.diff));
      }
    }

    return {
      profile: structuredClone(profileToSave),
      report: structuredClone(snapshot.report),
      diff: snapshot.diff ? structuredClone(snapshot.diff) : null,
      lastSyncedAt: nowIso,
    };
  }

  // Test helpers
  clear(): void {
    this.identities.clear();
    this.profiles.clear();
    this.reports.clear();
    this.timestamps.clear();
    this.diffs.clear();
  }

  getProfileCount(): number {
    let count = 0;
    for (const versions of this.profiles.values()) {
      count += versions.size;
    }
    return count;
  }
}
