"use client";

import { useEffect } from "react";
import type { SourceCitation } from "@/lib/types";

interface SourcePreviewDialogProps {
  citation: SourceCitation | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SourcePreviewDialog({
  citation,
  isOpen,
  onClose,
}: SourcePreviewDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !citation) return null;

  const publisher =
    citation.publication?.publisherName ||
    citation.publication?.publisherDomain ||
    "Nguồn chưa xác định";

  const authors = citation.publication?.authors || [];
  const publishedDate = citation.publication?.publishedAt
    ? new Date(citation.publication.publishedAt).toLocaleDateString("vi-VN")
    : citation.publication?.publishedLabel || null;

  const isPaywall =
    citation.previewPolicy?.paywallDetected ||
    citation.previewPolicy?.isAccessibleForFree === false;

  const isMetadataOnly = citation.previewPolicy?.mode === "metadata_only";
  const fetchMethodLabel =
    citation.fetchMethod === "server_extract"
      ? "Trích xuất toàn văn"
      : "Đoạn trích tìm kiếm";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-card-border bg-[#0f172a]/95 text-foreground animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-card-border/80 flex items-start justify-between gap-4 bg-gradient-to-r from-accent/15 via-purple-500/10 to-transparent">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded bg-accent/20 text-accent-light border border-accent/30">
                {citation.source}
              </span>
              {citation.signals?.primarySource && (
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Nguồn chính thức
                </span>
              )}
              {citation.signals?.duplicateClusterSize &&
                citation.signals.duplicateClusterSize > 1 && (
                  <span className="px-2 py-0.5 text-[11px] rounded bg-surface text-muted border border-card-border">
                    {`${citation.signals.duplicateClusterSize} bản sao chép`}
                  </span>
                )}
            </div>
            <h3
              id="source-preview-title"
              className="text-lg font-bold text-foreground leading-snug line-clamp-2"
            >
              {citation.title || citation.publication?.title || citation.url}
            </h3>
            <p className="text-xs text-muted flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Nhà xuất bản: <strong className="text-foreground/90">{publisher}</strong></span>
              {authors.length > 0 && (
                <span>Tác giả: <strong className="text-foreground/90">{authors.join(", ")}</strong></span>
              )}
              {publishedDate && (
                <span>Ngày đăng: <strong className="text-foreground/90">{publishedDate}</strong></span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="p-1.5 text-muted hover:text-foreground rounded-lg hover:bg-surface border border-transparent hover:border-card-border transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        {/* Policy Notices */}
        <div className="px-5 pt-4 space-y-2">
          {isPaywall && (
            <div className="px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
              <span>⚠️</span>
              <span>
                <strong>Tường phí (Paywall):</strong> Bài viết có thể bị giới hạn truy cập. Hệ thống tôn trọng quyền của nhà xuất bản.
              </span>
            </div>
          )}

          {isMetadataOnly && (
            <div className="px-3.5 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs flex items-center gap-2">
              <span>ℹ️</span>
              <span>
                <strong>Chỉ hiển thị siêu dữ liệu:</strong> Theo chỉ thị bản quyền hoặc robots.txt của nguồn.
              </span>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div>
            <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Đoạn trích nội dung ({fetchMethodLabel})
            </h4>
            <div className="p-4 rounded-xl bg-surface/90 border border-card-border/60 text-sm text-foreground/90 leading-relaxed font-sans whitespace-pre-wrap selection:bg-accent/30">
              {citation.excerpt || citation.snippet || "Không có đoạn trích khả dụng."}
            </div>
          </div>

          {citation.fieldsContributed && citation.fieldsContributed.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Thông tin được hỗ trợ kiểm chứng
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {citation.fieldsContributed.map((field) => (
                  <span
                    key={field}
                    className="px-2.5 py-1 text-xs rounded-md bg-accent/10 text-accent-light border border-accent/20"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-card-border/80 bg-surface/60 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted truncate max-w-[60%]">
            URL gốc: {citation.url}
          </span>
          <div className="flex items-center gap-2">
            <a
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white hover:bg-accent-light transition-all flex items-center gap-1 shadow-md shadow-accent/20"
            >
              Mở trang gốc ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
