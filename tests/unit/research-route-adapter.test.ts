import { describe, expect, it, vi } from "vitest";

const handleResearch = vi.hoisted(() => vi.fn());

vi.mock("@/server/research/handler", () => ({ handleResearch }));

import { maxDuration, POST, runtime } from "@/app/api/research/route";

describe("research route adapter", () => {
  it("preserves route configuration and delegates the Web Request unchanged", async () => {
    const request = new Request("http://localhost/api/research", {
      method: "POST",
    });
    const expected = new Response("delegated", { status: 202 });
    handleResearch.mockResolvedValueOnce(expected);

    await expect(POST(request)).resolves.toBe(expected);
    expect(handleResearch).toHaveBeenCalledWith(request);
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(300);
  });
});
