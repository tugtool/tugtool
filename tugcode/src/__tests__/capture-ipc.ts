// Shared capture-helper support for session-level stdout tests.
//
// The cold-replay emitter ships committed-turn content as `replay_batch`
// transport envelopes (one wire line carrying many frames). Session-level
// tests assert on individual replay frames, so a capture helper must
// expand those envelopes back into their inner frames — exactly as the
// browser does at its ingest boundary. This is the one place that unwrap
// lives; the per-file capture helpers run their parsed output through it.

import type { OutboundMessage } from "../types.ts";

/**
 * Expand any `replay_batch` envelopes in a captured IPC stream into their
 * inner frames. Non-batch frames pass through unchanged, so this is
 * identity on streams that contain no batches.
 */
export function unwrapReplayBatches(
  msgs: OutboundMessage[],
): OutboundMessage[] {
  const out: OutboundMessage[] = [];
  for (const m of msgs) {
    if (m.type === "replay_batch") {
      out.push(...m.frames);
    } else {
      out.push(m);
    }
  }
  return out;
}
