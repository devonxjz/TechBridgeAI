import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { EvidenceBadge } from "@/app/components/evidence-badge";
import { ProfileCard } from "@/app/components/profile-card";
import type { CompanyProfile, AnalysisReport } from "@/lib/types";

describe("EvidenceBadge & Field Provenance UI", () => {
  it("renders appropriate status labels and styles across verification states", () => {
    const primaryHtml = renderToString(
      <EvidenceBadge
        evidence={{
          status: "primary_source",
          independentPublisherCount: 1,
          supportingUrls: ["https://api.vietqr.io/mst"],
          conflictingUrls: [],
        }}
      />
    );
    expect(primaryHtml).toContain("Nguồn chính thức");

    const corroboratedHtml = renderToString(
      <EvidenceBadge
        evidence={{
          status: "corroborated",
          independentPublisherCount: 3,
          supportingUrls: ["https://site1.com", "https://site2.com", "https://site3.com"],
          conflictingUrls: [],
        }}
      />
    );
    expect(corroboratedHtml).toContain("Kiểm chứng chéo (3 nguồn)");

    const conflictHtml = renderToString(
      <EvidenceBadge
        evidence={{
          status: "conflicting",
          independentPublisherCount: 1,
          supportingUrls: ["https://site1.com"],
          conflictingUrls: ["https://site2.com"],
        }}
      />
    );
    expect(conflictHtml).toContain("Có mâu thuẫn");
  });

  it("renders field evidence badges inside ProfileCard for verified fields", () => {
    const profile: CompanyProfile = {
      id: "fpt-corp",
      version: 1,
      createdAt: new Date("2026-01-01"),
      lastUpdated: new Date("2026-01-01"),
      input: { name: "FPT" },
      officialName: "CÔNG TY CỔ PHẦN FPT",
      tradingNames: ["FPT Corp"],
      taxId: "0101248141",
      industry: ["CNTT"],
      description: "Tập đoàn công nghệ",
      keyPeople: [],
      products: [],
      markets: [],
      recentActivities: [],
      sources: [
        {
          source: "registry",
          url: "https://api.vietqr.io/mst",
          accessedAt: new Date(),
          fieldsContributed: ["officialName", "taxId"],
          publication: { publisherDomain: "vietqr.io", authors: [] },
          signals: {
            primarySource: true,
            publisherIdentified: true,
            authorIdentified: false,
            publicationDateIdentified: false,
            duplicateClusterSize: 1,
          },
        },
      ],
      fieldEvidence: {
        officialName: {
          status: "primary_source",
          independentPublisherCount: 1,
          supportingUrls: ["https://api.vietqr.io/mst"],
          conflictingUrls: [],
        },
        taxId: {
          status: "primary_source",
          independentPublisherCount: 1,
          supportingUrls: ["https://api.vietqr.io/mst"],
          conflictingUrls: [],
        },
      },
      overallConfidence: 0.95,
    };

    const html = renderToString(
      <ProfileCard profile={profile} diff={null} report={null} />
    );

    expect(html).toContain("Nguồn chính thức");
    expect(html).toContain("Nguồn dữ liệu &amp; Kiểm chứng trích dẫn");
    expect(html).toContain("Xem nguồn");
  });
});
