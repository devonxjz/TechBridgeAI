// ═══════════════════════════════════════════════════════
// Supabase PostgreSQL Storage Adapter
// Implements JSONB multi-version storage for CompanyProfile & ProfileDiff
// ═══════════════════════════════════════════════════════

// Ensure WebSocket constructor exists in Node.js runtimes < 22 for @supabase/realtime-js
if (typeof globalThis !== "undefined" && typeof globalThis.WebSocket === "undefined") {
  // @ts-expect-error fallback mock for RealtimeClient in REST-only mode
  globalThis.WebSocket = class WebSocket {};
}

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { CompanyProfile, ProfileDiff } from "@/lib/types";
import type { StorageAdapter } from "./types";

export class SupabaseStorageAdapter implements StorageAdapter {
  private client: SupabaseClient;

  constructor(supabaseUrl?: string, supabaseKey?: string) {
    const url = supabaseUrl || process.env.SUPABASE_URL;
    const key = supabaseKey || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error("Missing Supabase credentials: SUPABASE_URL or SUPABASE_ANON_KEY");
    }

    this.client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async saveProfile(profile: CompanyProfile): Promise<void> {
    const { error } = await this.client
      .from("company_profiles")
      .upsert(
        {
          id: profile.id,
          version: profile.version,
          official_name: profile.officialName,
          data: profile,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id,version" }
      );

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

  async getLatestProfile(companyId: string): Promise<CompanyProfile | null> {
    const { data, error } = await this.client
      .from("company_profiles")
      .select("data")
      .eq("id", companyId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get latest profile from Supabase: ${error.message}`);
    }

    return data ? (data.data as CompanyProfile) : null;
  }

  async listProfiles(): Promise<CompanyProfile[]> {
    // Get unique latest version per company
    const { data, error } = await this.client
      .from("company_profiles")
      .select("data")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Failed to list profiles from Supabase: ${error.message}`);
    }

    if (!data) return [];

    // Deduplicate to keep latest version per company id
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

  async saveDiff(diff: ProfileDiff): Promise<void> {
    const diffId = `${diff.companyId}_${diff.fromVersion}_${diff.toVersion}`;
    const { error } = await this.client
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
        { onConflict: "id" }
      );

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
}
