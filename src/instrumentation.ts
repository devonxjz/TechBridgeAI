// ═══════════════════════════════════════════════════════
// Next.js Instrumentation Hook
// Initializes OpenTelemetry / Langfuse only in Node.js runtime
// ═══════════════════════════════════════════════════════

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initOpenTelemetry } = await import("./observability/langfuse");
    initOpenTelemetry();
  }
}

