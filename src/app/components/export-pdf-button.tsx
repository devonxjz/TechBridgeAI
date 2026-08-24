"use client";

import { useState } from "react";
import type { CompanyProfile, AnalysisReport } from "@/lib/types";
import { mapToPdfPayload, buildPdfFilename } from "@/lib/export-pdf";

export interface ExportPdfButtonProps {
  profile: CompanyProfile;
  report?: AnalysisReport | null;
}

export function ExportPdfButton({ profile, report }: ExportPdfButtonProps) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canExport = Boolean(
    report?.fitScore &&
      Array.isArray(report.fitScore.criteria) &&
      report.fitScore.criteria.length === 5,
  );

  const handleExportPdf = async () => {
    if (!canExport || !report) return;

    setErrorMessage(null);
    setLoading(true);

    try {
      const [{ pdf }, { CompanyOnePager, registerPdfFonts }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./pdf/company-one-pager"),
      ]);

      registerPdfFonts("/fonts");

      const exportedAt = new Date();
      const payload = mapToPdfPayload(profile, report, exportedAt);
      const filename = buildPdfFilename(payload.companyName, exportedAt);

      const blob = await pdf(<CompanyOnePager payload={payload} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
      setErrorMessage("Không thể tạo PDF. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative inline-flex flex-col items-start">
      <button
        type="button"
        onClick={handleExportPdf}
        disabled={!canExport || loading}
        aria-live="polite"
        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all flex items-center gap-1.5 active:scale-95 ${
          !canExport
            ? "bg-surface/50 text-muted/50 border-card-border/50 cursor-not-allowed"
            : loading
            ? "bg-accent/20 text-accent-light border-accent/30 cursor-wait animate-pulse"
            : "bg-surface hover:bg-card-border text-accent-light border-card-border hover:border-accent/40 shadow-sm"
        }`}
        title={
          canExport
            ? "Xuất hồ sơ doanh nghiệp thành PDF A4 1 trang"
            : "Cần hoàn thành phân tích với đủ 5 tiêu chí để xuất PDF"
        }
      >
        {/* Inline PDF document icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-3.5 h-3.5 shrink-0"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 011.5 0v3.25h1.25a.75.75 0 010 1.5h-3.5a.75.75 0 010-1.5h1.25V8.75z"
            clipRule="evenodd"
          />
        </svg>
        <span>{loading ? "Đang tạo PDF…" : "Xuất PDF"}</span>
      </button>

      {errorMessage && (
        <div
          role="alert"
          className="absolute top-full left-0 mt-1.5 z-20 px-2.5 py-1 text-[11px] text-error bg-surface border border-error/30 rounded-md shadow-lg whitespace-nowrap"
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
