import { GatewayError } from "./errors";

export async function readJsonBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new GatewayError(415, "unsupported_media_type", "request");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      throw new GatewayError(413, "request_too_large", "request");
    }
  }

  if (!request.body) {
    throw new GatewayError(400, "invalid_json", "request");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request_too_large");
        throw new GatewayError(413, "request_too_large", "request");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(400, "invalid_body", "request");
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("body_not_object");
    }
  } catch {
    throw new GatewayError(400, "invalid_json", "request");
  }

  return body.buffer;
}
