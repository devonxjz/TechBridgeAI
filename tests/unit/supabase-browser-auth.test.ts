import { afterEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient }));

import {
  getBrowserSupabaseClient,
  installSupabaseResearchContextProvider,
} from "@/app/lib/supabase-auth";
import { getResearchRequestContext } from "@/app/lib/research-request-context";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  vi.clearAllMocks();
});

describe("browser Supabase auth", () => {
  it("fails closed when browser auth is not configured", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(getBrowserSupabaseClient()).toBeNull();
  });

  it("provides the current access token to research requests", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "access-token" } },
          error: null,
        }),
      },
    };

    installSupabaseResearchContextProvider(supabase as never);
    await expect(getResearchRequestContext()).resolves.toEqual({
      accessToken: "access-token",
    });
  });

  it("rejects research when no session exists", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
    };

    installSupabaseResearchContextProvider(supabase as never);
    await expect(getResearchRequestContext()).rejects.toThrow("Vui lòng đăng nhập");
  });
});
