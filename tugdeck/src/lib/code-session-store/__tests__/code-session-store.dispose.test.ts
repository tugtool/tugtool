/**
 * Step 9 — dispose teardown.
 *
 * `dispose()` unsubscribes the FeedStore subscription + the
 * `conn.onClose` subscription from Step 8, clears the listener list,
 * clears `queuedSends`, and resets the in-flight streaming paths.
 *
 * It explicitly does NOT clear the transcript ([L23] — user-visible
 * state must not be destroyed by internal implementation operations)
 * and does NOT write a `close_session` CONTROL frame ([D02] — the card
 * owns session lifecycle).
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

describe("CodeSessionStore — dispose teardown (Step 9)", () => {
  it("preserves transcript but stops listening after dispose", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    let notifyCount = 0;
    store.subscribe(() => {
      notifyCount += 1;
    });

    store.send("hello", []);
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }

    const postTurn = store.getSnapshot();
    expect(postTurn.phase).toBe("idle");
    expect(postTurn.transcript.length).toBe(1);
    expect(store.streamingDocument.get("inflight.assistant")).toBe("");

    const notifyBeforeDispose = notifyCount;
    store.dispose();

    // A post-dispose frame must not fire subscribers or mutate the
    // phase. The FeedStore is disposed; its onFrame guard drops the
    // decode; even if it didn't, we already unsubscribed.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID_N(2),
      text: "ghost",
      is_partial: true,
      rev: 0,
      seq: 0,
    });

    expect(notifyCount).toBe(notifyBeforeDispose);
    const postDispose = store.getSnapshot();
    expect(postDispose.phase).toBe("idle");

    // [L23]: transcript survives dispose.
    expect(postDispose.transcript.length).toBe(1);
    expect(postDispose.transcript[0].msgId).toBe(FIXTURE_IDS.MSG_ID);

    // Inflight paths reset to their empty initials.
    expect(store.streamingDocument.get("inflight.assistant")).toBe("");
    expect(store.streamingDocument.get("inflight.thinking")).toBe("");
    expect(store.streamingDocument.get("inflight.tools")).toBe("[]");

    // [D02]: no close_session frame was ever written.
    const closeFrames = conn.recordedFrames.filter(
      (f) => (f.decoded as { type?: string }).type === "close_session",
    );
    expect(closeFrames.length).toBe(0);
  });

  it("is idempotent on double-dispose", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);
    store.dispose();
    // Second call must not throw, must not double-free.
    expect(() => store.dispose()).not.toThrow();
  });

  it("stops routing transport close events after dispose", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);
    expect(store.getSnapshot().phase).toBe("submitting");

    store.dispose();

    // triggerClose after dispose: the onClose unsub ran, so the
    // store's close handler should no longer be registered. Even if
    // it were, the `_disposed` guard in the close callback drops the
    // dispatch. State stays where it was at dispose time.
    conn.triggerClose();
    expect(store.getSnapshot().phase).toBe("submitting");
    expect(store.getSnapshot().lastError).toBeNull();
  });

  it("does not fire listeners for frames that arrived before dispose but after unsubscribe", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);

    let notifyCount = 0;
    const unsub = store.subscribe(() => {
      notifyCount += 1;
    });
    unsub(); // caller's own unsubscribe, not dispose
    expect(notifyCount).toBe(0);

    // A frame arrives; the store's internal _listeners array is empty
    // (we unsubscribed) so notifyCount stays at 0 — but the state
    // still updates.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "x",
      is_partial: true,
      rev: 0,
      seq: 0,
    });
    expect(notifyCount).toBe(0);
    expect(store.getSnapshot().phase).toBe("awaiting_first_token");

    store.dispose();
  });
});
