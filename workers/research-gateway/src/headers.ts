const REQUEST_HEADER_ALLOWLIST = ["accept", "accept-language", "content-type", "idempotency-key", "user-agent"];
const RESPONSE_HEADER_ALLOWLIST = [
  "cache-control",
  "content-encoding",
  "content-language",
  "content-type",
  "retry-after",
  "x-accel-buffering",
];

export function sanitizedOriginHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  return headers;
}

export function sanitizedResponseHeaders(response: Response, requestId: string): Headers {
  const headers = new Headers();
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = response.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  headers.set("cache-control", "no-store");
  headers.set("x-request-id", requestId);
  return headers;
}
