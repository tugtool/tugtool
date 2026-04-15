/**
 * Tests for the test-only `MockFeedStore` and `MockTugConnection`
 * doubles (Step 2). Exercises replay + filter + ordering,
 * `replayRange` bounded playback for Step 7's interleave, and the
 * `MockTugConnection.send` recording path that decodes CODE_INPUT
 * payloads back to structured `InboundMessage` objects via
 * `decodeCodeInputPayload`.
 */

import { describe, it, expect } from "bun:test";

import {
  MockFeedStore,
  MockTugConnection,
  type MockFrame,
} from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import {
  encodeCodeInputPayload,
  FeedId,
  type InboundMessage,
} from "@/protocol";

function makeThreeFrames(): MockFrame[] {
  return [
    {
      feedId: FeedId.CODE_OUTPUT,
      decoded: { type: "session_init", tug_session_id: "A" },
    },
    {
      feedId: FeedId.CODE_OUTPUT,
      decoded: { type: "assistant_text", tug_session_id: "A", text: "hi" },
    },
    {
      feedId: FeedId.CODE_OUTPUT,
      decoded: { type: "turn_complete", tug_session_id: "A" },
    },
  ];
}

describe("MockFeedStore — replay + filter + ordering", () => {
  it("replays frames in order and notifies subscribers once per frame", () => {
    const conn = new MockTugConnection();
    const store = new MockFeedStore(conn, [FeedId.CODE_OUTPUT]);
    const seen: unknown[] = [];
    store.subscribe(() => {
      seen.push(store.getSnapshot().get(FeedId.CODE_OUTPUT));
    });

    const frames = makeThreeFrames();
    store.replay(frames);

    expect(seen.length).toBe(3);
    expect((seen[0] as { type: string }).type).toBe("session_init");
    expect((seen[1] as { type: string }).type).toBe("assistant_text");
    expect((seen[2] as { type: string }).type).toBe("turn_complete");
  });

  it("drops frames whose feedId is not in the subscribed set", () => {
    const conn = new MockTugConnection();
    const store = new MockFeedStore(conn, [FeedId.CODE_OUTPUT]);
    let notifyCount = 0;
    store.subscribe(() => {
      notifyCount += 1;
    });

    store.replay([
      {
        feedId: FeedId.SESSION_STATE,
        decoded: { state: "live" },
      },
      {
        feedId: FeedId.CODE_OUTPUT,
        decoded: { type: "session_init" },
      },
    ]);

    expect(notifyCount).toBe(1);
  });

  it("applies the filter predicate to drop non-matching frames", () => {
    const conn = new MockTugConnection();
    const filter = (_feedId: number, decoded: unknown): boolean =>
      (decoded as { tug_session_id?: string }).tug_session_id === "A";
    const store = new MockFeedStore(
      conn,
      [FeedId.CODE_OUTPUT],
      undefined,
      filter,
    );

    const seen: Array<{ tug_session_id?: string }> = [];
    store.subscribe(() => {
      seen.push(
        store.getSnapshot().get(FeedId.CODE_OUTPUT) as { tug_session_id?: string },
      );
    });

    store.replay([
      {
        feedId: FeedId.CODE_OUTPUT,
        decoded: { type: "assistant_text", tug_session_id: "A", text: "x" },
      },
      {
        feedId: FeedId.CODE_OUTPUT,
        decoded: { type: "assistant_text", tug_session_id: "B", text: "y" },
      },
      {
        feedId: FeedId.CODE_OUTPUT,
        decoded: { type: "assistant_text", tug_session_id: "A", text: "z" },
      },
    ]);

    expect(seen.length).toBe(2);
    expect(seen[0].tug_session_id).toBe("A");
    expect(seen[1].tug_session_id).toBe("A");
  });
});

describe("MockFeedStore — replayRange", () => {
  it("plays only the first N frames on a bounded call", () => {
    const conn = new MockTugConnection();
    const store = new MockFeedStore(conn, [FeedId.CODE_OUTPUT]);
    let notifyCount = 0;
    store.subscribe(() => {
      notifyCount += 1;
    });

    const frames = makeThreeFrames();
    store.replayRange(frames, 0, 2);

    expect(notifyCount).toBe(2);
    const last = store.getSnapshot().get(FeedId.CODE_OUTPUT) as {
      type: string;
    };
    expect(last.type).toBe("assistant_text");
  });

  it("supports pause/resume via two consecutive replayRange calls", () => {
    const conn = new MockTugConnection();
    const store = new MockFeedStore(conn, [FeedId.CODE_OUTPUT]);
    let notifyCount = 0;
    store.subscribe(() => {
      notifyCount += 1;
    });

    const frames = makeThreeFrames();
    store.replayRange(frames, 0, 2);
    expect(notifyCount).toBe(2);

    store.replayRange(frames, 2, frames.length);
    expect(notifyCount).toBe(3);
    expect(
      (store.getSnapshot().get(FeedId.CODE_OUTPUT) as { type: string }).type,
    ).toBe("turn_complete");
  });
});

describe("MockTugConnection — send recording", () => {
  it("decodes a CODE_INPUT payload back to the original InboundMessage", () => {
    const conn = new MockTugConnection();
    const msg: InboundMessage = {
      type: "user_message",
      text: "hi",
      attachments: [],
    };
    conn.send(
      FeedId.CODE_INPUT,
      encodeCodeInputPayload(msg, FIXTURE_IDS.TUG_SESSION_ID),
    );

    expect(conn.recordedFrames.length).toBe(1);
    expect(conn.recordedFrames[0].feedId).toBe(FeedId.CODE_INPUT);
    expect(conn.recordedFrames[0].decoded).toEqual({
      type: "user_message",
      text: "hi",
      attachments: [],
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    });
  });

  it("dispatches onFrame callbacks via dispatchFrame", () => {
    const conn = new MockTugConnection();
    const received: Uint8Array[] = [];
    conn.onFrame(FeedId.CODE_OUTPUT, (payload) => {
      received.push(payload);
    });

    const bytes = new TextEncoder().encode('{"type":"session_init"}');
    conn.dispatchFrame(FeedId.CODE_OUTPUT, bytes);

    expect(received.length).toBe(1);
    expect(received[0]).toBe(bytes);
  });

  it("fires close listeners on triggerClose and supports unsubscribe", () => {
    const conn = new MockTugConnection();
    let closeCount = 0;
    const unsub = conn.onClose(() => {
      closeCount += 1;
    });

    conn.triggerClose();
    expect(closeCount).toBe(1);

    unsub();
    conn.triggerClose();
    expect(closeCount).toBe(1);
  });
});
