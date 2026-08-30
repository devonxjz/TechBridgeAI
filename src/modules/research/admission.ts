import crypto from "node:crypto";

export type AdmissionErrorCode =
  | "concurrency_limited"
  | "daily_research_limited"
  | "daily_tokens_limited"
  | "invalid_reservation";

export class AdmissionError extends Error {
  constructor(readonly code: AdmissionErrorCode) {
    super(code);
    this.name = "AdmissionError";
  }
}

export interface AdmissionLease {
  leaseId: string;
  principalId: string;
  estimatedTokens: number;
}

export interface AdmissionController {
  reserve(principalId: string, estimatedResearches: number, estimatedTokens: number): Promise<AdmissionLease>;
  release(leaseId: string): Promise<void>;
}

export interface AdmissionLimits {
  maxConcurrent: number;
  maxPerDay: number;
  maxTokensPerDay: number;
}

export function createAdmissionController(limits: AdmissionLimits): AdmissionController {
  const leases = new Map<string, AdmissionLease>();
  let reservedResearches = 0;
  let reservedTokens = 0;

  return {
    async reserve(principalId, estimatedResearches, estimatedTokens) {
      if (estimatedResearches <= 0 || estimatedTokens <= 0) {
        throw new AdmissionError("invalid_reservation");
      }
      if (reservedResearches + estimatedResearches > limits.maxPerDay) {
        throw new AdmissionError("daily_research_limited");
      }
      if (reservedTokens + estimatedTokens > limits.maxTokensPerDay) {
        throw new AdmissionError("daily_tokens_limited");
      }
      if (leases.size >= limits.maxConcurrent) {
        throw new AdmissionError("concurrency_limited");
      }

      const lease = {
        leaseId: crypto.randomUUID(),
        principalId,
        estimatedTokens,
      };
      leases.set(lease.leaseId, lease);
      reservedResearches += estimatedResearches;
      reservedTokens += estimatedTokens;
      return lease;
    },

    async release(leaseId) {
      const lease = leases.get(leaseId);
      if (!lease) return;
      leases.delete(leaseId);
      reservedResearches -= 1;
      reservedTokens -= lease.estimatedTokens;
    },
  };
}
