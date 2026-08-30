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
  StorageContext,
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
    context: StorageContext,
    profile: CompanyProfile,
    options?: StorageWriteOptions,
  ): Promise<void> {
    const query = this.client
      .from("company_profiles")
      .upsert(
        {
          tenant_id: context.tenantId,
          id: profile.id,
          version: profile.version,
          official_name: profile.officialName,
          data: profile,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,id,version" },
      );
    if (options?.signal) query.abortSignal(options.signal);
    const { error } = await query;

    if (error) {
      throw new Error(`Failed to save profile to Supabase: ${error.message}`);
    }
  }

  async getProfile(
    context: StorageContext,
    companyId: string,
    version?: number
  ): Promise<CompanyProfile | null> {
    if (version !== undefined) {
      const { data, error } = await this.client
        .from("company_profiles")
        .select("data")
        .eq("tenant_id", context.tenantId)
        .eq("id", companyId)
        .eq("version", version)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to get profile from Supabase: ${error.message}`);
      }

      return data ? (data.data as CompanyProfile) : null;
    }

    return this.getLatestProfile(context, companyId);
  }

  async getLatestProfile(
    context: StorageContext,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<CompanyProfile | null> {
    const query = this.client
      .from("company_profiles")
      .select("data")
      .eq("tenant_id", context.tenantId)
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

  async listProfiles(context: StorageContext): Promise<CompanyProfile[]> {
    const { data, error } = await this.client
      .from("company_profiles")
      .select("data")
      .eq("tenant_id", context.tenantId)
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
    context: StorageContext,
    diff: ProfileDiff,
    options?: StorageWriteOptions,
  ): Promise<void> {
    const diffId = `${diff.companyId}_${diff.fromVersion}_${diff.toVersion}`;
    const query = this.client
      .from("company_diffs")
      .upsert(
        {
          tenant_id: context.tenantId,
          id: diffId,
          company_id: diff.companyId,
          from_version: diff.fromVersion,
          to_version: diff.toVersion,
          data: diff,
          created_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,id" },
      );
    if (options?.signal) query.abortSignal(options.signal);
    const { error } = await query;

    if (error) {
      throw new Error(`Failed to save diff to Supabase: ${error.message}`);
    }
  }

  async getDiffs(context: StorageContext, companyId: string): Promise<ProfileDiff[]> {
    const { data, error } = await this.client
      .from("company_diffs")
      .select("data")
      .eq("tenant_id", context.tenantId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to get diffs from Supabase: ${error.message}`);
    }

    return (data ?? []).map((row) => row.data as ProfileDiff);
  }

  // ─── Cache & Snapshot RPCs ───

  async findIdentityCandidates(
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    options?: StorageReadOptions,
  ): Promise<IdentityCandidate[]> {
    const query = this.client.rpc("lookup_company_identities_v2", {
      p_tenant_id: context.tenantId,
      p_tax_id: identity.taxId,
      p_domain: identity.domain,
      p_name: identity.name,
    });
    if (options?.signal) query.abortSignal(options.signal);

    const { data, error } = await query;
    if (error) {
      if (
        error.code === "PGRST202" ||
        error.code === "PGRST205" ||
        error.message.includes("schema cache") ||
        error.message.includes("Could not find the function") ||
        error.message.includes("Could not find the table")
      ) {
        console.warn(
          "Supabase stored procedures not found in database. Operating in live research mode without cache."
        );
        return [];
      }
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
    context: StorageContext,
    companyId: string,
    options?: StorageReadOptions,
  ): Promise<ResearchSnapshot | null> {
    const query = this.client.rpc("get_latest_research_snapshot_v2", {
      p_tenant_id: context.tenantId,
      p_company_id: companyId,
    });
    if (options?.signal) query.abortSignal(options.signal);

    const { data, error } = await query;
    if (error) {
      if (
        error.code === "PGRST202" ||
        error.code === "PGRST205" ||
        error.message.includes("schema cache") ||
        error.message.includes("Could not find the function")
      ) {
        return null;
      }
      throw new Error(`Failed to get complete profile: ${error.message}`);
    }

    if (!Array.isArray(data) || data.length === 0) return null;

    const row = data[0] as {
      profile_data: unknown;
      analysis_report: unknown;
      diff_data: unknown;
      updated_at: string | Date;
    };
    const rawSnapshot = {
      profile: row.profile_data,
      report: row.analysis_report,
      diff: row.diff_data,
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
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    candidateId: string,
    options?: StorageWriteOptions,
  ): Promise<string> {
    const query = this.client.rpc("resolve_company_identity_v2", {
      p_tenant_id: context.tenantId,
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
      if (
        error.code === "PGRST202" ||
        error.code === "PGRST205" ||
        error.message.includes("schema cache") ||
        error.message.includes("Could not find the function")
      ) {
        console.warn(
          "Supabase stored procedure resolve_company_identity_v2 not found. Using candidate ID."
        );
        return candidateId;
      }
      throw new Error(`Failed to resolve company identity: ${error.message}`);
    }

    return data as string;
  }

  async persistResearchSnapshot(
    context: StorageContext,
    identity: NormalizedCompanyIdentity,
    snapshot: Omit<ResearchSnapshot, "lastSyncedAt">,
    options?: StorageWriteOptions,
  ): Promise<ResearchSnapshot> {
    const query = this.client.rpc("persist_research_snapshot_v2", {
      p_tenant_id: context.tenantId,
      p_company_id: snapshot.profile.id,
      p_tax_id: identity.taxId,
      p_domain: identity.domain,
      p_name: identity.name,
      p_version: snapshot.profile.version,
      p_expected_version: Math.max(0, snapshot.profile.version - 1),
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
      if (error.message.includes("version_conflict")) {
        throw new Error("version_conflict");
      }
      if (
        error.code === "PGRST202" ||
        error.code === "PGRST205" ||
        error.message.includes("schema cache") ||
        error.message.includes("Could not find the function")
      ) {
        console.warn(
          "Supabase stored procedure persist_research_snapshot_v2 not found. Skipping persistence."
        );
        return {
          profile: snapshot.profile,
          report: snapshot.report,
          diff: snapshot.diff,
          lastSyncedAt: new Date().toISOString(),
        };
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
