// ═══════════════════════════════════════════════════════
// Storage Adapter — Interface
// ═══════════════════════════════════════════════════════

import type { CompanyProfile, ProfileDiff } from "@/lib/types";

export interface StorageWriteOptions {
  signal?: AbortSignal;
}

export interface StorageReadOptions {
  signal?: AbortSignal;
}

export interface StorageAdapter {
  saveProfile(
    profile: CompanyProfile,
    options?: StorageWriteOptions,
  ): Promise<void>;
  getProfile(
    companyId: string,
    version?: number
  ): Promise<CompanyProfile | null>;
  getLatestProfile(
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<CompanyProfile | null>;
  listProfiles(): Promise<CompanyProfile[]>;
  saveDiff(diff: ProfileDiff, options?: StorageWriteOptions): Promise<void>;
  getDiffs(companyId: string): Promise<ProfileDiff[]>;
}
