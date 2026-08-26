// ═══════════════════════════════════════════════════════
// Registry Adapter — Types & Interface
// ═══════════════════════════════════════════════════════

export interface RegistryRecord {
  taxId: string;
  name: string;
  internationalName?: string;
  shortName?: string;
  address?: string;
}

export type RegistryErrorCode =
  | "timeout"
  | "rate_limited"
  | "not_found"
  | "invalid_response"
  | "upstream_error";

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly code: RegistryErrorCode,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export interface RegistryAdapter {
  findByTaxId(
    taxId: string,
    options?: { signal?: AbortSignal },
  ): Promise<RegistryRecord | null>;
}
