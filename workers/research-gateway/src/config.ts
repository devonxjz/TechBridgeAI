export const RESEARCH_PATH = "/api/research";
export const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPlaceholderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.includes("replace-") || url.hostname.endsWith(".invalid");
  } catch {
    return true;
  }
}

export function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function assertRuntimeConfig(env: Env): void {
  if (isPlaceholderUrl(env.ORIGIN_URL) || isPlaceholderUrl(env.SUPABASE_URL)) {
    throw new Error("placeholder_configuration");
  }

  const origin = new URL(env.ORIGIN_URL);
  const supabase = new URL(env.SUPABASE_URL);
  if (
    origin.protocol !== "https:" ||
    supabase.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    supabase.username ||
    supabase.password ||
    !supabase.hostname.endsWith(".supabase.co")
  ) {
    throw new Error("insecure_configuration");
  }

  if (
    !env.SUPABASE_API_KEY ||
    !env.GATEWAY_SIGNING_KEY ||
    env.SUPABASE_API_KEY === "WORKER_SECRET_REQUIRED" ||
    env.GATEWAY_SIGNING_KEY === "WORKER_SECRET_REQUIRED" ||
    env.GATEWAY_SIGNING_KEY.length < 32
  ) {
    throw new Error("missing_secret");
  }

  if (parsePositiveInteger(env.REPLAY_WINDOW_SECONDS, 0) !== 60) {
    throw new Error("invalid_replay_window");
  }
}
