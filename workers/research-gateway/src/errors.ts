export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly stage: "request" | "auth" | "membership" | "quota" | "origin" | "config",
  ) {
    super(code);
  }
}

export function errorResponse(error: GatewayError, requestId: string): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
  });
  if (error.status === 429) {
    headers.set("retry-after", "60");
  }
  return Response.json({ error: { code: error.code }, requestId }, { status: error.status, headers });
}
