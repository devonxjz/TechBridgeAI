import { describe, expect, it, vi } from "vitest";
import { SupabaseStorageAdapter } from "@/adapters/storage/supabase";

describe("Supabase snapshot version allocation", () => {
  it("requests the next version from the transactional RPC", async () => {
    const adapter = new SupabaseStorageAdapter(
      "https://example.supabase.co",
      "service-role",
    );
    const rpc = vi.fn().mockReturnValue({
      abortSignal: vi.fn(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
        data: "2026-08-30T00:00:00.000Z",
        error: null,
      })),
    });
    (adapter as unknown as { client: { rpc: typeof rpc } }).client = { rpc };

    const profile = {
      id: "company-1", version: 1, createdAt: new Date(), lastUpdated: new Date(),
      input: { name: "Company" }, officialName: "Company", tradingNames: [],
      industry: [], description: "Company", keyPeople: [], products: [], markets: [],
      recentActivities: [], sources: [], overallConfidence: 0.8,
    };
    await adapter.persistResearchSnapshot(
      { tenantId: "tenant-a", userId: "user-a" },
      { taxId: null, domain: "company.example", name: "company" },
      { profile, report: { companyId: "company-1", generatedAt: new Date(), riskFlags: [], suggestedActions: [], executiveSummary: "" }, diff: null },
    );

    expect(rpc).toHaveBeenCalledWith("persist_research_snapshot_v2", expect.objectContaining({
      p_tenant_id: "tenant-a",
      p_expected_version: 0,
    }));
  });
});
