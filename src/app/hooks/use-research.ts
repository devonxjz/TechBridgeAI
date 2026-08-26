"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  CompanyInput,
  CompanyProfile,
  ProfileDiff,
  AnalysisReport,
  SourceName,
  StreamEvent,
  CacheSuggestion,
  CacheHitMatchedBy,
  ResearchErrorCode,
  ResearchRequest,
} from "@/lib/types";

export type SourceStatus = "idle" | "started" | "done" | "failed";

export interface ResearchState {
  status: "idle" | "researching" | "building" | "suggesting" | "done" | "error";
  input: CompanyInput | null;
  sourceStatuses: Record<SourceName, SourceStatus>;
  findings: { source: SourceName; summary: string }[];
  profile: CompanyProfile | null;
  diff: ProfileDiff | null;
  report: AnalysisReport | null;
  error: string | null;
  errorCode?: ResearchErrorCode;
  notice?: string | null;
  suggestions: CacheSuggestion[];
  cacheHit: {
    matchedBy: CacheHitMatchedBy;
    version: number;
    lastSyncedAt: string;
  } | null;
}

export const INITIAL_STATE: ResearchState = {
  status: "idle",
  input: null,
  sourceStatuses: {
    web_search: "idle",
    website: "idle",
    registry: "idle",
    news: "idle",
    linkedin: "idle",
  },
  findings: [],
  profile: null,
  diff: null,
  report: null,
  error: null,
  notice: null,
  suggestions: [],
  cacheHit: null,
};

export function buildResearchRequest(
  input: CompanyInput,
  cache?: ResearchRequest["cache"]
): ResearchRequest {
  return cache ? { input, cache } : { input };
}

export function reduceResearchEvent(
  state: ResearchState,
  event: StreamEvent
): ResearchState {
  switch (event.event) {
    case "research:start":
      return {
        ...state,
        status: "researching",
        error: null,
        errorCode: undefined,
        sourceStatuses: {
          web_search: "idle",
          website: "idle",
          registry: "idle",
          news: "idle",
          linkedin: "idle",
        },
      };

    case "research:progress":
      return {
        ...state,
        sourceStatuses: {
          ...state.sourceStatuses,
          [event.data.source]: event.data.status as SourceStatus,
        },
      };

    case "research:finding":
      return {
        ...state,
        findings: [
          ...state.findings,
          {
            source: event.data.source,
            summary: event.data.summary,
          },
        ],
      };

    case "profile:building":
      return {
        ...state,
        status: "building",
      };

    case "profile:ready":
      return {
        ...state,
        profile: event.data.profile,
      };

    case "diff:ready":
      return {
        ...state,
        diff: event.data.diff,
      };

    case "analysis:ready":
      return {
        ...state,
        report: event.data.report,
      };

    case "cache:hit":
      return {
        ...state,
        cacheHit: {
          matchedBy: event.data.matchedBy,
          version: event.data.version,
          lastSyncedAt: event.data.lastSyncedAt,
        },
      };

    case "cache:suggestions":
      return {
        ...state,
        status: "suggesting",
        suggestions: event.data.suggestions,
      };

    case "error":
      if (event.data.code === "cache_invalid") {
        return {
          ...state,
          notice: event.data.message,
        };
      }
      return {
        ...state,
        error: event.data.message,
        errorCode: event.data.code,
      };

    case "done":
      if (state.status === "suggesting") {
        return state;
      }
      return {
        ...state,
        status: state.error && !state.profile ? "error" : "done",
      };

    default:
      return state;
  }
}

export function useResearch() {
  const [state, setState] = useState<ResearchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const research = useCallback(
    async (input: CompanyInput, cache?: ResearchRequest["cache"]) => {
      // Abort previous research
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        ...INITIAL_STATE,
        input,
        status: "researching",
      });

      try {
        const payload = buildResearchRequest(input, cache);

        const response = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errBody = (await response.json().catch(() => ({}))) as {
            error?: string;
            code?: ResearchErrorCode;
          };
          setState((prev) => ({
            ...prev,
            status: "error",
            error: errBody.error ?? `HTTP ${response.status}`,
            errorCode: errBody.code,
          }));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));
                const streamEvent = {
                  event: currentEvent,
                  data,
                } as StreamEvent;
                setState((prev) => reduceResearchEvent(prev, streamEvent));
              } catch {
                // Skip malformed JSON
              }
              currentEvent = "";
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          status: "error",
          error: (err as Error).message,
        }));
      }
    },
    []
  );

  const selectSuggestion = useCallback(
    (companyId: string) => {
      if (!state.input) return;
      void research(state.input, { action: "select", companyId });
    },
    [research, state.input]
  );

  const refreshResearch = useCallback(() => {
    if (!state.input || !state.profile) return;
    void research(state.input, {
      action: "refresh",
      companyId: state.profile.id,
    });
  }, [research, state.input, state.profile]);

  const bypassAndResearch = useCallback(() => {
    if (!state.input) return;
    void research(state.input, { action: "bypass" });
  }, [research, state.input]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    state,
    research,
    selectSuggestion,
    refreshResearch,
    bypassAndResearch,
    reset,
  };
}
