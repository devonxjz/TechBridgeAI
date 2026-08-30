import { handleResearch } from "@/server/research/handler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleResearch(request);
}
