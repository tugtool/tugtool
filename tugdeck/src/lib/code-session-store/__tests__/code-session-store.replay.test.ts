/**
 * Replay-bracket reducer tests for `CodeSessionStore`.
 *
 * Covers the JSONL replay window ingested via CODE_OUTPUT:
 *   - `replay_started` brackets phase entry into `replaying` from
 *     `idle` or `errored` and clears any in-flight scratch state.
 *   - `user_message_replay` mirrors to `pendingUserMessage` with the
 *     turn's terminal `msg_id`.
 *   - `assistant_text` / `tool_use` / `tool_result` events
 *     accumulate into scratch + toolCallMap during `replaying` but
 *     do not flip phase or write to the in-flight streaming
 *     document.
 *   - `turn_complete` commits a `TurnEntry` to `transcript` and
 *     keeps phase at `replaying` until the closing bracket.
 *   - `replay_complete` returns to `idle` and populates
 *     `lastReplayResult` (success or error variant).
 *   - `turn_complete` deduplicates by `msg_id` — the second commit
 *     for the same id is a logged no-op.
 *   - `send` / live deltas during `replaying` are dropped
 *     defensively.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import {
  committedTurnValue,
  inflightValue,
} from "@/lib/code-session-store/testing/inflight-paths";
import { FeedId } from "@/protocol";

const TUG = FIXTURE_IDS.TUG_SESSION_ID;
const IPC_VERSION = 2;

interface StoreFixture {
  store: CodeSessionStore;
  conn: TestFrameChannel;
}

function makeStore(): StoreFixture {
  const conn = new TestFrameChannel();
  const store = new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: TUG,
    sessionMode: "new",
  });
  return { store, conn };
}

/** Convenience: dispatch a decoded CODE_OUTPUT event with the
 * tug_session_id stamped on. */
function emit(conn: TestFrameChannel, evt: Record<string, unknown>): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, { ...evt, tug_session_id: TUG });
}

function replayStarted() {
  return { type: "replay_started", ipc_version: IPC_VERSION };
}
function replayComplete(count: number, error?: {
  kind:
    | "jsonl_missing"
    | "jsonl_unreadable"
    | "jsonl_malformed"
    | "replay_timeout";
  message: string;
}) {
  return error
    ? { type: "replay_complete", count, error, ipc_version: IPC_VERSION }
    : { type: "replay_complete", count, ipc_version: IPC_VERSION };
}
function userMessageReplay(msgId: string, text: string) {
  return {
    type: "user_message_replay",
    msg_id: msgId,
    text,
    attachments: [],
    ipc_version: IPC_VERSION,
    // The reducer requires turnKey on this event (added when the
    // contract moved to a pure reducer + impure wrapper layer). Tests
    // use a deterministic key so assertions stay reproducible.
    turnKey: `replay-key-${msgId}`,
  };
}
function assistantText(msgId: string, text: string) {
  return {
    type: "assistant_text",
    msg_id: msgId,
    seq: 0,
    rev: 0,
    text,
    is_partial: false,
    status: "complete",
    ipc_version: IPC_VERSION,
  };
}
function turnComplete(msgId: string, result: "success" | "error" = "success") {
  return {
    type: "turn_complete",
    msg_id: msgId,
    seq: 1,
    result,
    ipc_version: IPC_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Bracket round-trip — the canonical happy path
// ---------------------------------------------------------------------------

describe("CodeSessionStore — replay bracket round-trip", () => {
  it("replays two turns and returns to idle with lastReplayResult.kind=success", () => {
    const { store, conn } = makeStore();

    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().lastReplayResult).toBeNull();

    emit(conn, replayStarted());
    expect(store.getSnapshot().phase).toBe("replaying");
    expect(store.getSnapshot().canSubmit).toBe(false);
    expect(store.getSnapshot().canInterrupt).toBe(false);

    // Turn 1
    emit(conn, userMessageReplay("msg-1", "first user prompt"));
    emit(conn, assistantText("msg-1", "first reply"));
    emit(conn, turnComplete("msg-1", "success"));
    // Phase stays `replaying` between turns.
    expect(store.getSnapshot().phase).toBe("replaying");

    // Turn 2
    emit(conn, userMessageReplay("msg-2", "second user prompt"));
    emit(conn, assistantText("msg-2", "second reply"));
    emit(conn, turnComplete("msg-2", "success"));
    expect(store.getSnapshot().phase).toBe("replaying");

    // Bracket close
    emit(conn, replayComplete(2));

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.canSubmit).toBe(true);
    expect(snap.transcript.length).toBe(2);
    expect(snap.transcript[0].msgId).toBe("msg-1");
    expect(snap.transcript[0].userMessage.text).toBe("first user prompt");
    expect(snap.transcript[0].assistant).toBe("first reply");
    expect(snap.transcript[0].result).toBe("success");
    expect(snap.transcript[1].msgId).toBe("msg-2");
    expect(snap.lastReplayResult).toEqual({
      kind: "success",
      message: "",
      count: 2,
      at: expect.any(Number),
    });
  });

  it("phase is exposed as 'replaying' between bracket events", () => {
    const { store, conn } = makeStore();
    emit(conn, replayStarted());
    expect(store.getSnapshot().phase).toBe("replaying");
    expect(store.getSnapshot().canSubmit).toBe(false);
    expect(store.getSnapshot().canInterrupt).toBe(false);
    emit(conn, replayComplete(0));
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("a card whose phase is errored accepts replay_started and lands on idle after replay_complete", () => {
    const { store, conn } = makeStore();

    // Drive the store into errored via a wire error frame (no
    // tug_session_id needed — `error` events flow through the
    // CODE_OUTPUT path with normal session filtering).
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "error",
      tug_session_id: TUG,
      message: "boom",
      recoverable: false,
    });
    expect(store.getSnapshot().phase).toBe("errored");
    expect(store.getSnapshot().lastError?.cause).toBe("wire_error");

    // Replay opens from errored.
    emit(conn, replayStarted());
    expect(store.getSnapshot().phase).toBe("replaying");

    emit(conn, userMessageReplay("msg-x", "u"));
    emit(conn, assistantText("msg-x", "a"));
    emit(conn, turnComplete("msg-x"));
    emit(conn, replayComplete(1));

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript.length).toBe(1);
    expect(snap.lastReplayResult?.kind).toBe("success");
    expect(snap.lastReplayResult?.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Defense-in-depth: drops while replaying
// ---------------------------------------------------------------------------

describe("CodeSessionStore — defensive drops while replaying", () => {
  it("send() during replaying is a no-op and writes no CODE_INPUT frame", () => {
    const { store, conn } = makeStore();
    emit(conn, replayStarted());

    const framesBefore = conn.recordedFrames.length;
    store.send("hi", []);
    const framesAfter = conn.recordedFrames.length;

    expect(framesAfter).toBe(framesBefore);
    expect(store.getSnapshot().inflightUserMessage).toBeNull();
    expect(store.getSnapshot().queuedSends).toBe(0);
    expect(store.getSnapshot().phase).toBe("replaying");
  });

  it("a stray live assistant_text partial during replay accumulates in scratch but does not flip phase", () => {
    // The supervisor's bracket guarantees the wire is silent on live
    // events while replaying; the reducer treats this as
    // defense-in-depth — the live event lands in scratch keyed by
    // its msg_id, but phase stays `replaying` and the in-flight
    // streaming document is untouched.
    const { store, conn } = makeStore();
    emit(conn, replayStarted());

    const inflightBefore = inflightValue(store, "assistant");
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: TUG,
      msg_id: "stray-1",
      seq: 0,
      rev: 0,
      text: "stray partial",
      is_partial: true,
      status: "in_progress",
      ipc_version: IPC_VERSION,
    });
    const inflightAfter = inflightValue(store, "assistant");

    expect(store.getSnapshot().phase).toBe("replaying");
    expect(inflightAfter).toBe(inflightBefore);
  });
});

// ---------------------------------------------------------------------------
// Idempotency: dedupe by msg_id
// ---------------------------------------------------------------------------

describe("CodeSessionStore — turn_complete dedupe by msg_id", () => {
  it("a duplicate turn_complete with the same msg_id produces no second TurnEntry", () => {
    const { store, conn } = makeStore();

    // First turn lands.
    emit(conn, replayStarted());
    emit(conn, userMessageReplay("msg-dup", "u"));
    emit(conn, assistantText("msg-dup", "a"));
    emit(conn, turnComplete("msg-dup"));
    emit(conn, replayComplete(1));
    expect(store.getSnapshot().transcript.length).toBe(1);

    // Second window re-emits the same turn (synthetic — would
    // require a supervisor bug in practice). The committedMsgIds
    // dedupe keeps the transcript at length 1.
    emit(conn, replayStarted());
    emit(conn, userMessageReplay("msg-dup", "u again"));
    emit(conn, assistantText("msg-dup", "a again"));
    emit(conn, turnComplete("msg-dup"));
    emit(conn, replayComplete(1));

    expect(store.getSnapshot().transcript.length).toBe(1);
    // The original entry is preserved unchanged.
    expect(store.getSnapshot().transcript[0].userMessage.text).toBe("u");
    expect(store.getSnapshot().transcript[0].assistant).toBe("a");
  });

  it("a duplicate turn_complete clears stranded pendingUserMessage so replay closes to idle", () => {
    // Defensive: the translator has been hardened to fold same-msg_id
    // assistant runs into one cycle, but if a phantom second cycle
    // ever leaks through (translator regression, or a new SDK shape
    // we haven't surveyed), the duplicate `turn_complete` must clear
    // any pending state it stranded. Without the clear,
    // `replay_complete`'s in-flight-survival branch (chain-link 13)
    // would observe `pendingUserMessage !== null` and transition
    // phase to `streaming` post-replay — leaving the card with
    // `canInterrupt=true` and a Stop button that can't reach the
    // wire (the user-reported ae7360c bug shape).
    const { store, conn } = makeStore();

    emit(conn, replayStarted());
    // First (real) cycle commits.
    emit(conn, userMessageReplay("msg-strand", "real user text"));
    emit(conn, assistantText("msg-strand", "real reply"));
    emit(conn, turnComplete("msg-strand"));
    expect(store.getSnapshot().transcript.length).toBe(1);

    // Phantom second cycle for the same msg_id mid-bracket: a
    // `user_message_replay` writes to `pendingUserMessage` and the
    // following `turn_complete` is dedupe-dropped because msg-strand
    // is already in committedMsgIds. The dedup branch must wipe the
    // junk pending state.
    emit(conn, userMessageReplay("msg-strand", ""));
    emit(conn, assistantText("msg-strand", "phantom text"));
    emit(conn, turnComplete("msg-strand"));

    // Bracket closes. With the defensive clear, no pending cycle
    // survives — phase returns to idle, not streaming.
    emit(conn, replayComplete(1));

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.canInterrupt).toBe(false);
    expect(snap.canSubmit).toBe(true);
    expect(snap.transcript.length).toBe(1);
    // The committed turn is the real one, untouched by the phantom.
    expect(snap.transcript[0].userMessage.text).toBe("real user text");
    expect(snap.transcript[0].assistant).toBe("real reply");
    // No leftover pending state.
    expect(snap.inflightUserMessage).toBeNull();
    expect(snap.activeMsgId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error variants on replay_complete
// ---------------------------------------------------------------------------

describe("CodeSessionStore — replay_complete error variants", () => {
  it("jsonl_missing surfaces as lastReplayResult and the card returns to idle", () => {
    const { store, conn } = makeStore();
    emit(conn, replayStarted());
    emit(conn, replayComplete(0, {
      kind: "jsonl_missing",
      message: "no JSONL at /path",
    }));
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript.length).toBe(0);
    expect(snap.lastReplayResult?.kind).toBe("jsonl_missing");
    expect(snap.lastReplayResult?.message).toBe("no JSONL at /path");
    expect(snap.lastReplayResult?.count).toBe(0);
    // Card is interactive again — submit gating returns to true.
    expect(snap.canSubmit).toBe(true);
  });

  it("replay_timeout surfaces as lastReplayResult.kind and lets the card become interactive", () => {
    const { store, conn } = makeStore();
    emit(conn, replayStarted());
    // Some turns committed before the hard-budget cutoff fired.
    emit(conn, userMessageReplay("partial-1", "u1"));
    emit(conn, assistantText("partial-1", "a1"));
    emit(conn, turnComplete("partial-1"));
    emit(conn, replayComplete(1, {
      kind: "replay_timeout",
      message: "exceeded 10s budget",
    }));
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.canSubmit).toBe(true);
    expect(snap.lastReplayResult).toEqual({
      kind: "replay_timeout",
      message: "exceeded 10s budget",
      count: 1,
      at: expect.any(Number),
    });
    // The pre-timeout turn still committed.
    expect(snap.transcript.length).toBe(1);
  });

  it("jsonl_malformed and jsonl_unreadable round-trip the kind through the snapshot", () => {
    for (const kind of ["jsonl_malformed", "jsonl_unreadable"] as const) {
      const { store, conn } = makeStore();
      emit(conn, replayStarted());
      emit(conn, replayComplete(0, { kind, message: `synthetic-${kind}` }));
      const snap = store.getSnapshot();
      expect(snap.lastReplayResult?.kind).toBe(kind);
      expect(snap.lastReplayResult?.message).toBe(`synthetic-${kind}`);
      expect(snap.phase).toBe("idle");
    }
  });
});

// ---------------------------------------------------------------------------
// Bracket bookkeeping: lastReplayResult is reset on a fresh
// replay_started so the snapshot always reflects the most recent
// outcome.
// ---------------------------------------------------------------------------

describe("CodeSessionStore — lastReplayResult lifecycle", () => {
  it("a fresh replay_started clears the prior window's lastReplayResult", () => {
    const { store, conn } = makeStore();

    // First window — error.
    emit(conn, replayStarted());
    emit(conn, replayComplete(0, {
      kind: "jsonl_missing",
      message: "first",
    }));
    expect(store.getSnapshot().lastReplayResult?.kind).toBe("jsonl_missing");

    // Second window — pending; lastReplayResult should be null
    // again so a UI bound to the field doesn't show the prior error
    // copy while the new window is in progress.
    emit(conn, replayStarted());
    expect(store.getSnapshot().lastReplayResult).toBeNull();
    expect(store.getSnapshot().phase).toBe("replaying");

    emit(conn, replayComplete(0));
    expect(store.getSnapshot().lastReplayResult?.kind).toBe("success");
  });

  it("replay_complete outside replaying is a logged no-op", () => {
    const { store, conn } = makeStore();
    expect(store.getSnapshot().phase).toBe("idle");
    emit(conn, replayComplete(0));
    expect(store.getSnapshot().phase).toBe("idle");
    // No lastReplayResult written — the event was dropped.
    expect(store.getSnapshot().lastReplayResult).toBeNull();
  });

  it("replay_started outside idle/errored is a logged no-op (live turn protection)", () => {
    const { store, conn } = makeStore();
    // Drive the store into `submitting` via send().
    store.send("live prompt", []);
    expect(store.getSnapshot().phase).toBe("submitting");

    // Replay must not interrupt a live submit. The bracket is
    // dropped; phase stays `submitting`.
    emit(conn, replayStarted());
    expect(store.getSnapshot().phase).toBe("submitting");
  });
});

// ---------------------------------------------------------------------------
// Step 18.9 — per-turn streamingDocument paths populated across the replay
// bracket. [L26]'s post-unification render contract makes the per-turn paths
// the sole render surface; replay must populate them or cold-boot-rehydrated
// transcripts render empty.
// ---------------------------------------------------------------------------

describe("CodeSessionStore — per-turn paths populated across replay bracket ([L26])", () => {
  function toolUse(
    msgId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>,
  ) {
    return {
      type: "tool_use",
      msg_id: msgId,
      tool_use_id: toolUseId,
      tool_name: toolName,
      input,
      seq: 0,
      ipc_version: IPC_VERSION,
    };
  }
  function toolResult(toolUseId: string, output: string) {
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      output,
      is_error: false,
      ipc_version: IPC_VERSION,
    };
  }
  function toolUseStructured(
    toolUseId: string,
    structuredResult: Record<string, unknown>,
  ) {
    return {
      type: "tool_use_structured",
      tool_use_id: toolUseId,
      structured_result: structuredResult,
      ipc_version: IPC_VERSION,
    };
  }
  function thinkingText(msgId: string, text: string) {
    return {
      type: "thinking_text",
      msg_id: msgId,
      seq: 0,
      rev: 0,
      text,
      is_partial: false,
      ipc_version: IPC_VERSION,
    };
  }

  it("multi-turn bracket populates assistant + thinking + tools paths for every committed turn", () => {
    const { store, conn } = makeStore();

    emit(conn, replayStarted());

    // Turn 1: assistant text only.
    emit(conn, userMessageReplay("msg-A", "first user"));
    emit(conn, assistantText("msg-A", "first reply"));
    emit(conn, turnComplete("msg-A"));

    // Turn 2: assistant text + thinking text.
    emit(conn, userMessageReplay("msg-B", "second user"));
    emit(conn, thinkingText("msg-B", "second thought"));
    emit(conn, assistantText("msg-B", "second reply"));
    emit(conn, turnComplete("msg-B"));

    // Turn 3: a structured tool call (Read).
    emit(conn, userMessageReplay("msg-C", "read file"));
    emit(conn, toolUse("msg-C", "tool-1", "Read", { file_path: "/x" }));
    emit(conn, toolResult("tool-1", "file body"));
    emit(
      conn,
      toolUseStructured("tool-1", { type: "FileBody", text: "file body" }),
    );
    emit(conn, assistantText("msg-C", "here is the file"));
    emit(conn, turnComplete("msg-C"));

    emit(conn, replayComplete(3));

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript.length).toBe(3);

    // Turn 1 — assistant path populated; thinking / tools untouched.
    expect(committedTurnValue(store, "assistant", 0)).toBe("first reply");
    expect(committedTurnValue(store, "thinking", 0)).toBeUndefined();
    expect(committedTurnValue(store, "tools", 0)).toBeUndefined();

    // Turn 2 — assistant + thinking populated.
    expect(committedTurnValue(store, "assistant", 1)).toBe("second reply");
    expect(committedTurnValue(store, "thinking", 1)).toBe("second thought");
    expect(committedTurnValue(store, "tools", 1)).toBeUndefined();

    // Turn 3 — assistant + tools populated; structured_result lands in
    // the final tools write (handleToolUseStructured was the previously-
    // missed fourth site, so this assertion is the regression gate for
    // structured-tool rendering after cold boot).
    expect(committedTurnValue(store, "assistant", 2)).toBe("here is the file");
    const toolsSerialized = committedTurnValue(store, "tools", 2);
    expect(typeof toolsSerialized).toBe("string");
    const toolsPayload = JSON.parse(toolsSerialized as string) as ReadonlyArray<{
      toolUseId: string;
      status: string;
      structuredResult: unknown;
    }>;
    expect(toolsPayload.length).toBe(1);
    expect(toolsPayload[0].toolUseId).toBe("tool-1");
    expect(toolsPayload[0].status).toBe("done");
    expect(toolsPayload[0].structuredResult).toEqual({
      type: "FileBody",
      text: "file body",
    });

    // Default-index lookup (no `index` arg) resolves to the LAST turn.
    expect(committedTurnValue(store, "assistant")).toBe("here is the file");
  });

  it("each turn's per-turn paths are addressed by a distinct turnKey — no cross-contamination across turns", () => {
    const { store, conn } = makeStore();

    emit(conn, replayStarted());
    emit(conn, userMessageReplay("m1", "u1"));
    emit(conn, assistantText("m1", "A1"));
    emit(conn, turnComplete("m1"));
    emit(conn, userMessageReplay("m2", "u2"));
    emit(conn, assistantText("m2", "A2"));
    emit(conn, turnComplete("m2"));
    emit(conn, replayComplete(2));

    const snap = store.getSnapshot();
    const tk1 = snap.transcript[0].turnKey;
    const tk2 = snap.transcript[1].turnKey;
    expect(tk1).not.toBe(tk2);
    expect(store.streamingDocument.get(`turn.${tk1}.assistant`)).toBe("A1");
    expect(store.streamingDocument.get(`turn.${tk2}.assistant`)).toBe("A2");
  });
});

// ---------------------------------------------------------------------------
// [replay-1] — a dangling cold-resume turn commits instead of stranding
// ---------------------------------------------------------------------------

describe("CodeSessionStore — [replay-1] dangling-turn terminal", () => {
  /** A `turn_complete { result: "interrupted" }` — the shape tugcode's
   *  replay translator synthesizes at end-of-JSONL for a cycle that
   *  never reached `end_turn` (a cold resume of an abandoned turn). */
  function turnCompleteInterrupted(msgId: string) {
    return {
      type: "turn_complete",
      msg_id: msgId,
      seq: 1,
      result: "interrupted",
      ipc_version: IPC_VERSION,
    };
  }

  it("commits a replayed dangling turn (result: interrupted) as a terminal interrupted TurnEntry", () => {
    const { store, conn } = makeStore();

    emit(conn, replayStarted());
    emit(conn, userMessageReplay("msg-d", "do the thing"));
    emit(conn, assistantText("msg-d", "starting on it"));
    // tugcode's synthetic dangling-cycle terminal.
    emit(conn, turnCompleteInterrupted("msg-d"));
    emit(conn, replayComplete(1));

    const snap = store.getSnapshot();
    // Bracket closed cleanly to `idle` — chain-link-13 did NOT fire,
    // because the synthetic turn_complete cleared `pendingUserMessage`.
    expect(snap.phase).toBe("idle");
    // The dangling turn is a committed terminal entry — no in-flight
    // row, so the transcript renders `EndStateDisplay`, not a forever-
    // animating `TugThinkingIndicator`.
    expect(snap.inflightUserMessage).toBeNull();
    expect(snap.transcript.length).toBe(1);
    expect(snap.transcript[0].msgId).toBe("msg-d");
    expect(snap.transcript[0].turnEndReason).toBe("interrupted");
    expect(snap.transcript[0].result).toBe("interrupted");
  });

  it("regression guard — a replay with NO terminal for the last turn keeps chain-link-13 (phase → streaming)", () => {
    // Reload-mid-stream: tugcode left the cycle open
    // (`synthesizeDanglingTerminal` false) because a live ActiveTurn
    // is still producing the turn. `pendingUserMessage` survives the
    // bracket; chain-link-13 transitions to `streaming` so the live
    // drain's eventual `turn_complete` commits the turn naturally.
    const { store, conn } = makeStore();

    emit(conn, replayStarted());
    emit(conn, userMessageReplay("msg-live", "still streaming"));
    emit(conn, assistantText("msg-live", "partial repl"));
    // No turn_complete — the cycle is genuinely still live.
    emit(conn, replayComplete(0));

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("streaming");
    expect(snap.inflightUserMessage).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// [W2] — a flushed EOF orphan commits as an empty-assistant interrupted turn
// ---------------------------------------------------------------------------

describe("CodeSessionStore — [W2] flushed EOF orphan", () => {
  /** A `turn_complete { result: "interrupted" }` — the shape tugcode's
   *  replay translator emits (paired with a `user_message_replay`
   *  keyed on a synthetic `orphan-<n>` id) when it flushes a trailing
   *  user submission stranded at end-of-JSONL. */
  function turnCompleteInterrupted(msgId: string) {
    return {
      type: "turn_complete",
      msg_id: msgId,
      seq: 1,
      result: "interrupted",
      ipc_version: IPC_VERSION,
    };
  }

  it("commits a flushed trailing-orphan as an empty-assistant interrupted turn", () => {
    const { store, conn } = makeStore();

    emit(conn, replayStarted());
    // A real turn ahead of the orphan, so transcript ordering is
    // exercised too.
    emit(conn, userMessageReplay("msg-1", "first prompt"));
    emit(conn, assistantText("msg-1", "first reply"));
    emit(conn, turnComplete("msg-1", "success"));

    // The translator's EOF orphan flush ([W2]): a user_message_replay
    // + turn_complete{interrupted} keyed on a synthetic orphan id,
    // with NO assistant_text between them — the user quit before any
    // output landed.
    emit(conn, userMessageReplay("orphan-0", "one more thing"));
    emit(conn, turnCompleteInterrupted("orphan-0"));
    emit(conn, replayComplete(2));

    const snap = store.getSnapshot();
    // Bracket closed cleanly to `idle` — the orphan's turn_complete
    // cleared `pendingUserMessage`, so chain-link-13 did not fire.
    expect(snap.phase).toBe("idle");
    expect(snap.canSubmit).toBe(true);
    expect(snap.inflightUserMessage).toBeNull();
    expect(snap.transcript.length).toBe(2);

    const orphan = snap.transcript[1];
    expect(orphan.msgId).toBe("orphan-0");
    expect(orphan.userMessage.text).toBe("one more thing");
    // No assistant_text was emitted — the committed turn carries empty
    // assistant content (the flushed-orphan shape, [W2]).
    expect(orphan.assistant).toBe("");
    // The interrupted result round-trips: the row renders the
    // `interrupted` badge, not `error`.
    expect(orphan.turnEndReason).toBe("interrupted");
    expect(orphan.result).toBe("interrupted");
  });
});
