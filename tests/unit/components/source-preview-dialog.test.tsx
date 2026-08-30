import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { SourcePreviewDialog } from "@/app/components/source-preview-dialog";
import type { SourceCitation } from "@/lib/types";

describe("SourcePreviewDialog Component", () => {
  const sampleCitation: SourceCitation = {
    source: "news",
    url: "https://vnexpress.net/fpt-doanh-thu-tang-truong-2026",
    accessedAt: new Date("2026-08-25T10:00:00Z"),
    fieldsContributed: ["officialName", "revenue"],
    title: "FPT đạt doanh thu kỷ lục quý 3",
    snippet: "Đoạn trích tóm tắt",
    publication: {
      title: "FPT đạt doanh thu kỷ lục quý 3",
      publisherName: "VnExpress",
      publisherDomain: "vnexpress.net",
      authors: ["Nguyễn Văn A", "Trần Thị B"],
      publishedAt: "2026-08-24T08:00:00.000Z",
    },
    previewPolicy: {
      mode: "short_excerpt",
      paywallDetected: true,
      isAccessibleForFree: false,
      robotsDecision: "allowed",
    },
    signals: {
      primarySource: false,
      publisherIdentified: true,
      authorIdentified: true,
      publicationDateIdentified: true,
      duplicateClusterSize: 2,
    },
    excerpt: "Nội dung trích xuất toàn văn về tình hình tăng trưởng của tập đoàn FPT trong quý 3.",
    fetchMethod: "server_extract",
  };

  it("renders publication title, publisher, authors, and excerpt when open", () => {
    const html = renderToString(
      <SourcePreviewDialog
        citation={sampleCitation}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain("FPT đạt doanh thu kỷ lục quý 3");
    expect(html).toContain("VnExpress");
    expect(html).toContain("Nguyễn Văn A, Trần Thị B");
    expect(html).toContain("Nội dung trích xuất toàn văn");
    expect(html).toContain("Tường phí (Paywall)");
    expect(html).toContain("Trích xuất toàn văn");
    expect(html).toContain("2 bản sao chép");
  });

  it("renders metadata_only banner when previewPolicy mode is metadata_only", () => {
    const metadataOnlyCitation: SourceCitation = {
      ...sampleCitation,
      previewPolicy: {
        mode: "metadata_only",
        paywallDetected: false,
        robotsDecision: "allowed",
      },
    };

    const html = renderToString(
      <SourcePreviewDialog
        citation={metadataOnlyCitation}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain("Chỉ hiển thị siêu dữ liệu");
  });

  it("renders null when isOpen is false or citation is null", () => {
    const htmlClosed = renderToString(
      <SourcePreviewDialog
        citation={sampleCitation}
        isOpen={false}
        onClose={vi.fn()}
      />
    );
    expect(htmlClosed).toBe("");

    const htmlNull = renderToString(
      <SourcePreviewDialog
        citation={null}
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    expect(htmlNull).toBe("");
  });
});
