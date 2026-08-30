import { describe, expect, it } from "vitest";
import { toPublicResearchError } from "@/lib/public-api-error";

describe("public research error mapping", () => {
  it("does not expose internal exception details", () => {
    const result = toPublicResearchError(new Error("Supabase schema cache: secret details"));

    expect(result).toEqual({
      code: "internal_error",
      message: "Nghiên cứu tạm thời không khả dụng.",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret details");
  });

  it("preserves known public errors", () => {
    expect(toPublicResearchError(new Error("identity_conflict"))).toEqual({
      code: "identity_conflict",
      message: "Thông tin định danh công ty mâu thuẫn.",
      retryable: false,
    });
  });
});
