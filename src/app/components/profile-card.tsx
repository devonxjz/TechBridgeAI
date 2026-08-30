"use client";

import { useState } from "react";
import type { CompanyProfile, ProfileDiff, AnalysisReport, SourceCitation, ProfileField, ClaimEvidence } from "@/lib/types";
import { exportProfileToMarkdown, exportProfileToJSON } from "@/lib/export";
import { ExportPdfButton } from "./export-pdf-button";
import { SourcePreviewDialog } from "./source-preview-dialog";
import { EvidenceBadge } from "./evidence-badge";
import { FitScoreSection } from "./fit-score-section";
import { SourceListSection } from "./source-list-section";

interface ProfileCardProps {
  profile: CompanyProfile;
  diff: ProfileDiff | null;
  report?: AnalysisReport | null;
}
export function ProfileCard({ profile, diff, report }: ProfileCardProps) {
  const [copied, setCopied] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<SourceCitation | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleOpenPreview = (citationOrUrl: SourceCitation | string) => {
    if (typeof citationOrUrl === "string") {
      const found = profile.sources.find((s) => s.url === citationOrUrl);
      if (found) {
        setSelectedCitation(found);
        setIsPreviewOpen(true);
      } else {
        window.open(citationOrUrl, "_blank", "noopener,noreferrer");
      }
    } else {
      setSelectedCitation(citationOrUrl);
      setIsPreviewOpen(true);
    }
  };

  const handleFieldEvidenceClick = (field: ProfileField) => {
    const claim = profile.fieldEvidence?.[field];
    if (claim && claim.supportingUrls.length > 0) {
      handleOpenPreview(claim.supportingUrls[0]);
    }
  };

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
    <div className="glass-card min-w-0 overflow-hidden animate-fade-in space-y-0">
      {/* Header */}
      <div className="p-6 border-b border-card-border bg-gradient-to-r from-accent/10 via-purple-500/5 to-transparent">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-2xl font-bold gradient-text">
                {profile.officialName}
              </h2>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-md bg-accent/20 text-accent-light border border-accent/30">
                v{profile.version}
              </span>
              {profile.fieldEvidence?.officialName && (
                <EvidenceBadge
                  evidence={profile.fieldEvidence.officialName}
                  onClick={() => handleFieldEvidenceClick("officialName")}
                />
              )}
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
              &#123;&#125; Tải JSON
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-6">
        {/* ─── Collaboration Fit Score (Analyst Module) ─── */}
        {report && report.fitScore && (
          <FitScoreSection report={report} onOpenPreview={handleOpenPreview} />
        )}

        {/* Description */}
        <Section title="Tổng quan">
          <div className="p-3.5 rounded-xl bg-surface/60 border border-card-border/40">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                {profile.description}
              </p>
              {profile.fieldEvidence?.description && (
                <EvidenceBadge
                  evidence={profile.fieldEvidence.description}
                  onClick={() => handleFieldEvidenceClick("description")}
                />
              )}
            </div>
          </div>
        </Section>

        {/* Key Info Grid */}
        <div className="grid grid-cols-2 gap-4">
          {profile.website && (
            <InfoItem
              label="Website"
              href={profile.website}
              title="Nhấn để mở website chính thức"
              value={profile.website.replace(/^https?:\/\//, "")}
              evidence={profile.fieldEvidence?.website}
              onEvidenceClick={() => handleFieldEvidenceClick("website")}
            />
          )}
          {profile.taxId && (
            <InfoItem
              label="Mã số thuế"
              href={`https://masothue.com/Search/?q=${encodeURIComponent(profile.taxId)}&type=auto`}
              title="Nhấn để kiểm tra mã số thuế trên cổng ĐKKD"
              value={profile.taxId}
              evidence={profile.fieldEvidence?.taxId}
              onEvidenceClick={() => handleFieldEvidenceClick("taxId")}
            />
          )}
          {profile.foundedYear && (
            <InfoItem
              label="Năm thành lập"
              value={String(profile.foundedYear)}
              evidence={profile.fieldEvidence?.foundedYear}
              onEvidenceClick={() => handleFieldEvidenceClick("foundedYear")}
            />
          )}
          {profile.companySize && (
            <InfoItem
              label="Quy mô"
              value={`${profile.companySize} nhân sự`}
              evidence={profile.fieldEvidence?.companySize}
              onEvidenceClick={() => handleFieldEvidenceClick("companySize")}
            />
          )}
          {profile.headquarters && (
            <InfoItem
              label="Trụ sở"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                [
                  profile.headquarters.street,
                  profile.headquarters.city,
                  profile.headquarters.province,
                  profile.headquarters.country,
                ]
                  .filter(Boolean)
                  .join(", ")
              )}`}
              title="Nhấn để xem địa chỉ trụ sở trên Google Maps"
              value={[
                profile.headquarters.city,
                profile.headquarters.province,
                profile.headquarters.country,
              ]
                .filter(Boolean)
                .join(", ")}
              evidence={profile.fieldEvidence?.headquarters}
              onEvidenceClick={() => handleFieldEvidenceClick("headquarters")}
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
                  className="flex items-center gap-3 bg-surface rounded-xl px-4 py-2.5 border border-card-border/40"
                >
                  <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center text-sm font-bold text-accent-light">
                    {person.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {person.name}
                    </p>
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
                  className="px-3 py-1.5 text-xs font-medium bg-surface text-foreground
                             rounded-lg border border-card-border/60"
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
                  className="px-3 py-1 text-xs bg-surface text-muted rounded-md border border-card-border/40"
                >
                  {m}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Recent Activities */}
        {profile.recentActivities.length > 0 && (
          <Section title="Hoạt động & Sự kiện gần đây">
            <div className="space-y-2.5">
              {profile.recentActivities.map((act, i) => (
                <div
                  key={i}
                  className="p-3 bg-surface rounded-xl border border-card-border/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {act.title}
                    </p>
                    {act.date && (
                      <span className="text-[11px] text-muted shrink-0">
                        {new Date(act.date).toLocaleDateString("vi-VN")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1 leading-relaxed">
                    {act.summary}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Sources */}
        <SourceListSection sources={profile.sources} onOpenPreview={handleOpenPreview} />
      </div>

      {/* Source Preview Modal Dialog */}
      <SourcePreviewDialog
        citation={selectedCitation}
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
      />
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
  href,
  title,
  evidence,
  onEvidenceClick,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
  title?: string;
  evidence?: ClaimEvidence | null;
  onEvidenceClick?: () => void;
}) {
  return (
    <div className="bg-surface rounded-xl px-4 py-3 border border-card-border/40 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-xs text-muted">{label}</p>
        {evidence && (
          <EvidenceBadge evidence={evidence} onClick={onEvidenceClick} />
        )}
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:text-accent-light flex items-center gap-1 group truncate"
          title={title}
        >
          <span className="truncate">{value}</span>
          <span className="text-[10px] text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            ↗
          </span>
        </a>
      ) : (
        <p className="text-sm font-medium truncate">{value}</p>
      )}
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
