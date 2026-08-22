// ═══════════════════════════════════════════════════════
// PartnerIQ — Domain Types
// All TypeScript interfaces for the application
// ═══════════════════════════════════════════════════════

import { z } from "zod";

// ─── Input ───

export interface CompanyInput {
  name: string;
  website?: string;
  taxId?: string;
  linkedinUrl?: string;
  additionalKeywords?: string[];
}

export const CompanyInputSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().url().max(500).optional(),
  taxId: z.string().max(50).optional(),
  linkedinUrl: z.string().url().max(500).optional(),
  additionalKeywords: z.array(z.string().max(100)).max(5).optional(),
});

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Source types ───

export type SourceName =
  | "web_search"
  | "website"
  | "registry"
  | "news"
  | "linkedin";

export interface RawFinding {
  source: SourceName;
  url: string;
  content: string;
  extractedAt: Date;
  confidence: number; // 0.0 – 1.0
  metadata?: Record<string, unknown>;
}

// ─── Company Profile ───

export interface Address {
  street?: string;
  city?: string;
  province?: string;
  country: string;
}

export interface Person {
  name: string;
  title: string;
  source: SourceName;
  confidence: number;
}

export interface Activity {
  date: Date;
  title: string;
  summary: string;
  url: string;
  source: SourceName;
}

export interface SourceCitation {
  source: SourceName;
  url: string;
  accessedAt: Date;
  fieldsContributed: string[];
}

export type CompanySize =
  | "1-10"
  | "11-50"
  | "51-200"
  | "201-500"
  | "501-1000"
  | "1000+";

export type RevenueRange =
  | "< 1B VND"
  | "1-10B VND"
  | "10-100B VND"
  | "100B-1T VND"
  | "> 1T VND";

export interface CompanyProfile {
  id: string;
  version: number;
  createdAt: Date;
  input: CompanyInput;

  // Core fields
  officialName: string;
  tradingNames: string[];
  taxId?: string;
  industry: string[];
  description: string;
  foundedYear?: number;
  headquarters?: Address;
  website?: string;

  // People
  keyPeople: Person[];

  // Business
  products: string[];
  markets: string[];
  companySize?: CompanySize;
  revenue?: RevenueRange;

  // Activity
  recentActivities: Activity[];
  lastUpdated: Date;

  // Meta
  sources: SourceCitation[];
  overallConfidence: number;
  lowConfidence?: boolean;
}

// ─── Profile Diff ───

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: "added" | "removed" | "modified";
  significance: "high" | "medium" | "low";
}

export interface ProfileDiff {
  companyId: string;
  fromVersion: number;
  toVersion: number;
  changes: FieldChange[];
  summary: string;
}

// ─── Analysis Report ───

export interface FitScore {
  score: number; // 0-100
  reasoning: string;
  criteria: { name: string; score: number; weight: number; reasoning?: string }[];
}

export interface RiskFlag {
  type: "legal" | "financial" | "reputation" | "operational";
  description: string;
  severity: "high" | "medium" | "low";
  source: SourceName;
}

export interface SuggestedAction {
  action: string;
  priority: "high" | "medium" | "low";
  reasoning: string;
}

export interface AnalysisReport {
  companyId: string;
  generatedAt: Date;
  fitScore?: FitScore;
  riskFlags: RiskFlag[];
  suggestedActions: SuggestedAction[];
  executiveSummary: string;
}

export interface AnalysisContext {
  previousProfile?: CompanyProfile;
  sponsorCriteria?: string;
}

// ─── Research Events (streaming) ───

export type ResearchEvent =
  | {
      type: "progress";
      source: SourceName;
      status: "started" | "done" | "failed";
    }
  | { type: "finding"; finding: RawFinding }
  | { type: "complete"; findings: RawFinding[] }
  | { type: "error"; source: SourceName; error: string };

// ─── SSE Stream Events ───

export type StreamEvent =
  | { event: "research:start"; data: { sources: SourceName[] } }
  | {
      event: "research:progress";
      data: { source: SourceName; status: string };
    }
  | {
      event: "research:finding";
      data: { source: SourceName; summary: string };
    }
  | { event: "profile:building"; data: { message: string } }
  | { event: "profile:ready"; data: { profile: CompanyProfile } }
  | { event: "diff:ready"; data: { diff: ProfileDiff | null } }
  | { event: "analysis:ready"; data: { report: AnalysisReport } }
  | { event: "error"; data: { message: string; source?: SourceName } }
  | { event: "done"; data: Record<string, never> };

// ─── Source Result (error contract) ───

export interface SourceError {
  source: SourceName;
  type: "timeout" | "blocked" | "empty" | "parse_error" | "network_error";
  message: string;
  retryable: boolean;
}

export type SourceResult =
  | { ok: true; findings: RawFinding[] }
  | { ok: false; error: SourceError };
