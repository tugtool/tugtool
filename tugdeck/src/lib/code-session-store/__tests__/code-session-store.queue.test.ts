/**
 * Step 7 — queue flush on `turn_complete(success)`.
 *
 * The single-tick collapse (Spec S03) guarantees that a queued send
 * flushes in the same dispatch that commits the preceding turn, so
 * subscribers observe a final phase of `submitting`, not a transient
 * `idle`, and are notified exactly once per collapse.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import {
  MockTugConnection,
} from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { FeedId } from "@/protocol";

function constructStore(conn: MockTugConnection): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
  });
}

/**
 * Drive the store from `submitting` (just after a `send`) through two
 * assistant_text partials to `streaming`. Uses `msgId` so each turn's
 * scratch buffer is isolated.
 */
function driveToStreaming(
  conn: MockTugConnection,
  store: CodeSessionStore,
  msgId: string,
): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: "a",
    is_partial: true,
    rev: 0,
    seq: 0,
  });
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: "b",
    is_partial: true,
    rev: 1,
    seq: 0,
  });
  expect(store.getSnapshot().phase).toBe("streaming");
}

function dispatchTurnCompleteSuccess(
  conn: MockTugConnection,
  msgId: string,
): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "turn_complete",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    result: "success",
  });
}

function userMessageFrames(
  conn: MockTugConnection,
): Array<{ text: string }> {
  return conn.recordedFrames
    .filter(
      (f) =>
        f.feedId === FeedId.CODE_INPUT &&
        (f.decoded as { type?: string }).type === "user_message",
    )
    .map((f) => ({ text: (f.decoded as { text: string }).text }));
}

describe("CodeSessionStore — queue flush via turn_complete(success) collapse (Step 7)", () => {
  it("flushes exactly one queued send per successful turn and stays in submitting", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("first", []);
    driveToStreaming(conn, store, FIXTURE_IDS.MSG_ID_N(1));

    // Queue three mid-stream sends.
    store.send("a", []);
    store.send("b", []);
    store.send("c", []);
    expect(store.getSnapshot().queuedSends).toBe(3);
    expect(userMessageFrames(conn).map((f) => f.text)).toEqual(["first"]);

    // Subscribe *after* the send + driveToStreaming so we count only
    // the collapse notification on the next turn_complete.
    let notifyCount = 0;
    store.subscribe(() => {
      notifyCount += 1;
    });

    // First successful turn completes. Observers see final phase
    // `submitting` and are notified exactly once during the collapse.
    dispatchTurnCompleteSuccess(conn, FIXTURE_IDS.MSG_ID_N(1));

    let snap = store.getSnapshot();
    expect(snap.phase).toBe("submitting");
    expect(snap.queuedSends).toBe(2);
    expect(snap.transcript.length).toBe(1);
    expect(userMessageFrames(conn).map((f) => f.text)).toEqual([
      "first",
      "a",
    ]);
    expect(notifyCount).toBe(1);

    // Drive the next turn: two partials → streaming → turn_complete.
    driveToStreaming(conn, store, FIXTURE_IDS.MSG_ID_N(2));
    dispatchTurnCompleteSuccess(conn, FIXTURE_IDS.MSG_ID_N(2));

    snap = store.getSnapshot();
    expect(snap.phase).toBe("submitting");
    expect(snap.queuedSends).toBe(1);
    expect(snap.transcript.length).toBe(2);
    expect(userMessageFrames(conn).map((f) => f.text)).toEqual([
      "first",
      "a",
      "b",
    ]);

    // Third turn drains the last queued entry.
    driveToStreaming(conn, store, FIXTURE_IDS.MSG_ID_N(3));
    dispatchTurnCompleteSuccess(conn, FIXTURE_IDS.MSG_ID_N(3));

    snap = store.getSnapshot();
    expect(snap.phase).toBe("submitting");
    expect(snap.queuedSends).toBe(0);
    expect(snap.transcript.length).toBe(3);
    expect(userMessageFrames(conn).map((f) => f.text)).toEqual([
      "first",
      "a",
      "b",
      "c",
    ]);

    // Final turn with empty queue lands on idle, not submitting.
    driveToStreaming(conn, store, FIXTURE_IDS.MSG_ID_N(4));
    dispatchTurnCompleteSuccess(conn, FIXTURE_IDS.MSG_ID_N(4));

    snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.queuedSends).toBe(0);
    expect(snap.transcript.length).toBe(4);
  });

  it("clears a non-empty queue on turn_complete(error) without flushing", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("first", []);
    driveToStreaming(conn, store, FIXTURE_IDS.MSG_ID);

    store.send("a", []);
    store.send("b", []);
    expect(store.getSnapshot().queuedSends).toBe(2);

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "error",
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.queuedSends).toBe(0);
    expect(snap.transcript[0].result).toBe("interrupted");
    // No flushed user_message frame was written — only "first".
    expect(userMessageFrames(conn).map((f) => f.text)).toEqual(["first"]);
  });
});
