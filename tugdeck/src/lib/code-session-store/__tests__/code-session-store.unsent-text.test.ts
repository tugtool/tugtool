/**
 * Unsent text at application exit.
 *
 * Two kinds of user text live only in memory: sends queued behind a running
 * turn, and a submission pulled back by a CASE A interrupt (parked in
 * `pendingDraftRestore` until a render seeds it into the composer). At quit
 * neither has a durable home, so the termination pipeline folds both into
 * the draft it persists — via `captureUnsentText`.
 *
 * The ordering trap this pins: the pipeline interrupts live turns *before*
 * it captures (a CASE A interrupt is what produces the pulled-back text in
 * the first place), and a CASE A interrupt clears `queuedSends`. So the
 * pipeline stashes the queue first — `stashUnsentText` — and the capture
 * reports the union, oldest first.
 *
 * Real store, real reducer, scripted wire frames.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { FeedId } from "@/protocol";

function constructStore(conn: TestFrameChannel): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    sessionMode: "new",
  });
}

/**
 * Advance a submitted turn with thinking only. Thinking does not cross the
 * answer line, so the turn stays a clean CASE A pull-down — which is what a
 * quit during "claude is thinking" actually looks like.
 */
function driveToThinking(conn: TestFrameChannel, msgId: string): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "thinking_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    block_index: 0,
    text: "pondering",
    is_partial: true,
  });
}

/** Advance a turn past the first answer delta, making it CASE B. */
function driveToAnswer(conn: TestFrameChannel, msgId: string): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: "here is the answer",
    is_partial: true,
    rev: 0,
    seq: 0,
  });
}

describe("CodeSessionStore.captureUnsentText", () => {
  it("is empty for an idle session with nothing queued", () => {
    const store = constructStore(new TestFrameChannel());
    expect(store.captureUnsentText()).toEqual([]);
  });

  it("reports queued sends in the order they were queued", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("the turn that is running", []);
    driveToThinking(conn, FIXTURE_IDS.MSG_ID_N(1));
    store.send("queued first", []);
    store.send("queued second", []);

    expect(store.captureUnsentText()).toEqual(["queued first", "queued second"]);
  });

  it("keeps queued text across the CASE A interrupt that clears the queue", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("pulled back", []);
    driveToThinking(conn, FIXTURE_IDS.MSG_ID_N(1));
    store.send("queued first", []);
    store.send("queued second", []);

    // What the termination pipeline does, in order.
    store.stashUnsentText();
    store.interrupt();

    // CASE A: the in-flight submission is parked for re-edit and the queue
    // is cleared by the reducer — the exact loss this stash exists for.
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.pendingDraftRestore?.text).toBe("pulled back");
    expect(snap.queuedSends).toEqual([]);

    expect(store.captureUnsentText()).toEqual([
      "pulled back",
      "queued first",
      "queued second",
    ]);
  });

  it("does not report the same text twice when the interrupt left the queue intact", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("running", []);
    driveToThinking(conn, FIXTURE_IDS.MSG_ID_N(1));
    store.send("queued once", []);

    store.stashUnsentText();
    // No interrupt — the stash and the live queue hold the same text.
    expect(store.captureUnsentText()).toEqual(["queued once"]);
  });
});

describe("termination interrupt gate", () => {
  it("publishes canInterrupt for a running turn and withholds it when idle", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    expect(store.getSnapshot().canInterrupt).toBe(false);

    store.send("running", []);
    expect(store.getSnapshot().canInterrupt).toBe(true);

    driveToThinking(conn, FIXTURE_IDS.MSG_ID_N(1));
    expect(store.getSnapshot().canInterrupt).toBe(true);

    store.interrupt();
    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().canInterrupt).toBe(false);
  });

  it("a CASE A interrupt settles synchronously, so the pipeline never waits on it", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("pull me back", []);
    let notified = false;
    store.subscribe(() => {
      notified = true;
    });

    store.interrupt();

    // Settled inside `interrupt()` — the subscription fired and the phase is
    // already terminal, which is what lets an idle-ish quit add no latency.
    expect(notified).toBe(true);
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("a CASE B turn stays open until the wire commits it — the case the bound exists for", () => {
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("answer me", []);
    driveToAnswer(conn, FIXTURE_IDS.MSG_ID_N(1));

    store.interrupt();

    // Answer content has begun, so the turn is not retractable: the pipeline
    // has to wait for the wire, which is why the await is bounded rather
    // than unconditional.
    expect(store.getSnapshot().phase).not.toBe("idle");

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID_N(1),
      result: "interrupted",
    });

    expect(store.getSnapshot().phase).toBe("idle");
  });
});
