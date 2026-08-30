export interface SigningContext {
  version: "1";
  keyId: string;
  timestamp: string;
  requestId: string;
  userId: string;
  tenantId: string;
  method: string;
  pathname: string;
  bodyDigest: string;
}

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(body: ArrayBuffer | ArrayBufferView): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", body));
}

export function canonicalSigningInput(context: SigningContext): string {
  return [
    context.version,
    context.keyId,
    context.timestamp,
    context.requestId,
    context.tenantId,
    context.userId,
    context.method.toUpperCase(),
    context.pathname,
    context.bodyDigest,
  ].map(lengthPrefix).join("");
}

function lengthPrefix(value: string): string {
  return `${encoder.encode(value).byteLength}:${value}`;
}

export async function signContext(secret: string, context: SigningContext): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalSigningInput(context))));
}
