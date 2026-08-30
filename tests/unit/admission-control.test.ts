import { describe, expect, it } from "vitest";
import { createAdmissionController } from "@/modules/research/admission";

describe("research admission controller", () => {
  it("rejects a second concurrent lease and releases the first", async () => {
    const admission = createAdmissionController({ maxConcurrent: 1, maxPerDay: 2, maxTokensPerDay: 100 });
    const first = await admission.reserve("tenant-a", 1, 40);

    await expect(admission.reserve("tenant-a", 1, 40)).rejects.toMatchObject({ code: "concurrency_limited" });

    await admission.release(first.leaseId);
    const second = await admission.reserve("tenant-a", 1, 40);
    expect(second.leaseId).not.toBe(first.leaseId);
  });

  it("rejects reservations over daily research or token quotas", async () => {
    const admission = createAdmissionController({ maxConcurrent: 2, maxPerDay: 2, maxTokensPerDay: 100 });
    await admission.reserve("tenant-a", 1, 100);

    await expect(admission.reserve("tenant-a", 1, 1)).rejects.toMatchObject({ code: "daily_tokens_limited" });
  });

  it("rejects invalid reservation amounts", async () => {
    const admission = createAdmissionController({ maxConcurrent: 1, maxPerDay: 2, maxTokensPerDay: 100 });

    await expect(admission.reserve("tenant-a", 0, 10)).rejects.toMatchObject({ code: "invalid_reservation" });
    await expect(admission.reserve("tenant-a", 1, 0)).rejects.toMatchObject({ code: "invalid_reservation" });
  });
});
