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

  it("snapshot with pending control_request_forward (AskUserQuestion) → replay_complete lands in awaiting_approval and preserves pendingQuestion", () => {
    // Dialog-survival path: the in-flight bracket carries a pending
    // `control_request_forward` (re-emitted by tugcode from
    // `pendingControlRequests` on resume) so a permission/question
    // dialog open at reload reappears post-bracket. The handler
    // accepts the forward during `replaying`, stashes it in
    // pendingQuestion (or pendingApproval), and `replay_complete`
    // transitions to `awaiting_approval` instead of the normal
    // streaming-tail branch.
    const events: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_with_dialog",
        text: "ask me some questions",
        attachments: [],
        ipc_version: 2,
        turnKey: "test-replay-turn-key",
      },
      {
        type: "assistant_text",
        msg_id: "msg_with_dialog",
        seq: 0,
        rev: 4,
        text: "I'll ask a few.",
        is_partial: false,
        status: "streaming",
        ipc_version: 2,
      },
      {
        type: "control_request_forward",
        request_id: "req-q-survive-reload",
        tool_name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Which approach?",
              options: [{ label: "A" }, { label: "B" }],
            },
          ],
        },
        is_question: true,
        ipc_version: 2,
      },
      { type: "replay_complete", count: 0, ipc_version: 2 },
    ];

    const after = applyAll(fresh(), events);

    // pendingQuestion survived the bracket and the post-bracket
    // transition.
    expect(after.state.pendingQuestion).not.toBeNull();
    expect(after.state.pendingQuestion?.request_id).toBe(
      "req-q-survive-reload",
    );
    expect(after.state.pendingQuestion?.tool_name).toBe("AskUserQuestion");
    expect(after.state.pendingApproval).toBeNull();

    // Phase lands in awaiting_approval (not streaming) so the dialog
    // can render and the awaiting-approval clock can run.
    expect(after.state.phase).toBe("awaiting_approval");
    expect(after.state.awaitingApprovalSince).not.toBeNull();

    // pendingUserMessage + scratch still preserved — the in-flight
    // turn's text remains for the eventual commit.
    expect(after.state.pendingUserMessage).not.toBeNull();
    const scratchEntry = after.state.scratch.get("msg_with_dialog");
    expect(scratchEntry).toBeDefined();
  });

  it("snapshot with pending control_request_forward (can_use_tool / permission) → replay_complete lands in awaiting_approval with pendingApproval set", () => {
    // Mirror of the question case, but for a permission dialog
    // (`is_question: false`). The forward populates pendingApproval
    // and replay_complete still lands in awaiting_approval.
    const events: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_with_perm",
        text: "count lines with tokei",
        attachments: [],
        ipc_version: 2,
        turnKey: "test-replay-turn-key",
      },
      {
        type: "assistant_text",
        msg_id: "msg_with_perm",
        seq: 0,
        rev: 1,
        text: "",
        is_partial: false,
        status: "streaming",
        ipc_version: 2,
      },
      {
        type: "control_request_forward",
        request_id: "req-p-survive-reload",
        tool_name: "Bash",
        input: { command: "tokei" },
        is_question: false,
        ipc_version: 2,
      },
      { type: "replay_complete", count: 0, ipc_version: 2 },
    ];

    const after = applyAll(fresh(), events);

    expect(after.state.pendingApproval).not.toBeNull();
    expect(after.state.pendingApproval?.request_id).toBe(
      "req-p-survive-reload",
    );
    expect(after.state.pendingApproval?.tool_name).toBe("Bash");
    expect(after.state.pendingQuestion).toBeNull();
    expect(after.state.phase).toBe("awaiting_approval");
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

// ---------------------------------------------------------------------------
// Step 18.9 — replay emits write-inflight effects equivalent to live's, so
// committed cells (which read exclusively from per-turn `streamingDocument`
// paths under [L26]) render their content after cold-boot rehydration.
// ---------------------------------------------------------------------------

describe("replay emits write-inflight effects for per-turn paths ([L26])", () => {
  function writeInflightEffects(effects: ReadonlyArray<Effect>): Array<{
    turnKey: string;
    channel: "assistant" | "thinking" | "tools";
    value: string;
  }> {
    return effects
      .filter((e): e is Extract<Effect, { kind: "write-inflight" }> =>
        e.kind === "write-inflight",
      )
      .map(({ turnKey, channel, value }) => ({ turnKey, channel, value }));
  }

  function committedEntries(effects: ReadonlyArray<Effect>): Array<
    Extract<Effect, { kind: "append-transcript" }>["entry"]
  > {
    return effects
      .filter((e): e is Extract<Effect, { kind: "append-transcript" }> =>
        e.kind === "append-transcript",
      )
      .map((e) => e.entry);
  }

  it("replayed assistant_text emits a write-inflight effect for turn.${turnKey}.assistant", () => {
    const events: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_assist",
        text: "hi",
        turnKey: "tk-assist",
        attachments: [],
        ipc_version: 2,
      },
      {
        type: "assistant_text",
        msg_id: "msg_assist",
        seq: 0,
        rev: 0,
        text: "AUTHORITATIVE",
        is_partial: false,
        status: "complete",
        ipc_version: 2,
      },
      {
        type: "turn_complete",
        msg_id: "msg_assist",
        seq: 1,
        result: "success",
        ipc_version: 2,
      },
      { type: "replay_complete", count: 1, ipc_version: 2 },
    ];

    const after = applyAll(fresh(), events);
    const writes = writeInflightEffects(after.effects);
    const assistantWrites = writes.filter((w) => w.channel === "assistant");

    expect(assistantWrites.length).toBe(1);
    expect(assistantWrites[0]).toEqual({
      turnKey: "tk-assist",
      channel: "assistant",
      value: "AUTHORITATIVE",
    });

    // State invariants stay correct (regression check on the existing
    // behavior surface). The reducer emits the committed entry via
    // `append-transcript`; the wrapper aggregates onto `_transcript`,
    // not reducer state.
    const [committed] = committedEntries(after.effects);
    expect(committed?.assistant).toBe("AUTHORITATIVE");
    expect(committed?.turnKey).toBe("tk-assist");
  });

  it("replayed thinking_text emits a write-inflight effect for turn.${turnKey}.thinking", () => {
    const events: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_think",
        text: "why?",
        turnKey: "tk-think",
        attachments: [],
        ipc_version: 2,
      },
      {
        type: "thinking_text",
        msg_id: "msg_think",
        seq: 0,
        rev: 0,
        text: "FINAL THOUGHT",
        is_partial: false,
        ipc_version: 2,
      },
      {
        type: "turn_complete",
        msg_id: "msg_think",
        seq: 1,
        result: "success",
        ipc_version: 2,
      },
      { type: "replay_complete", count: 1, ipc_version: 2 },
    ];

    const after = applyAll(fresh(), events);
    const writes = writeInflightEffects(after.effects);
    const thinkingWrites = writes.filter((w) => w.channel === "thinking");

    expect(thinkingWrites.length).toBe(1);
    expect(thinkingWrites[0]).toEqual({
      turnKey: "tk-think",
      channel: "thinking",
      value: "FINAL THOUGHT",
    });

    const [committed] = committedEntries(after.effects);
    expect(committed?.thinking).toBe("FINAL THOUGHT");
  });

  it("replayed tool_use → tool_result → tool_use_structured all emit write-inflight effects for turn.${turnKey}.tools with the structured payload landing in the last write", () => {
    const events: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_tool",
        text: "read it",
        turnKey: "tk-tool",
        attachments: [],
        ipc_version: 2,
      },
      {
        type: "tool_use",
        tool_use_id: "tool-1",
        tool_name: "Read",
        input: { file_path: "/x" },
        msg_id: "msg_tool",
        seq: 0,
        ipc_version: 2,
      },
      {
        type: "tool_result",
        tool_use_id: "tool-1",
        output: "raw output",
        is_error: false,
        ipc_version: 2,
      },
      {
        type: "tool_use_structured",
        tool_use_id: "tool-1",
        structured_result: { type: "FileBody", text: "raw output" },
        ipc_version: 2,
      },
      {
        type: "turn_complete",
        msg_id: "msg_tool",
        seq: 1,
        result: "success",
        ipc_version: 2,
      },
      { type: "replay_complete", count: 1, ipc_version: 2 },
    ];

    const after = applyAll(fresh(), events);
    const writes = writeInflightEffects(after.effects);
    const toolWrites = writes.filter((w) => w.channel === "tools");

    // tool_use, tool_result, tool_use_structured all emit. Three
    // writes total; each is the serialized toolCallMap snapshot
    // valid at that event.
    expect(toolWrites.length).toBe(3);
    expect(toolWrites.every((w) => w.turnKey === "tk-tool")).toBe(true);

    // The last write — emitted from handleToolUseStructured — must
    // carry the `structuredResult` field. This is the previously-
    // missed fourth site; if it regresses, structured-tool blocks
    // render empty bodies after cold-boot rehydration.
    const finalToolPayload = JSON.parse(
      toolWrites[toolWrites.length - 1].value,
    ) as ReadonlyArray<{
      toolUseId: string;
      structuredResult: unknown;
      result: unknown;
      status: string;
    }>;
    expect(finalToolPayload.length).toBe(1);
    expect(finalToolPayload[0].toolUseId).toBe("tool-1");
    expect(finalToolPayload[0].status).toBe("done");
    expect(finalToolPayload[0].result).toBe("raw output");
    expect(finalToolPayload[0].structuredResult).toEqual({
      type: "FileBody",
      text: "raw output",
    });

    // Committed TurnEntry carries the same payload.
    const [committed] = committedEntries(after.effects);
    expect(committed?.toolCalls.length).toBe(1);
    expect(committed?.toolCalls[0].structuredResult).toEqual({
      type: "FileBody",
      text: "raw output",
    });
  });

  it("in-flight snapshot in bracket → continued live tail: per-turn path holds the full body after turn_complete", () => {
    // This is the cross-bracket write-through trace: the replay-side
    // snapshot writes "head of response" via the new emission; live-
    // tail appends " and tail" through the same path; turn_complete
    // commits. The per-turn path must equal TurnEntry.assistant at
    // every observable moment.
    const events: CodeSessionEvent[] = [
      { type: "replay_started", ipc_version: 2 },
      {
        type: "user_message_replay",
        msg_id: "msg_inflight_X",
        text: "what's the time?",
        turnKey: "tk-cross",
        attachments: [],
        ipc_version: 2,
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
      {
        type: "turn_complete",
        msg_id: "msg_inflight_X",
        seq: 2,
        result: "success",
        ipc_version: 2,
      },
    ];

    const after = applyAll(fresh(), events);
    const writes = writeInflightEffects(after.effects).filter(
      (w) => w.channel === "assistant",
    );

    // Two writes: one during the bracket (the replay snapshot's
    // assistant_text — now emitted thanks to the L26 fix), one
    // post-bracket (the live tail). Both target the same turnKey.
    expect(writes.length).toBe(2);
    expect(writes.map((w) => w.value)).toEqual([
      "head of response",
      "head of response and tail",
    ]);
    expect(writes.every((w) => w.turnKey === "tk-cross")).toBe(true);

    // The committed TurnEntry matches the final per-turn-path value.
    const [committed] = committedEntries(after.effects);
    expect(committed?.assistant).toBe("head of response and tail");
  });
});
