// ═══════════════════════════════════════════════════════
// PartnerIQ Research Workflow State Schema (LangGraph Annotation)
// ═══════════════════════════════════════════════════════

import { Annotation } from "@langchain/langgraph";
import type {
  AnalysisReport,
  CompanyInput,
  CompanyProfile,
  ProfileDiff,
  RawFinding,
  ResearchOutcome,
  SourceExecutionResult,
} from "@/lib/types";

export interface ResearchWorkflowState {
  researchRunId: string;
  input: CompanyInput;
  sourceResults: SourceExecutionResult[];
  findings: RawFinding[];
  existingProfile: CompanyProfile | null;
  profile: CompanyProfile | null;
  diff: ProfileDiff | null;
  report: AnalysisReport | null;
  outcome: ResearchOutcome;
  fatalError: string | null;
}

export const ResearchWorkflowAnnotation = Annotation.Root({
  researchRunId: Annotation<string>(),
  input: Annotation<CompanyInput>(),
  sourceResults: Annotation<SourceExecutionResult[]>({
    reducer: (prev, next) => (next ? prev.concat(next) : prev),
    default: () => [],
  }),
  findings: Annotation<RawFinding[]>({
    reducer: (_, next) => next ?? [],
    default: () => [],
  }),
  existingProfile: Annotation<CompanyProfile | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  profile: Annotation<CompanyProfile | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  diff: Annotation<ProfileDiff | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  report: Annotation<AnalysisReport | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  outcome: Annotation<ResearchOutcome>({
    reducer: (_, next) => next ?? "running",
    default: () => "running",
  }),
  fatalError: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
});
