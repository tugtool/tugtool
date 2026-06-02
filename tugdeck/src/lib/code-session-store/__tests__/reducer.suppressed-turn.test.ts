/**
 * Reducer tests for single-turn suppression (the `/compact` seed) and the
 * `mark_compaction_seed` flag.
 *
 * A suppressed turn runs on claude (the send-frame still goes out) but is
 * never committed to the transcript: `turn_complete` drops the append,
 * and the in-flight active turn reports `suppressed: true` so the data
 * source skips it.
 */

import { describe, it, expect } from "bun:test";

import {
  reduce,
  createInitialState,
  deriveActiveTurnSnapshot,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";
import { isAppendTranscript } from "@/lib/code-session-store/effects";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

function fresh(): CodeSessionState {
  return createInitialState(FIXTURE_IDS.TUG_SESSION_ID, "test", "new");
}

function send(suppress: boolean): CodeSessionEvent {
  return {
    type: "send",
    text: "seed",
    atoms: [],
    content: [{ type: "text" as const, text: "seed" }],
    turnKey: "k1",
    suppress,
  } as CodeSessionEvent;
}

const ASSISTANT: CodeSessionEvent = {
  type: "assistant_text", msg_id: "m1", block_index: 0, text: "ok", is_partial: false,
} as CodeSessionEvent;
const COMPLETE: CodeSessionEvent = { type: "turn_complete", msg_id: "m1", result: "success" } as CodeSessionEvent;

describe("reducer — suppressed turn", () => {
  it("a suppressed turn still emits the send-frame (claude runs it)", () => {
    const { effects } = reduce(fresh(), send(true));
    expect(effects.some((e) => e.kind === "send-frame")).toBe(true);
  });

  it("the in-flight suppressed turn reports suppressed:true", () => {
    const state = reduce(fresh(), send(true)).state;
    expect(deriveActiveTurnSnapshot(state)?.suppressed).toBe(true);
  });

  it("turn_complete does NOT append a suppressed turn to the transcript", () => {
    let s = fresh();
    s = reduce(s, send(true)).state;
    s = reduce(s, ASSISTANT).state;
    const { effects } = reduce(s, COMPLETE);
    expect(effects.some(isAppendTranscript)).toBe(false);
  });

  it("an ordinary (non-suppressed) turn DOES append", () => {
    let s = fresh();
    s = reduce(s, send(false)).state;
    s = reduce(s, ASSISTANT).state;
    const { effects } = reduce(s, COMPLETE);
    expect(effects.some(isAppendTranscript)).toBe(true);
  });
});

describe("reducer — mark_compaction_seed", () => {
  it("sets compactionSeed with the pre-token count", () => {
    const s = reduce(fresh(), { type: "mark_compaction_seed", preTokens: 48000 } as CodeSessionEvent).state;
    expect(s.compactionSeed).toEqual({ preTokens: 48000 });
  });
});
