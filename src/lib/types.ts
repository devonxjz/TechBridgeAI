// ═══════════════════════════════════════════════════════
// PartnerIQ — Domain Types
// All TypeScript interfaces for the application
// ═══════════════════════════════════════════════════════

import { z } from "zod";

// ─── Input ───

export type DomainPolicyMode = "broad" | "prefer" | "only";

export interface SourceDomainPolicy {
  mode: DomainPolicyMode;
  domains: string[];
}

export interface CompanyInput {
  name: string;
  website?: string;
  taxId?: string;
  linkedinUrl?: string;
  additionalKeywords?: string[];
  sourcePolicy?: SourceDomainPolicy;
}

const domainHostnameRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export const SourceDomainPolicySchema = z.object({
  mode: z.enum(["broad", "prefer", "only"]),
  domains: z.array(z.string()).max(20),
}).transform((policy, ctx) => {
  const normalizedDomains: string[] = [];

  for (const raw of policy.domains) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) continue;
    if (
      trimmed.includes("://") ||
      trimmed.includes("/") ||
      trimmed.includes("@") ||
      trimmed.includes(":") ||
      trimmed.includes("?") ||
      trimmed.includes("#") ||
      !domainHostnameRegex.test(trimmed)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Invalid domain format: ${raw}. Must be a valid hostname without protocol, path, port or credentials.`,
      });
      return z.NEVER;
    }
    if (!normalizedDomains.includes(trimmed)) {
      normalizedDomains.push(trimmed);
    }
  }

  if (policy.mode !== "broad" && normalizedDomains.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: `Domain policy mode "${policy.mode}" requires at least one valid domain.`,
    });
    return z.NEVER;
  }

  return {
    mode: policy.mode,
    domains: normalizedDomains,
  };
});

export const CompanyInputSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().url().max(500).optional(),
  taxId: z.string().max(50).optional(),
  linkedinUrl: z.string().url().max(500).optional(),
  additionalKeywords: z.array(z.string().max(100)).max(5).optional(),
  sourcePolicy: SourceDomainPolicySchema.optional(),
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

// ─── Source & Provenance types ───

export type SourceName =
  | "web_search"
  | "website"
  | "registry"
  | "news"
  | "linkedin";

export type VerificationStatus =
  | "primary_source"
  | "corroborated"
  | "single_source"
  | "conflicting"
  | "insufficient";

export type PreviewMode = "short_excerpt" | "metadata_only";
export type RobotsDecision = "allowed" | "disallowed" | "unknown";
export type FetchMethod = "search_snippet" | "server_extract";

export interface PublicationMetadata {
  title?: string;
  publisherName?: string;
  publisherDomain: string;
  authors: string[];
  publishedAt?: string;
  publishedLabel?: string;
  modifiedAt?: string;
  canonicalUrl?: string;
  ampUrl?: string;
}

export interface PreviewPolicy {
  mode: PreviewMode;
  paywallDetected: boolean;
  isAccessibleForFree?: boolean;
  robotsDecision: RobotsDecision;
  maxSnippetLength?: number;
}

export interface SourceSignals {
  primarySource: boolean;
  publisherIdentified: boolean;
  authorIdentified: boolean;
  publicationDateIdentified: boolean;
  duplicateClusterSize: number;
}

export interface ClaimEvidence {
  supportingUrls: string[];
  conflictingUrls: string[];
  independentPublisherCount: number;
  status: VerificationStatus;
}

export const PROFILE_FIELDS = [
  "officialName",
  "tradingNames",
  "taxId",
  "industry",
  "description",
  "foundedYear",
  "headquarters",
  "website",
  "keyPeople",
  "products",
  "markets",
  "companySize",
  "revenue",
  "recentActivities",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export interface RawFinding {
  source: SourceName;
  url: string;
  content: string;
  extractedAt: Date;
  confidence: number; // 0.0 – 1.0
  metadata?: Record<string, unknown>;
  publication?: PublicationMetadata;
  previewPolicy?: PreviewPolicy;
  signals?: SourceSignals;
  excerpt?: string;
  contentFingerprint?: string;
  fetchMethod?: FetchMethod;
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
  fieldsContributed: ProfileField[] | string[];
  title?: string;
  snippet?: string;
  confidence?: number;
  publication?: PublicationMetadata;
  previewPolicy?: PreviewPolicy;
  signals?: SourceSignals;
  excerpt?: string;
  contentFingerprint?: string;
  fetchMethod?: FetchMethod;
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

  // Meta & Provenance
  sources: SourceCitation[];
  fieldEvidence?: Partial<Record<ProfileField, ClaimEvidence>>;
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

export interface FitScoreCriteria {
  name: string;
  score: number;
  weight: number;
  reasoning?: string;
  evidence?: ClaimEvidence;
}

export interface FitScore {
  score: number; // 0-100
  reasoning: string;
  criteria: FitScoreCriteria[];
}

export interface RiskFlag {
  type: "legal" | "financial" | "reputation" | "operational";
  description: string;
  severity: "high" | "medium" | "low";
  source: SourceName;
  evidence?: ClaimEvidence;
}

export interface SuggestedAction {
  action: string;
  priority: "high" | "medium" | "low";
  reasoning: string;
  evidence?: ClaimEvidence;
}

export interface AnalysisReport {
  companyId: string;
  generatedAt: Date;
  fitScore?: FitScore;
  riskFlags: RiskFlag[];
  suggestedActions: SuggestedAction[];
  executiveSummary: string;
  executiveSummaryEvidence?: ClaimEvidence;
}

export interface AnalysisContext {
  previousProfile?: CompanyProfile;
  sponsorCriteria?: string;
}

// ─── Cache & Request Contracts ───

export const CacheActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), companyId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("refresh"), companyId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("bypass") }).strict(),
]);

export const ResearchRequestSchema = z.object({
  input: CompanyInputSchema,
  cache: CacheActionSchema.optional(),
}).strict();

export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;

export type ResearchErrorCode =
  | "identity_conflict"
  | "cache_invalid"
  | "invalid_cache_selection"
  | "cache_unavailable"
  | "persist_failed"
  | "research_failed";

export type CacheHitMatchedBy = "tax_id" | "domain" | "selected" | "user_selection";

export interface CacheSuggestion {
  companyId: string;
  officialName: string;
  taxId?: string;
  domain?: string;
  lastSyncedAt: string;
}

// ─── Runtime Schemas for Cached Snapshot ───

export const ProfileFieldSchema = z.enum(PROFILE_FIELDS);

export const VerificationStatusSchema = z.enum([
  "primary_source",
  "corroborated",
  "single_source",
  "conflicting",
  "insufficient",
]);

export const ClaimEvidenceSchema = z.object({
  supportingUrls: z.array(z.string().url()),
  conflictingUrls: z.array(z.string().url()),
  independentPublisherCount: z.number().int().min(0),
  status: VerificationStatusSchema,
});

export const PreviewModeSchema = z.enum(["short_excerpt", "metadata_only"]);
export const RobotsDecisionSchema = z.enum(["allowed", "disallowed", "unknown"]);
export const FetchMethodSchema = z.enum(["search_snippet", "server_extract"]);

export const PublicationMetadataSchema = z.object({
  title: z.string().optional(),
  publisherName: z.string().optional(),
  publisherDomain: z.string(),
  authors: z.array(z.string()),
  publishedAt: z.string().optional(),
  publishedLabel: z.string().optional(),
  modifiedAt: z.string().optional(),
  canonicalUrl: z.string().url().optional(),
  ampUrl: z.string().url().optional(),
});

export const PreviewPolicySchema = z.object({
  mode: PreviewModeSchema,
  paywallDetected: z.boolean(),
  isAccessibleForFree: z.boolean().optional(),
  robotsDecision: RobotsDecisionSchema,
  maxSnippetLength: z.number().int().optional(),
});

export const SourceSignalsSchema = z.object({
  primarySource: z.boolean(),
  publisherIdentified: z.boolean(),
  authorIdentified: z.boolean(),
  publicationDateIdentified: z.boolean(),
  duplicateClusterSize: z.number().int().min(0),
});

export const SourceNameSchema = z.enum([
  "web_search",
  "website",
  "registry",
  "news",
  "linkedin",
]);

export const AddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  country: z.string(),
});

export const PersonSchema = z.object({
  name: z.string(),
  title: z.string(),
  source: SourceNameSchema,
  confidence: z.number().min(0).max(1),
});

export const ActivitySchema = z.object({
  date: z.coerce.date(),
  title: z.string(),
  summary: z.string(),
  url: z.string(),
  source: SourceNameSchema,
});

export const SourceCitationSchema = z.object({
  source: SourceNameSchema,
  url: z.string(),
  accessedAt: z.coerce.date(),
  fieldsContributed: z.array(z.string()),
  title: z.string().optional(),
  snippet: z.string().optional(),
  confidence: z.number().optional(),
  publication: PublicationMetadataSchema.optional(),
  previewPolicy: PreviewPolicySchema.optional(),
  signals: SourceSignalsSchema.optional(),
  excerpt: z.string().max(800).optional(),
  contentFingerprint: z.string().optional(),
  fetchMethod: FetchMethodSchema.optional(),
});

export const CompanySizeSchema = z.enum([
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1000+",
]);

export const RevenueRangeSchema = z.enum([
  "< 1B VND",
  "1-10B VND",
  "10-100B VND",
  "100B-1T VND",
  "> 1T VND",
]);

export const CompanyProfileSchema = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  createdAt: z.coerce.date(),
  input: CompanyInputSchema,
  officialName: z.string(),
  tradingNames: z.array(z.string()),
  taxId: z.string().optional(),
  industry: z.array(z.string()),
  description: z.string(),
  foundedYear: z.number().int().optional(),
  headquarters: AddressSchema.optional(),
  website: z.string().optional(),
  keyPeople: z.array(PersonSchema),
  products: z.array(z.string()),
  markets: z.array(z.string()),
  companySize: CompanySizeSchema.optional(),
  revenue: RevenueRangeSchema.optional(),
  recentActivities: z.array(ActivitySchema),
  lastUpdated: z.coerce.date(),
  sources: z.array(SourceCitationSchema),
  fieldEvidence: z.record(ProfileFieldSchema, ClaimEvidenceSchema).optional(),
  overallConfidence: z.number().min(0).max(1),
  lowConfidence: z.boolean().optional(),
});

export const FieldChangeSchema = z.object({
  field: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  changeType: z.enum(["added", "removed", "modified"]),
  significance: z.enum(["high", "medium", "low"]),
});

export const ProfileDiffSchema = z.object({
  companyId: z.string(),
  fromVersion: z.number().int(),
  toVersion: z.number().int(),
  changes: z.array(FieldChangeSchema),
  summary: z.string(),
});

export const FitScoreCriteriaSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number(),
  reasoning: z.string().optional(),
  evidence: ClaimEvidenceSchema.optional(),
});

export const FitScoreSchema = z.object({
  score: z.number().min(0).max(100),
  reasoning: z.string(),
  criteria: z.array(FitScoreCriteriaSchema),
});

export const RiskFlagSchema = z.object({
  type: z.enum(["legal", "financial", "reputation", "operational"]),
  description: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  source: SourceNameSchema,
  evidence: ClaimEvidenceSchema.optional(),
});

export const SuggestedActionSchema = z.object({
  action: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
  evidence: ClaimEvidenceSchema.optional(),
});

export const AnalysisReportSchema = z.object({
  companyId: z.string(),
  generatedAt: z.coerce.date(),
  fitScore: FitScoreSchema.optional(),
  riskFlags: z.array(RiskFlagSchema),
  suggestedActions: z.array(SuggestedActionSchema),
  executiveSummary: z.string(),
  executiveSummaryEvidence: ClaimEvidenceSchema.optional(),
});

export interface ResearchSnapshot {
  profile: CompanyProfile;
  report: AnalysisReport;
  diff: ProfileDiff | null;
  lastSyncedAt: string;
}

export const ResearchSnapshotSchema = z.object({
  profile: CompanyProfileSchema,
  report: AnalysisReportSchema,
  diff: ProfileDiffSchema.nullable(),
  lastSyncedAt: z.string().datetime(),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.report.companyId !== snapshot.profile.id) {
    ctx.addIssue({
      code: "custom",
      path: ["report", "companyId"],
      message: "Analysis report companyId must match profile id",
    });
  }
  if (
    snapshot.diff &&
    (snapshot.diff.companyId !== snapshot.profile.id ||
      snapshot.diff.toVersion !== snapshot.profile.version)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["diff"],
      message: "Profile diff must match profile id and version",
    });
  }
});

// ─── SSE Stream Events ───

export type StreamEvent =
  | {
      event: "cache:hit";
      data: {
        companyId: string;
        matchedBy: CacheHitMatchedBy;
        version: number;
        lastSyncedAt: string;
      };
    }
  | {
      event: "cache:suggestions";
      data: { suggestions: CacheSuggestion[] };
    }
  | { event: "research:start"; data: { sources: SourceName[] } }
  | {
      event: "research:progress";
      data: { source: SourceName; status: string };
    }
  | {
      event: "research:finding";
      data: { source: SourceName; summary: string; url?: string };
    }
  | { event: "profile:building"; data: { message: string } }
  | { event: "profile:ready"; data: { profile: CompanyProfile } }
  | { event: "diff:ready"; data: { diff: ProfileDiff | null } }
  | { event: "analysis:ready"; data: { report: AnalysisReport } }
  | {
      event: "error";
      data: {
        message: string;
        source?: SourceName;
        code?: ResearchErrorCode;
      };
    }
  | { event: "done"; data: Record<string, never> };

// ─── Source Result (error contract) ───

export interface SourceError {
  source: SourceName;
  type: "timeout" | "blocked" | "empty" | "parse_error" | "network_error";
  message: string;
  retryable: boolean;
}

export type SourceExecutionStatus = "succeeded" | "failed" | "skipped";
export type ResearchOutcome = "running" | "complete" | "partial" | "failed";

export interface SourceExecutionResult {
  source: SourceName;
  status: SourceExecutionStatus;
  findings: RawFinding[];
  error?: SourceError;
  attempts: number;
  durationMs: number;
}

export interface PreparedEvidence {
  findings: RawFinding[];
  sourceCoverage: number;
  outcome: Exclude<ResearchOutcome, "running">;
}

