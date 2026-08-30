import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseStorageAdapter } from "@/adapters/storage/supabase";
import type { CompanyProfile } from "@/lib/types";

describe("SupabaseStorageAdapter Unit Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws error when initialized without credentials", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => new SupabaseStorageAdapter()).toThrow(
      "Missing Supabase credentials: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  });

  it("initializes client properly with URL and Service Role Key", () => {
    const adapter = new SupabaseStorageAdapter(
      "https://example.supabase.co",
      "mock-service-role-key"
    );
    expect(adapter).toBeDefined();
    expect(typeof adapter.saveProfile).toBe("function");
    expect(typeof adapter.getProfile).toBe("function");
    expect(typeof adapter.getLatestProfile).toBe("function");
    expect(typeof adapter.listProfiles).toBe("function");
    expect(typeof adapter.saveDiff).toBe("function");
    expect(typeof adapter.getDiffs).toBe("function");
    expect(typeof adapter.findIdentityCandidates).toBe("function");
    expect(typeof adapter.getLatestCompleteSnapshot).toBe("function");
    expect(typeof adapter.resolveOrCreateIdentity).toBe("function");
    expect(typeof adapter.persistResearchSnapshot).toBe("function");
  });

  it("calls lookup_company_identities RPC with normalized values", async () => {
    const adapter = new SupabaseStorageAdapter(
      "https://example.supabase.co",
      "mock-service-role-key"
    );

    const mockRpc = vi.fn().mockReturnValue({
      abortSignal: vi.fn(),
      then: (resolve: (val: unknown) => unknown) =>
        Promise.resolve(
          resolve({
            data: [
              {
                id: "comp-1",
                tax_id: "0101245486",
                normalized_domain: "vingroup.net",
                normalized_name: "tập đoàn vingroup",
              },
            ],
            error: null,
          })
        ),
    });

    (adapter as unknown as { client: { rpc: unknown } }).client = {
      rpc: mockRpc,
    };

    const identity = {
      taxId: "0101245486",
      domain: "vingroup.net",
      name: "tập đoàn vingroup",
    };

    const candidates = await adapter.findIdentityCandidates(
      { tenantId: "tenant-a", userId: "user-a" },
      identity,
    );
    expect(mockRpc).toHaveBeenCalledWith("lookup_company_identities_v2", {
      p_tenant_id: "tenant-a",
      p_tax_id: "0101245486",
      p_domain: "vingroup.net",
      p_name: "tập đoàn vingroup",
    });
    expect(candidates).toEqual([
      {
        companyId: "comp-1",
        taxId: "0101245486",
        domain: "vingroup.net",
        name: "tập đoàn vingroup",
      },
    ]);
  });

  it("calls get_latest_research_snapshot_v2 with tenant membership context", async () => {
    const adapter = new SupabaseStorageAdapter(
      "https://example.supabase.co",
      "mock-service-role-key"
    );
    const mockRpc = vi.fn().mockReturnValue({
      abortSignal: vi.fn(),
      then: (resolve: (val: unknown) => unknown) => Promise.resolve(resolve({
        data: [],
        error: null,
      })),
    });
    (adapter as unknown as { client: { rpc: unknown } }).client = {
      rpc: mockRpc,
    };

    await expect(adapter.getLatestCompleteSnapshot(
      { tenantId: "tenant-a", userId: "user-a" },
      "comp-1",
    )).resolves.toBeNull();
    expect(mockRpc).toHaveBeenCalledWith("get_latest_research_snapshot_v2", {
      p_tenant_id: "tenant-a",
      p_company_id: "comp-1",
    });
  });

  it("calls resolve_company_identity RPC and handles conflicts", async () => {
    const adapter = new SupabaseStorageAdapter(
      "https://example.supabase.co",
      "mock-service-role-key"
    );

    const mockRpc = vi.fn().mockReturnValue({
      abortSignal: vi.fn(),
      then: (resolve: (val: unknown) => unknown) =>
        Promise.resolve(
          resolve({
            data: null,
            error: { message: "identity_conflict: conflicting domain" },
          })
        ),
    });

    (adapter as unknown as { client: { rpc: unknown } }).client = {
      rpc: mockRpc,
    };

    await expect(
      adapter.resolveOrCreateIdentity(
        { tenantId: "tenant-a", userId: "user-a" },
        { taxId: "0101245486", domain: "vingroup.net", name: "vingroup" },
        "candidate-1"
      )
    ).rejects.toThrow("Thông tin định danh công ty mâu thuẫn.");
    expect(mockRpc).toHaveBeenCalledWith("resolve_company_identity_v2", {
      p_tenant_id: "tenant-a",
      p_tax_id: "0101245486",
      p_domain: "vingroup.net",
      p_name: "vingroup",
      p_candidate_id: "candidate-1",
    });
  });

  it("calls persist_research_snapshot RPC and returns parsed snapshot", async () => {
    const adapter = new SupabaseStorageAdapter(
      "https://example.supabase.co",
      "mock-service-role-key"
    );

    const mockRpc = vi.fn().mockReturnValue({
      abortSignal: vi.fn(),
      then: (resolve: (val: unknown) => unknown) =>
        Promise.resolve(
          resolve({
            data: "2026-08-26T08:00:00.000Z",
            error: null,
          })
        ),
    });

    (adapter as unknown as { client: { rpc: unknown } }).client = {
      rpc: mockRpc,
    };

    const dummyProfile: CompanyProfile = {
      id: "comp-1",
      version: 1,
      createdAt: new Date("2026-08-26T00:00:00.000Z"),
      lastUpdated: new Date("2026-08-26T08:00:00.000Z"),
      input: { name: "Vingroup" },
      officialName: "Tập đoàn Vingroup",
      tradingNames: [],
      industry: ["Conglomerate"],
      description: "Desc",
      keyPeople: [],
      products: [],
      markets: [],
      recentActivities: [],
      sources: [],
      overallConfidence: 0.9,
    };

    const draft = {
      profile: dummyProfile,
      report: {
        companyId: "comp-1",
        generatedAt: new Date("2026-08-26T08:00:00.000Z"),
        riskFlags: [],
        suggestedActions: [],
        executiveSummary: "Summary",
      },
      diff: null,
    };

    const result = await adapter.persistResearchSnapshot(
      { tenantId: "tenant-a", userId: "user-a" },
      { taxId: "0101245486", domain: "vingroup.net", name: "vingroup" },
      draft,
    );

    expect(mockRpc).toHaveBeenCalledWith("persist_research_snapshot_v2", {
      p_tenant_id: "tenant-a",
      p_company_id: "comp-1",
      p_tax_id: "0101245486",
      p_domain: "vingroup.net",
      p_name: "vingroup",
      p_version: 1,
      p_expected_version: 0,
      p_profile_data: dummyProfile,
      p_analysis_report: draft.report,
      p_diff_data: null,
    });
    expect(result.lastSyncedAt).toBe("2026-08-26T08:00:00.000Z");
  });
});
