"use client";

import type { SourceCitation } from "@/lib/types";

interface SourceListSectionProps {
  sources: SourceCitation[];
  onOpenPreview: (citation: SourceCitation) => void;
}

export function SourceListSection({ sources, onOpenPreview }: SourceListSectionProps) {
  if (sources.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
        Nguồn dữ liệu & Kiểm chứng trích dẫn
      </h3>
      <div className="space-y-2">
        {sources.map((src, i) => {
          const pubName = src.publication?.publisherName || src.publication?.publisherDomain;
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-surface/70 hover:bg-card-border/50 border border-card-border/40 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span className="text-xs text-accent/60">🔗</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground truncate">
                      {src.title || src.url}
                    </span>
                    {src.signals?.primarySource && (
                      <span className="px-1.5 py-0.2 text-[10px] font-semibold rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                        Chính thức
                      </span>
                    )}
                    {src.previewPolicy?.paywallDetected && (
                      <span className="px-1.5 py-0.2 text-[10px] rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                        Paywall
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted truncate">
                    {pubName ? `${pubName} • ` : ""}{src.url}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenPreview(src)}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md bg-accent/15 text-accent-light hover:bg-accent/25 border border-accent/30 transition-all cursor-pointer"
                >
                  Xem nguồn
                </button>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 text-xs text-muted hover:text-foreground"
                  title="Mở tab mới"
                >
                  ↗
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
