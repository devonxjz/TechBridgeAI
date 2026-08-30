import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayError } from "../src/errors";
import { createHandler, type Dependencies } from "../src/handler";
import { canonicalSigningInput, sha256, signContext } from "../src/signing";

const env = {

  ENVIRONMENT: "local",
  ORIGIN_URL: "https://origin.example.com",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_JWT_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_JWT_AUDIENCE: "authenticated",
  MAX_BODY_BYTES: "1024",
  REPLAY_WINDOW_SECONDS: "60",
  ORIGIN_TIMEOUT_MS: "1000",
  SUPABASE_TIMEOUT_MS: "1000",
  QUOTA_OPERATION: "research",
  QUOTA_COST: "1",
  GATEWAY_KEY_ID: "current",
  SUPABASE_API_KEY: "server-key",
  GATEWAY_SIGNING_KEY: "test-signing-secret-at-least-32-bytes-long",
} as const satisfies Record<keyof Env, string>;

const requestId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const bodyText = JSON.stringify({ company: "Acme" });

function request(headers: Record<string, string> = {}, body = bodyText): Request {
  return new Request("https://gateway.example.com/api/research", {
    method: "POST",
    headers: {
      authorization: "Bearer jwt",
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...headers,
    },
    body,
  });
}

function rpcResponse(value: unknown): Response {
  return Response.json(value);
}

function quotaRow(allowed: boolean, remaining = allowed ? 3 : 0) {
  return {
    allowed,
    reservation_id: "reservation-1",
    remaining,
    reset_at: "2030-01-01T00:00:00Z",
  };
}

function baseDependencies(fetcher: typeof fetch): Partial<Dependencies> {
  return {
    fetcher,
    verifyJwt: vi.fn().mockResolvedValue({ userId: "user-1" }),
    now: () => 1_700_000_000_000,
    randomUUID: () => requestId,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("research gateway", () => {
  it("rejects unsupported routes and methods", async () => {
    const handler = createHandler(baseDependencies(vi.fn()));
    const notFound = await handler(new Request("https://gateway.example.com/nope"), env);
    const method = await handler(new Request("https://gateway.example.com/api/research", { method: "GET" }), env);
    expect(notFound.status).toBe(404);
    expect(method.status).toBe(405);
  });

  it("requires JSON, bounded object bodies and UUID idempotency keys", async () => {
    const handler = createHandler(baseDependencies(vi.fn()));
    expect((await handler(request({ "idempotency-key": "nope" }), env)).status).toBe(400);
    expect((await handler(request({ "content-type": "text/plain" }), env)).status).toBe(415);
    expect((await handler(request({}, "[]"), env)).status).toBe(400);
    expect((await handler(request({}, JSON.stringify({ value: "x".repeat(1024) })), env)).status).toBe(413);
  });

  it("fails closed on invalid auth without calling Supabase or origin", async () => {
    const fetcher = vi.fn();
    const handler = createHandler({
      ...baseDependencies(fetcher),
      verifyJwt: vi.fn().mockRejectedValue(new Error("bad jwt")),
    });
    const response = await handler(request(), env);
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns 401 for rejected JWT verification", async () => {
    const fetcher = vi.fn();
    const handler = createHandler({
      ...baseDependencies(fetcher),
      verifyJwt: vi.fn().mockRejectedValue(new GatewayError(401, "unauthorized", "auth")),
    });
    expect((await handler(request(), env)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the tenant header only as a membership hint", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResponse([{ tenant_id: "tenant-verified" }]))
      .mockResolvedValueOnce(rpcResponse([quotaRow(true)]))
      .mockResolvedValueOnce(new Response("data: one\n\n", { headers: { "content-type": "text/event-stream" } }));
    const handler = createHandler(baseDependencies(fetcher));
    const response = await handler(request({
      "x-tenant-id": "tenant-forged",
      "x-internal-tenant-id": "attacker",
      cookie: "secret-cookie",
    }), env);
    expect(response.status).toBe(200);

    const membershipInit = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(membershipInit.body))).toEqual({
      p_user_id: "user-1",
      p_tenant_hint: "tenant-forged",
    });
    const originInit = fetcher.mock.calls[2][1] as RequestInit;
    const headers = new Headers(originInit.headers);
    expect(headers.get("x-internal-tenant-id")).toBe("tenant-verified");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("passes a null hint so the DB can auto-resolve one membership", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResponse([{ tenant_id: "tenant-only" }]))
      .mockResolvedValueOnce(rpcResponse([quotaRow(true)]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const response = await createHandler(baseDependencies(fetcher))(request(), env);
    expect(response.status).toBe(204);
    expect(fetcher.mock.calls[0][0]).toBe("https://project.supabase.co/rest/v1/rpc/resolve_research_tenant");
    const membershipInit = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(membershipInit.body))).toEqual({
      p_user_id: "user-1",
      p_tenant_hint: null,
    });
  });

  it("maps ambiguous membership selection and never calls origin", async () => {
    const ambiguous = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(
      JSON.stringify({ message: "tenant_selection_required" }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));
    const response = await createHandler(baseDependencies(ambiguous))(request(), env);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "tenant_selection_required" } });
    expect(ambiguous).toHaveBeenCalledTimes(1);
  });

  it("does not call origin when membership or quota admission fails", async () => {
    const noMembership = vi.fn<typeof fetch>().mockResolvedValueOnce(rpcResponse([]));
    expect((await createHandler(baseDependencies(noMembership))(request(), env)).status).toBe(403);
    expect(noMembership).toHaveBeenCalledTimes(1);

    const noQuota = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResponse([{ tenant_id: "tenant-1" }]))
      .mockResolvedValueOnce(rpcResponse([quotaRow(false)]));
    expect((await createHandler(baseDependencies(noQuota))(request(), env)).status).toBe(429);
    expect(noQuota).toHaveBeenCalledTimes(2);
  });

  it("fails closed when an allowed quota result omits required fields", async () => {
    const malformed = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResponse([{ tenant_id: "tenant-1" }]))
      .mockResolvedValueOnce(rpcResponse([{ allowed: true, reservation_id: null, remaining: 3, reset_at: null }]));

    const response = await createHandler(baseDependencies(malformed))(request(), env);
    expect(response.status).toBe(503);
    expect(malformed).toHaveBeenCalledTimes(2);
  });

  it("signs the verified context and body digest", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResponse([{ tenant_id: "tenant-1" }]))
      .mockResolvedValueOnce(rpcResponse([quotaRow(true)]))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { "set-cookie": "blocked=true" } }));
    const response = await createHandler(baseDependencies(fetcher))(request(), env);
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");

    const originInit = fetcher.mock.calls[2][1] as RequestInit;
    const headers = new Headers(originInit.headers);
    const digest = await sha256(new TextEncoder().encode(bodyText));
    const expected = await signContext(env.GATEWAY_SIGNING_KEY, {
      version: "1",
      keyId: "current",
      timestamp: "1700000000",
      requestId,
      userId: "user-1",
      tenantId: "tenant-1",
      method: "POST",
      pathname: "/api/research",
      bodyDigest: digest,
    });
    expect(headers.get("x-internal-signature")).toBe(expected);
    expect(headers.get("x-internal-kid")).toBe("current");
    expect(headers.get("x-internal-version")).toBe("1");
    expect(headers.get("x-internal-body-sha256")).toBe(digest);
    expect(headers.get("x-internal-timestamp")).toBe("1700000000");
  });

  it("returns the origin stream directly without consuming it", async () => {
    let pulls = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode(`data: ${pulls}\n\n`));
        if (pulls === 2) controller.close();
      },
    });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResponse([{ tenant_id: "tenant-1" }]))
      .mockResolvedValueOnce(rpcResponse([quotaRow(true)]))
      .mockResolvedValueOnce(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    const response = await createHandler(baseDependencies(fetcher))(request(), env);
    expect(response.body).not.toBeNull();
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("data: 1\n\n");
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("data: 2\n\n");
  });

  it("fails closed on Supabase and origin network errors", async () => {
    const supabaseFailure = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    expect((await createHandler(baseDependencies(supabaseFailure))(request(), env)).status).toBe(503);

    const originFailure = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rpcResponse([{ tenant_id: "tenant-1" }]))
      .mockResolvedValueOnce(rpcResponse([quotaRow(true)]))
      .mockRejectedValueOnce(new Error("offline"));
    expect((await createHandler(baseDependencies(originFailure))(request(), env)).status).toBe(502);
  });

  it("blocks placeholder configuration before any fetch", async () => {
    const fetcher = vi.fn();
    const response = await createHandler(baseDependencies(fetcher))(request(), {
      ...env,
      ORIGIN_URL: "https://replace-production-origin.invalid",
    });
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the canonical signing contract stable", () => {
    expect(canonicalSigningInput({
      version: "1",
      keyId: "key",
      timestamp: "2",
      requestId: "3",
      userId: "5",
      tenantId: "4",
      method: "post",
      pathname: "/api/research",
      bodyDigest: "6",
    })).toBe("1:13:key1:21:31:41:54:POST13:/api/research1:6");
  });
});
