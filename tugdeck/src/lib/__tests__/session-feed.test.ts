/**
 * subscribeSessionFeed — the [D11] session predicate as a reusable helper.
 *
 * Pure-logic tests: a minimal frame source delivers real payload bytes
 * (the same session-tagged JSON the cast-side SessionScopedFeed splices);
 * assertions cover per-session routing, foreign/malformed drops, and the
 * dispose tombstone.
 */

import { describe, expect, test } from "bun:test";

import {
  type SessionFeedSample,
  type SessionFrameSource,
  subscribeSessionFeed,
} from "../session-feed";

const FEED_ID = 0x52 as const; // SESSION_STATE

/** Minimal frame source: records callbacks, lets tests push payloads. */
function frameSource(): SessionFrameSource & {
  push: (feedId: number, json: unknown) => void;
  pushRaw: (feedId: number, bytes: Uint8Array) => void;
  count: (feedId: number) => number;
} {
  const callbacks = new Map<number, Array<(payload: Uint8Array) => void>>();
  return {
    onFrame(feedId, callback) {
      const list = callbacks.get(feedId) ?? [];
      list.push(callback);
      callbacks.set(feedId, list);
      return () => {
        const cur = callbacks.get(feedId);
        if (cur === undefined) return;
        const idx = cur.indexOf(callback);
        if (idx >= 0) cur.splice(idx, 1);
      };
    },
    push(feedId, json) {
      const bytes = new TextEncoder().encode(JSON.stringify(json));
      for (const cb of callbacks.get(feedId) ?? []) cb(bytes);
    },
    pushRaw(feedId, bytes) {
      for (const cb of callbacks.get(feedId) ?? []) cb(bytes);
    },
    count(feedId) {
      return callbacks.get(feedId)?.length ?? 0;
    },
  };
}

describe("subscribeSessionFeed", () => {
  test("routes each session's frames to its own subscriber only", () => {
    const source = frameSource();
    const seenA: SessionFeedSample[] = [];
    const seenB: SessionFeedSample[] = [];
    subscribeSessionFeed(source, FEED_ID, "session-a", (s) => seenA.push(s));
    subscribeSessionFeed(source, FEED_ID, "session-b", (s) => seenB.push(s));

    source.push(FEED_ID, { tug_session_id: "session-a", state: "live" });
    source.push(FEED_ID, { tug_session_id: "session-b", state: "pending" });
    source.push(FEED_ID, { tug_session_id: "session-a", state: "closed" });

    expect(seenA.map((s) => s.state)).toEqual(["live", "closed"]);
    expect(seenB.map((s) => s.state)).toEqual(["pending"]);
  });

  test("drops untagged, foreign, and malformed payloads silently", () => {
    const source = frameSource();
    const seen: SessionFeedSample[] = [];
    subscribeSessionFeed(source, FEED_ID, "session-a", (s) => seen.push(s));

    source.push(FEED_ID, { state: "no session tag" });
    source.push(FEED_ID, { tug_session_id: "someone-else", state: "x" });
    source.push(FEED_ID, "a bare string");
    source.pushRaw(FEED_ID, new TextEncoder().encode("{not json"));
    source.push(FEED_ID, { tug_session_id: "session-a", state: "mine" });

    expect(seen).toHaveLength(1);
    expect(seen[0].state).toBe("mine");
  });

  test("dispose stops delivery AND unregisters the source callback", () => {
    const source = frameSource();
    const seen: SessionFeedSample[] = [];
    const dispose = subscribeSessionFeed(source, FEED_ID, "session-a", (s) =>
      seen.push(s),
    );
    expect(source.count(FEED_ID)).toBe(1);

    source.push(FEED_ID, { tug_session_id: "session-a", n: 1 });
    dispose();
    // No leaked callback: dispose unregisters from the source, not just
    // a local tombstone.
    expect(source.count(FEED_ID)).toBe(0);
    source.push(FEED_ID, { tug_session_id: "session-a", n: 2 });

    expect(seen).toHaveLength(1);
    expect(seen[0].n).toBe(1);
  });
});
