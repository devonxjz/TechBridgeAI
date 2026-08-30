import { describe, expect, it, vi } from "vitest";
import { retryDelayMs, getRetryAfterMs } from "@/modules/workflow";

describe("source retry backoff", () => {
  it("grows exponentially and respects the configured cap", () => {
    expect(retryDelayMs(1, 1000, 0)).toBe(1000);
    expect(retryDelayMs(2, 1000, 0)).toBe(2000);
    expect(retryDelayMs(3, 1000, 0)).toBe(4000);
    expect(retryDelayMs(10, 1000, 0)).toBe(30000);
  });

  it("adds bounded jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(retryDelayMs(1, 1000, 0.2)).toBeGreaterThan(1000);
    expect(retryDelayMs(1, 1000, 0.2)).toBeLessThanOrEqual(1200);
    vi.restoreAllMocks();
  });

  it("parses Retry-After seconds and HTTP-date values", () => {
    expect(getRetryAfterMs("3", 1000)).toBe(3000);
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(getRetryAfterMs("Thu, 01 Jan 2026 00:00:05 GMT", now)).toBe(5000);
    expect(getRetryAfterMs("invalid", now)).toBeUndefined();
  });
});
