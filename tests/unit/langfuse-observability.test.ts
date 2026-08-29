import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tracingMocks = vi.hoisted(() => ({
  propagateAttributes: vi.fn(
    async (_attributes: unknown, task: () => Promise<unknown>) => task(),
  ),
  startActiveObservation: vi.fn(
    async (_name: string, task: (span: { traceId: string }) => Promise<unknown>) =>
      task({ traceId: "trace-123" }),
  ),
  updateActiveObservation: vi.fn(),
}));

const clientMocks = vi.hoisted(() => ({
  scoreCreate: vi.fn(),
  flush: vi.fn(async () => undefined),
}));

const processorMocks = vi.hoisted(() => ({
  mask: undefined as ((params: { data: unknown }) => unknown) | undefined,
  forceFlush: vi.fn(async () => undefined),
}));

vi.mock("@langfuse/tracing", () => tracingMocks);
vi.mock("@langfuse/client", () => ({
  LangfuseClient: class {
    score = { create: clientMocks.scoreCreate };
    flush = clientMocks.flush;
  },
}));
vi.mock("@langfuse/otel", () => ({
  LangfuseSpanProcessor: class {
    constructor(options: { mask: (params: { data: unknown }) => unknown }) {
      processorMocks.mask = options.mask;
    }
    forceFlush = processorMocks.forceFlush;
  },
}));
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    start() {}
  },
}));

import {
  maskPartnerIqTelemetry,
  maskPartnerIqTelemetryData,
  calculateDeterministicScores,
  emitResearchScores,
  flushLangfuse,
  initOpenTelemetry,
  traceResearch,
  hashCompanyIdentifier,
  fingerprintCacheKey,
  updateResearchCacheOutcome,
} from "@/observability/langfuse";
import type { SourceExecutionResult } from "@/lib/types";
import * as langfuseObservability from "@/observability/langfuse";

describe("Langfuse Observability & Privacy Minimization", () => {
  beforeEach(() => {
    tracingMocks.propagateAttributes.mockClear();
    tracingMocks.startActiveObservation.mockClear();
    tracingMocks.updateActiveObservation.mockClear();
    clientMocks.scoreCreate.mockClear();
    clientMocks.flush.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("redacts arbitrary callback message content", () => {
    const rawData = JSON.stringify({
      messages: [
        {
          role: "user",
          content: "Confidential scraped evidence from a company website",
        },
      ],
      metadata: {
        source: "website",
        summary: "Raw finding preview sent through a custom graph event",
      },
    });

    const masked = maskPartnerIqTelemetry(rawData);

    expect(masked).not.toContain("Confidential scraped evidence");
    expect(masked).not.toContain("Raw finding preview");
    expect(masked).toContain("[REDACTED_RAW_CONTENT]");
    expect(JSON.parse(masked)).toEqual({
      messages: [
        {
          role: "user",
          content: "[REDACTED_RAW_CONTENT]",
        },
      ],
      metadata: {
        source: "website",
        summary: "[REDACTED_RAW_CONTENT]",
      },
    });
  });

  it("removes full workflow input, credentials, cookies, and Vietnamese phones", () => {
    const masked = maskPartnerIqTelemetryData({
      input: {
        name: "Private Company",
        website: "https://private.example.com",
        taxId: "0101234567",
      },
      headers: {
        authorization: "opaque-session-value",
        cookie: "session=private-cookie",
        "x-api-key": "private-api-key",
      },
      contactPhone: "0901234567",
      safe: "workflow:research",
    });

    expect(masked).toEqual({
      input: "[REDACTED_INPUT]",
      headers: {
        authorization: "[REDACTED_CREDENTIAL]",
        cookie: "[REDACTED_CREDENTIAL]",
        "x-api-key": "[REDACTED_CREDENTIAL]",
      },
      contactPhone: "[REDACTED_PHONE]",
      safe: "workflow:research",
    });
  });

  it("masks serialized telemetry received by the span processor", () => {
    vi.stubEnv("LANGFUSE_ENABLED", "true");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    initOpenTelemetry();

    const masked = processorMocks.mask?.({
      data: JSON.stringify({
        input: { name: "Private Company" },
        cookie: "opaque-session",
        content: "private source evidence",
      }),
    });

    expect(masked).toBe(JSON.stringify({
      input: "[REDACTED_INPUT]",
      cookie: "[REDACTED_CREDENTIAL]",
      content: "[REDACTED_RAW_CONTENT]",
    }));
  });

  it("marks a failed active research observation as an error", () => {
    vi.stubEnv("LANGFUSE_ENABLED", "true");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    const updateOutcome = (
      langfuseObservability as typeof langfuseObservability & {
        updateResearchObservationOutcome?: (outcome: "failed") => void;
      }
    ).updateResearchObservationOutcome;

    updateOutcome?.("failed");

    expect(tracingMocks.updateActiveObservation).toHaveBeenCalledWith({
      level: "ERROR",
      output: { outcome: "failed" },
    });
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

  it("creates one workflow observation under the research trace", async () => {
    vi.stubEnv("LANGFUSE_ENABLED", "true");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    let receivedTraceId: string | undefined;

    await traceResearch(
      {
        researchRunId: "run-1",
        companyId: "fpt",
        requestedSources: ["web_search"],
        sessionId: "session-1",
      },
      async (traceId) => {
        receivedTraceId = traceId;
      },
    );

    expect(tracingMocks.propagateAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        traceName: "partneriq.research",
        sessionId: "session-1",
      }),
      expect.any(Function),
    );
    expect(tracingMocks.startActiveObservation).toHaveBeenCalledWith(
      "partneriq.workflow",
      expect.any(Function),
      { asType: "chain" },
    );
    expect(receivedTraceId).toBe("trace-123");
  });

  it("emits and flushes all deterministic trace scores", async () => {
    vi.stubEnv("LANGFUSE_ENABLED", "true");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");

    await emitResearchScores("trace-123", {
      sourceResults: [
        {
          source: "web_search",
          status: "succeeded",
          findings: [],
          attempts: 1,
          durationMs: 10,
        },
      ],
      hasProfile: true,
      hasAnalysis: true,
      overallConfidence: 0.8,
      outcome: "complete",
    });
    await flushLangfuse();

    expect(clientMocks.scoreCreate.mock.calls.map(([score]) => score)).toEqual([
      { traceId: "trace-123", name: "source_coverage", value: 1 },
      { traceId: "trace-123", name: "profile_schema_valid", value: 1 },
      { traceId: "trace-123", name: "profile_confidence", value: 0.8 },
      { traceId: "trace-123", name: "analysis_schema_valid", value: 1 },
      { traceId: "trace-123", name: "research_success", value: "complete" },
    ]);
    expect(clientMocks.flush).toHaveBeenCalledOnce();
  });

  it("hashes company identifier deterministically with salt", () => {
    vi.stubEnv("LANGFUSE_SALT", "test-secret-salt");
    const hash1 = hashCompanyIdentifier("0101248141");
    const hash2 = hashCompanyIdentifier("0101248141");
    const hashDiff = hashCompanyIdentifier("0101245486");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDiff);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  it("fingerprints low-entropy tax IDs with a keyed HMAC", () => {
    const first = fingerprintCacheKey("tax_id", "0101248141", "secret-a");
    const second = fingerprintCacheKey("tax_id", "0101248141", "secret-b");

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("0101248141");
    expect(second).not.toBe(first);
    expect(fingerprintCacheKey("tax_id", "0101248141", undefined)).toBeUndefined();
  });

  it("updates active observation with research cache telemetry", () => {
    vi.stubEnv("LANGFUSE_ENABLED", "true");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");

    updateResearchCacheOutcome({
      cacheOutcome: "hit",
      matchedBy: "tax_id",
      version: 1,
      lastSyncedAt: "2026-08-26T08:00:00.000Z",
      lookupDurationMs: 42,
      keyType: "tax_id",
      keyFingerprint: "fingerprint-123",
    });

    expect(tracingMocks.updateActiveObservation).toHaveBeenCalledWith({
      output: {
        cacheOutcome: "hit",
        matchedBy: "tax_id",
        version: 1,
        lastSyncedAt: "2026-08-26T08:00:00.000Z",
        lookupDurationMs: 42,
        keyType: "tax_id",
        keyFingerprint: "fingerprint-123",
      },
    });
  });

  it("includes cache metadata in trace attributes", async () => {
    vi.stubEnv("LANGFUSE_ENABLED", "true");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");

    await traceResearch(
      {
        researchRunId: "run-cache-hit",
        companyId: "comp-fpt",
        requestedSources: [],
        cacheHit: true,
        cacheMatchedBy: "tax_id",
        cacheAction: "auto",
      },
      async () => undefined
    );

    expect(tracingMocks.propagateAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining(["cache:hit"]),
        metadata: expect.objectContaining({
          cacheHit: "true",
          cacheMatchedBy: "tax_id",
          cacheAction: "auto",
          companyIdHash: expect.any(String),
        }),
      }),
      expect.any(Function)
    );
  });
});
