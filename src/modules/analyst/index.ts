// ═══════════════════════════════════════════════════════
// AnalystModule — Deep Module
// Analyzes CompanyProfile, generates Collaboration Fit Score (5 criteria),
// Risk Flags, Suggested Actions, and Executive Summary with claim evidence provenance.
// ═══════════════════════════════════════════════════════

import { z } from "zod";
import type {
  CompanyProfile,
  AnalysisReport,
  AnalysisContext,
  FitScore,
  RiskFlag,
  SuggestedAction,
  FitScoreCriteria,
} from "@/lib/types";
import type { LLMAdapter, LLMInvocationContext } from "@/adapters/llm/types";
import { buildClaimEvidence } from "@/modules/research/evidence";

export interface AnalystModule {
  analyze(
    profile: CompanyProfile,
    context?: AnalysisContext,
    llmContext?: LLMInvocationContext,
  ): Promise<AnalysisReport>;
}

interface AnalystDeps {
  llm: LLMAdapter;
}

// 5 Core Criteria with calibrated weights from ARCHITECTURE.md
export const DEFAULT_CRITERIA_WEIGHTS: Record<string, number> = {
  "Industry Alignment": 0.3,
  "Company Size Match": 0.2,
  "Geographic Relevance": 0.15,
  "Digital Maturity": 0.15,
  "Recent Activity": 0.2,
};

const LLMClaimEvidenceSchema = z.object({
  supportingUrls: z.array(z.string()).default([]),
  conflictingUrls: z.array(z.string()).default([]),
});

const LLMAnalysisSchema = z.object({
  executiveSummary: z.string(),
  criteria: z.array(
    z.object({
      name: z.string(),
      score: z.number().min(0).max(100),
      reasoning: z.string(),
      evidence: LLMClaimEvidenceSchema.nullable().default(null),
    })
  ),
  riskFlags: z
    .array(
      z.object({
        type: z.enum(["legal", "financial", "reputation", "operational"]),
        description: z.string(),
        severity: z.enum(["high", "medium", "low"]),
        evidence: LLMClaimEvidenceSchema.nullable().default(null),
      })
    )
    .default([]),
  suggestedActions: z
    .array(
      z.object({
        action: z.string(),
        priority: z.enum(["high", "medium", "low"]),
        reasoning: z.string(),
        evidence: LLMClaimEvidenceSchema.nullable().default(null),
      })
    )
    .default([]),
});

type LLMAnalysisOutput = z.infer<typeof LLMAnalysisSchema>;

export function createAnalystModule(deps: AnalystDeps): AnalystModule {
  return {
    async analyze(profile, context, llmContext) {
      const prompt = buildAnalysisPrompt(profile, context);

      const llmOutput = await deps.llm.completeStructured<LLMAnalysisOutput>(
        prompt,
        LLMAnalysisSchema,
        {
          systemPrompt: ANALYST_SYSTEM_PROMPT,
          temperature: 0.2,
          context: llmContext,
        }
      );

      const sources = profile.sources || [];

      // Compute weighted overall score with evidence
      const fitScore = calculateFitScore(llmOutput.criteria, sources);

      const riskFlags: RiskFlag[] = llmOutput.riskFlags.map((rf) => ({
        type: rf.type,
        description: rf.description,
        severity: rf.severity,
        source: "news",
        evidence: rf.evidence ? buildClaimEvidence(rf.evidence, sources) : undefined,
      }));

      const suggestedActions: SuggestedAction[] = llmOutput.suggestedActions.map((sa) => ({
        action: sa.action,
        priority: sa.priority,
        reasoning: sa.reasoning,
        evidence: sa.evidence ? buildClaimEvidence(sa.evidence, sources) : undefined,
      }));

      const report: AnalysisReport = {
        companyId: profile.id,
        generatedAt: new Date(),
        fitScore,
        riskFlags,
        suggestedActions,
        executiveSummary: llmOutput.executiveSummary,
      };

      return report;
    },
  };
}

// ─── Helpers ───

const ANALYST_SYSTEM_PROMPT = `Bạn là chuyên gia thẩm định và phân tích đối tác kinh doanh (Partner Intelligence Analyst).
Nhiệm vụ: Đánh giá toàn diện hồ sơ doanh nghiệp Việt Nam, tính điểm tiềm năng hợp tác (Collaboration Fit Score), phát hiện rủi ro và đề xuất hành động tiếp cận kèm trích dẫn chứng cứ.

Đánh giá bắt buộc theo 5 tiêu chí sau:
1. "Industry Alignment" (Trọng số 0.30): Mức độ liên quan, bổ trợ và phù hợp của ngành nghề hoạt động.
2. "Company Size Match" (Trọng số 0.20): Quy mô doanh nghiệp, nhân sự và khả năng hấp thụ hợp tác.
3. "Geographic Relevance" (Trọng số 0.15): Trụ sở, chi nhánh và địa bàn hoạt động tại Việt Nam/quốc tế.
4. "Digital Maturity" (Trọng số 0.15): Mức độ số hóa, website, hiện diện trực tuyến và công nghệ.
5. "Recent Activity" (Trọng số 0.20): Các hoạt động, tin tức mới nhất, xu hướng phát triển hoặc mở rộng.

Quy tắc:
- Cho điểm từ 0 đến 100 cho mỗi tiêu chí kèm giải thích ngắn gọn, súc tích (1-2 câu).
- Cung cấp trích dẫn chứng cứ (supportingUrls) từ danh sách nguồn được cung cấp.
- Nhận diện các rủi ro (Risk Flags) nếu có dấu hiệu bất thường (pháp lý, tài chính, uy tín).
- Đề xuất 2-4 hành động cụ thể (Suggested Actions) để tiếp cận hoặc xúc tiến hợp tác.
- Viết tóm tắt tổng quan (executiveSummary) bằng tiếng Việt rõ ràng, chuyên nghiệp.`;

function buildAnalysisPrompt(
  profile: CompanyProfile,
  context?: AnalysisContext
): string {
  let contextInfo = "";
  if (context?.sponsorCriteria) {
    contextInfo += `\nTiêu chí đặc thù của Sponsor/Bên tìm kiếm đối tác:\n${context.sponsorCriteria}\n`;
  }
  if (context?.previousProfile) {
    contextInfo += `\nLịch sử phiên bản trước: Version ${context.previousProfile.version} (Cập nhật: ${new Date(context.previousProfile.lastUpdated).toLocaleDateString("vi-VN")})\n`;
  }

  const tradingNames = (profile.tradingNames ?? []).join(", ") || "Không có";
  const industry = (profile.industry ?? []).join(", ") || "Chưa rõ";
  const products = (profile.products ?? []).join(", ") || "Chưa rõ";
  const markets = (profile.markets ?? []).join(", ") || "Chưa rõ";
  const keyPeople = (profile.keyPeople ?? []).map((p) => `${p.name} (${p.title})`).join("; ") || "Chưa rõ";
  const recentActivities = (profile.recentActivities ?? []).map((a) => `- ${a.title}: ${a.summary}`).join("\n") || "Không có";

  const sourceItems = (profile.sources ?? []).map((s, idx) => {
    const pub = s.publication?.publisherName || s.publication?.publisherDomain || "";
    return `[${idx + 1}] URL: ${s.url} | Title: ${s.title || ""} | Publisher: ${pub}`;
  }).join("\n");

  return `Phân tích và đánh giá tiềm năng hợp tác cho doanh nghiệp sau:

Tên chính thức: ${profile.officialName}
Tên giao dịch: ${tradingNames}
Mã số thuế: ${profile.taxId || "Chưa rõ"}
Ngành nghề: ${industry}
Mô tả: ${profile.description}
Quy mô: ${profile.companySize || "Chưa rõ"}
Trụ sở: ${profile.headquarters ? `${profile.headquarters.city || ""}, ${profile.headquarters.province || ""}, ${profile.headquarters.country}` : "Chưa rõ"}
Sản phẩm/Dịch vụ: ${products}
Thị trường: ${markets}
Nhân sự chủ chốt: ${keyPeople}
Hoạt động gần đây: ${recentActivities}
${contextInfo}

Danh sách nguồn kiểm chứng:
${sourceItems || "Không có nguồn cụ thể"}

Hãy đánh giá 5 tiêu chí ("Industry Alignment", "Company Size Match", "Geographic Relevance", "Digital Maturity", "Recent Activity"), phát hiện rủi ro và gợi ý hành động tiếp cận kèm supportingUrls. Trả về JSON theo đúng schema.`;
}

function calculateFitScore(
  criteriaList: {
    name: string;
    score: number;
    reasoning: string;
    evidence?: { supportingUrls: string[]; conflictingUrls: string[] } | null;
  }[],
  sources: CompanyProfile["sources"] = []
): FitScore {
  const criteriaWithWeights: FitScoreCriteria[] = criteriaList.map((c) => {
    const weight = DEFAULT_CRITERIA_WEIGHTS[c.name] ?? 0.2;
    const evidence = c.evidence ? buildClaimEvidence(c.evidence, sources) : undefined;
    return {
      name: c.name,
      score: Math.min(100, Math.max(0, Math.round(c.score))),
      weight,
      reasoning: c.reasoning,
      evidence,
    };
  });

  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const c of criteriaWithWeights) {
    totalWeightedScore += c.score * c.weight;
    totalWeight += c.weight;
  }

  const finalScore =
    totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 50;

  let overallReasoning = "";
  if (finalScore >= 80) {
    overallReasoning = "Tiềm năng hợp tác cao — Doanh nghiệp phù hợp mạnh với các tiêu chí trọng tâm.";
  } else if (finalScore >= 60) {
    overallReasoning = "Tiềm năng hợp tác trung bình — Cần tìm hiểu thêm các yêu cầu chuyên sâu.";
  } else if (finalScore >= 40) {
    overallReasoning = "Tiềm năng hợp tác hạn chế — Có một số khoảng cách về ngành nghề hoặc quy mô.";
  } else {
    overallReasoning = "Không khuyến nghị hợp tác ở thời điểm hiện tại.";
  }

  return {
    score: finalScore,
    reasoning: overallReasoning,
    criteria: criteriaWithWeights,
  };
}
