/**
 * Reducer tests for `handleCompactBoundary` — appends a compaction
 * `system_note` (`source: "compact"`) to the active turn's scratch.
 *
 * Auto-compaction fires mid-turn, so a turn is in flight; with no active
 * turn the boundary is dropped (a typed `/compact` is client-dispatched
 * and never reaches the bridge anyway).
 *
 * Pins:
 *   - mid-turn: a `system_note` with `source:"compact"` is appended,
 *     carrying the derived divider text,
 *   - idle (no active turn): inert,
 *   - the note does not displace the turn's opening `user_message`.
 */

import { describe, it, expect } from "bun:test";

import {
  reduce,
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

function fresh(): CodeSessionState {
  return createInitialState(FIXTURE_IDS.TUG_SESSION_ID, "test", "new");
}

function applyAll(
  state: CodeSessionState,
  events: ReadonlyArray<CodeSessionEvent>,
): CodeSessionState {
  let current = state;
  for (const ev of events) {
    current = reduce(current, ev).state;
  }
  return current;
}

const SEND: CodeSessionEvent = {
  type: "send",
  text: "hi",
  atoms: [],
  content: [{ type: "text" as const, text: "hi" }],
  turnKey: "k1",
} as CodeSessionEvent;

function compactBoundary(preTokens?: number): CodeSessionEvent {
  return {
    type: "compact_boundary",
    trigger: "auto",
    ...(preTokens !== undefined ? { preTokens } : {}),
  } as CodeSessionEvent;
}

describe("reducer — handleCompactBoundary", () => {
  it("appends a compact system_note to the active turn mid-turn", () => {
    const state = applyAll(fresh(), [
      SEND,
      { type: "assistant_text", msg_id: "m1", block_index: 0, text: "working", is_partial: true } as CodeSessionEvent,
      compactBoundary(48_000),
    ]);
    const entry = state.scratch.get("k1");
    expect(entry).toBeDefined();
    const note = entry!.messages.find((m) => m.kind === "system_note");
    expect(note).toBeDefined();
    if (note && note.kind === "system_note") {
      expect(note.source).toBe("compact");
      expect(note.text).toBe("Conversation compacted · ~48k tokens");
    }
    // The opening user_message is still at the head, undisturbed.
    expect(entry!.messages[0]?.kind).toBe("user_message");
  });

  it("is inert when no turn is in flight (idle)", () => {
    const before = fresh();
    const after = reduce(before, compactBoundary(48_000)).state;
    expect(after).toBe(before);
  });
});
