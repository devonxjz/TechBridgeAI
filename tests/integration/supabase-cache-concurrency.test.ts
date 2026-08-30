import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const testUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;

const isLiveDb = Boolean(testUrl && serviceKey);

describe.skipIf(!isLiveDb)("Supabase Research Cache - Integration & Concurrency", () => {
  it("resolves domain-only identity concurrently without duplicate rows", async () => {
    const first = createClient(testUrl!, serviceKey!, { auth: { persistSession: false } });
    const second = createClient(testUrl!, serviceKey!, { auth: { persistSession: false } });

    const domain = `race-${crypto.randomUUID()}.example`;
    const name = `race ${crypto.randomUUID()}`;

    const [a, b] = await Promise.all([
      first.rpc("resolve_company_identity", {
        p_tax_id: null,
        p_domain: domain,
        p_name: name,
        p_candidate_id: crypto.randomUUID(),
      }),
      second.rpc("resolve_company_identity", {
        p_tax_id: null,
        p_domain: domain,
        p_name: name,
        p_candidate_id: crypto.randomUUID(),
      }),
    ]);

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data).toBe(b.data);

    const { data: rows, error } = await first
      .from("company_identities")
      .select("id")
      .eq("normalized_domain", domain);

    expect(error).toBeNull();
    expect(rows?.length).toBe(1);
  });

  it("rolls back persistence when identity conflict occurs post-pipeline", async () => {
    const client = createClient(testUrl!, serviceKey!, { auth: { persistSession: false } });
    const taxId = `0101${Math.floor(100000 + Math.random() * 900000)}`;

    await client.rpc("resolve_company_identity", {
      p_tax_id: taxId,
      p_domain: `comp-a-${taxId}.vn`,
      p_name: "company a",
      p_candidate_id: crypto.randomUUID(),
    });

    const companyBId = crypto.randomUUID();
    await client.rpc("resolve_company_identity", {
      p_tax_id: null,
      p_domain: `comp-b-${taxId}.vn`,
      p_name: "company b",
      p_candidate_id: companyBId,
    });

    // Try to persist companyB with companyA's tax ID -> should fail & rollback
    const { error: persistError } = await client.rpc("persist_research_snapshot", {
      p_company_id: companyBId,
      p_tax_id: taxId,
      p_domain: `comp-b-${taxId}.vn`,
      p_name: "company b",
      p_version: 1,
      p_profile_data: { id: companyBId, version: 1, officialName: "company b" },
      p_analysis_report: { companyId: companyBId, generatedAt: new Date().toISOString() },
      p_diff_data: null,
    });

    expect(persistError).not.toBeNull();

    // Verify profile was not persisted
    const { data: profiles } = await client
      .from("company_profiles")
      .select("id")
      .eq("id", companyBId);

    expect(profiles?.length).toBe(0);
  });

  it("denies access to anon role on company_identities and RPCs", async () => {
    if (!anonKey) return;
    const anonClient = createClient(testUrl!, anonKey, { auth: { persistSession: false } });

    const { error: selectError } = await anonClient.from("company_identities").select("*");
    expect(selectError).not.toBeNull();

    const { error: rpcError } = await anonClient.rpc("lookup_company_identities", {
      p_tax_id: null,
      p_domain: null,
      p_name: "test",
    });
    expect(rpcError).not.toBeNull();
  });
});
