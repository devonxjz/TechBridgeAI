import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureTestGatewayKeys,
  createSignedResearchRequest,
  TEST_TENANT_ID,
} from "../helpers/signed-research-request";

const handleResearchRequest = vi.hoisted(() => vi.fn());

vi.mock("@/modules/research/handler", () => ({ handleResearchRequest }));

import { handleResearch } from "@/server/research/handler";

const originalGatewayEnv = {
  keyId: process.env.GATEWAY_SIGNING_KEY_CURRENT_ID,
  secret: process.env.GATEWAY_SIGNING_KEY_CURRENT,
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("research server handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureTestGatewayKeys();
  });

  afterEach(() => {
    restoreEnv("GATEWAY_SIGNING_KEY_CURRENT_ID", originalGatewayEnv.keyId);
    restoreEnv("GATEWAY_SIGNING_KEY_CURRENT", originalGatewayEnv.secret);
  });

  it("verifies the request before passing trusted context to the handler", async () => {
    const request = await createSignedResearchRequest({ input: { name: "FPT" } });
    const expected = new Response("ok");
    handleResearchRequest.mockResolvedValueOnce(expected);

    await expect(handleResearch(request)).resolves.toBe(expected);
    expect(handleResearchRequest).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ tenantId: TEST_TENANT_ID }),
    );
  });

  it("rejects unsigned requests before the handler can access cache", async () => {
    const response = await handleResearch(
      new Request("http://localhost/api/research", {
        method: "POST",
        body: JSON.stringify({ input: { name: "FPT" } }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_gateway_signature",
    });
    expect(handleResearchRequest).not.toHaveBeenCalled();
  });

  it("fails closed when gateway key configuration is missing", async () => {
    delete process.env.GATEWAY_SIGNING_KEY_CURRENT_ID;
    delete process.env.GATEWAY_SIGNING_KEY_CURRENT;

    const response = await handleResearch(
      new Request("http://localhost/api/research", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "gateway_unavailable",
    });
    expect(handleResearchRequest).not.toHaveBeenCalled();
  });
});
