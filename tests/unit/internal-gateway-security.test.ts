import { describe, expect, it } from "vitest";
import {
  copyToArrayBuffer,
  INTERNAL_GATEWAY_HEADERS,
  signInternalGatewayRequest,
} from "@/lib/internal-gateway-signing";
import {
  InternalGatewayVerificationError,
  verifyInternalGatewayRequest,
} from "@/server/security/internal-gateway-verifier";

const NOW = 2_000_000_000;
const CURRENT = { keyId: "current-2026-08", secret: "current-secret-with-enough-entropy" };
const PREVIOUS = { keyId: "previous-2026-07", secret: "previous-secret-with-enough-entropy" };
const BODY = new TextEncoder().encode('{"company":"TechBridge"}');

async function signedRequest(overrides: {
  body?: Uint8Array;
  key?: typeof CURRENT;
  method?: string;
  pathname?: string;
  timestamp?: number;
} = {}): Promise<Request> {
  const body = overrides.body ?? BODY;
  const method = overrides.method ?? "POST";
  const pathname = overrides.pathname ?? "/api/research";
  const headers = await signInternalGatewayRequest({
    keyId: (overrides.key ?? CURRENT).keyId,
    secret: (overrides.key ?? CURRENT).secret,
    requestId: "request-123",
    tenantId: "tenant-a",
    userId: "user-a",
    timestamp: overrides.timestamp ?? NOW,
    method,
    pathname,
    body,
  });
  headers.set("content-type", "application/json");

  return new Request(`https://origin.example${pathname}?client=ignored`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : copyToArrayBuffer(body),
  });
}

const options = {
  keys: { current: CURRENT, previous: PREVIOUS },
  maxBodyBytes: 1024,
  now: NOW,
};

describe("internal gateway signing contract", () => {
  it("verifies every required signed field and returns trusted replayable input", async () => {
    const original = await signedRequest();
    const verified = await verifyInternalGatewayRequest(original, options);

    expect(verified.context).toEqual({
      requestId: "request-123",
      tenantId: "tenant-a",
      userId: "user-a",
    });
    expect(new TextDecoder().decode(verified.body)).toBe('{"company":"TechBridge"}');
    expect(await verified.request.text()).toBe('{"company":"TechBridge"}');
    expect(await original.text()).toBe('{"company":"TechBridge"}');
  });

  it("accepts exact current and previous key IDs during rotation", async () => {
    await expect(verifyInternalGatewayRequest(await signedRequest(), options)).resolves.toBeDefined();
    await expect(verifyInternalGatewayRequest(await signedRequest({ key: PREVIOUS }), options)).resolves.toBeDefined();
  });

  it("rejects an unknown key ID even when the signature was made with a valid secret", async () => {
    const request = await signedRequest();
    request.headers.set(INTERNAL_GATEWAY_HEADERS.keyId, "current-2026");

    await expect(verifyInternalGatewayRequest(request, options)).rejects.toEqual(
      new InternalGatewayVerificationError(),
    );
  });

  it("rejects browser-provided internal headers without a valid signature", async () => {
    const request = new Request("https://origin.example/api/research", {
      method: "POST",
      body: copyToArrayBuffer(BODY),
      headers: {
        [INTERNAL_GATEWAY_HEADERS.version]: "1",
        [INTERNAL_GATEWAY_HEADERS.keyId]: CURRENT.keyId,
        [INTERNAL_GATEWAY_HEADERS.timestamp]: String(NOW),
        [INTERNAL_GATEWAY_HEADERS.requestId]: "request-123",
        [INTERNAL_GATEWAY_HEADERS.tenantId]: "forged-tenant",
        [INTERNAL_GATEWAY_HEADERS.userId]: "forged-user",
        [INTERNAL_GATEWAY_HEADERS.bodyDigest]: "0".repeat(64),
        [INTERNAL_GATEWAY_HEADERS.signature]: "0".repeat(64),
      },
    });

    await expect(verifyInternalGatewayRequest(request, options)).rejects.toEqual(
      new InternalGatewayVerificationError(),
    );
  });

  it("rejects tampering with identity, method, path, body, or signature", async () => {
    const mutations: Array<(request: Request) => Request> = [
      (request) => {
        request.headers.set(INTERNAL_GATEWAY_HEADERS.tenantId, "tenant-b");
        return request;
      },
      (request) => new Request(request, { method: "PUT" }),
      (request) => new Request("https://origin.example/api/other", request),
      (request) => new Request(request, {
        body: copyToArrayBuffer(new TextEncoder().encode("tampered")),
      }),
      (request) => {
        request.headers.set(INTERNAL_GATEWAY_HEADERS.signature, "f".repeat(64));
        return request;
      },
    ];

    for (const mutate of mutations) {
      const request = mutate(await signedRequest());
      await expect(verifyInternalGatewayRequest(request, options)).rejects.toEqual(
        new InternalGatewayVerificationError(),
      );
    }
  });

  it("enforces the 60-second past and 15-second future timestamp window inclusively", async () => {
    await expect(verifyInternalGatewayRequest(await signedRequest({ timestamp: NOW - 60 }), options)).resolves.toBeDefined();
    await expect(verifyInternalGatewayRequest(await signedRequest({ timestamp: NOW + 15 }), options)).resolves.toBeDefined();
    await expect(verifyInternalGatewayRequest(await signedRequest({ timestamp: NOW - 61 }), options)).rejects.toEqual(new InternalGatewayVerificationError());
    await expect(verifyInternalGatewayRequest(await signedRequest({ timestamp: NOW + 16 }), options)).rejects.toEqual(new InternalGatewayVerificationError());
  });

  it("rejects bodies over the configured size limit", async () => {
    const request = await signedRequest({ body: new Uint8Array(5) });

    await expect(verifyInternalGatewayRequest(request, { ...options, maxBodyBytes: 4 })).rejects.toEqual(
      new InternalGatewayVerificationError(),
    );
  });

  it("uses one generic rejection for malformed and missing contract headers", async () => {
    const missing = await signedRequest();
    missing.headers.delete(INTERNAL_GATEWAY_HEADERS.userId);
    const malformed = await signedRequest();
    malformed.headers.set(INTERNAL_GATEWAY_HEADERS.timestamp, "not-a-timestamp");

    for (const request of [missing, malformed]) {
      try {
        await verifyInternalGatewayRequest(request, options);
        expect.unreachable("verification should reject");
      } catch (error) {
        expect(error).toBeInstanceOf(InternalGatewayVerificationError);
        expect((error as Error).message).toBe("Internal gateway request rejected");
      }
    }
  });
});
