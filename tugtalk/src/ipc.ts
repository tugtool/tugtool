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
 * Validate and parse a JSON line into an InboundMessage.
 * Returns null on failure, logs error to stderr.
 */
export function validateMessage(raw: string): InboundMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (isInboundMessage(parsed)) {
      return parsed;
    } else {
      console.error(`[tugtalk] Invalid message type: ${JSON.stringify(parsed)}`);
      return null;
    }
  } catch (err) {
    console.error(`[tugtalk] JSON parse error: ${err}`);
    return null;
  }
}
