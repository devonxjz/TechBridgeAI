"use client";

import type { AnalysisReport } from "@/lib/types";
import { EvidenceBadge } from "./evidence-badge";

interface FitScoreSectionProps {
  report: AnalysisReport;
  onOpenPreview: (url: string) => void;
}

export function FitScoreSection({ report, onOpenPreview }: FitScoreSectionProps) {
  if (!report.fitScore) return null;

  return (
    <div className="glass-card p-5 bg-gradient-to-br from-surface/80 to-accent/5 border border-accent/20 rounded-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-card-border pb-3">
        <div className="flex items-center gap-3">
          <FitScoreGauge score={report.fitScore.score} />
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Điểm Tiềm năng Hợp tác (Collaboration Fit)
            </h3>
            <p className="text-xs text-muted mt-0.5">
              {report.fitScore.reasoning}
            </p>
          </div>
        </div>
      </div>

      {/* Criteria Breakdown (5 Core Criteria) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        {report.fitScore.criteria.map((c) => (
          <div
            key={c.name}
            className="bg-surface/90 rounded-lg p-3 border border-card-border hover:border-accent/40 transition-all block group"
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold text-foreground/90 group-hover:text-accent-light flex items-center gap-1">
                {c.name} <span className="text-muted/60">({Math.round(c.weight * 100)}%)</span>
              </span>
              <div className="flex items-center gap-2">
                {c.evidence && (
                  <EvidenceBadge
                    evidence={c.evidence}
                    onClick={() => {
                      if (c.evidence?.supportingUrls[0]) {
                        onOpenPreview(c.evidence.supportingUrls[0]);
                      }
                    }}
                  />
                )}
                <span className={`font-bold ${c.score >= 80 ? "text-success" : c.score >= 60 ? "text-warning" : "text-error"}`}>
                  {c.score}/100
                </span>
              </div>
            </div>
            <div className="w-full h-1.5 bg-card-border rounded-full overflow-hidden mb-2">
              <div
                className={`h-full rounded-full ${
                  c.score >= 80
                    ? "bg-success"
                    : c.score >= 60
                      ? "bg-warning"
                      : "bg-error"
                }`}
                style={{ width: `${c.score}%` }}
              />
            </div>
            <p className="text-xs text-muted leading-relaxed">
              {c.reasoning}
            </p>
          </div>
        ))}
      </div>

      {/* Executive Summary */}
      {report.executiveSummary && (
        <div className="pt-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            Nhận định chuyên gia (Executive Summary)
          </p>
          <div className="text-xs text-foreground/80 leading-relaxed bg-surface/70 rounded-lg p-3 border border-card-border">
            {report.executiveSummary}
          </div>
        </div>
      )}

      {/* Risk Flags & Suggested Actions Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
        {/* Risk Flags */}
        {report.riskFlags.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Cảnh báo rủi ro ({report.riskFlags.length})
            </p>
            <div className="space-y-2">
              {report.riskFlags.map((rf, i) => (
                <div
                  key={i}
                  className={`text-xs p-2.5 rounded-lg border-l-2 bg-surface/80 transition-all ${
                    rf.severity === "high"
                      ? "border-l-error text-error/90"
                      : rf.severity === "medium"
                        ? "border-l-warning text-warning/90"
                        : "border-l-muted text-muted"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold uppercase tracking-wider text-[10px] block">
                      [{rf.type}] {rf.severity}
                    </span>
                    {rf.evidence && (
                      <EvidenceBadge
                        evidence={rf.evidence}
                        onClick={() => {
                          if (rf.evidence?.supportingUrls[0]) {
                            onOpenPreview(rf.evidence.supportingUrls[0]);
                          }
                        }}
                      />
                    )}
                  </div>
                  <span className="block mt-0.5">{rf.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Actions */}
        {report.suggestedActions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Gợi ý hành động tiếp cận ({report.suggestedActions.length})
            </p>
            <div className="space-y-2">
              {report.suggestedActions.map((sa, i) => (
                <div
                  key={i}
                  className="text-xs p-2.5 rounded-lg bg-surface/80 border border-card-border transition-all"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.2 text-[10px] font-bold rounded uppercase ${
                          sa.priority === "high"
                            ? "bg-accent/20 text-accent-light"
                            : "bg-card-border text-muted"
                        }`}
                      >
                        {sa.priority}
                      </span>
                      <span className="font-semibold text-foreground">
                        {sa.action}
                      </span>
                    </div>
                    {sa.evidence && (
                      <EvidenceBadge
                        evidence={sa.evidence}
                        onClick={() => {
                          if (sa.evidence?.supportingUrls[0]) {
                            onOpenPreview(sa.evidence.supportingUrls[0]);
                          }
                        }}
                      />
                    )}
                  </div>
                  <p className="text-muted leading-relaxed">{sa.reasoning}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FitScoreGauge({ score }: { score: number }) {
  const colorClass =
    score >= 80
      ? "from-emerald-500 to-teal-400 text-emerald-400"
      : score >= 60
        ? "from-amber-500 to-yellow-400 text-amber-400"
        : "from-rose-500 to-red-400 text-rose-400";

  return (
    <div className="relative w-12 h-12 flex items-center justify-center rounded-xl bg-surface border border-card-border">
      <span className={`text-base font-extrabold ${colorClass.split(" ")[2]}`}>
        {score}
      </span>
    </div>
  );
}
