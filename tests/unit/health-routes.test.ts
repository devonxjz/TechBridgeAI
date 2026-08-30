import { describe, expect, it } from "vitest";
import { GET as live } from "@/app/api/health/live/route";
import { GET as ready } from "@/app/api/health/ready/route";

describe("health routes", () => {
  it("returns a minimal liveness response", async () => {
    const response = await live();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns readiness without exposing configuration secrets", async () => {
    const response = await ready();
    expect([200, 503]).toContain(response.status);
    const body = await response.json();
    expect(body).toHaveProperty("status");
    expect(JSON.stringify(body)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
