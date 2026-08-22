import { describe, it, expect } from "vitest";
import { SupabaseStorageAdapter } from "@/adapters/storage/supabase";

describe("SupabaseStorageAdapter Unit Tests", () => {
  it("throws error when initialized without credentials", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => new SupabaseStorageAdapter()).toThrow(
      "Missing Supabase credentials: SUPABASE_URL or SUPABASE_ANON_KEY"
    );
  });

  it("initializes client properly with URL and Key", () => {
    const adapter = new SupabaseStorageAdapter(
      "https://example.supabase.co",
      "mock-anon-key"
    );
    expect(adapter).toBeDefined();
    expect(typeof adapter.saveProfile).toBe("function");
    expect(typeof adapter.getProfile).toBe("function");
    expect(typeof adapter.getLatestProfile).toBe("function");
    expect(typeof adapter.listProfiles).toBe("function");
    expect(typeof adapter.saveDiff).toBe("function");
    expect(typeof adapter.getDiffs).toBe("function");
  });
});
