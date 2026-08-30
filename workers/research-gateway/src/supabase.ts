import { GatewayError } from "./errors";

interface RpcOptions {
  signal: AbortSignal;
  fetcher: typeof fetch;
}

export interface QuotaReservation {
  allowed: boolean;
  reservationId: string | null;
  remaining: number | null;
  resetAt: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneRow(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] : null;
  }
  return value;
}

async function rpc(env: Env, name: string, body: Record<string, unknown>, options: RpcOptions): Promise<unknown> {
  let response: Response;
  try {
    response = await options.fetcher(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_API_KEY,
        authorization: `Bearer ${env.SUPABASE_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch {
    throw new GatewayError(503, "authorization_service_unavailable", name.includes("quota") ? "quota" : "membership");
  }

  if (!response.ok) {
    if (name === "resolve_research_tenant") {
      const message = await response.text().catch(() => "");
      if (message.includes("tenant_selection_required")) {
        throw new GatewayError(409, "tenant_selection_required", "membership");
      }
      if (message.includes("tenant_access_denied")) {
        throw new GatewayError(403, "tenant_access_denied", "membership");
      }
    }
    throw new GatewayError(503, "authorization_service_unavailable", name.includes("quota") ? "quota" : "membership");
  }

  try {
    return await response.json();
  } catch {
    throw new GatewayError(503, "authorization_service_unavailable", name.includes("quota") ? "quota" : "membership");
  }
}

export async function resolveTenant(
  env: Env,
  userId: string,
  tenantHint: string | null,
  options: RpcOptions,
): Promise<string> {
  const row = oneRow(await rpc(env, "resolve_research_tenant", {
    p_user_id: userId,
    p_tenant_hint: tenantHint,
  }, options));

  if (!isObject(row) || typeof row.tenant_id !== "string" || !row.tenant_id) {
    throw new GatewayError(403, "tenant_access_denied", "membership");
  }
  return row.tenant_id;
}

export async function reserveQuota(
  env: Env,
  tenantId: string,
  userId: string,
  idempotencyKey: string,
  options: RpcOptions,
): Promise<QuotaReservation> {
  const row = oneRow(await rpc(env, "reserve_research_quota", {
    p_tenant_id: tenantId,
    p_user_id: userId,
    p_operation: env.QUOTA_OPERATION,
    p_idempotency_key: idempotencyKey,
    p_cost: Number(env.QUOTA_COST),
  }, options));

  if (
    !isObject(row) ||
    typeof row.allowed !== "boolean" ||
    typeof row.reservation_id !== "string" ||
    !row.reservation_id ||
    typeof row.remaining !== "number" ||
    !Number.isSafeInteger(row.remaining) ||
    row.remaining < 0 ||
    typeof row.reset_at !== "string" ||
    !row.reset_at ||
    Number.isNaN(Date.parse(row.reset_at))
  ) {
    throw new GatewayError(503, "quota_service_unavailable", "quota");
  }
  return {
    allowed: row.allowed,
    reservationId: row.reservation_id,
    remaining: row.remaining,
    resetAt: row.reset_at,
  };
}
