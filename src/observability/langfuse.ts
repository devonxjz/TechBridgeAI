// ═══════════════════════════════════════════════════════
// Langfuse Observability & Privacy Minimization
// Provides client-side masking, deterministic scoring, and OTel/LangChain callback
// ═══════════════════════════════════════════════════════

import { CallbackHandler } from "@langfuse/langchain";
import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  propagateAttributes,
  startActiveObservation,
  updateActiveObservation,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type {
  ResearchOutcome,
  SourceExecutionResult,
  SourceName,
} from "@/lib/types";
import type { ResearchWorkflowState } from "@/modules/workflow/state";

const APP_VERSION = "0.0.2";
const RAW_CONTENT_KEYS = new Set(["content", "summary", "text", "html"]);
const CREDENTIAL_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "apikey",
  "xapikey",
  "secret",
  "secretkey",
  "token",
  "accesstoken",
  "refreshtoken",
]);
const PHONE_KEY_PARTS = ["phone", "tel", "mobile", "hotline"];

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
  try {
    return JSON.stringify(maskPartnerIqTelemetryData(JSON.parse(serialized)));
  } catch {
    return maskSensitiveString(serialized);
  }
}

export function maskPartnerIqTelemetryData(data: unknown): unknown {
  if (typeof data === "string") {
    if (data.includes("UNTRUSTED_SOURCE_DATA")) {
      return "[REDACTED_RAW_CONTENT]";
    }
    return maskSensitiveString(data);
  }

  if (Array.isArray(data)) {
    return data.map(maskPartnerIqTelemetryData);
  }

  if (data && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => {
        const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
        let maskedValue: unknown;

        if (normalizedKey === "input") maskedValue = "[REDACTED_INPUT]";
        else if (CREDENTIAL_KEYS.has(normalizedKey)) {
          maskedValue = "[REDACTED_CREDENTIAL]";
        } else if (PHONE_KEY_PARTS.some((part) => normalizedKey.includes(part))) {
          maskedValue = "[REDACTED_PHONE]";
        } else if (RAW_CONTENT_KEYS.has(normalizedKey)) {
          maskedValue = "[REDACTED_RAW_CONTENT]";
        } else maskedValue = maskPartnerIqTelemetryData(value);

        return [key, maskedValue];
      }),
    );
  }

  return data;
}

function maskSensitiveString(serialized: string): string {
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
  masked = masked.replace(
    /\b(?:\+?84|0)(?:3|5|7|8|9)(?:[\s.-]?\d){8}\b/g,
    "[REDACTED_PHONE]"
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
let _client: LangfuseClient | null = null;

function isLangfuseEnabled(): boolean {
  return (
    process.env.LANGFUSE_ENABLED === "true" &&
    Boolean(process.env.LANGFUSE_PUBLIC_KEY) &&
    Boolean(process.env.LANGFUSE_SECRET_KEY)
  );
}

function getLangfuseClient(): LangfuseClient | null {
  if (!isLangfuseEnabled()) return null;
  _client ??= new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });
  return _client;
}

export async function traceResearch<T>(
  context: ResearchTraceContext,
  task: (traceId?: string) => Promise<T>,
): Promise<T> {
  if (!isLangfuseEnabled()) return task();

  let taskPromise: Promise<T> | undefined;
  try {
    return await propagateAttributes(
      {
        traceName: "partneriq.research",
        sessionId: context.sessionId,
        version: APP_VERSION,
        tags: ["workflow:research", "surface:sse"],
        environment:
          process.env.LANGFUSE_TRACING_ENVIRONMENT || "production",
        metadata: {
          researchRunId: context.researchRunId,
          companyId: context.companyId,
          requestedSources: context.requestedSources.join(","),
        },
      },
      () =>
        startActiveObservation(
          "partneriq.workflow",
          (workflow) => {
            taskPromise = task(workflow.traceId);
            return taskPromise;
          },
          { asType: "chain" },
        ),
    );
  } catch (error) {
    if (taskPromise) return await taskPromise;
    console.warn("[Langfuse] Research trace initialization failed:", error);
    return task();
  }
}

export async function observeResearchStep<T>(
  name: string,
  task: () => Promise<T>,
): Promise<T> {
  if (!isLangfuseEnabled()) return task();

  let taskPromise: Promise<T> | undefined;
  try {
    return await startActiveObservation(name, () => {
      taskPromise = task();
      return taskPromise;
    });
  } catch (error) {
    if (taskPromise) return await taskPromise;
    console.warn(`[Langfuse] Observation ${name} failed to initialize:`, error);
    return task();
  }
}

export function updateResearchTraceOutcome(state: ResearchWorkflowState): void {
  if (!isLangfuseEnabled()) return;
  updateActiveObservation({
    level:
      state.outcome === "failed"
        ? "ERROR"
        : state.outcome === "partial"
          ? "WARNING"
          : "DEFAULT",
    output: {
      outcome: state.outcome,
      sourceCount: state.sourceResults.length,
      hasProfile: Boolean(state.profile),
      hasAnalysis: Boolean(state.report),
    },
  });
}

export function updateResearchObservationOutcome(
  outcome: "partial" | "failed" | "cancelled",
): void {
  if (!isLangfuseEnabled()) return;
  updateActiveObservation({
    level: outcome === "partial" ? "WARNING" : "ERROR",
    output: { outcome },
  });
}

export async function emitResearchScores(
  traceId: string | undefined,
  params: ScoreParams,
): Promise<void> {
  const client = getLangfuseClient();
  if (!client || !traceId) return;

  try {
    for (const score of calculateDeterministicScores(params)) {
      client.score.create({ traceId, ...score });
    }
  } catch (error) {
    console.warn("[Langfuse] Failed to queue research scores:", error);
  }
}

export function initOpenTelemetry(): void {
  if (_sdk || !isLangfuseEnabled()) return;
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
        return typeof data === "string"
          ? maskPartnerIqTelemetry(data)
          : maskPartnerIqTelemetryData(data);
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
  const isEnabled = isLangfuseEnabled();
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!isEnabled || !publicKey || !secretKey) {
    return null;
  }

  try {
    return new CallbackHandler({
      sessionId: context.sessionId,
      version: APP_VERSION,
      tags: ["workflow:research", "surface:sse"],
      traceMetadata: {
        researchRunId: context.researchRunId,
        companyId: context.companyId,
        requestedSources: context.requestedSources,
        appVersion: APP_VERSION,
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
  if (_client) {
    try {
      await _client.flush();
    } catch (err) {
      console.warn("[Langfuse] score flush failed:", err);
    }
  }
}
