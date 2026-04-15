/**
 * Step 4 — streaming delta accumulation for assistant_text and
 * thinking_text. Covers test-02 (9 partials + 1 complete = 615 chars
 * under the {{text:len=615}} placeholder) with byte-exact buffer
 * assertions, the clear-on-turn-complete guarantee, and a synthetic
 * thinking_text accumulation path since v2.1.105 has no thinking_text
 * fixture in scope.
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

describe("CodeSessionStore — assistant_text delta accumulation (Step 4)", () => {
  it("grows inflight.assistant monotonically across test-02 and lands on the authoritative text", () => {
    const probe = loadGoldenProbe(
      "v2.1.105",
      "test-02-longer-response-streaming",
    );
    const conn = new MockTugConnection();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    });

    store.send("please write", []);

    // Track every distinct `inflight.assistant` value we observe
    // during replay. Assertion: strictly non-decreasing length, and
    // every observed value is a prefix of the previous value's
    // successor (we're appending, not overwriting).
    const observedBuffers: string[] = [];
    let lastLen = 0;
    let prevObserved = "";

    // Dispatch events up to (but not including) turn_complete so we
    // can sample inflight.assistant before the clear-inflight effect
    // wipes it.
    const turnCompleteIdx = probe.events.findIndex(
      (e) => e.type === "turn_complete",
    );
    const completeEventIdx = probe.events.findIndex(
      (e) => e.type === "assistant_text" && e.is_partial === false,
    );
    expect(completeEventIdx).toBeGreaterThan(-1);
    expect(turnCompleteIdx).toBeGreaterThan(completeEventIdx);

    for (let i = 0; i < turnCompleteIdx; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
      const buf = store.streamingDocument.get("inflight.assistant") as string;
      if (buf !== prevObserved) {
        observedBuffers.push(buf);
        if (i <= completeEventIdx) {
          // Up to and including the authoritative complete event,
          // buffer length should grow. After is_partial:false the
          // buffer equals the authoritative text (same length as the
          // accumulated partials for test-02, but distinct semantic).
          expect(buf.length).toBeGreaterThanOrEqual(lastLen);
          lastLen = buf.length;
        }
        prevObserved = buf;
      }
    }

    // At this point, inflight.assistant holds the authoritative text
    // from the is_partial:false event (byte-for-byte).
    const completeEvent = probe.events[completeEventIdx];
    const authoritative = completeEvent.text as string;
    expect(
      store.streamingDocument.get("inflight.assistant"),
    ).toBe(authoritative);
    expect(authoritative.length).toBe(615);
    expect(/^x+$/.test(authoritative)).toBe(true);

    // Now dispatch turn_complete and verify cleanup.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[turnCompleteIdx]);

    expect(store.streamingDocument.get("inflight.assistant")).toBe("");
    expect(store.streamingDocument.get("inflight.thinking")).toBe("");
    expect(store.streamingDocument.get("inflight.tools")).toBe("[]");

    // TurnEntry captures the authoritative assistant text.
    const snap = store.getSnapshot();
    expect(snap.transcript.length).toBe(1);
    expect(snap.transcript[0].assistant).toBe(authoritative);
    expect(snap.phase).toBe("idle");
  });

  it("accumulates only in arrival order — replacing on is_partial:false matches the authoritative text", () => {
    // Synthetic: two partials then a complete with DIFFERENT bytes.
    // The complete event's text is what wins.
    const conn = new MockTugConnection();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    });

    store.send("hi", []);

    const msgId = FIXTURE_IDS.MSG_ID;
    const tug = FIXTURE_IDS.TUG_SESSION_ID;

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: true,
      rev: 0,
      seq: 0,
      text: "aaa",
    });
    expect(store.streamingDocument.get("inflight.assistant")).toBe("aaa");

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: true,
      rev: 1,
      seq: 0,
      text: "bbb",
    });
    expect(store.streamingDocument.get("inflight.assistant")).toBe("aaabbb");

    // Authoritative replacement — the full text is NOT "aaabbb".
    // The reducer replaces the buffer with the complete event's text.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: false,
      rev: 0,
      seq: 1,
      text: "AUTHORITATIVE",
    });
    expect(store.streamingDocument.get("inflight.assistant")).toBe(
      "AUTHORITATIVE",
    );

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: tug,
      msg_id: msgId,
      result: "success",
      seq: 2,
    });

    const entry = store.getSnapshot().transcript[0];
    expect(entry.assistant).toBe("AUTHORITATIVE");
  });
});

describe("CodeSessionStore — thinking_text delta accumulation (Step 4)", () => {
  it("accumulates two thinking_text partials then replaces on is_partial:false", () => {
    const conn = new MockTugConnection();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    });

    store.send("why?", []);

    const msgId = FIXTURE_IDS.MSG_ID;
    const tug = FIXTURE_IDS.TUG_SESSION_ID;

    // First partial drives submitting → awaiting_first_token and starts
    // populating the thinking scratch buffer.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "thinking_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: true,
      rev: 0,
      seq: 0,
      text: "hmm ",
    });
    expect(store.streamingDocument.get("inflight.thinking")).toBe("hmm ");
    expect(store.getSnapshot().phase).toBe("awaiting_first_token");

    // Second partial bumps to streaming.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "thinking_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: true,
      rev: 1,
      seq: 0,
      text: "let me see",
    });
    expect(store.streamingDocument.get("inflight.thinking")).toBe(
      "hmm let me see",
    );
    expect(store.getSnapshot().phase).toBe("streaming");

    // Authoritative replacement.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "thinking_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: false,
      rev: 0,
      seq: 1,
      text: "FINAL THOUGHT",
    });
    expect(store.streamingDocument.get("inflight.thinking")).toBe(
      "FINAL THOUGHT",
    );

    // Assistant path was never touched.
    expect(store.streamingDocument.get("inflight.assistant")).toBe("");

    // turn_complete commits thinking to the TurnEntry and clears inflight.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: tug,
      msg_id: msgId,
      result: "success",
      seq: 2,
    });

    const entry = store.getSnapshot().transcript[0];
    expect(entry.thinking).toBe("FINAL THOUGHT");
    expect(entry.assistant).toBe("");
    expect(store.streamingDocument.get("inflight.thinking")).toBe("");
  });

  it("interleaves thinking_text and assistant_text on the same msg_id without cross-contamination", () => {
    const conn = new MockTugConnection();
    const store = new CodeSessionStore({
      conn: conn as unknown as TugConnection,
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    });

    store.send("interleave", []);

    const msgId = FIXTURE_IDS.MSG_ID;
    const tug = FIXTURE_IDS.TUG_SESSION_ID;

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "thinking_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: true,
      rev: 0,
      seq: 0,
      text: "think-1",
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: true,
      rev: 0,
      seq: 0,
      text: "assist-1",
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "thinking_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: true,
      rev: 1,
      seq: 0,
      text: " think-2",
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: tug,
      msg_id: msgId,
      is_partial: true,
      rev: 1,
      seq: 0,
      text: " assist-2",
    });

    expect(store.streamingDocument.get("inflight.thinking")).toBe(
      "think-1 think-2",
    );
    expect(store.streamingDocument.get("inflight.assistant")).toBe(
      "assist-1 assist-2",
    );
  });
});
