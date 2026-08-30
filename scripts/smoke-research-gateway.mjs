#!/usr/bin/env node

const gatewayUrl = process.env.RESEARCH_GATEWAY_URL;
const token = process.env.RESEARCH_GATEWAY_SMOKE_JWT;
const query = process.env.RESEARCH_GATEWAY_SMOKE_QUERY ?? "OpenAI";
const timeoutMs = Number(process.env.RESEARCH_GATEWAY_SMOKE_TIMEOUT_MS ?? 30_000);

if (!gatewayUrl) {
  console.error("RESEARCH_GATEWAY_URL is required.");
  process.exit(2);
}

const endpoint = new URL("/api/research", gatewayUrl);
const forgedHeaders = {
  "x-internal-tenant-id": "smoke-forged-tenant",
  "x-internal-user-id": "smoke-forged-user",
  "x-internal-request-id": "smoke-forged-request",
  "x-internal-timestamp": "0",
  "x-internal-signature": "smoke-forged-signature",
};

async function request(authorization) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
      ...forgedHeaders,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  return response;
}

const unauthorized = await request();
if (unauthorized.status !== 401) {
  console.error(`Expected an unauthenticated request to return 401, received ${unauthorized.status}.`);
  process.exit(1);
}
console.log("PASS unauthenticated request rejected with 401");

if (!token) {
  console.log("SKIP authenticated SSE check (set RESEARCH_GATEWAY_SMOKE_JWT to enable it)");
  process.exit(0);
}

const authorized = await request(`Bearer ${token}`);
if (!authorized.ok) {
  const body = await authorized.text();
  console.error(`Authenticated request failed with ${authorized.status}: ${body.slice(0, 500)}`);
  process.exit(1);
}

const contentType = authorized.headers.get("content-type") ?? "";
if (!contentType.toLowerCase().includes("text/event-stream")) {
  console.error(`Expected text/event-stream, received ${contentType || "no content-type"}.`);
  process.exit(1);
}

if (!authorized.body) {
  console.error("Authenticated response did not include a stream body.");
  process.exit(1);
}

const reader = authorized.body.getReader();
const first = await reader.read();
await reader.cancel("smoke test received the first SSE chunk");
if (first.done || !first.value?.byteLength) {
  console.error("Authenticated response ended before the first SSE chunk.");
  process.exit(1);
}

console.log(`PASS authenticated SSE response streamed ${first.value.byteLength} bytes before cancellation`);
