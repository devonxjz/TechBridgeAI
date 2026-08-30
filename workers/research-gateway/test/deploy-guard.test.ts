import { describe, expect, it } from "vitest";

import { isPlaceholderUrl } from "../src/config";

describe("deployment placeholders", () => {
  it("identifies committed placeholder URLs", () => {
    expect(isPlaceholderUrl("https://replace-production-origin.invalid")).toBe(true);
    expect(isPlaceholderUrl("https://replace-production.supabase.co")).toBe(true);
    expect(isPlaceholderUrl("https://origin.example.com")).toBe(false);
  });
});
