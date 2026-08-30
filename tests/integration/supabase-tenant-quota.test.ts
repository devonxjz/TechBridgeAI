import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const testUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const isLiveDb = Boolean(testUrl && serviceKey);

type QuotaResult = {
  allowed: boolean;
  reservation_id: string | null;
  remaining: number;
  reset_at: string;
  duplicate: boolean;
};

const rpcRow = <T>(data: T | T[] | null): T => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("RPC returned no row");
  return row;
};

describe.skipIf(!isLiveDb)("Supabase tenant isolation and quota", () => {
  let client: SupabaseClient;
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const userAEmail = `tenant-a-${crypto.randomUUID()}@example.test`;
  const userBEmail = `tenant-b-${crypto.randomUUID()}@example.test`;
  let userA = "";
  let userB = "";
  let multiTenantUser = "";

  beforeAll(async () => {
    client = createClient(testUrl!, serviceKey!, { auth: { persistSession: false } });

    const [createdA, createdB, createdMulti] = await Promise.all([
      client.auth.admin.createUser({ email: userAEmail, email_confirm: true }),
      client.auth.admin.createUser({ email: userBEmail, email_confirm: true }),
      client.auth.admin.createUser({
        email: `tenant-multi-${crypto.randomUUID()}@example.test`,
        email_confirm: true,
      }),
    ]);
    expect(createdA.error).toBeNull();
    expect(createdB.error).toBeNull();
    expect(createdMulti.error).toBeNull();
    userA = createdA.data.user!.id;
    userB = createdB.data.user!.id;
    multiTenantUser = createdMulti.data.user!.id;

    const { error: tenantError } = await client.from("tenants").insert([
      { id: tenantA, name: "integration tenant a", research_quota_limit: 3 },
      { id: tenantB, name: "integration tenant b", research_quota_limit: 3 },
    ]);
    expect(tenantError).toBeNull();

    const { error: membershipError } = await client.from("tenant_memberships").insert([
      { tenant_id: tenantA, user_id: userA },
      { tenant_id: tenantB, user_id: userB },
      { tenant_id: tenantA, user_id: multiTenantUser },
      { tenant_id: tenantB, user_id: multiTenantUser },
    ]);
    expect(membershipError).toBeNull();
  });

  afterAll(async () => {
    if (!client) return;
    await client.from("tenants").delete().in("id", [tenantA, tenantB]);
    if (userA) await client.auth.admin.deleteUser(userA);
    if (userB) await client.auth.admin.deleteUser(userB);
    if (multiTenantUser) await client.auth.admin.deleteUser(multiTenantUser);
  });

  it("resolves one membership, validates hints, and requires selection for many", async () => {
    const inferred = await client.rpc("resolve_research_tenant", {
      p_user_id: userA,
      p_tenant_hint: null,
    });
    expect(inferred.error).toBeNull();
    expect(rpcRow<{ tenant_id: string }>(inferred.data).tenant_id).toBe(tenantA);

    const hinted = await client.rpc("resolve_research_tenant", {
      p_user_id: multiTenantUser,
      p_tenant_hint: tenantB,
    });
    expect(hinted.error).toBeNull();
    expect(rpcRow<{ tenant_id: string }>(hinted.data).tenant_id).toBe(tenantB);

    const ambiguous = await client.rpc("resolve_research_tenant", {
      p_user_id: multiTenantUser,
      p_tenant_hint: null,
    });
    expect(ambiguous.error?.message).toContain("tenant_selection_required");

    const denied = await client.rpc("resolve_research_tenant", {
      p_user_id: userA,
      p_tenant_hint: tenantB,
    });
    expect(denied.error?.message).toContain("tenant_access_denied");
  });

  it("keeps identical cache identities isolated by tenant", async () => {
    const taxId = `tax-${crypto.randomUUID()}`;
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();

    const [resolvedA, resolvedB] = await Promise.all([
      client.rpc("resolve_company_identity_v2", {
        p_tenant_id: tenantA,
        p_tax_id: taxId,
        p_domain: "shared.example",
        p_name: "shared company",
        p_candidate_id: companyA,
      }),
      client.rpc("resolve_company_identity_v2", {
        p_tenant_id: tenantB,
        p_tax_id: taxId,
        p_domain: "shared.example",
        p_name: "shared company",
        p_candidate_id: companyB,
      }),
    ]);
    expect(resolvedA.error).toBeNull();
    expect(resolvedB.error).toBeNull();
    expect(resolvedA.data).toBe(companyA);
    expect(resolvedB.data).toBe(companyB);

    const lookupA = await client.rpc("lookup_company_identities_v2", {
      p_tenant_id: tenantA,
      p_tax_id: taxId,
      p_domain: null,
      p_name: null,
    });
    expect(lookupA.error).toBeNull();
    expect(lookupA.data).toHaveLength(1);
    expect(lookupA.data?.[0]?.id).toBe(companyA);

    const tenantBLookup = await client.rpc("lookup_company_identities_v2", {
      p_tenant_id: tenantB,
      p_tax_id: taxId,
      p_domain: null,
      p_name: null,
    });
    expect(tenantBLookup.error).toBeNull();
    expect(tenantBLookup.data?.[0]?.id).toBe(companyB);
  });

  it("does not let one tenant read or persist another tenant's snapshot", async () => {
    const companyId = crypto.randomUUID();
    const [identityA, identityB] = await Promise.all([
      client.rpc("resolve_company_identity_v2", {
        p_tenant_id: tenantA,
        p_tax_id: null,
        p_domain: `${companyId}.example`,
        p_name: "tenant a only",
        p_candidate_id: companyId,
      }),
      client.rpc("resolve_company_identity_v2", {
        p_tenant_id: tenantB,
        p_tax_id: null,
        p_domain: `${companyId}.example`,
        p_name: "tenant b only",
        p_candidate_id: companyId,
      }),
    ]);
    expect(identityA.error).toBeNull();
    expect(identityB.error).toBeNull();

    const persisted = await client.rpc("persist_research_snapshot_v2", {
      p_tenant_id: tenantA,
      p_company_id: companyId,
      p_tax_id: null,
      p_domain: `${companyId}.example`,
      p_name: "tenant a only",
      p_version: 1,
      p_expected_version: 0,
      p_profile_data: { id: companyId, version: 1, officialName: "tenant a only" },
      p_analysis_report: { companyId },
      p_diff_data: null,
    });
    expect(persisted.error).toBeNull();

    const ownSnapshot = await client.rpc("get_latest_research_snapshot_v2", {
      p_tenant_id: tenantA,
      p_company_id: companyId,
    });
    expect(ownSnapshot.error).toBeNull();
    expect(ownSnapshot.data).toHaveLength(1);

    const crossTenantRead = await client.rpc("get_latest_research_snapshot_v2", {
      p_tenant_id: tenantB,
      p_company_id: companyId,
    });
    expect(crossTenantRead.error).toBeNull();
    expect(crossTenantRead.data).toHaveLength(0);

    const tenantBSnapshot = await client.rpc("get_latest_research_snapshot_v2", {
      p_tenant_id: tenantB,
      p_company_id: companyId,
    });
    expect(tenantBSnapshot.error).toBeNull();
    expect(tenantBSnapshot.data).toHaveLength(0);
  });

  it("charges concurrent duplicate UUID reservations exactly once", async () => {
    const key = crypto.randomUUID();
    const reserve = () => client.rpc("reserve_research_quota", {
      p_tenant_id: tenantA,
      p_user_id: userA,
      p_operation: "research",
      p_idempotency_key: key,
      p_cost: 2,
    });

    const [first, second] = await Promise.all([reserve(), reserve()]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const firstRow = rpcRow<QuotaResult>(first.data);
    const secondRow = rpcRow<QuotaResult>(second.data);
    expect(firstRow.allowed).toBe(true);
    expect(secondRow.allowed).toBe(true);
    expect(firstRow.reservation_id).toBe(secondRow.reservation_id);
    expect(firstRow.remaining).toBe(1);
    expect(secondRow.remaining).toBe(1);
    expect([firstRow.duplicate, secondRow.duplicate].sort()).toEqual([false, true]);

    const { data: reservations, error } = await client
      .from("research_quota_reservations")
      .select("id,cost")
      .eq("tenant_id", tenantA)
      .eq("idempotency_key", key);
    expect(error).toBeNull();
    expect(reservations).toHaveLength(1);
    expect(reservations?.[0]?.cost).toBe(2);
  });

  it("fails closed on membership/idempotency errors and denies exhausted quota", async () => {
    const forged = await client.rpc("reserve_research_quota", {
      p_tenant_id: tenantB,
      p_user_id: userA,
      p_operation: "research",
      p_idempotency_key: crypto.randomUUID(),
      p_cost: 1,
    });
    expect(forged.error?.message).toContain("tenant_membership_required");

    const existingKey = crypto.randomUUID();
    const initial = await client.rpc("reserve_research_quota", {
      p_tenant_id: tenantB,
      p_user_id: userB,
      p_operation: "research",
      p_idempotency_key: existingKey,
      p_cost: 1,
    });
    expect(initial.error).toBeNull();

    const conflict = await client.rpc("reserve_research_quota", {
      p_tenant_id: tenantB,
      p_user_id: userB,
      p_operation: "research",
      p_idempotency_key: existingKey,
      p_cost: 2,
    });
    expect(conflict.error?.message).toContain("idempotency_key_conflict");

    const deniedKey = crypto.randomUUID();
    const exhausted = await client.rpc("reserve_research_quota", {
      p_tenant_id: tenantA,
      p_user_id: userA,
      p_operation: "research",
      p_idempotency_key: deniedKey,
      p_cost: 2,
    });
    expect(exhausted.error).toBeNull();
    const denied = rpcRow<QuotaResult>(exhausted.data);
    expect(denied).toMatchObject({
      allowed: false,
      reservation_id: expect.any(String),
      remaining: 1,
      duplicate: false,
    });

    const deniedReplay = await client.rpc("reserve_research_quota", {
      p_tenant_id: tenantA,
      p_user_id: userA,
      p_operation: "research",
      p_idempotency_key: deniedKey,
      p_cost: 2,
    });
    expect(deniedReplay.error).toBeNull();
    expect(rpcRow<QuotaResult>(deniedReplay.data)).toMatchObject({
      allowed: false,
      reservation_id: denied.reservation_id,
      remaining: denied.remaining,
      duplicate: true,
    });
  });

  it("does not expose tenant or quota tables/RPCs to anon", async () => {
    if (!anonKey) return;
    const anon = createClient(testUrl!, anonKey, { auth: { persistSession: false } });

    const tableRead = await anon.from("tenant_memberships").select("tenant_id");
    expect(tableRead.error).not.toBeNull();

    const quotaCall = await anon.rpc("reserve_research_quota", {
      p_tenant_id: tenantA,
      p_user_id: userA,
      p_operation: "research",
      p_idempotency_key: crypto.randomUUID(),
      p_cost: 1,
    });
    expect(quotaCall.error).not.toBeNull();
  });
});
