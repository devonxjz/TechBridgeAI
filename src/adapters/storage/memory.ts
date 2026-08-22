// ═══════════════════════════════════════════════════════
// In-Memory Storage Adapter — for development & testing
// ═══════════════════════════════════════════════════════

import type { CompanyProfile, ProfileDiff } from "@/lib/types";
import type { StorageAdapter } from "./types";

export class MemoryStorageAdapter implements StorageAdapter {
  // companyId → version → profile
  private profiles: Map<string, Map<number, CompanyProfile>> = new Map();
  // companyId → diffs
  private diffs: Map<string, ProfileDiff[]> = new Map();

  async saveProfile(profile: CompanyProfile): Promise<void> {
    if (!this.profiles.has(profile.id)) {
      this.profiles.set(profile.id, new Map());
    }
    this.profiles.get(profile.id)!.set(profile.version, profile);
  }

  async getProfile(
    companyId: string,
    version?: number
  ): Promise<CompanyProfile | null> {
    const versions = this.profiles.get(companyId);
    if (!versions) return null;

    if (version !== undefined) {
      return versions.get(version) ?? null;
    }

    // Return latest
    return this.getLatestProfile(companyId);
  }

  async getLatestProfile(companyId: string): Promise<CompanyProfile | null> {
    const versions = this.profiles.get(companyId);
    if (!versions || versions.size === 0) return null;

    const maxVersion = Math.max(...versions.keys());
    return versions.get(maxVersion) ?? null;
  }

  async listProfiles(): Promise<CompanyProfile[]> {
    const result: CompanyProfile[] = [];
    for (const versions of this.profiles.values()) {
      const maxVersion = Math.max(...versions.keys());
      const latest = versions.get(maxVersion);
      if (latest) result.push(latest);
    }
    return result;
  }

  async saveDiff(diff: ProfileDiff): Promise<void> {
    if (!this.diffs.has(diff.companyId)) {
      this.diffs.set(diff.companyId, []);
    }
    this.diffs.get(diff.companyId)!.push(diff);
  }

  async getDiffs(companyId: string): Promise<ProfileDiff[]> {
    return this.diffs.get(companyId) ?? [];
  }

  // Test helpers
  clear(): void {
    this.profiles.clear();
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
