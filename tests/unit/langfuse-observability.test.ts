import { describe, expect, it } from "vitest";
import {
  maskPartnerIqTelemetry,
  calculateDeterministicScores,
  createLangfuseCallback,
} from "@/observability/langfuse";
import type { SourceExecutionResult } from "@/lib/types";

describe("Langfuse Observability & Privacy Minimization", () => {
  it("removes secrets, emails, phones, and raw page contents while preserving valid JSON", () => {
    const rawData = JSON.stringify({
      authorization: "Bearer sk-proj-1234567890abcdef",
      apiKey: "sk-live-abcdef123456",
      email: "contact@company.com",
      phone: "+84901234567",
      content: "raw scraped page full of html and text",
      companyName: "FPT Corporation",
      taxId: "0101248141",
    });

    const masked = maskPartnerIqTelemetry(rawData);

    expect(masked).not.toContain("sk-proj-1234567890abcdef");
    expect(masked).not.toContain("sk-live-abcdef123456");
    expect(masked).not.toContain("contact@company.com");
    expect(masked).not.toContain("+84901234567");
    expect(masked).not.toContain("raw scraped page");
    expect(masked).toContain("FPT Corporation");
    expect(masked).toContain("0101248141");

    expect(() => JSON.parse(masked)).not.toThrow();
  });

  it("calculates deterministic quality scores without LLM judge", () => {
    const sourceResults: SourceExecutionResult[] = [
      { source: "web_search", status: "succeeded", findings: [{ source: "web_search", url: "https://a.com", content: "a", confidence: 0.8, extractedAt: new Date() }], attempts: 1, durationMs: 100 },
      { source: "website", status: "succeeded", findings: [{ source: "website", url: "https://b.com", content: "b", confidence: 0.9, extractedAt: new Date() }], attempts: 1, durationMs: 100 },
      { source: "registry", status: "succeeded", findings: [{ source: "registry", url: "https://c.com", content: "c", confidence: 0.95, extractedAt: new Date() }], attempts: 1, durationMs: 100 },
      { source: "news", status: "failed", findings: [], attempts: 1, durationMs: 50 },
      { source: "linkedin", status: "skipped", findings: [], attempts: 0, durationMs: 0 },
    ];

    const scores = calculateDeterministicScores({
      sourceResults,
      hasProfile: true,
      hasAnalysis: true,
      overallConfidence: 0.88,
      outcome: "partial",
    });

    expect(scores).toContainEqual({ name: "source_coverage", value: 0.75 });
    expect(scores).toContainEqual({ name: "profile_schema_valid", value: 1 });
    expect(scores).toContainEqual({ name: "profile_confidence", value: 0.88 });
    expect(scores).toContainEqual({ name: "analysis_schema_valid", value: 1 });
    expect(scores).toContainEqual({ name: "research_success", value: "partial" });
  });

  it("returns no-op / null handler when LANGFUSE_ENABLED is false", () => {
    const prev = process.env.LANGFUSE_ENABLED;
    process.env.LANGFUSE_ENABLED = "false";

    const handler = createLangfuseCallback({
      researchRunId: "run-1",
      companyId: "fpt",
      requestedSources: ["web_search"],
    });

    expect(handler).toBeNull();
    process.env.LANGFUSE_ENABLED = prev;
  });
});
