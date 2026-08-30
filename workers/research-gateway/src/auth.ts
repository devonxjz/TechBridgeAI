import { createRemoteJWKSet, jwtVerify } from "jose";

import { GatewayError } from "./errors";

export interface VerifiedUser {
  userId: string;
}

export type VerifyJwt = (token: string, env: Env) => Promise<VerifiedUser>;

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) {
    throw new GatewayError(401, "unauthorized", "auth");
  }
  return match[1];
}

export function getBearerToken(request: Request): string {
  return bearerToken(request);
}

export const verifySupabaseJwt: VerifyJwt = async (token, env) => {
  try {
    const issuer = env.SUPABASE_JWT_ISSUER.replace(/\/$/, "");
    const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      timeoutDuration: 3_000,
    });
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: env.SUPABASE_JWT_AUDIENCE,
      algorithms: ["RS256", "ES256"],
    });
    if (!payload.sub || payload.role !== "authenticated") {
      throw new Error("invalid_subject_or_role");
    }
    return { userId: payload.sub };
  } catch {
    throw new GatewayError(401, "unauthorized", "auth");
  }
};
