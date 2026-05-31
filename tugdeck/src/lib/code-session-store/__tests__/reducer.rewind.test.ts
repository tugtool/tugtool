/**
 * reducer.rewind.test.ts — `/rewind` store layer ([#step-7-3]).
 *
 * Pure-logic pins for the conversation/code rewind plumbing in the reducer:
 *  - the L26-safe `truncateTranscriptAtAnchor` helper (survivor references
 *    preserved verbatim; not-found is a true no-op),
 *  - the anchor (`promptUuid`) capture on both the replay opener and the live
 *    `prompt_anchor` frame, committing onto the `TurnEntry`,
 *  - the diff-stat preview cache fold,
 *  - the applied-rewind ack + its conversation/both truncation effect.
 *
 * @module lib/code-session-store/__tests__/reducer.rewind
 */

import { describe, expect, test } from "bun:test";

import {
  reduce,
  createInitialState,
  truncateTranscriptAtAnchor,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type {
  Effect,
  AppendTranscriptEffect,
  SendFrameEffect,
  TruncateTranscriptEffect,
} from "@/lib/code-session-store/effects";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";
import type { TurnEntry } from "@/lib/code-session-store/types";
import { TURN_ENTRY_TELEMETRY_DEFAULTS } from "@/lib/code-session-store/testing/turn-entry-defaults";

function fresh(): CodeSessionState {
  return createInitialState("session", "test", "new");
}

function applyAll(
  state: CodeSessionState,
  events: ReadonlyArray<CodeSessionEvent>,
): { state: CodeSessionState; effects: Effect[] } {
  let current = state;
  const collected: Effect[] = [];
  for (const ev of events) {
    const r = reduce(current, ev);
    current = r.state;
    collected.push(...r.effects);
  }
  return { state: current, effects: collected };
}

function turn(turnKey: string, promptUuid?: string): TurnEntry {
  return {
    turnKey,
    msgId: `m-${turnKey}`,
    ...(promptUuid !== undefined ? { promptUuid } : {}),
    messages: [],
    result: "success",
    endedAt: 0,
    ...TURN_ENTRY_TELEMETRY_DEFAULTS,
  };
}

// Drive a complete live turn, returning the committed TurnEntry.
function commitLiveTurn(
  state: CodeSessionState,
  turnKey: string,
  extra: ReadonlyArray<CodeSessionEvent> = [],
): { state: CodeSessionState; entry: TurnEntry } {
  const r = applyAll(state, [
    { type: "send", text: "hi", atoms: [], content: [{ type: "text", text: "hi" }], turnKey } as unknown as CodeSessionEvent,
    ...extra,
    { type: "content_block_start", msg_id: "m", block_index: 0, kind: "text" } as CodeSessionEvent,
    { type: "assistant_text", msg_id: "m", block_index: 0, text: "ok", is_partial: false } as CodeSessionEvent,
    { type: "turn_complete", msg_id: "m", result: "success" } as CodeSessionEvent,
  ]);
  const entry = r.effects.find(
    (e): e is AppendTranscriptEffect => e.kind === "append-transcript",
  )!.entry;
  return { state: r.state, entry };
}

describe("truncateTranscriptAtAnchor — L26-safe local truncation", () => {
  test("drops the anchor turn AND every turn after it", () => {
    const t = [turn("a", "uuid-a"), turn("b", "uuid-b"), turn("c", "uuid-c")];
    const out = truncateTranscriptAtAnchor(t, "uuid-b");
    expect(out.map((e) => e.turnKey)).toEqual(["a"]);
  });

  test("survivors are the SAME references (byte-identical identity inputs)", () => {
    const t = [turn("a", "uuid-a"), turn("b", "uuid-b"), turn("c", "uuid-c")];
    const out = truncateTranscriptAtAnchor(t, "uuid-c");
    // The retained turns must be reference-identical so React's key + type +
    // renderer inputs are unchanged and no mount tears down ([L26]).
    expect(out[0]).toBe(t[0]);
    expect(out[1]).toBe(t[1]);
  });

  test("an absent anchor returns the SAME array reference (true no-op)", () => {
    const t = [turn("a", "uuid-a"), turn("b", "uuid-b")];
    expect(truncateTranscriptAtAnchor(t, "nope")).toBe(t);
  });

  test("rewinding to the first turn yields an empty transcript", () => {
    const t = [turn("a", "uuid-a"), turn("b", "uuid-b")];
    expect(truncateTranscriptAtAnchor(t, "uuid-a")).toEqual([]);
  });
});

describe("anchor (promptUuid) capture", () => {
  test("replay opener (add_user_message.promptUuid) commits onto the TurnEntry", () => {
    const r0 = reduce(fresh(), { type: "replay_started" } as CodeSessionEvent);
    const { effects } = applyAll(r0.state, [
      {
        type: "add_user_message",
        text: "hi",
        atoms: [],
        turnKey: "rk",
        promptUuid: "uuid-replay",
      } as unknown as CodeSessionEvent,
      { type: "content_block_start", msg_id: "m", block_index: 0, kind: "text" } as CodeSessionEvent,
      { type: "assistant_text", msg_id: "m", block_index: 0, text: "ok", is_partial: false } as CodeSessionEvent,
      { type: "turn_complete", msg_id: "m", result: "success" } as CodeSessionEvent,
    ]);
    const entry = effects.find(
      (e): e is AppendTranscriptEffect => e.kind === "append-transcript",
    )!.entry;
    expect(entry.promptUuid).toBe("uuid-replay");
  });

  test("live prompt_anchor frame commits onto the TurnEntry", () => {
    const { entry } = commitLiveTurn(fresh(), "lk", [
      { type: "prompt_anchor", promptUuid: "uuid-live" } as CodeSessionEvent,
    ]);
    expect(entry.promptUuid).toBe("uuid-live");
  });

  test("prompt_anchor is first-wins (a second frame does not overwrite)", () => {
    const { entry } = commitLiveTurn(fresh(), "lk", [
      { type: "prompt_anchor", promptUuid: "first" } as CodeSessionEvent,
      { type: "prompt_anchor", promptUuid: "second" } as CodeSessionEvent,
    ]);
    expect(entry.promptUuid).toBe("first");
  });

  test("prompt_anchor between turns (no pending turn) is a no-op", () => {
    const r = reduce(fresh(), { type: "prompt_anchor", promptUuid: "x" } as CodeSessionEvent);
    expect(r.state.pendingTurn).toBeNull();
    expect(r.effects).toEqual([]);
  });

  test("a turn with no anchor commits with promptUuid undefined", () => {
    const { entry } = commitLiveTurn(fresh(), "lk");
    expect(entry.promptUuid).toBeUndefined();
  });
});

describe("diff-stat preview cache", () => {
  test("request marks loading and emits a rewind_preview frame", () => {
    const r = reduce(fresh(), {
      type: "request_rewind_preview",
      promptUuid: "uuid-p",
    } as CodeSessionEvent);
    expect(r.state.rewindPreviews.get("uuid-p")).toEqual({
      loading: true,
      canRewind: false,
    });
    const frame = r.effects.find(
      (e): e is SendFrameEffect => e.kind === "send-frame",
    );
    expect(frame?.msg).toEqual({ type: "rewind_preview", promptUuid: "uuid-p" });
  });

  test("result folds in the diff-stat and clears loading", () => {
    const r0 = reduce(fresh(), {
      type: "request_rewind_preview",
      promptUuid: "uuid-p",
    } as CodeSessionEvent);
    const r1 = reduce(r0.state, {
      type: "rewind_preview_result",
      promptUuid: "uuid-p",
      canRewind: true,
      filesChanged: ["/repo/a.txt"],
      insertions: 3,
      deletions: 1,
    } as CodeSessionEvent);
    expect(r1.state.rewindPreviews.get("uuid-p")).toEqual({
      loading: false,
      canRewind: true,
      filesChanged: ["/repo/a.txt"],
      insertions: 3,
      deletions: 1,
    });
  });
});

describe("applied-rewind ack + truncation effect", () => {
  test("session_rewind_request emits a session_rewind frame (with fork)", () => {
    const r = reduce(fresh(), {
      type: "session_rewind_request",
      promptUuid: "uuid-r",
      scope: "conversation",
      fork: true,
    } as CodeSessionEvent);
    const frame = r.effects.find(
      (e): e is SendFrameEffect => e.kind === "send-frame",
    );
    expect(frame?.msg).toEqual({
      type: "session_rewind",
      promptUuid: "uuid-r",
      scope: "conversation",
      fork: true,
    });
  });

  test("conversation rewind ack records the result AND emits truncate-transcript", () => {
    const r = reduce(fresh(), {
      type: "rewind_result",
      promptUuid: "uuid-r",
      scope: "conversation",
      canRewind: true,
      newSessionId: "fork-sid",
    } as CodeSessionEvent);
    expect(r.state.lastRewindResult).toEqual({
      promptUuid: "uuid-r",
      scope: "conversation",
      canRewind: true,
      newSessionId: "fork-sid",
    });
    const trunc = r.effects.find(
      (e): e is TruncateTranscriptEffect => e.kind === "truncate-transcript",
    );
    expect(trunc?.promptUuid).toBe("uuid-r");
  });

  test("code-only rewind ack records the result but does NOT truncate", () => {
    const r = reduce(fresh(), {
      type: "rewind_result",
      promptUuid: "uuid-r",
      scope: "code",
      canRewind: true,
    } as CodeSessionEvent);
    expect(r.state.lastRewindResult?.scope).toBe("code");
    expect(
      r.effects.some((e) => e.kind === "truncate-transcript"),
    ).toBe(false);
  });

  test("a refused conversation rewind records the error but does NOT truncate", () => {
    const r = reduce(fresh(), {
      type: "rewind_result",
      promptUuid: "uuid-r",
      scope: "conversation",
      canRewind: false,
      error: "Claude is busy; rewind requires an idle session.",
    } as CodeSessionEvent);
    expect(r.state.lastRewindResult?.canRewind).toBe(false);
    expect(r.state.lastRewindResult?.error).toContain("busy");
    expect(
      r.effects.some((e) => e.kind === "truncate-transcript"),
    ).toBe(false);
  });
});
