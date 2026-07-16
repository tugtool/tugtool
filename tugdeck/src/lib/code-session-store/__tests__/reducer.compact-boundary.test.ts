/**
 * Reducer tests for `handleCompactBoundary` / `handleCompactSummary`.
 *
 * Mid-turn (live: a native `/compact` send opens a turn, auto-compaction fires
 * inside one) the boundary appends a `system_note` (`source: "compact"`) to the
 * active turn's scratch. With no open turn (replay path) it emits an
 * `append-compact-note` effect the wrapper seats on the last committed turn
 * ([P04]) — state is untouched, so the pure reducer's contract is "effect
 * emitted, state unchanged." `handleCompactSummary` folds the summary into
 * `compactionSeed` ([P05]), latest-wins.
 *
 * Pins:
 *   - mid-turn: a `system_note` with `source:"compact"` is appended,
 *     carrying the derived divider text, without displacing the `user_message`,
 *   - idle (no active turn): state unchanged + one `append-compact-note` effect,
 *   - compact_summary sets `compactionSeed.summary` (replaying + live), overwrites.
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

function compactBoundary(preTokens?: number, postTokens?: number): CodeSessionEvent {
  return {
    type: "compact_boundary",
    trigger: "auto",
    ...(preTokens !== undefined ? { preTokens } : {}),
    ...(postTokens !== undefined ? { postTokens } : {}),
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
      expect(note.text).toBe("Session compacted · ~48k tokens");
    }
    // The opening user_message is still at the head, undisturbed.
    expect(entry!.messages[0]?.kind).toBe("user_message");
  });

  it("stamps the HONEST post-compaction window (sessionInit + postTokens), not raw postTokens", () => {
    // A compaction turn's own cost_update reports the pre-compaction context it
    // read (here: none), so without the stamp the committed window would carry
    // the stale peak forward. Raw postTokens alone is a sub-base figure ([P02]);
    // the honest window is `sessionInit + postTokens` and rides a dedicated
    // field, never `cost` ([P01]).
    let s = fresh();
    s = reduce(s, SEND).state;
    // Establish the session base via a token-bearing streaming_usage frame.
    s = reduce(s, {
      type: "streaming_usage",
      msg_id: "m1",
      usage: { input_tokens: 24_000 },
    } as CodeSessionEvent).state;
    s = reduce(s, { type: "assistant_text", msg_id: "m1", block_index: 0, text: "Compacted", is_partial: false } as CodeSessionEvent).state;
    s = reduce(s, compactBoundary(42_396, 2_011)).state;
    const scratch = s.scratch.get("k1");
    // Honest total = sessionInit (24_000) + post_tokens (2_011).
    expect(scratch?.compactionPostTotal).toBe(26_011);

    const { effects } = reduce(s, { type: "turn_complete", msg_id: "m1", result: "success" } as CodeSessionEvent);
    const append = effects.find((e) => e.kind === "append-transcript");
    expect(append).toBeDefined();
    if (append && append.kind === "append-transcript") {
      // The committed entry carries the honest total in its dedicated field.
      expect(append.entry.compactionPostTotal).toBe(26_011);
      // The cost stays real (zero-usage here) — postTokens never leaks into it.
      const c = append.entry.cost;
      const costWindow =
        c.inputTokens + c.outputTokens + c.cacheReadInputTokens + c.cacheCreationInputTokens;
      expect(costWindow).toBe(0);
    }
  });

  it("leaves compactionPostTotal unset when sessionInit is unknown", () => {
    // No streaming_usage frame ⇒ sessionInitTokens null ⇒ no honest total to
    // stamp (raw postTokens must never stand in as the window).
    let s = fresh();
    s = reduce(s, SEND).state;
    s = reduce(s, compactBoundary(42_396, 2_011)).state;
    expect(s.scratch.get("k1")?.compactionPostTotal).toBeUndefined();
  });

  it("leaves state unchanged and emits an append-compact-note effect when idle", () => {
    const before = fresh();
    const { state: after, effects } = reduce(before, compactBoundary(48_000));
    // The committed transcript lives in the wrapper, not reducer state — the
    // reducer hands off the divider via an effect and leaves state untouched.
    expect(after).toBe(before);
    const note = effects.find((e) => e.kind === "append-compact-note");
    expect(note).toBeDefined();
    if (note && note.kind === "append-compact-note") {
      expect(note.text).toBe("Session compacted · ~48k tokens");
    }
  });
});

function compactSummary(summary: string): CodeSessionEvent {
  return { type: "compact_summary", summary } as CodeSessionEvent;
}

describe("reducer — handleCompactSummary", () => {
  it("sets compactionSeed.summary during replay", () => {
    const state = applyAll(fresh(), [
      { type: "replay_started" } as CodeSessionEvent,
      compactSummary("recap A"),
    ]);
    expect(state.compactionSeed?.summary).toBe("recap A");
  });

  it("sets compactionSeed.summary live mid-turn and preserves a latched preTokens", () => {
    const state = applyAll(fresh(), [
      SEND,
      compactBoundary(48_000), // mid-turn: appends the note (no preTokens latch here)
      compactSummary("recap live"),
    ]);
    expect(state.compactionSeed?.summary).toBe("recap live");
    // preTokens defaults to null — the boundary handler doesn't latch it onto
    // the seed today; the merge shape (`?? null`) just preserves any future latch.
    expect(state.compactionSeed?.preTokens).toBeNull();
  });

  it("latest summary overwrites the prior one", () => {
    const state = applyAll(fresh(), [
      compactSummary("first"),
      compactSummary("second"),
    ]);
    expect(state.compactionSeed?.summary).toBe("second");
  });
});
