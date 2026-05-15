/**
 * Reducer — `replay_complete` must preserve in-flight cycle state.
 *
 * Never-drop chain link 13: after the in-flight snapshot lands inside
 * the replay bracket (the user's submission echo + the snapshot
 * `assistant_text { is_partial: false }` keyed on claude's `message.id`),
 * the bracket-closing `replay_complete` arrives. If the in-flight
 * cycle's `pendingUserMessage` and `scratch[msgId]` are wiped at that
 * point, every downstream signal collapses:
 *
 *   1. Post-bracket live `assistant_text { is_partial: true }` deltas
 *      arrive while `phase === "idle"` → `handleTextDelta`'s first
 *      guard rejects them → deltas DROPPED.
 *   2. `pendingUserMessage` is null → eventual live `turn_complete`
 *      has nothing to commit → no `TurnEntry` ever materializes.
 *   3. The user sees a blank card after HMR-mid-stream and no
 *      automatic sync when claude finally finishes.
 *
 * The fix: `replay_complete` must check whether `pendingUserMessage`
 * was populated by the in-flight snapshot during the bracket. If yes,
 * preserve it AND `scratch` AND transition to a phase that accepts
 * subsequent live deltas (`streaming`). If no, drop to `idle` (the
 * existing behavior for replay-of-only-committed-turns).
 *
 * The wire signal that distinguishes the two: an in-flight snapshot's
 * `user_message_replay` lands during the bracket but its corresponding
 * `turn_complete` does NOT (the live tail is still streaming). So at
 * `replay_complete` time, `pendingUserMessage` is set iff the bracket
 * carried an unterminated in-flight cycle.
 */

import { describe, it, expect } from "bun:test";

import {
  reduce,
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";
import type { Effect } from "@/lib/code-session-store/effects";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

function fresh(): CodeSessionState {
  return createInitialState(FIXTURE_IDS.TUG_SESSION_ID, "test", "new");
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

describe("replay_complete preserves in-flight cycle state for the live tail", () => {
  it("snapshot in bracket → replay_complete keeps pendingUserMessage and scratch", () => {
    // Walk the never-drop chain at the reducer layer:
    //   replay_started      (phase enters `replaying`)
    //   user_message_replay (snapshot's user-side echo, in-flight cycle)
    //   assistant_text      (snapshot's accumulated text, is_partial:false)
    //   replay_complete     (bracket closes — must NOT wipe the cycle)
    //   assistant_text      (post-bracket live delta, is_partial:true)
    //   turn_complete       (live tail terminates the cycle)
    const events: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_inflight_X",
        text: "what's the time?",
        attachments: [],
        ipc_version: 2,
        turnKey: "test-replay-turn-key",
      },
      {
        type: "assistant_text",
        msg_id: "msg_inflight_X",
        seq: 0,
        rev: 12,
        text: "snapshot of pre-HMR streaming",
        is_partial: false,
        status: "streaming",
        ipc_version: 2,
      },
      { type: "replay_complete", count: 0, ipc_version: 2 },
    ];

    const after = applyAll(fresh(), events);

    // pendingUserMessage MUST survive replay_complete because the
    // snapshot's `user_message_replay` had no matching `turn_complete`
    // in the bracket — the live tail is going to deliver it.
    expect(after.state.pendingUserMessage).not.toBeNull();
    expect(after.state.pendingUserMessage?.text).toBe("what's the time?");

    // The snapshot's assistant_text scratch MUST survive so post-
    // bracket live deltas append onto it (rather than starting from
    // an empty buffer and losing the head of claude's response).
    const scratchEntry = after.state.scratch.get("msg_inflight_X");
    expect(scratchEntry).toBeDefined();
    expect(scratchEntry?.assistant).toBe("snapshot of pre-HMR streaming");

    // activeMsgId carries claude's id for the in-flight message —
    // set by handleTextDelta when the snapshot's assistant_text
    // landed during the bracket; preserved across replay_complete.
    expect(after.state.activeMsgId).toBe("msg_inflight_X");

    // Phase must NOT be `idle` (would drop incoming deltas). It must
    // be a phase that accepts assistant_text — `streaming` is the
    // natural choice given a populated scratch.
    expect(after.state.phase).toBe("streaming");
  });

  it("post-bracket live delta after preserved snapshot: appends, doesn't drop", () => {
    const eventsThroughBracket: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_inflight_X",
        text: "what's the time?",
        attachments: [],
        ipc_version: 2,
        turnKey: "test-replay-turn-key",
      },
      {
        type: "assistant_text",
        msg_id: "msg_inflight_X",
        seq: 0,
        rev: 12,
        text: "head of response",
        is_partial: false,
        status: "streaming",
        ipc_version: 2,
      },
      { type: "replay_complete", count: 0, ipc_version: 2 },
    ];

    const liveTail: CodeSessionEvent[] = [
      {
        type: "assistant_text",
        msg_id: "msg_inflight_X",
        seq: 1,
        rev: 13,
        text: " and tail",
        is_partial: true,
        status: "partial",
        ipc_version: 2,
      },
    ];

    const afterBracket = applyAll(fresh(), eventsThroughBracket);
    const afterLive = applyAll(afterBracket.state, liveTail);

    // The append landed (snapshot text + tail).
    const scratchEntry = afterLive.state.scratch.get("msg_inflight_X");
    expect(scratchEntry?.assistant).toBe("head of response and tail");
  });

  it("live turn_complete after preserved snapshot: emits append-transcript effect with full body", () => {
    const events: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_inflight_X",
        text: "what's the time?",
        attachments: [],
        ipc_version: 2,
        turnKey: "test-replay-turn-key",
      },
      {
        type: "assistant_text",
        msg_id: "msg_inflight_X",
        seq: 0,
        rev: 12,
        text: "the time is",
        is_partial: false,
        status: "streaming",
        ipc_version: 2,
      },
      { type: "replay_complete", count: 0, ipc_version: 2 },
      {
        type: "assistant_text",
        msg_id: "msg_inflight_X",
        seq: 1,
        rev: 13,
        text: " noon",
        is_partial: true,
        status: "partial",
        ipc_version: 2,
      },
      {
        type: "turn_complete",
        msg_id: "msg_inflight_X",
        seq: 2,
        result: "success",
        ipc_version: 2,
      },
    ];

    const after = applyAll(fresh(), events);

    // The reducer emits an append-transcript effect on commit; check
    // it carries the full body (snapshot + post-bracket tail).
    const appendEffects = after.effects.filter(
      (e) => e.kind === "append-transcript",
    ) as Array<Extract<Effect, { kind: "append-transcript" }>>;
    const inflightEntry = appendEffects.find(
      (e) => e.entry.msgId === "msg_inflight_X",
    );
    expect(inflightEntry).toBeDefined();
    expect(inflightEntry?.entry.assistant).toBe("the time is noon");
    expect(inflightEntry?.entry.userMessage.text).toBe("what's the time?");

    // Phase returned to idle after turn_complete.
    expect(after.state.phase).toBe("idle");
  });

  it("replay with NO in-flight snapshot (only committed turns): replay_complete drops to idle, no scratch leaked", () => {
    // The original semantics: replay_complete with no surviving
    // pendingUserMessage (committed turns all completed within the
    // bracket) clears state and returns to idle. This must NOT
    // regress — a stale scratch leak would break every clean replay.
    const events: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_committed",
        text: "hello",
        turnKey: "test-replay-turn-key",
        attachments: [],
        ipc_version: 2,
      },
      {
        type: "assistant_text",
        msg_id: "msg_committed",
        seq: 0,
        rev: 0,
        text: "hi there",
        is_partial: false,
        status: "complete",
        ipc_version: 2,
      },
      {
        type: "turn_complete",
        msg_id: "msg_committed",
        seq: 1,
        result: "success",
        ipc_version: 2,
      },
      { type: "replay_complete", count: 1, ipc_version: 2 },
    ];

    const after = applyAll(fresh(), events);

    expect(after.state.phase).toBe("idle");
    expect(after.state.pendingUserMessage).toBeNull();
    expect(after.state.scratch.size).toBe(0);
    // Committed cycle's append-transcript effect was emitted by the
    // turn_complete inside the bracket.
    const appendEffects = after.effects.filter(
      (e) => e.kind === "append-transcript",
    ) as Array<Extract<Effect, { kind: "append-transcript" }>>;
    const committedEntry = appendEffects.find(
      (e) => e.entry.msgId === "msg_committed",
    );
    expect(committedEntry).toBeDefined();
    expect(committedEntry?.entry.assistant).toBe("hi there");
  });
});
