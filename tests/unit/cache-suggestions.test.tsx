import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { CacheSuggestions } from "@/app/components/cache-suggestions";
import type { CacheSuggestion } from "@/lib/types";

describe("CacheSuggestions Component", () => {
  const mockSuggestions: CacheSuggestion[] = [
    {
      companyId: "comp-fpt",
      officialName: "Công ty Cổ phần FPT",
      taxId: "0101248141",
      domain: "fpt.com.vn",
      lastSyncedAt: "2026-08-26T08:00:00.000Z",
    },
    {
      companyId: "comp-vin",
      officialName: "Tập đoàn Vingroup",
      taxId: "0101245486",
      domain: "vingroup.net",
      lastSyncedAt: "2026-08-25T12:00:00.000Z",
    },
  ];

  it("renders suggestions list with names, tax IDs, and domains", () => {
    const onSelect = vi.fn();
    const onBypass = vi.fn();

    const html = renderToString(
      <CacheSuggestions
        suggestions={mockSuggestions}
        onSelect={onSelect}
        onBypass={onBypass}
      />
    );

    expect(html).toContain("Công ty Cổ phần FPT");
    expect(html).toContain("0101248141");
    expect(html).toContain("fpt.com.vn");
    expect(html).toContain("Tập đoàn Vingroup");
    expect(html).toContain("0101245486");
    expect(html).toContain("vingroup.net");
    expect(html).toContain("Nghiên cứu mới (Bỏ qua cache)");
  });

  it("renders null when suggestions list is empty", () => {
    const html = renderToString(
      <CacheSuggestions
        suggestions={[]}
        onSelect={vi.fn()}
        onBypass={vi.fn()}
      />
    );

    expect(html).toBe("");
  });
});
