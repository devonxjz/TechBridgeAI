// ═══════════════════════════════════════════════════════
// PartnerIQ — PDF Export Payload Mapper & Utilities
// Deterministic budget mapper for 1-page A4 PDF export
// ═══════════════════════════════════════════════════════

import type { AnalysisReport, CompanyProfile } from "./types";

export interface PdfCriterion {
  name: string;
  score: number;
  weight: number;
}

export interface PdfPayload {
  companyName: string;
  taxId?: string;
  industries: string[];
  description: string;
  fitScore: number;
  fitReason: string;
  criteria: PdfCriterion[];
  executiveSummary: string;
  risks: string[];
  actions: string[];
  sources: Array<{ label: string; url: string }>;
  generatedAt: string;
}

export const CRITERIA_LABELS: Record<string, string> = {
  "Industry Alignment": "Phù hợp ngành",
  "Company Size Match": "Tương thích quy mô",
  "Geographic Relevance": "Phù hợp địa lý",
  "Digital Maturity": "Trưởng thành số",
  "Recent Activity": "Hoạt động gần đây",
};

const SEVERITY_ORDER: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const PRIORITY_ORDER: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function truncateText(text: string | undefined | null, maxLength: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  if (maxLength <= 1) return trimmed.slice(0, maxLength);
  return trimmed.slice(0, maxLength - 1).trimEnd() + "…";
}

function clampScore(score: number): number {
  if (isNaN(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function formatDateDDMMYYYY(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function formatDateYYYYMMDD(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${y}-${m}-${d}`;
}

function safeFilenamePart(text: string): string {
  return text
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đ]/g, "d")
    .replace(/[Đ]/g, "D")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildPdfFilename(companyName: string, exportedAt?: Date): string {
  const targetDate = exportedAt ? new Date(exportedAt) : new Date();
  const safeName = safeFilenamePart(companyName) || "Company";
  const dateStr = formatDateYYYYMMDD(targetDate);
  return `PartnerIQ_${safeName}_${dateStr}.pdf`;
}

export function mapToPdfPayload(
  profile: CompanyProfile,
  report: AnalysisReport,
  exportedAt?: Date,
): PdfPayload {
  if (!report.fitScore) {
    throw new Error("PDF export requires fitScore in report");
  }

  if (!Array.isArray(report.fitScore.criteria) || report.fitScore.criteria.length !== 5) {
    throw new Error("PDF export requires exactly 5 fit criteria");
  }

  const targetDate = exportedAt
    ? new Date(exportedAt)
    : report.generatedAt
    ? new Date(report.generatedAt)
    : new Date();

  // Sort risks: high -> medium -> low
  const sortedRisks = [...(report.riskFlags || [])]
    .sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0))
    .slice(0, 2)
    .map((r) => truncateText(r.description, 120));

  // Sort actions: high -> medium -> low
  const sortedActions = [...(report.suggestedActions || [])]
    .sort((a, b) => (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0))
    .slice(0, 2)
    .map((a) => truncateText(a.action, 110));

  // Deduplicate sources by hostname (up to 3)
  const sources: Array<{ label: string; url: string }> = [];
  const seenHostnames = new Set<string>();

  for (const src of profile.sources || []) {
    if (!src.url) continue;
    try {
      const parsed = new URL(src.url);
      const hostname = parsed.hostname.replace(/^www\./, "");
      if (hostname && !seenHostnames.has(hostname)) {
        seenHostnames.add(hostname);
        sources.push({ label: hostname, url: src.url });
        if (sources.length >= 3) break;
      }
    } catch {
      // Ignore invalid URL strings
    }
  }

  return {
    companyName: truncateText(profile.officialName || profile.input.name || "Company", 90),
    taxId: profile.taxId?.trim() || undefined,
    industries: (profile.industry || []).slice(0, 3).map((ind) => truncateText(ind, 32)),
    description: truncateText(profile.description, 320),
    fitScore: clampScore(report.fitScore.score),
    fitReason: truncateText(report.fitScore.reasoning, 140),
    criteria: report.fitScore.criteria.map((c) => ({
      name: CRITERIA_LABELS[c.name] || c.name,
      score: clampScore(c.score),
      weight: c.weight,
    })),
    executiveSummary: truncateText(report.executiveSummary, 260),
    risks: sortedRisks,
    actions: sortedActions,
    sources,
    generatedAt: formatDateDDMMYYYY(targetDate),
  };
}
