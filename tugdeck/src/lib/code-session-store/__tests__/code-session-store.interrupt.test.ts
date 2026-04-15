/**
 * Step 7 — interrupt semantics. Exercises:
 *
 *  - `v2.1.105/test-06-interrupt-mid-stream` replay: stop at the second
 *    assistant_text partial, call `interrupt()`, capture the in-flight
 *    buffer, then drain the rest of the fixture (including the
 *    fixture's own `turn_complete(error)`). The committed transcript
 *    entry carries `result: "interrupted"` and the accumulated text.
 *  - Synthetic queue-clear: three mid-stream `send` calls populate
 *    `queuedSends`; `interrupt()` wipes them; a synthetic
 *    `turn_complete(error)` then commits. The only outbound frames
 *    should be the original `user_message` and the `interrupt`.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import {
  MockTugConnection,
} from "@/lib/code-session-store/testing/mock-feed-store";
import {
  FIXTURE_IDS,
  loadGoldenProbe,
} from "@/lib/code-session-store/testing/golden-catalog";
import { FeedId } from "@/protocol";

function constructStore(conn: MockTugConnection): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
  });
}

describe("CodeSessionStore — interrupt mid-stream on test-06 (Step 7)", () => {
  it("preserves accumulated text and commits an interrupted TurnEntry", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-06-interrupt-mid-stream");
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("please run forever", []);

    // Fixture layout (0-indexed, cross-reference fixture lines 1..7):
    //  0: session_init
    //  1: system_metadata
    //  2: assistant_text partial rev=0 (3 chars)
    //  3: assistant_text partial rev=1 (113 chars)  ← K stop point
    //  4: cost_update
    //  5: assistant_text complete rev=0 seq=1 (116 chars)
    //  6: turn_complete result=error
    const K = 3; // second assistant_text partial, inclusive
    for (let i = 0; i <= K; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    expect(store.getSnapshot().phase).toBe("streaming");
    const preservedText = store.streamingDocument.get(
      "inflight.assistant",
    ) as string;
    expect(preservedText.length).toBe(116); // 3 + 113 accumulated

    const framesBefore = conn.recordedFrames.length;
    store.interrupt();

    // interrupt frame written, queue cleared, phase unchanged.
    expect(conn.recordedFrames.length).toBe(framesBefore + 1);
    const interruptFrame = conn.recordedFrames[framesBefore];
    expect(interruptFrame.feedId).toBe(FeedId.CODE_INPUT);
    expect(interruptFrame.decoded).toEqual({
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      type: "interrupt",
    });

    // Drain the remaining events. The fixture emits its own
    // turn_complete(error) after a few more frames — the reducer
    // commits whatever has accumulated in the in-flight buffer at that
    // moment, including the terminal assistant_text that lands between
    // our interrupt and the turn_complete.
    for (let i = K + 1; i < probe.events.length; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript.length).toBe(1);
    expect(snap.transcript[0].result).toBe("interrupted");
    // The fixture's terminal assistant_text carries exactly 116 chars,
    // matching the length of the accumulated partials captured before
    // the interrupt — so the committed buffer is the same length.
    expect(snap.transcript[0].assistant.length).toBe(116);
    expect(snap.transcript[0].assistant).toBe(preservedText);

    // In-flight document cleared on turn_complete.
    expect(store.streamingDocument.get("inflight.assistant")).toBe("");
  });
});

describe("CodeSessionStore — synthetic queue clear on interrupt (Step 7)", () => {
  it("discards queued sends and emits only the original user_message + interrupt", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("first", []);
    // Drive submitting → awaiting_first_token → streaming.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "x",
      is_partial: true,
      rev: 0,
      seq: 0,
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "y",
      is_partial: true,
      rev: 1,
      seq: 0,
    });
    expect(store.getSnapshot().phase).toBe("streaming");

    // Three mid-stream sends enqueue without writing frames.
    store.send("a", []);
    store.send("b", []);
    store.send("c", []);
    expect(store.getSnapshot().queuedSends).toBe(3);
    // Only the original user_message has been written so far.
    expect(conn.recordedFrames.length).toBe(1);

    store.interrupt();
    expect(store.getSnapshot().queuedSends).toBe(0);

    // Outbound so far: user_message "first", interrupt.
    expect(conn.recordedFrames.length).toBe(2);
    expect(conn.recordedFrames[0].decoded).toEqual({
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      type: "user_message",
      text: "first",
      attachments: [],
    });
    expect(conn.recordedFrames[1].decoded).toEqual({
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      type: "interrupt",
    });

    // A synthetic turn_complete(error) closes the turn.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "error",
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.queuedSends).toBe(0);
    expect(snap.transcript.length).toBe(1);
    expect(snap.transcript[0].result).toBe("interrupted");

    // No additional frames were written during the commit path.
    expect(conn.recordedFrames.length).toBe(2);
  });

  it("drops interrupt() when the store is idle", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.interrupt();
    expect(conn.recordedFrames.length).toBe(0);
    expect(store.getSnapshot().phase).toBe("idle");
  });
});
