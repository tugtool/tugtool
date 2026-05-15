/**
 * Step 3 — basic round-trip: load `v2.1.105/test-01-basic-round-trip`,
 * dispatch a `send`, replay every decoded CODE_OUTPUT event through
 * `TestFrameChannel.dispatchDecoded`, and verify the full turn
 * transitions `idle → submitting → awaiting_first_token → streaming →
 * idle`, commits one `TurnEntry(result: "success")`, captures the
 * Claude `session_id`, and writes a `user_message` CODE_INPUT frame.
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
import { inflightValue } from "@/lib/code-session-store/testing/inflight-paths";import { FeedId } from "@/protocol";

describe("CodeSessionStore — basic round-trip (Step 3)", () => {
  it("drives the full turn state machine on test-01", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const conn = new TestFrameChannel();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      lifecycle: new ConnectionLifecycle(),
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
      sessionMode: "new",
    });

    const phases: string[] = [];
    store.subscribe(() => {
      const current = store.getSnapshot().phase;
      if (phases[phases.length - 1] !== current) {
        phases.push(current);
      }
    });

    // 1. User submits a turn.
    store.send("hello", []);

    // Outbound CODE_INPUT frame written immediately.
    expect(conn.recordedFrames.length).toBe(1);
    expect(conn.recordedFrames[0].feedId).toBe(FeedId.CODE_INPUT);
    expect(conn.recordedFrames[0].decoded).toEqual({
      type: "user_message",
      text: "hello",
      attachments: [],
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    });

    // 2. Replay every CODE_OUTPUT event in fixture order. The real
    //    FeedStore inside the store decodes each payload, runs the
    //    tug_session_id filter, and dispatches into the reducer.
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }

    // 3. Phase sequence — one entry per distinct phase change.
    expect(phases).toEqual([
      "submitting",
      "awaiting_first_token",
      "streaming",
      "idle",
    ]);

    // 4. Final snapshot state.
    const final = store.getSnapshot();
    expect(final.phase).toBe("idle");
    expect(final.transcript.length).toBe(1);
    expect(final.transcript[0].result).toBe("success");
    expect(final.transcript[0].msgId).toBe(FIXTURE_IDS.MSG_ID);
    expect(final.transcript[0].userMessage.text).toBe("hello");
    expect(final.activeMsgId).toBeNull();

    // 5. After turn_complete, inflightUserMessage is null so the
    // helper returns undefined — there's no in-flight turn to read
    // from. The committed turn's per-turn paths still hold their
    // final values, but they're addressed by `lastCommittedTurnValue`
    // when a test cares to assert on them.
    expect(inflightValue(store, "assistant")).toBeUndefined();
    expect(inflightValue(store, "thinking")).toBeUndefined();
    expect(inflightValue(store, "tools")).toBeUndefined();
  });

  it("populates inflightUserMessage on send and clears it on turn_complete(success)", () => {
    // [D10] / Step 9 — the snapshot mirrors the reducer's
    // `pendingUserMessage` so the transcript's in-flight `user` row
    // can render via `useSyncExternalStore`. The field is non-null
    // for the duration of the turn (`send` → `turn_complete`) and
    // returns to `null` once the matching `TurnEntry` lands.
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const conn = new TestFrameChannel();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      lifecycle: new ConnectionLifecycle(),
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
      sessionMode: "new",
    });

    // Idle store: no pending message.
    expect(store.getSnapshot().inflightUserMessage).toBeNull();

    // After `send`: the text + atoms appear on the snapshot.
    store.send("hello", []);
    const submittingSnap = store.getSnapshot();
    expect(submittingSnap.phase).toBe("submitting");
    expect(submittingSnap.inflightUserMessage).not.toBeNull();
    expect(submittingSnap.inflightUserMessage?.text).toBe("hello");
    expect(submittingSnap.inflightUserMessage?.atoms).toEqual([]);

    // Identity stable across snapshots while the same message is in
    // flight — `useSyncExternalStore` consumers depend on `Object.is`
    // equality to avoid spurious rerenders ([L02]).
    const a = store.getSnapshot().inflightUserMessage;
    const b = store.getSnapshot().inflightUserMessage;
    expect(Object.is(a, b)).toBe(true);

    // Drive the turn to completion.
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }

    // After `turn_complete(success)`: the committed `TurnEntry`
    // takes over, and `inflightUserMessage` is back to `null`.
    const finalSnap = store.getSnapshot();
    expect(finalSnap.phase).toBe("idle");
    expect(finalSnap.inflightUserMessage).toBeNull();
    expect(finalSnap.transcript.length).toBe(1);
    expect(finalSnap.transcript[0].userMessage.text).toBe("hello");
  });

  it("captures the final assistant text on the committed TurnEntry", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const conn = new TestFrameChannel();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      lifecycle: new ConnectionLifecycle(),
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
      sessionMode: "new",
    });

    store.send("hello", []);
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }

    // test-01's `complete` event (is_partial: false) carries a
    // `{{text:len=28}}` placeholder → 28 repeated 'x' characters.
    const entry = store.getSnapshot().transcript[0];
    expect(entry.assistant).toBe("x".repeat(28));
  });

  it("routes frames for other tug_session_ids to neither phase nor transcript", () => {
    const conn = new TestFrameChannel();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      lifecycle: new ConnectionLifecycle(),
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
      sessionMode: "new",
    });

    store.send("hello", []);

    // A frame for some OTHER tug_session_id must be filtered by
    // FeedStore before reaching the reducer. Use `assistant_text`
    // since session_init no longer mutates state and would be
    // indistinguishable from a filtered frame on the snapshot side.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      msg_id: "msg-other",
      seq: 0,
      rev: 0,
      text: "wrong session text",
      is_partial: true,
      status: "partial",
      tug_session_id: "tug00000-0000-4000-8000-999999999999",
    });

    // The other-session frame must not affect this store: still
    // `submitting`, no scratch text accumulated. The per-turn
    // path was never written to since no text-delta event
    // landed for this turnKey — `inflightValue` returns undefined.
    expect(store.getSnapshot().phase).toBe("submitting");
    expect(inflightValue(store, "assistant")).toBeUndefined();
  });
});
