// ═══════════════════════════════════════════════════════
// VietQR Registry Adapter (Official Business Tax Lookup)
// ═══════════════════════════════════════════════════════

import {
  RegistryError,
  type RegistryAdapter,
  type RegistryRecord,
} from "./types";

interface VietQrBusinessResponse {
  code?: string;
  desc?: string;
  data?: {
    id?: string;
    name?: string;
    internationalName?: string;
    shortName?: string;
    address?: string;
  };
}

export class VietQrRegistryAdapter implements RegistryAdapter {
  // ponytail: process-local cache only helps warm-instance bursts; move to Supabase at Gate D for cross-instance caching.
  private cache = new Map<string, { record: RegistryRecord; expiresAt: number }>();
  private readonly ttlMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(private readonly timeoutMs = 5_000) {}

  async findByTaxId(taxId: string): Promise<RegistryRecord | null> {
    const cleanTaxId = taxId.trim();
    if (!cleanTaxId) return null;

    // Check cache
    const cached = this.cache.get(cleanTaxId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.record;
    }

    try {
      const url = `https://api.vietqr.io/v2/business/${encodeURIComponent(cleanTaxId)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.status === 404) {
        throw new RegistryError(
          `Business with taxId ${cleanTaxId} not found in VietQR`,
          "not_found",
        );
      }

      if (response.status === 429) {
        throw new RegistryError("VietQR API rate limited", "rate_limited", false);
      }

      if (!response.ok) {
        throw new RegistryError(
          `VietQR upstream error: ${response.status} ${response.statusText}`,
          "upstream_error",
        );
      }

      let data: VietQrBusinessResponse;
      try {
        data = (await response.json()) as VietQrBusinessResponse;
      } catch {
        throw new RegistryError("Failed to parse VietQR response JSON", "invalid_response");
      }

      if (data.code !== "00" || !data.data || !data.data.name) {
        if (data.code === "51" || (data.desc && data.desc.toLowerCase().includes("not found"))) {
          throw new RegistryError(
            `Business with taxId ${cleanTaxId} not found: ${data.desc || data.code}`,
            "not_found",
          );
        }
        throw new RegistryError(
          `VietQR returned error code or invalid data: ${data.code || "missing"}`,
          "invalid_response",
        );
      }

      const record: RegistryRecord = {
        taxId: data.data.id || cleanTaxId,
        name: data.data.name,
        internationalName: data.data.internationalName || undefined,
        shortName: data.data.shortName || undefined,
        address: data.data.address || undefined,
      };

      // Cache valid record
      this.cache.set(cleanTaxId, {
        record,
        expiresAt: Date.now() + this.ttlMs,
      });

      return record;
    } catch (err: unknown) {
      if (err instanceof RegistryError) {
        throw err;
      }

      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError")
      ) {
        throw new RegistryError("VietQR request timed out", "timeout");
      }

      throw new RegistryError(
        `VietQR lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        "upstream_error",
      );
    }
  }
}
