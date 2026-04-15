/**
 * Step 3 — basic round-trip: load `v2.1.105/test-01-basic-round-trip`,
 * dispatch a `send`, replay every decoded CODE_OUTPUT event through
 * `MockTugConnection.dispatchDecoded`, and verify the full turn
 * transitions `idle → submitting → awaiting_first_token → streaming →
 * idle`, commits one `TurnEntry(result: "success")`, captures the
 * Claude `session_id`, and writes a `user_message` CODE_INPUT frame.
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

describe("CodeSessionStore — basic round-trip (Step 3)", () => {
  it("drives the full turn state machine on test-01", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const conn = new MockTugConnection();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
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
    expect(final.claudeSessionId).toBe(FIXTURE_IDS.CLAUDE_SESSION_ID);
    expect(final.activeMsgId).toBeNull();

    // 5. In-flight streaming document cleared on turn_complete.
    expect(store.streamingDocument.get("inflight.assistant")).toBe("");
    expect(store.streamingDocument.get("inflight.thinking")).toBe("");
    expect(store.streamingDocument.get("inflight.tools")).toBe("[]");
  });

  it("captures the final assistant text on the committed TurnEntry", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const conn = new MockTugConnection();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
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
    const conn = new MockTugConnection();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    });

    store.send("hello", []);

    // A session_init for some OTHER tug_session_id must be filtered by
    // FeedStore before reaching the reducer.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "session_init",
      session_id: "cla00000-0000-4000-8000-999999999999",
      tug_session_id: "tug00000-0000-4000-8000-999999999999",
    });

    expect(store.getSnapshot().claudeSessionId).toBeNull();
    expect(store.getSnapshot().phase).toBe("submitting");
  });
});
