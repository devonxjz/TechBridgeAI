// ═══════════════════════════════════════════════════════
// Supabase PostgreSQL Storage Adapter
// Implements JSONB multi-version storage for CompanyProfile, ProfileDiff, and ResearchSnapshot
// ═══════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type CompanyProfile,
  type ProfileDiff,
  type ResearchSnapshot,
  ResearchSnapshotSchema,
} from "@/lib/types";
import {
  type IdentityCandidate,
  type NormalizedCompanyIdentity,
  IdentityConflictError,
  CacheInvalidError,
} from "@/modules/cache";
import type {
  StorageAdapter,
  StorageReadOptions,
  StorageWriteOptions,
} from "./types";

export class SupabaseStorageAdapter implements StorageAdapter {
  private client: SupabaseClient;

  constructor(supabaseUrl?: string, supabaseKey?: string) {
    const url = supabaseUrl || process.env.SUPABASE_URL;
    const key =
      supabaseKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error(
        "Missing Supabase credentials: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY"
      );
    }

    this.client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async saveProfile(
    profile: CompanyProfile,
    options?: StorageWriteOptions,
  ): Promise<void> {
    const query = this.client
      .from("company_profiles")
      .upsert(
        {
          id: profile.id,
          version: profile.version,
          official_name: profile.officialName,
          data: profile,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id,version" },
      );
    if (options?.signal) query.abortSignal(options.signal);
    const { error } = await query;

    if (error) {
      throw new Error(`Failed to save profile to Supabase: ${error.message}`);
    }
  }

  async getProfile(
    companyId: string,
    version?: number
  ): Promise<CompanyProfile | null> {
    if (version !== undefined) {
      const { data, error } = await this.client
        .from("company_profiles")
        .select("data")
        .eq("id", companyId)
        .eq("version", version)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to get profile from Supabase: ${error.message}`);
      }

      return data ? (data.data as CompanyProfile) : null;
    }

    return this.getLatestProfile(companyId);
  }

  async getLatestProfile(
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<CompanyProfile | null> {
    const query = this.client
      .from("company_profiles")
      .select("data")
      .eq("id", companyId)
      .order("version", { ascending: false })
      .limit(1);
    if (options?.signal) query.abortSignal(options.signal);
    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(`Failed to get latest profile from Supabase: ${error.message}`);
    }

    return data ? (data.data as CompanyProfile) : null;
  }

  async listProfiles(): Promise<CompanyProfile[]> {
    const { data, error } = await this.client
      .from("company_profiles")
      .select("data")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Failed to list profiles from Supabase: ${error.message}`);
    }

    if (!data) return [];

    const seen = new Set<string>();
    const profiles: CompanyProfile[] = [];

    for (const row of data) {
      const profile = row.data as CompanyProfile;
      if (!seen.has(profile.id)) {
        seen.add(profile.id);
        profiles.push(profile);
      }
    }

    return profiles;
  }

  async saveDiff(
    diff: ProfileDiff,
    options?: StorageWriteOptions,
  ): Promise<void> {
    const diffId = `${diff.companyId}_${diff.fromVersion}_${diff.toVersion}`;
    const query = this.client
      .from("company_diffs")
      .upsert(
        {
          id: diffId,
          company_id: diff.companyId,
          from_version: diff.fromVersion,
          to_version: diff.toVersion,
          data: diff,
          created_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    if (options?.signal) query.abortSignal(options.signal);
    const { error } = await query;

    if (error) {
      throw new Error(`Failed to save diff to Supabase: ${error.message}`);
    }
  }

  async getDiffs(companyId: string): Promise<ProfileDiff[]> {
    const { data, error } = await this.client
      .from("company_diffs")
      .select("data")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to get diffs from Supabase: ${error.message}`);
    }

    return (data ?? []).map((row) => row.data as ProfileDiff);
  }

  // ─── Cache & Snapshot RPCs ───

  async findIdentityCandidates(
    identity: NormalizedCompanyIdentity,
    options?: StorageReadOptions,
  ): Promise<IdentityCandidate[]> {
    const query = this.client.rpc("lookup_company_identities", {
      p_tax_id: identity.taxId,
      p_domain: identity.domain,
      p_name: identity.name,
    });
    if (options?.signal) query.abortSignal(options.signal);

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to lookup company identities: ${error.message}`);
    }

    if (!Array.isArray(data)) return [];

    return data.map((row: { id: string; tax_id: string | null; normalized_domain: string | null; normalized_name: string }) => ({
      companyId: row.id,
      taxId: row.tax_id,
      domain: row.normalized_domain,
      name: row.normalized_name,
    }));
  }

  async getLatestCompleteSnapshot(
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot | null> {
    const profileQuery = this.client
      .from("company_profiles")
      .select("version, data, analysis_report, updated_at")
      .eq("id", companyId)
      .not("analysis_report", "is", null)
      .order("version", { ascending: false })
      .limit(1);

    if (options?.signal) profileQuery.abortSignal(options.signal);

    const { data: profileRows, error: profileError } = await profileQuery;
    if (profileError) {
      throw new Error(`Failed to get complete profile: ${profileError.message}`);
    }

    if (!profileRows || profileRows.length === 0) return null;

    const row = profileRows[0];
    const version = row.version;

    const diffQuery = this.client
      .from("company_diffs")
      .select("data")
      .eq("company_id", companyId)
      .eq("to_version", version);

    if (options?.signal) diffQuery.abortSignal(options.signal);

    const { data: diffRow, error: diffError } = await diffQuery.maybeSingle();
    if (diffError) {
      throw new Error(`Failed to get snapshot diff: ${diffError.message}`);
    }

    const rawSnapshot = {
      profile: row.data,
      report: row.analysis_report,
      diff: diffRow ? diffRow.data : null,
      lastSyncedAt: typeof row.updated_at === "string" ? row.updated_at : new Date(row.updated_at).toISOString(),
    };

    const parsed = ResearchSnapshotSchema.safeParse(rawSnapshot);
    if (!parsed.success) {
      throw new CacheInvalidError(
        `Cached snapshot for company ${companyId} failed validation: ${parsed.error.message}`
      );
    }

    return parsed.data;
  }

  async resolveOrCreateIdentity(
    identity: NormalizedCompanyIdentity,
    candidateId: string,
    options?: StorageWriteOptions,
  ): Promise<string> {
    const query = this.client.rpc("resolve_company_identity", {
      p_tax_id: identity.taxId,
      p_domain: identity.domain,
      p_name: identity.name,
      p_candidate_id: candidateId,
    });
    if (options?.signal) query.abortSignal(options.signal);

    const { data, error } = await query;
    if (error) {
      if (error.message.includes("identity_conflict")) {
        throw new IdentityConflictError();
      }
      throw new Error(`Failed to resolve company identity: ${error.message}`);
    }

    return data as string;
  }

  async persistResearchSnapshot(
    identity: NormalizedCompanyIdentity,
    snapshot: Omit<ResearchSnapshot, "lastSyncedAt">,
    options?: StorageWriteOptions,
  ): Promise<ResearchSnapshot> {
    const query = this.client.rpc("persist_research_snapshot", {
      p_company_id: snapshot.profile.id,
      p_tax_id: identity.taxId,
      p_domain: identity.domain,
      p_name: identity.name,
      p_version: snapshot.profile.version,
      p_profile_data: snapshot.profile,
      p_analysis_report: snapshot.report,
      p_diff_data: snapshot.diff,
    });
    if (options?.signal) query.abortSignal(options.signal);

    const { data, error } = await query;
    if (error) {
      if (error.message.includes("identity_conflict")) {
        throw new IdentityConflictError();
      }
      throw new Error(`Failed to persist research snapshot: ${error.message}`);
    }

    const lastSyncedAt =
      typeof data === "string" ? data : new Date(data).toISOString();

    return {
      profile: snapshot.profile,
      report: snapshot.report,
      diff: snapshot.diff,
      lastSyncedAt,
    };
  }
}
