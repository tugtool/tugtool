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
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import {
  TestFrameChannel,
} from "@/lib/code-session-store/testing/mock-feed-store";
import {
  FIXTURE_IDS,
  loadGoldenProbe,
} from "@/lib/code-session-store/testing/golden-catalog";
import { FeedId } from "@/protocol";

function constructStore(
  conn: TestFrameChannel,
  lifecycle: ConnectionLifecycle = new ConnectionLifecycle(),
): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle,
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
  });
}

describe("CodeSessionStore — interrupt mid-stream on test-06 (Step 7)", () => {
  it("preserves accumulated text and commits an interrupted TurnEntry", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-06-interrupt-mid-stream");
    const conn = new TestFrameChannel();
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

describe("CodeSessionStore — inflightUserMessage cleared on interrupt (Step 9)", () => {
  it("clears inflightUserMessage when the turn is interrupted via test-06", () => {
    // [D10] / Step 9 — the in-flight pending message is set on
    // `send`, mirrored through the snapshot for the duration of the
    // turn, and cleared when the reducer commits the TurnEntry —
    // including the interrupt path that produces
    // `result: "interrupted"`. This pins the cleanup-on-interrupt
    // contract end-to-end through test-06's mid-stream stop.
    const probe = loadGoldenProbe("v2.1.105", "test-06-interrupt-mid-stream");
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    expect(store.getSnapshot().inflightUserMessage).toBeNull();

    store.send("please run forever", []);
    expect(store.getSnapshot().inflightUserMessage?.text).toBe(
      "please run forever",
    );

    // Drive into mid-stream (per the existing test-06 layout).
    const K = 3;
    for (let i = 0; i <= K; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }
    // Mid-stream — pending still in flight.
    expect(store.getSnapshot().inflightUserMessage?.text).toBe(
      "please run forever",
    );

    store.interrupt();
    // `interrupt()` does NOT immediately clear the pending message —
    // the reducer waits for `turn_complete(error)` to commit the
    // interrupted entry before clearing. Until then the in-flight
    // pair still belongs in the transcript.
    expect(store.getSnapshot().inflightUserMessage?.text).toBe(
      "please run forever",
    );

    // Drain the rest of the fixture (which includes the
    // `turn_complete(error)` that commits the interrupted entry).
    for (let i = K + 1; i < probe.events.length; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    const final = store.getSnapshot();
    expect(final.phase).toBe("idle");
    expect(final.inflightUserMessage).toBeNull();
    expect(final.transcript.length).toBe(1);
    expect(final.transcript[0].result).toBe("interrupted");
    expect(final.transcript[0].userMessage.text).toBe("please run forever");
  });
});

describe("CodeSessionStore — synthetic queue clear on interrupt (Step 7)", () => {
  it("discards queued sends and emits only the original user_message + interrupt", () => {
    const conn = new TestFrameChannel();
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
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.interrupt();
    expect(conn.recordedFrames.length).toBe(0);
    expect(store.getSnapshot().phase).toBe("idle");
  });
});

describe("CodeSessionStore — interrupt during awaiting_approval (Step 9b)", () => {
  it("clears pendingApproval and restores prevPhase before turn_complete arrives", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("read some file", []);

    // Drive into tool_work by opening a Read tool call.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "tool_use",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID,
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      tool_name: "Read",
      input: {},
      seq: 0,
    });
    expect(store.getSnapshot().phase).toBe("tool_work");

    // A permission prompt lands and the store waits.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "control_request_forward",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      request_id: FIXTURE_IDS.REQUEST_ID,
      is_question: false,
      tool_name: "Read",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      input: { file_path: "/tmp/x" },
    });
    expect(store.getSnapshot().phase).toBe("awaiting_approval");
    expect(store.getSnapshot().pendingApproval).not.toBeNull();

    // User interrupts instead of responding. The store writes the
    // interrupt frame AND simultaneously restores a coherent
    // non-approval state — subscribers never see the "live prompt on
    // a dead turn" window while waiting for turn_complete(error).
    const framesBefore = conn.recordedFrames.length;
    store.interrupt();

    expect(conn.recordedFrames.length).toBe(framesBefore + 1);
    const interruptFrame = conn.recordedFrames[framesBefore];
    expect(interruptFrame.feedId).toBe(FeedId.CODE_INPUT);
    expect(interruptFrame.decoded).toEqual({
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      type: "interrupt",
    });

    const mid = store.getSnapshot();
    expect(mid.pendingApproval).toBeNull();
    expect(mid.pendingQuestion).toBeNull();
    // prevPhase was tool_work before the prompt, so that's where we
    // land until turn_complete(error) commits the interrupted entry.
    expect(mid.phase).toBe("tool_work");

    // Claude's turn_complete(error) follows the interrupt round-trip.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "error",
    });

    const end = store.getSnapshot();
    expect(end.phase).toBe("idle");
    expect(end.transcript.length).toBe(1);
    expect(end.transcript[0].result).toBe("interrupted");
  });
});

// ---------------------------------------------------------------------------
// Step 1.1 — Phase-aware interrupt: CASE A (submitting, no msg_id yet)
// ---------------------------------------------------------------------------
//
// The dividing line between CASE A and CASE B is the first content frame
// from claude carrying an `msg_id`. While `phase === "submitting"` the
// wire received our `user_message` but no `msg_id` is bound on this side
// — there is nothing meaningful to commit as an interrupted TurnEntry.
// CASE A captures the pending message into `pendingDraftRestore` for the
// prompt-entry editor to seed back into the editor surface, clears the
// in-flight pair, returns phase to `idle`, and increments
// `pendingCaseAEchoes` so the wire's eventual
// `turn_complete(msg_id: "", result: "error")` is suppressed by the
// gate at the top of `handleTurnComplete`. The counter (rather than a
// boolean) makes back-to-back cancels and re-submit-before-echo races
// correct: each abort claims its own pending suppression slot,
// drained in FIFO order as wire echoes arrive. Wire frame shapes and
// FIFO ordering verified via `tugcode/probe-case-a.ts` and
// `tugcode/probe-case-a-race.ts`.

describe("CodeSessionStore — CASE A interrupt (submitting → no transcript entry)", () => {
  it("captures pendingDraftRestore, clears inflight, routes phase to idle", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("draft text", []);
    expect(store.getSnapshot().phase).toBe("submitting");
    expect(store.getSnapshot().inflightUserMessage?.text).toBe("draft text");
    expect(store.getSnapshot().pendingDraftRestore).toBeNull();

    const framesBefore = conn.recordedFrames.length;
    store.interrupt();

    // One outbound interrupt frame.
    expect(conn.recordedFrames.length).toBe(framesBefore + 1);
    expect(conn.recordedFrames[framesBefore].decoded).toEqual({
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      type: "interrupt",
    });

    const mid = store.getSnapshot();
    // The draft is captured for the editor to consume.
    expect(mid.pendingDraftRestore).not.toBeNull();
    expect(mid.pendingDraftRestore?.text).toBe("draft text");
    expect(mid.pendingDraftRestore?.atoms).toEqual([]);
    // In-flight pair stops rendering immediately.
    expect(mid.inflightUserMessage).toBeNull();
    expect(mid.queuedSends).toBe(0);
    // Phase returns to idle so the user can resubmit without waiting
    // for the wire round-trip.
    expect(mid.phase).toBe("idle");
    expect(mid.canSubmit).toBe(true);
    expect(mid.canInterrupt).toBe(false);
    // No transcript entry yet (and there should never be one).
    expect(mid.transcript).toEqual([]);

    // The wire eventually echoes the cancelled cycle's
    // turn_complete(error). The empirical wire shape carries
    // `msg_id: ""` for an aborted-no-content cycle (verified via
    // `tugcode/probe-case-a.ts`); the suppression gate is keyed on
    // `pendingCaseAEchoes > 0 && activeMsgId === null && result ===
    // "error"`, NOT on the msg_id, so an empty id is fine.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "",
      result: "error",
    });

    const end = store.getSnapshot();
    expect(end.phase).toBe("idle");
    expect(end.transcript).toEqual([]);
    expect(end.activeMsgId).toBeNull();
    // The restore slot is unaffected by the wire echo — only the
    // editor's `consumePendingDraftRestore()` clears it.
    expect(end.pendingDraftRestore?.text).toBe("draft text");
  });

  it("re-submit before echo: aborted echo is suppressed, new turn commits cleanly (FIFO race)", () => {
    // Race scenario: user clicks Stop (CASE A), edits, clicks Send
    // again — all before the wire's `turn_complete(error, msg_id: "")`
    // for the aborted cycle arrives. Wire FIFO ordering (verified via
    // `tugcode/probe-case-a-race.ts`) guarantees the aborted cycle's
    // echo arrives BEFORE any frame from the new cycle, so at the
    // moment the suppression gate fires `state.activeMsgId` is still
    // null. The counter (set by CASE A, drained here) tracks the
    // pending suppression across the re-submit; `handleSend` does NOT
    // clear the counter for this reason.
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("draft v1", []);
    store.interrupt();
    expect(store.getSnapshot().pendingDraftRestore?.text).toBe("draft v1");

    // Simulate the editor consuming the restore.
    store.consumePendingDraftRestore();
    expect(store.getSnapshot().pendingDraftRestore).toBeNull();

    // User re-submits with edits — phase moves idle → submitting; the
    // outstanding case-A echo counter survives so the in-flight
    // aborted-cycle echo is still routable to the suppression gate.
    store.send("draft v2", []);
    expect(store.getSnapshot().phase).toBe("submitting");
    expect(store.getSnapshot().inflightUserMessage?.text).toBe("draft v2");
    expect(store.getSnapshot().activeMsgId).toBeNull();

    // FIFO order: aborted cycle's echo lands BEFORE any frame from
    // the new turn. Counter > 0 + activeMsgId === null + result ===
    // "error" → suppress, decrement.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "",
      result: "error",
    });
    const afterEcho = store.getSnapshot();
    expect(afterEcho.phase).toBe("submitting");
    expect(afterEcho.transcript).toEqual([]);
    expect(afterEcho.inflightUserMessage?.text).toBe("draft v2");

    // New turn proceeds normally. First content sets activeMsgId so
    // any further echoes route via the standard path, not the gate.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "msg-v2",
      text: "ok",
      is_partial: false,
      seq: 0,
      rev: 0,
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "msg-v2",
      result: "success",
    });

    const end = store.getSnapshot();
    expect(end.phase).toBe("idle");
    expect(end.transcript.length).toBe(1);
    expect(end.transcript[0].result).toBe("success");
    expect(end.transcript[0].userMessage.text).toBe("draft v2");
  });

  it("two back-to-back CASE A cancels: both wire echoes suppressed via the counter", () => {
    // The counter (rather than a boolean) is what makes back-to-back
    // cancels correct. Each CASE A increments; each matching wire
    // echo decrements in FIFO order.
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("draft #1", []);
    store.interrupt();
    expect(store.getSnapshot().pendingDraftRestore?.text).toBe("draft #1");
    store.consumePendingDraftRestore();

    store.send("draft #2", []);
    store.interrupt();
    expect(store.getSnapshot().pendingDraftRestore?.text).toBe("draft #2");
    store.consumePendingDraftRestore();

    // Two outstanding aborted echoes. Wire delivers them in FIFO order.
    // First echo: counter 2→1, suppressed.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "",
      result: "error",
    });
    expect(store.getSnapshot().transcript).toEqual([]);

    // Second echo: counter 1→0, also suppressed.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "",
      result: "error",
    });
    expect(store.getSnapshot().transcript).toEqual([]);
    expect(store.getSnapshot().phase).toBe("idle");

    // After the counter has drained, a fresh turn that errors
    // pre-content commits an interrupted entry as the existing
    // semantics demand (claude crashed before any content; the
    // empty-interrupted entry is the "something went wrong" marker).
    store.send("draft #3", []);
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "msg-3",
      result: "error",
    });
    const end = store.getSnapshot();
    expect(end.transcript.length).toBe(1);
    expect(end.transcript[0].result).toBe("interrupted");
    expect(end.transcript[0].userMessage.text).toBe("draft #3");
  });

  it("transport_close resets the case-A counter (stranded echoes are lost with the wire)", () => {
    // The counter must reset on transport close because any pending
    // echoes are tied to the now-dead connection. Letting the counter
    // carry across a reconnect would falsely suppress the next live
    // turn's pre-content error after reconnect.
    const conn = new TestFrameChannel();
    const lifecycle = new ConnectionLifecycle();
    const store = constructStore(conn, lifecycle);

    store.send("about to die", []);
    store.interrupt();
    expect(store.getSnapshot().pendingDraftRestore?.text).toBe("about to die");
    // Counter was incremented; an aborted echo is in flight.

    // Transport drops before the echo arrives. The
    // ConnectionLifecycle fires connectionDidClose; the store
    // dispatches transport_close into the reducer, which (per Design
    // E) resets `pendingCaseAEchoes` to 0 alongside flipping
    // transportState to offline.
    lifecycle.notifyConnectionDidClose();
    expect(store.getSnapshot().transportState).toBe("offline");

    // Bring the wire back: open + settle. The store is now `errored`
    // (per the existing transport_close path for non-idle phases) but
    // the case-A counter is 0, so the next live turn's error route
    // is normal.
    lifecycle.notifyConnectionDidOpen();
    store.notifyTransportSettled();
    expect(store.getSnapshot().transportState).toBe("online");

    // A fresh turn that errors pre-content must commit an interrupted
    // entry — confirming the counter was indeed reset and the next
    // live `turn_complete(error)` is NOT falsely suppressed by a
    // stranded echo from the prior connection.
    store.send("post-reconnect submit", []);
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "msg-after-reconnect",
      result: "error",
    });
    const end = store.getSnapshot();
    expect(end.transcript.length).toBe(1);
    expect(end.transcript[0].result).toBe("interrupted");
    expect(end.transcript[0].userMessage.text).toBe("post-reconnect submit");
  });

  it("wipes queued sends on CASE A interrupt (current behavior preserved)", () => {
    // The user can't actually queue from the prompt entry while
    // phase=submitting (no partial received yet), but a programmatic
    // queue pre-existing here would still need to be cleared. Pin
    // the contract end-to-end.
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("first draft", []);
    expect(store.getSnapshot().phase).toBe("submitting");

    // Defensive synthetic enqueue while phase is still submitting.
    // The reducer's `handleSend` falls through to the queued path for
    // any non-{idle,errored,replaying} phase including submitting.
    store.send("queued follow-up", []);
    expect(store.getSnapshot().queuedSends).toBe(1);

    store.interrupt();
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.queuedSends).toBe(0);
    expect(snap.pendingDraftRestore?.text).toBe("first draft");
  });

  it("consumePendingDraftRestore clears the slot to null and is idempotent", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("hold this", []);
    store.interrupt();
    expect(store.getSnapshot().pendingDraftRestore).not.toBeNull();

    store.consumePendingDraftRestore();
    expect(store.getSnapshot().pendingDraftRestore).toBeNull();

    // Second consume is a state-ref-stable no-op.
    const snapBefore = store.getSnapshot();
    store.consumePendingDraftRestore();
    const snapAfter = store.getSnapshot();
    expect(snapAfter).toBe(snapBefore);
  });

  it("re-CASE-A overwrites a still-stranded pendingDraftRestore", () => {
    // If the user cancels twice in quick succession before the editor
    // has consumed the first restore, the second cancel wins. The
    // alternative (preserving the first) would surface an outdated
    // draft when the editor finally remounts.
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("first draft", []);
    store.interrupt();
    expect(store.getSnapshot().pendingDraftRestore?.text).toBe("first draft");

    store.send("second draft", []);
    store.interrupt();
    expect(store.getSnapshot().pendingDraftRestore?.text).toBe("second draft");
  });
});

// ---------------------------------------------------------------------------
// Step 1.1 — Phase-aware interrupt: CASE B boundary
// ---------------------------------------------------------------------------
//
// One single partial is enough to cross from CASE A to CASE B — claude
// has produced content under an `activeMsgId`, and the existing
// interrupt path commits a `TurnEntry` with `result: "interrupted"`
// carrying that partial's text. This pins the dividing line.

describe("CodeSessionStore — CASE B at the awaiting_first_token boundary", () => {
  it("one partial in, then interrupt, commits an interrupted TurnEntry with the partial", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("hi", []);
    expect(store.getSnapshot().phase).toBe("submitting");
    expect(store.getSnapshot().pendingDraftRestore).toBeNull();

    // Single content frame from claude — the moment the dividing line
    // crosses. handleTextDelta drives `submitting → awaiting_first_token`.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "msg-b-boundary",
      text: "Hel",
      is_partial: true,
      seq: 0,
      rev: 0,
    });
    expect(store.getSnapshot().phase).toBe("awaiting_first_token");
    expect(store.getSnapshot().activeMsgId).toBe("msg-b-boundary");

    store.interrupt();

    // CASE B: phase stays where it was (no return-to-idle); restore
    // slot is NOT populated (this isn't a re-edit cancel, it's a
    // mid-stream interrupt that should commit an interrupted entry).
    const mid = store.getSnapshot();
    expect(mid.pendingDraftRestore).toBeNull();
    expect(mid.phase).toBe("awaiting_first_token");
    expect(mid.inflightUserMessage?.text).toBe("hi");

    // Wire's turn_complete(error) closes the turn → committed entry.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: "msg-b-boundary",
      result: "error",
    });

    const end = store.getSnapshot();
    expect(end.phase).toBe("idle");
    expect(end.transcript.length).toBe(1);
    expect(end.transcript[0].result).toBe("interrupted");
    expect(end.transcript[0].userMessage.text).toBe("hi");
    expect(end.transcript[0].assistant).toBe("Hel");
    expect(end.pendingDraftRestore).toBeNull();
  });
});
