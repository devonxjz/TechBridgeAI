export const INTERNAL_GATEWAY_VERSION = "1";

export const INTERNAL_GATEWAY_HEADERS = {
  version: "x-internal-version",
  keyId: "x-internal-kid",
  timestamp: "x-internal-timestamp",
  requestId: "x-internal-request-id",
  tenantId: "x-internal-tenant-id",
  userId: "x-internal-user-id",
  bodyDigest: "x-internal-body-sha256",
  signature: "x-internal-signature",
} as const;

export interface InternalGatewayContext {
  requestId: string;
  tenantId: string;
  userId: string;
}

export interface SignInternalGatewayRequestInput extends InternalGatewayContext {
  keyId: string;
  secret: string | Uint8Array;
  method: string;
  pathname: string;
  body: Uint8Array;
  timestamp: number;
}

export interface InternalGatewaySignedFields extends InternalGatewayContext {
  version: typeof INTERNAL_GATEWAY_VERSION;
  keyId: string;
  timestamp: number;
  method: string;
  pathname: string;
  bodyDigest: string;
}

const encoder = new TextEncoder();

export async function digestInternalGatewayBody(body: Uint8Array): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", copyToArrayBuffer(body)));
}

export function canonicalizeInternalGatewayFields(fields: InternalGatewaySignedFields): Uint8Array {
  return encoder.encode([
    fields.version,
    fields.keyId,
    String(fields.timestamp),
    fields.requestId,
    fields.tenantId,
    fields.userId,
    fields.method.toUpperCase(),
    fields.pathname,
    fields.bodyDigest,
  ].map(lengthPrefix).join(""));
}

export async function computeInternalGatewaySignature(
  fields: InternalGatewaySignedFields,
  secret: string | Uint8Array,
): Promise<string> {
  const keyBytes = typeof secret === "string"
    ? copyToArrayBuffer(encoder.encode(secret))
    : copyToArrayBuffer(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    copyToArrayBuffer(canonicalizeInternalGatewayFields(fields)),
  );
  return bytesToHex(signature);
}

export async function signInternalGatewayRequest(
  input: SignInternalGatewayRequestInput,
): Promise<Headers> {
  validateSignedValue(input.keyId);
  validateSignedValue(input.requestId);
  validateSignedValue(input.tenantId);
  validateSignedValue(input.userId);
  validateTimestamp(input.timestamp);
  validatePathname(input.pathname);

  const fields: InternalGatewaySignedFields = {
    version: INTERNAL_GATEWAY_VERSION,
    keyId: input.keyId,
    timestamp: input.timestamp,
    requestId: input.requestId,
    tenantId: input.tenantId,
    userId: input.userId,
    method: input.method,
    pathname: input.pathname,
    bodyDigest: await digestInternalGatewayBody(input.body),
  };
  const signature = await computeInternalGatewaySignature(fields, input.secret);

  return new Headers({
    [INTERNAL_GATEWAY_HEADERS.version]: fields.version,
    [INTERNAL_GATEWAY_HEADERS.keyId]: fields.keyId,
    [INTERNAL_GATEWAY_HEADERS.timestamp]: String(fields.timestamp),
    [INTERNAL_GATEWAY_HEADERS.requestId]: fields.requestId,
    [INTERNAL_GATEWAY_HEADERS.tenantId]: fields.tenantId,
    [INTERNAL_GATEWAY_HEADERS.userId]: fields.userId,
    [INTERNAL_GATEWAY_HEADERS.bodyDigest]: fields.bodyDigest,
    [INTERNAL_GATEWAY_HEADERS.signature]: signature,
  });
}

function lengthPrefix(value: string): string {
  return `${encoder.encode(value).byteLength}:${value}`;
}

function validateSignedValue(value: string): void {
  if (!value || value.trim() !== value) {
    throw new TypeError("Invalid internal gateway signing input");
  }
}

function validateTimestamp(timestamp: number): void {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("Invalid internal gateway signing input");
  }
}

function validatePathname(pathname: string): void {
  if (!pathname.startsWith("/") || pathname.includes("?") || pathname.includes("#")) {
    throw new TypeError("Invalid internal gateway signing input");
  }
}

export function copyToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
