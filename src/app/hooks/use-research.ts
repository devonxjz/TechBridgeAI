"use client";

import { useState, useCallback, useRef } from "react";
import type {
  CompanyInput,
  CompanyProfile,
  ProfileDiff,
  AnalysisReport,
  SourceName,
} from "@/lib/types";

export type SourceStatus = "idle" | "started" | "done" | "failed";

export interface ResearchState {
  status: "idle" | "researching" | "building" | "done" | "error";
  sourceStatuses: Record<SourceName, SourceStatus>;
  findings: { source: SourceName; summary: string }[];
  profile: CompanyProfile | null;
  diff: ProfileDiff | null;
  report: AnalysisReport | null;
  error: string | null;
}

const INITIAL_STATE: ResearchState = {
  status: "idle",
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
};

export function useResearch() {
  const [state, setState] = useState<ResearchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const research = useCallback(async (input: CompanyInput) => {
    // Abort previous research
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...INITIAL_STATE,
      status: "researching",
    });

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error ?? `HTTP ${response.status}`
        );
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
              handleSSEEvent(currentEvent, data, setState);
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
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { state, research, reset };
}

function handleSSEEvent(
  event: string,
  data: Record<string, unknown>,
  setState: React.Dispatch<React.SetStateAction<ResearchState>>
) {
  switch (event) {
    case "research:progress":
      setState((prev) => ({
        ...prev,
        sourceStatuses: {
          ...prev.sourceStatuses,
          [data.source as string]: data.status as SourceStatus,
        },
      }));
      break;

    case "research:finding":
      setState((prev) => ({
        ...prev,
        findings: [
          ...prev.findings,
          {
            source: data.source as SourceName,
            summary: data.summary as string,
          },
        ],
      }));
      break;

    case "profile:building":
      setState((prev) => ({
        ...prev,
        status: "building",
      }));
      break;

    case "profile:ready":
      setState((prev) => ({
        ...prev,
        profile: data.profile as CompanyProfile,
      }));
      break;

    case "diff:ready":
      setState((prev) => ({
        ...prev,
        diff: (data.diff as ProfileDiff) ?? null,
      }));
      break;

    case "analysis:ready":
      setState((prev) => ({
        ...prev,
        report: (data.report as AnalysisReport) ?? null,
      }));
      break;

    case "error":
      setState((prev) => ({
        ...prev,
        error: data.message as string,
      }));
      break;

    case "done":
      setState((prev) => ({
        ...prev,
        status: prev.error && !prev.profile ? "error" : "done",
      }));
      break;
  }
}
