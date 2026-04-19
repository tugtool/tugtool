// JSON-lines IPC protocol implementation

import type { InboundMessage, OutboundMessage } from "./types.ts";
import { isInboundMessage } from "./types.ts";

/**
 * Async generator that reads JSON lines from stdin.
 * Yields valid InboundMessage objects, logs invalid lines to stderr.
 */
export async function* readLine(): AsyncGenerator<InboundMessage, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });

    let lineEnd = buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);

      if (line.length > 0) {
        const msg = validateMessage(line);
        if (msg) {
          yield msg;
        }
      }

      lineEnd = buffer.indexOf("\n");
    }
  }
}

/**
 * Write an outbound message as a JSON line to stdout.
 */
export function writeLine(msg: OutboundMessage): void {
  const json = JSON.stringify(msg);
  Bun.write(Bun.stdout, json + "\n");
}

/**
 * Write a final outbound message and call `process.exit(code)` only
 * after the bytes have been flushed to stdout. Used by the early-exit
 * watcher in `SessionManager` so the bridge actually receives the
 * `resume_failed` / `error` IPC line before tugcode dies — a plain
 * `writeLine(...); process.exit(...)` races the async write against
 * the exit and silently drops the frame.
 *
 * Awaits `Bun.write` (which only resolves once the bytes are in the
 * stdout pipe) before exiting. Goes through the same `Bun.write`
 * path as `writeLine` so test mocks see it identically.
 */
export async function writeLineAndExit(
  msg: OutboundMessage,
  code: number,
): Promise<void> {
  const json = JSON.stringify(msg) + "\n";
  await Bun.write(Bun.stdout, json);
  process.exit(code);
  // process.exit normally never returns. In tests `process.exit` is
  // stubbed to a no-op so the test process survives — let the function
  // simply return in that case rather than throwing.
}

/**
 * Validate and parse a JSON line into an InboundMessage.
 * Returns null on failure, logs error to stderr.
 */
export function validateMessage(raw: string): InboundMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (isInboundMessage(parsed)) {
      return parsed;
    } else {
      console.error(`[tugcode] Invalid message type: ${JSON.stringify(parsed)}`);
      return null;
    }
  } catch (err) {
    console.error(`[tugcode] JSON parse error: ${err}`);
    return null;
  }
}
