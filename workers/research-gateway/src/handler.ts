import { getBearerToken, verifySupabaseJwt, type VerifyJwt } from "./auth";
import { readJsonBody } from "./body";
import { assertRuntimeConfig, IDEMPOTENCY_KEY_PATTERN, parsePositiveInteger, RESEARCH_PATH } from "./config";
import { errorResponse, GatewayError } from "./errors";
import { sanitizedOriginHeaders, sanitizedResponseHeaders } from "./headers";
import { logEvent } from "./logging";
import { sha256, signContext } from "./signing";
import { reserveQuota, resolveTenant } from "./supabase";

export interface Dependencies {
  fetcher: typeof fetch;
  verifyJwt: VerifyJwt;
  now: () => number;
  randomUUID: () => string;
}

const defaultDependencies: Dependencies = {
  fetcher: fetch,
  verifyJwt: verifySupabaseJwt,
  now: Date.now,
  randomUUID: crypto.randomUUID.bind(crypto),
};

function timeoutSignal(milliseconds: number, clientSignal: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return AbortSignal.any([clientSignal, timeout]);
}

export function createHandler(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function handle(request: Request, env: Env): Promise<Response> {
    const startedAt = dependencies.now();
    const requestId = dependencies.randomUUID();
    let stage: GatewayError["stage"] = "request";

    try {
      assertRuntimeConfig(env);
      stage = "config";

      const url = new URL(request.url);
      if (url.pathname !== RESEARCH_PATH) {
        throw new GatewayError(404, "not_found", "request");
      }
      if (request.method !== "POST") {
        throw new GatewayError(405, "method_not_allowed", "request");
      }

      const idempotencyKey = request.headers.get("idempotency-key");
      if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw new GatewayError(400, "invalid_idempotency_key", "request");
      }

      const maxBodyBytes = parsePositiveInteger(env.MAX_BODY_BYTES, 262_144);
      const body = await readJsonBody(request, maxBodyBytes);
      const token = getBearerToken(request);

      stage = "auth";
      const { userId } = await dependencies.verifyJwt(token, env);

      stage = "membership";
      const tenantId = await resolveTenant(env, userId, request.headers.get("x-tenant-id"), {
        fetcher: dependencies.fetcher,
        signal: timeoutSignal(parsePositiveInteger(env.SUPABASE_TIMEOUT_MS, 5_000), request.signal),
      });

      stage = "quota";
      const quota = await reserveQuota(env, tenantId, userId, idempotencyKey, {
        fetcher: dependencies.fetcher,
        signal: timeoutSignal(parsePositiveInteger(env.SUPABASE_TIMEOUT_MS, 5_000), request.signal),
      });
      if (!quota.allowed) {
        throw new GatewayError(429, "quota_exceeded", "quota");
      }

      stage = "origin";
      const timestamp = String(Math.floor(dependencies.now() / 1_000));
      const bodyDigest = await sha256(body);
      const signature = await signContext(env.GATEWAY_SIGNING_KEY, {
        version: "1",
        keyId: env.GATEWAY_KEY_ID,
        timestamp,
        requestId,
        userId,
        tenantId,
        method: "POST",
        pathname: RESEARCH_PATH,
        bodyDigest,
      });
      const headers = sanitizedOriginHeaders(request);
      headers.set("x-internal-version", "1");
      headers.set("x-internal-tenant-id", tenantId);
      headers.set("x-internal-user-id", userId);
      headers.set("x-internal-request-id", requestId);
      headers.set("x-internal-timestamp", timestamp);
      headers.set("x-internal-body-sha256", bodyDigest);
      headers.set("x-internal-signature", signature);
      headers.set("x-internal-kid", env.GATEWAY_KEY_ID);
      if (quota.reservationId) {
        headers.set("x-internal-quota-reservation-id", quota.reservationId);
      }

      const originUrl = new URL(RESEARCH_PATH, `${env.ORIGIN_URL.replace(/\/$/, "")}/`);
      let originResponse: Response;
      try {
        originResponse = await dependencies.fetcher(originUrl, {
          method: "POST",
          headers,
          body,
          signal: timeoutSignal(parsePositiveInteger(env.ORIGIN_TIMEOUT_MS, 300_000), request.signal),
          redirect: "manual",
        });
      } catch {
        throw new GatewayError(502, "origin_unavailable", "origin");
      }

      logEvent({
        requestId,
        stage: "origin",
        outcome: "proxied",
        status: originResponse.status,
        originStatus: originResponse.status,
        environment: env.ENVIRONMENT,
        durationMs: dependencies.now() - startedAt,
      });
      return new Response(originResponse.body, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers: sanitizedResponseHeaders(originResponse, requestId),
      });
    } catch (error) {
      const publicError = error instanceof GatewayError
        ? error
        : new GatewayError(503, "gateway_unavailable", stage);
      logEvent({
        requestId,
        stage: publicError.stage,
        outcome: publicError.status < 500 ? "denied" : "error",
        status: publicError.status,
        environment: env.ENVIRONMENT,
        durationMs: dependencies.now() - startedAt,
      });
      return errorResponse(publicError, requestId);
    }
  };
}

export const handleRequest = createHandler();
