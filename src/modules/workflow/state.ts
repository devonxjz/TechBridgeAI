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
