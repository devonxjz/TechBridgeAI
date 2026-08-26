import { describe, it, expect } from "vitest";
import {
  reduceResearchEvent,
  buildResearchRequest,
  INITIAL_STATE,
  type ResearchState,
} from "@/app/hooks/use-research";
import type { StreamEvent, CompanyProfile, AnalysisReport, ProfileDiff } from "@/lib/types";

describe("useResearch request builder - buildResearchRequest", () => {
  it("builds default, selected, bypass, and refresh requests", () => {
    const input = { name: "FPT" };

    expect(buildResearchRequest(input)).toEqual({ input });
    expect(buildResearchRequest(input, { action: "select", companyId: "fpt" }))
      .toEqual({ input, cache: { action: "select", companyId: "fpt" } });
    expect(buildResearchRequest(input, { action: "bypass" }))
      .toEqual({ input, cache: { action: "bypass" } });
    expect(buildResearchRequest(input, { action: "refresh", companyId: "fpt" }))
      .toEqual({ input, cache: { action: "refresh", companyId: "fpt" } });
  });
});

describe("useResearch pure reducer - reduceResearchEvent", () => {
  const dummyProfile: CompanyProfile = {
    id: "comp-1",
    version: 1,
    createdAt: new Date(),
    lastUpdated: new Date(),
    input: { name: "Test" },
    officialName: "Test Corp",
    tradingNames: [],
    industry: ["Tech"],
    description: "Desc",
    keyPeople: [],
    products: [],
    markets: [],
    recentActivities: [],
    sources: [],
    overallConfidence: 0.9,
  };

  const dummyDiff: ProfileDiff = {
    companyId: "comp-1",
    fromVersion: 1,
    toVersion: 2,
    summary: "Markets updated",
    changes: [
      {
        field: "markets",
        changeType: "modified",
        oldValue: ["Việt Nam"],
        newValue: ["Việt Nam", "Mỹ"],
        significance: "medium",
      },
    ],
  };

  const dummyReport: AnalysisReport = {
    companyId: "comp-1",
    generatedAt: new Date(),
    riskFlags: [],
    suggestedActions: [],
    executiveSummary: "Executive Summary",
  };

  it("resets errors on research:start", () => {
    const errorState: ResearchState = {
      ...INITIAL_STATE,
      status: "error",
      error: "Previous error",
      errorCode: "identity_conflict",
    };

    const nextState = reduceResearchEvent(errorState, {
      event: "research:start",
      data: { sources: ["web_search", "news"] },
    });

    expect(nextState.status).toBe("researching");
    expect(nextState.error).toBeNull();
    expect(nextState.errorCode).toBeUndefined();
    expect(nextState.sourceStatuses.web_search).toBe("idle");
  });

  it("updates individual source statuses on research:progress", () => {
    let state = reduceResearchEvent(INITIAL_STATE, {
      event: "research:progress",
      data: { source: "web_search", status: "started" },
    });
    expect(state.sourceStatuses.web_search).toBe("started");
    expect(state.sourceStatuses.news).toBe("idle");

    state = reduceResearchEvent(state, {
      event: "research:progress",
      data: { source: "web_search", status: "done" },
    });
    expect(state.sourceStatuses.web_search).toBe("done");
  });

  it("appends findings on research:finding", () => {
    let state = reduceResearchEvent(INITIAL_STATE, {
      event: "research:finding",
      data: { source: "web_search", summary: "Finding 1" },
    });
    state = reduceResearchEvent(state, {
      event: "research:finding",
      data: { source: "news", summary: "Finding 2" },
    });

    expect(state.findings).toHaveLength(2);
    expect(state.findings[0]).toEqual({ source: "web_search", summary: "Finding 1" });
    expect(state.findings[1]).toEqual({ source: "news", summary: "Finding 2" });
  });

  it("sets building status on profile:building", () => {
    const nextState = reduceResearchEvent(INITIAL_STATE, {
      event: "profile:building",
      data: { message: "Building..." },
    });
    expect(nextState.status).toBe("building");
  });

  it("records profile diff on diff:ready", () => {
    const nextState = reduceResearchEvent(INITIAL_STATE, {
      event: "diff:ready",
      data: { diff: dummyDiff },
    });
    expect(nextState.diff).toEqual(dummyDiff);
  });

  it("handles cache:hit event and records metadata", () => {
    const event: StreamEvent = {
      event: "cache:hit",
      data: {
        companyId: "comp-1",
        matchedBy: "tax_id",
        version: 1,
        lastSyncedAt: "2026-08-26T08:00:00.000Z",
      },
    };

    const nextState = reduceResearchEvent(INITIAL_STATE, event);
    expect(nextState.cacheHit).toEqual({
      matchedBy: "tax_id",
      version: 1,
      lastSyncedAt: "2026-08-26T08:00:00.000Z",
    });
  });

  it("transitions to suggesting state on cache:suggestions", () => {
    const event: StreamEvent = {
      event: "cache:suggestions",
      data: {
        suggestions: [
          {
            companyId: "comp-1",
            officialName: "FPT Corporation",
            taxId: "0101248141",
            lastSyncedAt: "2026-08-26T08:00:00.000Z",
          },
        ],
      },
    };

    const nextState = reduceResearchEvent(INITIAL_STATE, event);
    expect(nextState.status).toBe("suggesting");
    expect(nextState.suggestions).toHaveLength(1);
    expect(nextState.suggestions[0].companyId).toBe("comp-1");
  });

  it("preserves suggesting status on done event", () => {
    const suggestingState: ResearchState = {
      ...INITIAL_STATE,
      status: "suggesting",
      suggestions: [
        {
          companyId: "comp-1",
          officialName: "FPT Corporation",
          lastSyncedAt: "2026-08-26T08:00:00.000Z",
        },
      ],
    };

    const event: StreamEvent = {
      event: "done",
      data: {},
    };

    const nextState = reduceResearchEvent(suggestingState, event);
    expect(nextState.status).toBe("suggesting");
  });

  it("records error and error code on error event", () => {
    const event: StreamEvent = {
      event: "error",
      data: {
        message: "Thông tin định danh công ty mâu thuẫn.",
        code: "identity_conflict",
      },
    };

    const nextState = reduceResearchEvent(INITIAL_STATE, event);
    expect(nextState.error).toBe("Thông tin định danh công ty mâu thuẫn.");
    expect(nextState.errorCode).toBe("identity_conflict");
  });

  it("transitions to done when profile and analysis are ready", () => {
    let state = reduceResearchEvent(INITIAL_STATE, {
      event: "profile:ready",
      data: { profile: dummyProfile },
    });
    state = reduceResearchEvent(state, {
      event: "analysis:ready",
      data: { report: dummyReport },
    });
    state = reduceResearchEvent(state, {
      event: "done",
      data: {},
    });

    expect(state.status).toBe("done");
    expect(state.profile?.id).toBe("comp-1");
    expect(state.report?.companyId).toBe("comp-1");
  });
});
