// ═══════════════════════════════════════════════════════
// SSE Stream Utilities
// ═══════════════════════════════════════════════════════

import type { StreamEvent } from "@/lib/types";

export interface SSEWriter {
  write(event: StreamEvent): void;
  close(): void;
}

/**
 * Create a ReadableStream that accepts StreamEvents and encodes them as SSE.
 */
export function createSSEStream(): {
  stream: ReadableStream<Uint8Array>;
  writer: SSEWriter;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let isClosed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      isClosed = true;
    },
  });

  return {
    stream,
    writer: {
      write(event: StreamEvent) {
        if (isClosed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        } catch {
          isClosed = true;
        }
      },
      close() {
        if (isClosed) return;
        isClosed = true;
        try {
          controller.close();
        } catch {}
      },
    },
  };
}
