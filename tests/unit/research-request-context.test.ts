import { afterEach, describe, expect, it } from "vitest";
import {
  getResearchRequestContext,
  setResearchRequestContextProvider,
} from "@/app/lib/research-request-context";

describe("research request context", () => {
  afterEach(() => {
    setResearchRequestContextProvider(null);
  });

  it("fails closed with an explanatory error when auth context is unavailable", async () => {
    setResearchRequestContextProvider(null);

    await expect(getResearchRequestContext()).rejects.toThrow(
      "Research authentication context is unavailable. Configure a request-context provider with the current Supabase session before starting research."
    );
  });

  it("returns the injected Supabase session and optional tenant hint", async () => {
    setResearchRequestContextProvider(async () => ({
      accessToken: "supabase-access-token",
      tenantId: "tenant-a",
    }));

    await expect(getResearchRequestContext()).resolves.toEqual({
      accessToken: "supabase-access-token",
      tenantId: "tenant-a",
    });
  });
});
