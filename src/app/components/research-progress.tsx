"use client";

import type { SourceStatus } from "../hooks/use-research";
import type { SourceName } from "@/lib/types";

const SOURCE_LABELS: Record<SourceName, { label: string; icon: string }> = {
  web_search: { label: "Tìm kiếm web", icon: "🔍" },
  website: { label: "Website công ty", icon: "🌐" },
  news: { label: "Tin tức", icon: "📰" },
  registry: { label: "Đăng ký kinh doanh", icon: "🏛️" },
  linkedin: { label: "LinkedIn", icon: "💼" },
};

interface ResearchProgressProps {
  sourceStatuses: Record<SourceName, SourceStatus>;
  findings: { source: SourceName; summary: string }[];
  status: string;
}

export function ResearchProgress({
  sourceStatuses,
  findings,
  status,
}: ResearchProgressProps) {
  const activeSources = Object.entries(sourceStatuses).filter(
    ([, s]) => s !== "idle"
  ) as [SourceName, SourceStatus][];

  if (activeSources.length === 0 && status === "idle") return null;

  return (
    <div className="glass-card p-6 space-y-4 animate-fade-in">
      <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">
        Tiến trình nghiên cứu
      </h3>

      <div className="space-y-3">
        {activeSources.map(([source, sourceStatus], i) => (
          <div
            key={source}
            className="flex items-center gap-3 animate-slide-in"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <StatusIcon status={sourceStatus} />
            <span className="text-sm">
              {SOURCE_LABELS[source]?.icon}{" "}
              {SOURCE_LABELS[source]?.label ?? source}
            </span>
            <span className="text-xs text-muted ml-auto">
              {sourceStatus === "started" && "Đang xử lý..."}
              {sourceStatus === "done" && (
                <span className="text-success">
                  ✓ {findings.filter((f) => f.source === source).length} kết quả
                </span>
              )}
              {sourceStatus === "failed" && (
                <span className="text-error">✗ Thất bại</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {status === "building" && (
        <div className="flex items-center gap-2 pt-2 border-t border-card-border animate-fade-in">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
          <span className="text-sm text-accent-light">
            Đang tổng hợp hồ sơ bằng AI...
          </span>
        </div>
      )}

      {/* Findings log */}
      {findings.length > 0 && (
        <details className="pt-2 border-t border-card-border">
          <summary className="text-xs text-muted cursor-pointer hover:text-foreground transition-colors">
            Xem {findings.length} phát hiện chi tiết
          </summary>
          <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
            {findings.map((f, i) => (
              <div
                key={i}
                className="text-xs text-muted/70 bg-surface rounded-lg px-3 py-2 font-mono"
              >
                <span className="text-accent-light">[{f.source}]</span>{" "}
                {f.summary.slice(0, 120)}...
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: SourceStatus }) {
  switch (status) {
    case "started":
      return (
        <div className="w-5 h-5 flex items-center justify-center">
          <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
        </div>
      );
    case "done":
      return (
        <div className="w-5 h-5 flex items-center justify-center text-success">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    case "failed":
      return (
        <div className="w-5 h-5 flex items-center justify-center text-error">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
    default:
      return <div className="w-5 h-5 rounded-full bg-card-border" />;
  }
}
