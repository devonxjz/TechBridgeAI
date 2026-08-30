import { createStorageAdapter } from "@/config";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    createStorageAdapter();
    return Response.json(
      { status: "ready" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "not_ready" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
