// ═══════════════════════════════════════════════════════
// Langfuse Observability & Privacy Minimization
// Provides client-side masking, deterministic scoring, and OTel/LangChain callback
// ═══════════════════════════════════════════════════════

import { CallbackHandler } from "@langfuse/langchain";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type {
  ResearchOutcome,
  SourceExecutionResult,
  SourceName,
} from "@/lib/types";

export interface ResearchTraceContext {
  researchRunId: string;
  companyId: string;
  requestedSources: SourceName[];
  sessionId?: string;
}

export interface DeterministicScore {
  name: string;
  value: number | string;
}

export function maskPartnerIqTelemetry(serialized: string): string {
  let masked = serialized;

  // 1. Redact Authorization / API keys (sk-...)
  masked = masked.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer [REDACTED_TOKEN]");
  masked = masked.replace(/sk-[A-Za-z0-9_\-\.]+/gi, "[REDACTED_API_KEY]");

  // 2. Redact email addresses
  masked = masked.replace(
    /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g,
    "[REDACTED_EMAIL]"
  );

  // 3. Redact phone fields and formatted phone numbers
  masked = masked.replace(
    /("(?:phone|tel|mobile|telephone|hotline)"\s*:\s*)"[^"]*"/gi,
    '$1"[REDACTED_PHONE]"'
  );
  masked = masked.replace(
    /\+\d{1,4}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g,
    "[REDACTED_PHONE]"
  );

  // 4. Redact raw scraped page content fields
  masked = masked.replace(
    /"content"\s*:\s*"raw scraped page[^"]*"/gi,
    '"content":"[REDACTED_RAW_CONTENT]"'
  );

  return masked;
}

export interface ScoreParams {
  sourceResults: SourceExecutionResult[];
  hasProfile: boolean;
  hasAnalysis: boolean;
  overallConfidence: number;
  outcome: Exclude<ResearchOutcome, "running">;
}

export function calculateDeterministicScores(
  params: ScoreParams
): DeterministicScore[] {
  const activeResults = params.sourceResults.filter(
    (r) => r.status !== "skipped"
  );
  const succeededResults = activeResults.filter((r) => r.status === "succeeded");
  const sourceCoverage =
    activeResults.length > 0
      ? succeededResults.length / activeResults.length
      : 0;

  return [
    { name: "source_coverage", value: sourceCoverage },
    { name: "profile_schema_valid", value: params.hasProfile ? 1 : 0 },
    { name: "profile_confidence", value: params.overallConfidence },
    { name: "analysis_schema_valid", value: params.hasAnalysis ? 1 : 0 },
    { name: "research_success", value: params.outcome },
  ];
}

let _processor: LangfuseSpanProcessor | null = null;
let _sdk: NodeSDK | null = null;

export function initOpenTelemetry(): void {
  if (_sdk || process.env.LANGFUSE_ENABLED !== "true") return;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return;

  try {
    _processor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_BASE_URL,
      environment: process.env.LANGFUSE_TRACING_ENVIRONMENT || "production",
      exportMode: "immediate",
      mask: ({ data }) => {
        if (typeof data === "string") {
          return maskPartnerIqTelemetry(data);
        }
        return data;
      },
    });

    _sdk = new NodeSDK({
      spanProcessors: [_processor],
    });

    _sdk.start();
  } catch (err) {
    console.warn("[Langfuse] OpenTelemetry initialization failed:", err);
  }
}

export function createLangfuseCallback(
  context: ResearchTraceContext
): CallbackHandler | null {
  const isEnabled = process.env.LANGFUSE_ENABLED === "true";
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!isEnabled || !publicKey || !secretKey) {
    return null;
  }

  try {
    return new CallbackHandler({
      sessionId: context.sessionId,
      userId: context.companyId,
      version: "0.1.0",
      tags: ["workflow:research", "surface:sse"],
      traceMetadata: {
        researchRunId: context.researchRunId,
        companyId: context.companyId,
        requestedSources: context.requestedSources,
        appVersion: "0.1.0",
      },
    });
  } catch (err) {
    console.warn("[Langfuse] Failed to initialize CallbackHandler:", err);
    return null;
  }
}

export async function flushLangfuse(): Promise<void> {
  if (_processor) {
    try {
      await _processor.forceFlush();
    } catch (err) {
      console.warn("[Langfuse] forceFlush failed:", err);
    }
  }
}
