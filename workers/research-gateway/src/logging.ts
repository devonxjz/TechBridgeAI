export interface LogEvent {
  requestId: string;
  stage: "request" | "auth" | "membership" | "quota" | "origin" | "config";
  outcome: "allowed" | "denied" | "error" | "proxied";
  status: number;
  environment: string;
  durationMs: number;
  originStatus?: number;
}

export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify({ event: "research_gateway", ...event }));
}
