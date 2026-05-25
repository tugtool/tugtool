/**
 * Wake-bracket store-wrapper tests for `CodeSessionStore`. End-to-end
 * through `_ingestFrameForTest` so the wire-frame decode (`frameToEvent`)
 * AND the reducer (`handleWakeStarted` + the loosened guards + the
 * `waking → idle` commit branch) run together — pinning the cross-
 * boundary contract that the pure-reducer tests in `handle-wake.test.ts`
 * cannot see (`frameToEvent` mints the turnKey before dispatch; the
 * snapshot's `canInterrupt` projects `waking` to `true` per [Q03]).
 *
 * See `roadmap/tugplan-tide-session-wake.md` Step 5 for the test matrix.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { committedTurnValue } from "@/lib/code-session-store/testing/inflight-paths";
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

function emit(conn: TestFrameChannel, evt: Record<string, unknown>): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, { ...evt, tug_session_id: TUG });
}

function wakeStartedFrame(
  overrides: Partial<{
    task_id: string;
    tool_use_id: string;
    status: "completed" | "failed" | "stopped";
    summary: string;
    output_file: string;
  }> = {},
): Record<string, unknown> {
  return {
    type: "wake_started",
    session_id: FIXTURE_IDS.CLAUDE_SESSION_ID,
    wake_trigger: {
      task_id: FIXTURE_IDS.TASK_ID,
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      status: "stopped",
      summary: "kernel lines in /var/log/system.log",
      output_file: "",
      ...overrides,
    },
    ipc_version: IPC_VERSION,
  };
}

function assistantText(msgId: string, text: string, isPartial = false) {
  return {
    type: "assistant_text",
    msg_id: msgId,
    seq: 0,
    rev: 0,
    text,
    is_partial: isPartial,
    status: isPartial ? "partial" : "complete",
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
// frameToEvent turnKey mint + reducer dispatch
// ---------------------------------------------------------------------------

describe("CodeSessionStore — wake_started turnKey mint", () => {
  it("frameToEvent mints a turnKey on receipt; the wire frame does NOT carry one", () => {
    const { store, conn } = makeStore();
    // The wire frame deliberately omits `turnKey` — the store wrapper
    // mints it (same contract as `user_message_replay`).
    emit(conn, wakeStartedFrame());
    const snap = store.getSnapshot();

    expect(snap.phase).toBe("waking");
    // The minted turnKey lands on `inflightUserMessage` (which mirrors
    // the reducer's `pendingUserMessage` per [D10]). Without the mint,
    // `pendingUserMessage.turnKey` would be undefined and the per-turn
    // write paths would not address the right key.
    expect(snap.inflightUserMessage).not.toBeNull();
    expect(typeof snap.inflightUserMessage?.turnKey).toBe("string");
    expect(snap.inflightUserMessage?.turnKey.length).toBeGreaterThan(0);
  });

  it("threads the camelCase wakeTrigger payload through to the snapshot", () => {
    const { store, conn } = makeStore();
    emit(
      conn,
      wakeStartedFrame({
        task_id: "task-abc",
        tool_use_id: "toolu_abc",
        status: "completed",
        summary: "background job finished",
        output_file: "/tmp/job.out",
      }),
    );
    const snap = store.getSnapshot();

    expect(snap.wakeTrigger).toEqual({
      taskId: "task-abc",
      toolUseId: "toolu_abc",
      status: "completed",
      summary: "background job finished",
      outputFile: "/tmp/job.out",
    });
  });

  it("each wake mints a fresh turnKey — back-to-back wakes do not collide", () => {
    const { store, conn } = makeStore();

    // Wake 1
    emit(conn, wakeStartedFrame());
    emit(conn, assistantText("msg-w1", "wake-1"));
    emit(conn, turnComplete("msg-w1"));
    const snap1 = store.getSnapshot();
    const tk1 = snap1.transcript[0].turnKey;

    // Wake 2
    emit(conn, wakeStartedFrame({ task_id: "task-2" }));
    emit(conn, assistantText("msg-w2", "wake-2"));
    emit(conn, turnComplete("msg-w2"));
    const snap2 = store.getSnapshot();
    const tk2 = snap2.transcript[1].turnKey;

    expect(tk1).not.toBe(tk2);
    expect(committedTurnValue(store, "assistant", 0)).toBe("wake-1");
    expect(committedTurnValue(store, "assistant", 1)).toBe("wake-2");
  });
});

// ---------------------------------------------------------------------------
// Snapshot projections that gate UI affordances
// ---------------------------------------------------------------------------

describe("CodeSessionStore — wake snapshot gates", () => {
  it("canInterrupt is true during waking per [Q03]; canSubmit is false (phase !== idle)", () => {
    const { store, conn } = makeStore();
    emit(conn, wakeStartedFrame());
    const snap = store.getSnapshot();
    expect(snap.canInterrupt).toBe(true);
    expect(snap.canSubmit).toBe(false);
  });

  it("canSubmit returns to true after the wake commits to idle", () => {
    const { store, conn } = makeStore();
    emit(conn, wakeStartedFrame());
    emit(conn, assistantText(FIXTURE_IDS.MSG_ID, "wake content"));
    emit(conn, turnComplete(FIXTURE_IDS.MSG_ID));
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.canSubmit).toBe(true);
    expect(snap.canInterrupt).toBe(false);
    expect(snap.wakeTrigger).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full end-to-end wake round-trip — the integration regression for PPF-01
// ---------------------------------------------------------------------------

describe("CodeSessionStore — wake bracket round-trip [PPF-01]", () => {
  it("wake_started → assistant_text → turn_complete commits a TurnEntry with empty-text user marker and the wake's assistant content", () => {
    const { store, conn } = makeStore();

    emit(conn, wakeStartedFrame());
    emit(conn, assistantText(FIXTURE_IDS.MSG_ID, "investigating /var/log…"));
    emit(conn, turnComplete(FIXTURE_IDS.MSG_ID));

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript.length).toBe(1);
    const entry = snap.transcript[0];
    // The empty-text userMessage IS the wake sentinel — consumers
    // check `userMessage.text === ""` and skip the user-bubble render.
    expect(entry.userMessage.text).toBe("");
    expect(entry.assistant).toBe("investigating /var/log…");
    expect(entry.result).toBe("success");
    // The per-turn write paths landed under the minted turnKey.
    expect(committedTurnValue(store, "assistant")).toBe(
      "investigating /var/log…",
    );
  });

  it("a wake's assistant_text is NOT dropped (the closed PPF-01 regression)", () => {
    const { store, conn } = makeStore();

    // Pre-Step-4 behavior: with no wake bracket, this text would be
    // dropped by the `handleTextDelta` guard (phase === "idle"). The
    // bracket lets it through; this test fails loudly if the guard
    // regresses.
    emit(conn, wakeStartedFrame());
    emit(conn, assistantText(FIXTURE_IDS.MSG_ID, "content from wake"));

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("waking");
    expect(snap.activeMsgId).toBe(FIXTURE_IDS.MSG_ID);
    expect(snap.inflightUserMessage).not.toBeNull();
  });
});
