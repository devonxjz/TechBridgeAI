import { handleResearchRequest } from "@/modules/research/handler";
import {
  InternalGatewayVerificationError,
  verifyInternalGatewayRequest,
  type InternalGatewayVerificationKeys,
} from "@/server/security/internal-gateway-verifier";

const DEFAULT_MAX_BODY_BYTES = 65_536;

export async function handleResearch(request: Request): Promise<Response> {
  try {
    const verified = await verifyInternalGatewayRequest(request, {
      keys: readGatewayKeys(process.env),
      maxBodyBytes: readPositiveInteger(
        process.env.GATEWAY_MAX_BODY_BYTES,
        DEFAULT_MAX_BODY_BYTES,
        "GATEWAY_MAX_BODY_BYTES",
      ),
    });
    return handleResearchRequest(verified.request, verified.context);
  } catch (error) {
    if (error instanceof InternalGatewayVerificationError) {
      return jsonError(401, "Unauthorized", "invalid_gateway_signature");
    }
    console.error("Research gateway configuration error", error);
    return jsonError(503, "Research gateway is unavailable", "gateway_unavailable");
  }
}

export function readGatewayKeys(
  env: NodeJS.ProcessEnv,
): InternalGatewayVerificationKeys {
  const current = readKeyPair(
    env.GATEWAY_SIGNING_KEY_CURRENT_ID,
    env.GATEWAY_SIGNING_KEY_CURRENT,
    "current",
  );
  const hasPreviousId = Boolean(env.GATEWAY_SIGNING_KEY_PREVIOUS_ID);
  const hasPreviousSecret = Boolean(env.GATEWAY_SIGNING_KEY_PREVIOUS);
  if (hasPreviousId !== hasPreviousSecret) {
    throw new Error("Previous gateway signing key ID and secret must be configured together");
  }
  const previous = hasPreviousId
    ? readKeyPair(
        env.GATEWAY_SIGNING_KEY_PREVIOUS_ID,
        env.GATEWAY_SIGNING_KEY_PREVIOUS,
        "previous",
      )
    : undefined;
  if (previous?.keyId === current.keyId) {
    throw new Error("Gateway signing key IDs must be unique");
  }
  return { current, previous };
}

function readKeyPair(
  keyId: string | undefined,
  secret: string | undefined,
  label: string,
): { keyId: string; secret: string } {
  if (!keyId || keyId.trim() !== keyId || !secret || secret.length < 32) {
    throw new Error(`Invalid ${label} gateway signing key configuration`);
  }
  return { keyId, secret };
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is out of range`);
  return parsed;
}

function jsonError(status: number, error: string, code: string): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
