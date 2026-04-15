/**
 * Step 8 — errored phase triggers + recovery.
 *
 * Spec S04 describes two triggers for the `errored` phase:
 *  - `SESSION_STATE { state: "errored", detail }` delivered through the
 *    filtered FeedStore subscription from Step 3.
 *  - `TugConnection.onClose` firing during an active turn.
 *
 * Both populate `lastError` with a distinct cause tag. The next
 * `send()` from `errored` re-enters `submitting` without clearing
 * `lastError`; a subsequent `turn_complete(success)` is what finally
 * clears it (the manual-recovery semantics from [D08]).
 *
 * CONTROL-error triggers (`session_not_owned`, `session_unknown`) are
 * explicitly out of scope for T3.4.a and have no coverage here.
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

describe("CodeSessionStore — SESSION_STATE errored trigger (Step 8)", () => {
  it("routes a session_state errored frame into the errored phase", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hello", []);
    driveToStreaming(conn, store, FIXTURE_IDS.MSG_ID);

    const transcriptBefore = store.getSnapshot().transcript;

    // SESSION_STATE payload shape per `build_session_state_frame` in
    // tugcast: `{ tug_session_id, state, detail }` (no top-level type).
    conn.dispatchDecoded(FeedId.SESSION_STATE, {
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      state: "errored",
      detail: "crash_budget_exhausted",
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("errored");
    expect(snap.lastError).not.toBeNull();
    expect(snap.lastError?.cause).toBe("session_state_errored");
    expect(snap.lastError?.message).toContain("crash_budget_exhausted");
    // Errored is NOT a commit — the transcript ref is unchanged.
    expect(snap.transcript).toBe(transcriptBefore);
    expect(snap.transcript.length).toBe(0);
  });

  it("drops non-errored session_state frames silently", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);
    driveToStreaming(conn, store, FIXTURE_IDS.MSG_ID);

    conn.dispatchDecoded(FeedId.SESSION_STATE, {
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      state: "pending",
    });
    conn.dispatchDecoded(FeedId.SESSION_STATE, {
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      state: "spawning",
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("streaming");
    expect(snap.lastError).toBeNull();
  });
});

describe("CodeSessionStore — transport close trigger (Step 8)", () => {
  it("routes onClose into the errored phase during an active turn", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hello", []);
    expect(store.getSnapshot().phase).toBe("submitting");

    conn.triggerClose();

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("errored");
    expect(snap.lastError).not.toBeNull();
    expect(snap.lastError?.cause).toBe("transport_closed");
  });

  it("drops onClose when the store is idle", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    expect(store.getSnapshot().phase).toBe("idle");
    conn.triggerClose();

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.lastError).toBeNull();
  });
});

describe("CodeSessionStore — retry recovery from errored (Step 8)", () => {
  it("re-submits from errored, keeps lastError until turn_complete(success)", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("initial", []);
    driveToStreaming(conn, store, FIXTURE_IDS.MSG_ID_N(1));

    // Force errored via SESSION_STATE.
    conn.dispatchDecoded(FeedId.SESSION_STATE, {
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      state: "errored",
      detail: "boom",
    });
    expect(store.getSnapshot().phase).toBe("errored");
    const errAtFirst = store.getSnapshot().lastError;
    expect(errAtFirst).not.toBeNull();

    // Retry. Phase flips to submitting, but lastError stays set.
    store.send("retry", []);
    let snap = store.getSnapshot();
    expect(snap.phase).toBe("submitting");
    expect(snap.lastError).toBe(errAtFirst);

    // The retry also wrote a fresh user_message frame.
    const retryFrame = conn.recordedFrames.find(
      (f, idx) =>
        idx > 0 && // skip the first submit
        (f.decoded as { type?: string; text?: string }).type ===
          "user_message" &&
        (f.decoded as { text?: string }).text === "retry",
    );
    expect(retryFrame).toBeDefined();

    // Drive the retry turn to completion.
    driveToStreaming(conn, store, FIXTURE_IDS.MSG_ID_N(2));
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID_N(2),
      result: "success",
    });

    snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.lastError).toBeNull();
    expect(snap.transcript.length).toBe(1);
    expect(snap.transcript[0].userMessage.text).toBe("retry");
  });
});
