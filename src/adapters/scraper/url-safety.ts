// ═══════════════════════════════════════════════════════
// SSRF & URL Safety Validator
// ═══════════════════════════════════════════════════════

import net from "node:net";
import dns from "node:dns/promises";
import { ScrapeError } from "./types";

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data",
  "169.254.169.254",
]);

/**
 * Validates if an IPv4 or IPv6 address is globally routable / public.
 * Rejects private, loopback, link-local, carrier-grade NAT, multicast,
 * documentation, reserved ranges, and non-2000::/3 IPv6 addresses.
 */
export function isPublicAddress(address: string): boolean {
  const ipFamily = net.isIP(address);
  if (ipFamily === 0) {
    return false;
  }

  if (ipFamily === 4) {
    const parts = address.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return false;
    }

    const [a, b, c] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return false;
    // 10.0.0.0/8 (Private)
    if (a === 10) return false;
    // 100.64.0.0/10 (Shared Address / CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return false;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return false;
    // 169.254.0.0/16 (Link-local)
    if (a === 169 && b === 254) return false;
    // 172.16.0.0/12 (Private)
    if (a === 172 && b >= 16 && b <= 31) return false;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return false;
    // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0 && c === 2) return false;
    // 192.88.99.0/24 (6to4 Relay Anycast)
    if (a === 192 && b === 88 && c === 99) return false;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return false;
    // 198.18.0.0/15 (Benchmarking)
    if (a === 198 && (b === 18 || b === 19)) return false;
    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51 && c === 100) return false;
    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0 && c === 113) return false;
    // 224.0.0.0/4 (Multicast)
    if (a >= 224 && a <= 239) return false;
    // 240.0.0.0/4 (Reserved / Broadcast)
    if (a >= 240) return false;

    return true;
  }

  // IPv6
  const lower = address.toLowerCase();

  // Explicitly reject IPv4-mapped IPv6 and transitions
  if (lower.includes("::ffff:") || lower.includes(".") || lower.startsWith("64:ff9b::")) {
    return false;
  }

  // Expand IPv6
  const groups = expandIpv6(lower);
  if (!groups || groups.length !== 8) {
    return false;
  }

  const [g0, g1] = groups;

  // :: and ::1
  if (groups.slice(0, 7).every((g) => g === 0) && (groups[7] === 0 || groups[7] === 1)) {
    return false;
  }

  // 100::/64 (Discard-only)
  if (g0 === 0x0100) return false;

  // 2001:db8::/32 (Documentation)
  if (g0 === 0x2001 && g1 === 0x0db8) return false;

  // fc00::/7 (Unique local / ULA)
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return false;

  // fe80::/10 (Link-local unicast)
  if (g0 >= 0xfe80 && g0 <= 0xfebf) return false;

  // fec0::/10 (Site-local deprecated)
  if (g0 >= 0xfec0 && g0 <= 0xfeff) return false;

  // ff00::/8 (Multicast)
  if (g0 >= 0xff00) return false;

  // Must be in allocated Global Unicast range 2000::/3 (0x2000 to 0x3fff)
  if (g0 < 0x2000 || g0 > 0x3fff) {
    return false;
  }

  return true;
}

function expandIpv6(ip: string): number[] | null {
  const parts = ip.split("::");
  if (parts.length > 2) return null;

  const left = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];

  if (parts.length === 1 && left.length !== 8) return null;

  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;

  const full = [...left, ...Array(missing).fill("0"), ...right];
  return full.map((h) => parseInt(h || "0", 16));
}

export async function resolvePublicTarget(
  rawUrl: string,
  deadlineAt?: number,
): Promise<ResolvedTarget> {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    throw new ScrapeError("DNS resolution timed out before lookup", "direct", "timeout");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new ScrapeError(`Invalid URL: ${rawUrl}`, "direct", "invalid_target");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new ScrapeError(
      `Unsupported protocol: ${parsedUrl.protocol}`,
      "direct",
      "invalid_target",
    );
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new ScrapeError("Credentials not allowed in target URL", "direct", "invalid_target");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost")
  ) {
    throw new ScrapeError(`Blocked hostname: ${hostname}`, "direct", "invalid_target");
  }

  const cleanIp = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  const isIp = net.isIP(cleanIp);
  if (isIp !== 0) {
    if (!isPublicAddress(cleanIp)) {
      throw new ScrapeError(`Non-public IP address: ${cleanIp}`, "direct", "invalid_target");
    }
    return {
      url: parsedUrl,
      address: cleanIp,
      family: isIp as 4 | 6,
    };
  }

  // Domain lookup with deadline
  let addresses: Array<{ address: string; family: number }>;
  try {
    let lookupPromise = dns.lookup(hostname, { all: true, verbatim: true });
    if (deadlineAt !== undefined) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new ScrapeError("DNS lookup timed out", "direct", "timeout");
      }
      lookupPromise = Promise.race([
        lookupPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new ScrapeError("DNS lookup timed out", "direct", "timeout")),
            remainingMs,
          ),
        ),
      ]);
    }
    addresses = await lookupPromise;
  } catch (err: unknown) {
    if (err instanceof ScrapeError) {
      throw err;
    }
    throw new ScrapeError(
      `DNS lookup failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
      "direct",
      "invalid_target",
    );
  }

  if (!addresses || addresses.length === 0) {
    throw new ScrapeError(`DNS returned no addresses for ${hostname}`, "direct", "invalid_target");
  }

  // Reject if any returned address is non-public
  for (const entry of addresses) {
    if (!isPublicAddress(entry.address)) {
      throw new ScrapeError(
        `DNS returned non-public IP ${entry.address} for ${hostname}`,
        "direct",
        "invalid_target",
      );
    }
  }

  return {
    url: parsedUrl,
    address: addresses[0].address,
    family: addresses[0].family as 4 | 6,
  };
}
