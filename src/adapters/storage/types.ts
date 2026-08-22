// ═══════════════════════════════════════════════════════
// Storage Adapter — Interface
// ═══════════════════════════════════════════════════════

import type { CompanyProfile, ProfileDiff } from "@/lib/types";

export interface StorageAdapter {
  saveProfile(profile: CompanyProfile): Promise<void>;
  getProfile(
    companyId: string,
    version?: number
  ): Promise<CompanyProfile | null>;
  getLatestProfile(companyId: string): Promise<CompanyProfile | null>;
  listProfiles(): Promise<CompanyProfile[]>;
  saveDiff(diff: ProfileDiff): Promise<void>;
  getDiffs(companyId: string): Promise<ProfileDiff[]>;
}
