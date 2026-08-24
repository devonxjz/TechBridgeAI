"use client";

import { useState } from "react";
import type { CompanyProfile, ProfileDiff, AnalysisReport } from "@/lib/types";
import { exportProfileToMarkdown, exportProfileToJSON } from "@/lib/export";
import { ExportPdfButton } from "./export-pdf-button";

interface ProfileCardProps {
  profile: CompanyProfile;
  diff: ProfileDiff | null;
  report?: AnalysisReport | null;
}

export function ProfileCard({ profile, diff, report }: ProfileCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = async () => {
    const md = exportProfileToMarkdown(profile, report, diff);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMarkdown = () => {
    const md = exportProfileToMarkdown(profile, report, diff);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${profile.id}-profile.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJSON = () => {
    const jsonStr = exportProfileToJSON(profile, report, diff);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${profile.id}-profile.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="glass-card overflow-hidden animate-fade-in space-y-0">
      {/* Header */}
      <div className="p-6 border-b border-card-border bg-gradient-to-r from-accent/10 via-purple-500/5 to-transparent">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-2xl font-bold gradient-text">
                {profile.officialName}
              </h2>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-md bg-accent/20 text-accent-light border border-accent/30">
                v{profile.version}
              </span>
            </div>
            {profile.tradingNames.length > 0 && (
              <p className="text-sm text-muted mt-1">
                Còn gọi là: {profile.tradingNames.join(", ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ConfidenceBadge confidence={profile.overallConfidence} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-card-border/50">
          <div className="flex flex-wrap gap-2">
            {profile.industry.map((ind) => (
              <span
                key={ind}
                className="px-2.5 py-0.5 text-xs font-medium bg-accent/10 text-accent-light
                           rounded-full border border-accent/20"
              >
                {ind}
              </span>
            ))}
          </div>

          {/* Export Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <ExportPdfButton profile={profile} report={report} />
            <button
              onClick={handleCopyMarkdown}
              className="px-3 py-1.5 text-xs font-medium bg-surface hover:bg-card-border
                         text-foreground rounded-lg border border-card-border
                         transition-colors flex items-center gap-1.5 active:scale-95"
              title="Sao chép Markdown vào clipboard"
            >
              {copied ? "✓ Đã sao chép!" : "📋 Copy .md"}
            </button>
            <button
              onClick={handleDownloadMarkdown}
              className="px-3 py-1.5 text-xs font-medium bg-surface hover:bg-card-border
                         text-accent-light rounded-lg border border-card-border
                         transition-colors flex items-center gap-1.5 active:scale-95"
              title="Tải tệp Markdown"
            >
              ⬇️ Tải .md
            </button>
            <button
              onClick={handleDownloadJSON}
              className="px-3 py-1.5 text-xs font-medium bg-surface hover:bg-card-border
                         text-muted hover:text-foreground rounded-lg border border-card-border
                         transition-colors flex items-center gap-1.5 active:scale-95"
              title="Tải tệp JSON"
            >
              {} Tải JSON
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-6">
        {/* ─── Collaboration Fit Score (Analyst Module) ─── */}
        {report && report.fitScore && (
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
                <div key={c.name} className="bg-surface/90 rounded-lg p-3 border border-card-border">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-foreground/90">
                      {c.name} <span className="text-muted/60">({Math.round(c.weight * 100)}%)</span>
                    </span>
                    <span className={`font-bold ${c.score >= 80 ? "text-success" : c.score >= 60 ? "text-warning" : "text-error"}`}>
                      {c.score}/100
                    </span>
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
                <p className="text-xs text-foreground/80 leading-relaxed bg-surface/70 rounded-lg p-3 border border-card-border">
                  {report.executiveSummary}
                </p>
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
                        className={`text-xs p-2.5 rounded-lg border-l-2 bg-surface/80 ${
                          rf.severity === "high"
                            ? "border-l-error text-error/90"
                            : rf.severity === "medium"
                              ? "border-l-warning text-warning/90"
                              : "border-l-muted text-muted"
                        }`}
                      >
                        <span className="font-semibold uppercase tracking-wider text-[10px] block">
                          [{rf.type}] {rf.severity}
                        </span>
                        {rf.description}
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
                        className="text-xs p-2.5 rounded-lg bg-surface/80 border border-card-border"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className={`px-1.5 py-0.2 text-[10px] font-bold rounded uppercase ${
                              sa.priority === "high"
                                ? "bg-accent/20 text-accent-light"
                                : "bg-card-border text-muted"
                            }`}
                          >
                            {sa.priority}
                          </span>
                          <span className="font-semibold text-foreground">{sa.action}</span>
                        </div>
                        <p className="text-muted leading-relaxed">{sa.reasoning}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Description */}
        <Section title="Tổng quan">
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {profile.description}
          </p>
        </Section>

        {/* Key Info Grid */}
        <div className="grid grid-cols-2 gap-4">
          {profile.website && (
            <InfoItem
              label="Website"
              value={
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-light hover:underline"
                >
                  {profile.website.replace(/^https?:\/\//, "")}
                </a>
              }
            />
          )}
          {profile.taxId && <InfoItem label="Mã số thuế" value={profile.taxId} />}
          {profile.foundedYear && (
            <InfoItem label="Năm thành lập" value={String(profile.foundedYear)} />
          )}
          {profile.companySize && (
            <InfoItem label="Quy mô" value={`${profile.companySize} nhân sự`} />
          )}
          {profile.headquarters && (
            <InfoItem
              label="Trụ sở"
              value={[
                profile.headquarters.city,
                profile.headquarters.province,
                profile.headquarters.country,
              ]
                .filter(Boolean)
                .join(", ")}
            />
          )}
        </div>

        {/* Key People */}
        {profile.keyPeople.length > 0 && (
          <Section title="Nhân sự chủ chốt">
            <div className="space-y-2">
              {profile.keyPeople.map((person, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 bg-surface rounded-xl px-4 py-2.5"
                >
                  <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center text-sm font-bold text-accent-light">
                    {person.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{person.name}</p>
                    <p className="text-xs text-muted">{person.title}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Products */}
        {profile.products.length > 0 && (
          <Section title="Sản phẩm / Dịch vụ">
            <div className="flex flex-wrap gap-2">
              {profile.products.map((p) => (
                <span
                  key={p}
                  className="px-3 py-1 text-xs bg-surface rounded-lg border border-card-border"
                >
                  {p}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Markets */}
        {profile.markets.length > 0 && (
          <Section title="Thị trường">
            <div className="flex flex-wrap gap-2">
              {profile.markets.map((m) => (
                <span
                  key={m}
                  className="px-3 py-1 text-xs bg-surface rounded-lg border border-card-border"
                >
                  {m}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Recent Activities */}
        {profile.recentActivities.length > 0 && (
          <Section title="Hoạt động gần đây">
            <div className="space-y-2">
              {profile.recentActivities.slice(0, 5).map((act, i) => (
                <div key={i} className="bg-surface rounded-xl px-4 py-3">
                  <p className="text-sm font-medium">{act.title}</p>
                  <p className="text-xs text-muted mt-1">{act.summary}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Diff */}
        {diff && diff.changes.length > 0 && (
          <Section title="🔄 Thay đổi so với lần trước">
            <div className="space-y-2">
              {diff.changes.map((change, i) => (
                <div
                  key={i}
                  className={`bg-surface rounded-xl px-4 py-3 border-l-3 ${
                    change.significance === "high"
                      ? "border-l-error"
                      : change.significance === "medium"
                        ? "border-l-warning"
                        : "border-l-muted"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold uppercase ${
                        change.changeType === "added"
                          ? "text-success"
                          : change.changeType === "removed"
                            ? "text-error"
                            : "text-warning"
                      }`}
                    >
                      {change.changeType === "added"
                        ? "MỚI"
                        : change.changeType === "removed"
                          ? "XÓA"
                          : "SỬA"}
                    </span>
                    <span className="text-sm font-medium">{change.field}</span>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted mt-2 whitespace-pre-wrap">
                {diff.summary}
              </p>
            </div>
          </Section>
        )}

        {/* Sources */}
        <Section title="Nguồn dữ liệu">
          <div className="space-y-1.5">
            {profile.sources.map((src, i) => (
              <a
                key={i}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-muted hover:text-accent-light transition-colors group"
              >
                <span className="text-accent/40 group-hover:text-accent">🔗</span>
                <span className="truncate">{src.url}</span>
                <span className="ml-auto text-muted/50 shrink-0">
                  [{src.source}]
                </span>
              </a>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── Sub-components ───

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function InfoItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="bg-surface rounded-xl px-4 py-3">
      <p className="text-xs text-muted mb-0.5">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 70
      ? "text-success border-success/30 bg-success/10"
      : pct >= 40
        ? "text-warning border-warning/30 bg-warning/10"
        : "text-error border-error/30 bg-error/10";

  return (
    <span
      className={`px-3 py-1 text-xs font-bold rounded-full border ${color}`}
    >
      {pct}% tin cậy
    </span>
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
