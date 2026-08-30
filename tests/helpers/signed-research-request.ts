import { NextRequest } from "next/server";
import { signInternalGatewayRequest } from "@/lib/internal-gateway-signing";

export const TEST_GATEWAY_KEY_ID = "research-route-test-key";
export const TEST_GATEWAY_SECRET =
  "research-route-test-signing-secret-at-least-32-bytes";
export const TEST_TENANT_ID = "tenant-test";
export const TEST_USER_ID = "user-test";
export const TEST_STORAGE_CONTEXT = {
  tenantId: TEST_TENANT_ID,
  userId: TEST_USER_ID,
};

let requestSequence = 0;

export function configureTestGatewayKeys(): void {
  process.env.GATEWAY_SIGNING_KEY_CURRENT_ID = TEST_GATEWAY_KEY_ID;
  process.env.GATEWAY_SIGNING_KEY_CURRENT = TEST_GATEWAY_SECRET;
}

export async function createSignedResearchRequest(
  payload: unknown,
  options?: { rawBody?: string; signal?: AbortSignal },
): Promise<NextRequest> {
  const body = options?.rawBody ?? JSON.stringify(payload);
  const bodyBytes = new TextEncoder().encode(body);
  requestSequence += 1;
  const headers = await signInternalGatewayRequest({
    keyId: TEST_GATEWAY_KEY_ID,
    secret: TEST_GATEWAY_SECRET,
    requestId: `request-test-${requestSequence}`,
    tenantId: TEST_TENANT_ID,
    userId: TEST_USER_ID,
    timestamp: Math.floor(Date.now() / 1000),
    method: "POST",
    pathname: "/api/research",
    body: bodyBytes,
  });
  headers.set("Content-Type", "application/json");

  return new NextRequest("http://localhost:3000/api/research", {
    method: "POST",
    headers,
    body,
    signal: options?.signal,
  });
}
