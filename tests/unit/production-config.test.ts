import { afterEach, describe, expect, it, vi } from "vitest";
import { createStorageAdapter, resetAdapters } from "@/config";

describe("production configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetAdapters();
  });

  it("rejects an unspecified storage provider in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.STORAGE_PROVIDER;

    expect(() => createStorageAdapter()).toThrow(
      "STORAGE_PROVIDER=supabase is required in production",
    );
  });

  it("rejects memory storage in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.STORAGE_PROVIDER = "memory";

    expect(() => createStorageAdapter()).toThrow(
      "STORAGE_PROVIDER=supabase is required in production",
    );
  });

  it("does not use the anon key as a server storage credential", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.STORAGE_PROVIDER = "supabase";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_ANON_KEY = "anon-key";

    expect(() => createStorageAdapter()).toThrow(
      "SUPABASE_SERVICE_ROLE_KEY is required in production",
    );
  });
});
