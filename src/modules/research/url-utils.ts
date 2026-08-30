// ═══════════════════════════════════════════════════════
// URL Utilities
// Shared functions for canonicalization, parsing, and hostname extraction.
// ═══════════════════════════════════════════════════════

export function getHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

export function isValidHttpUrl(rawUrl: string): boolean {
  if (typeof URL.canParse === "function") {
    if (!URL.canParse(rawUrl)) return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function canonicalizeUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveHttpUrl(target: string, base: string): string | undefined {
  try {
    const resolved = new URL(target, base).toString();
    if (isValidHttpUrl(resolved)) {
      return resolved;
    }
  } catch {
    // Ignore invalid URL
  }
  return undefined;
}
