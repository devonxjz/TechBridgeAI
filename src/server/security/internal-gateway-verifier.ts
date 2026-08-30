import {
  computeInternalGatewaySignature,
  copyToArrayBuffer,
  digestInternalGatewayBody,
  INTERNAL_GATEWAY_HEADERS,
  INTERNAL_GATEWAY_VERSION,
  type InternalGatewayContext,
  type InternalGatewaySignedFields,
} from "@/lib/internal-gateway-signing";

export const INTERNAL_GATEWAY_MAX_PAST_SECONDS = 60;
export const INTERNAL_GATEWAY_MAX_FUTURE_SECONDS = 15;

export class InternalGatewayVerificationError extends Error {
  constructor() {
    super("Internal gateway request rejected");
    this.name = "InternalGatewayVerificationError";
  }
}

export interface InternalGatewayVerificationKeys {
  current: { keyId: string; secret: string | Uint8Array };
  previous?: { keyId: string; secret: string | Uint8Array };
}

export interface VerifyInternalGatewayRequestOptions {
  keys: InternalGatewayVerificationKeys;
  maxBodyBytes: number;
  now?: number;
}

export interface VerifiedInternalGatewayRequest {
  context: InternalGatewayContext;
  body: Uint8Array;
  request: Request;
}

const HEX_256 = /^[0-9a-f]{64}$/;

export async function verifyInternalGatewayRequest(
  request: Request,
  options: VerifyInternalGatewayRequestOptions,
): Promise<VerifiedInternalGatewayRequest> {
  try {
    validateOptions(options);

    const fields = readSignedFields(request);
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (
      fields.timestamp < now - INTERNAL_GATEWAY_MAX_PAST_SECONDS ||
      fields.timestamp > now + INTERNAL_GATEWAY_MAX_FUTURE_SECONDS
    ) {
      reject();
    }

    const key = findExactKey(options.keys, fields.keyId);
    if (!key) reject();

    const body = await readBody(request, options.maxBodyBytes);
    const actualDigest = await digestInternalGatewayBody(body);
    if (!constantTimeHexEqual(fields.bodyDigest, actualDigest)) reject();

    const expectedSignature = await computeInternalGatewaySignature(fields, key.secret);
    const suppliedSignature = requiredHeader(request.headers, INTERNAL_GATEWAY_HEADERS.signature);
    if (!HEX_256.test(suppliedSignature) || !constantTimeHexEqual(suppliedSignature, expectedSignature)) {
      reject();
    }

    return {
      context: {
        requestId: fields.requestId,
        tenantId: fields.tenantId,
        userId: fields.userId,
      },
      body,
      request: rebuildRequest(request, body),
    };
  } catch (error) {
    if (error instanceof InternalGatewayVerificationError) throw error;
    throw new InternalGatewayVerificationError();
  }
}

function readSignedFields(request: Request): InternalGatewaySignedFields {
  const version = requiredHeader(request.headers, INTERNAL_GATEWAY_HEADERS.version);
  if (version !== INTERNAL_GATEWAY_VERSION) reject();

  const timestampText = requiredHeader(request.headers, INTERNAL_GATEWAY_HEADERS.timestamp);
  if (!/^(0|[1-9]\d*)$/.test(timestampText)) reject();
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp)) reject();

  const bodyDigest = requiredHeader(request.headers, INTERNAL_GATEWAY_HEADERS.bodyDigest);
  if (!HEX_256.test(bodyDigest)) reject();

  return {
    version: INTERNAL_GATEWAY_VERSION,
    keyId: requiredHeader(request.headers, INTERNAL_GATEWAY_HEADERS.keyId),
    timestamp,
    requestId: requiredHeader(request.headers, INTERNAL_GATEWAY_HEADERS.requestId),
    tenantId: requiredHeader(request.headers, INTERNAL_GATEWAY_HEADERS.tenantId),
    userId: requiredHeader(request.headers, INTERNAL_GATEWAY_HEADERS.userId),
    method: request.method,
    pathname: new URL(request.url).pathname,
    bodyDigest,
  };
}

function requiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (!value || value.trim() !== value || value.includes(",")) reject();
  return value;
}

async function readBody(request: Request, maxBodyBytes: number): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength) || Number(contentLength) > maxBodyBytes) reject();
  }

  const body = new Uint8Array(await request.clone().arrayBuffer());
  if (body.byteLength > maxBodyBytes) reject();
  return body;
}

function rebuildRequest(request: Request, body: Uint8Array): Request {
  const method = request.method.toUpperCase();
  return new Request(request, {
    body: method === "GET" || method === "HEAD" ? undefined : copyToArrayBuffer(body),
  });
}

function findExactKey(keys: InternalGatewayVerificationKeys, keyId: string) {
  if (keyId === keys.current.keyId) return keys.current;
  if (keys.previous && keyId === keys.previous.keyId) return keys.previous;
  return undefined;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function validateOptions(options: VerifyInternalGatewayRequestOptions): void {
  if (!Number.isSafeInteger(options.maxBodyBytes) || options.maxBodyBytes < 0) reject();
  if (options.keys.previous?.keyId === options.keys.current.keyId) reject();
}

function reject(): never {
  throw new InternalGatewayVerificationError();
}
