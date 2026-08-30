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

export interface StorageContext {
  tenantId: string;
  userId: string;
}

export interface StorageAdapter {
  saveProfile(
    context: StorageContext,
    profile: CompanyProfile,
    options?: StorageWriteOptions,
  ): Promise<void>;
  getProfile(
    context: StorageContext,
    companyId: string,
    version?: number
  ): Promise<CompanyProfile | null>;
  getLatestProfile(
    context: StorageContext,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<CompanyProfile | null>;
  listProfiles(context: StorageContext): Promise<CompanyProfile[]>;
  saveDiff(
    context: StorageContext,
    diff: ProfileDiff,
    options?: StorageWriteOptions,
  ): Promise<void>;
  getDiffs(context: StorageContext, companyId: string): Promise<ProfileDiff[]>;

  // Cache and complete snapshot methods
  findIdentityCandidates(
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    options?: StorageReadOptions,
  ): Promise<IdentityCandidate[]>;

  getLatestCompleteSnapshot(
    context: StorageContext,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot | null>;

  resolveOrCreateIdentity(
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    candidateId: string,
    options?: StorageWriteOptions,
  ): Promise<string>;

  persistResearchSnapshot(
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    snapshot: Omit<ResearchSnapshot, "lastSyncedAt">,
    options?: StorageWriteOptions,
  ): Promise<ResearchSnapshot>;
}

