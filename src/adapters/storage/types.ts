import type {
  CompanyProfile,
  ProfileDiff,
  ResearchSnapshot,
} from "@/lib/types";
import type {
  NormalizedCompanyIdentity,
  IdentityCandidate,
} from "@/modules/cache";

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

  // Cache and complete snapshot methods
  findIdentityCandidates(
    identity: NormalizedCompanyIdentity,
    options?: StorageReadOptions,
  ): Promise<IdentityCandidate[]>;

  getLatestCompleteSnapshot(
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot | null>;

  resolveOrCreateIdentity(
    identity: NormalizedCompanyIdentity,
    candidateId: string,
    options?: StorageWriteOptions,
  ): Promise<string>;

  persistResearchSnapshot(
    identity: NormalizedCompanyIdentity,
    snapshot: Omit<ResearchSnapshot, "lastSyncedAt">,
    options?: StorageWriteOptions,
  ): Promise<ResearchSnapshot>;
}

