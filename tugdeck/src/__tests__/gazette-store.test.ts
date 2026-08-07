/**
 * Pin the `GazetteStore` external-store contract:
 *
 *   - First `getSnapshot` kicks the one-shot `list_gazette_posts` tail
 *     request and returns pending.
 *   - `list_gazette_posts_ok` settles to ready, oldest-first.
 *   - Live GAZETTE frames fold (including while pending), dedupe against
 *     the tail by ledger id, and the channel caps at the render window.
 *   - A transient post is its own occurrence — it has no rowid to dedupe on.
 *   - Snapshots are referentially stable between folds.
 *   - The write path: `submitQuestion` sends `GAZETTE_INPUT` and holds a
 *     pending marker until the answer — or the transient failure — carrying
 *     that request id lands; one question at a time; the timeout ends the wait
 *     with a post rather than a spinner.
 *   - [L26] a post keys by its request id, so the pending row and the answer
 *     that resolves it are the same row.
 *   - [L27] `dispose()` releases the frame registration and the pending timer.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  DEFAULT_GAZETTE_CARD_ROWS,
  GazetteStore,
  publishListGazettePostsOk,
} from "@/lib/gazette-store";
import type { TugConnection } from "@/connection";
import { FeedId, type FeedIdValue, type GazettePostWire } from "@/protocol";

type FrameCallback = (payload: Uint8Array) => void;

class FakeConnection {
  readonly frames: Array<{ feedId: FeedIdValue; payload: Uint8Array }> = [];
  readonly frameSubscribers = new Map<number, FrameCallback[]>();
  send(feedId: FeedIdValue, payload: Uint8Array): void {
    this.frames.push({ feedId, payload });
  }
  onFrame(feedId: number, callback: FrameCallback): () => void {
    const list = this.frameSubscribers.get(feedId) ?? [];
    list.push(callback);
    this.frameSubscribers.set(feedId, list);
    return () => {
      const idx = list.indexOf(callback);
      if (idx >= 0) list.splice(idx, 1);
    };
  }
  /** How many callbacks are live on a feed — [L27]'s observable. */
  liveCallbacks(feedId: number): number {
    return (this.frameSubscribers.get(feedId) ?? []).length;
  }
  pushGazetteFrame(post: Record<string, unknown>): void {
    const payload = new TextEncoder().encode(JSON.stringify(post));
    for (const cb of this.frameSubscribers.get(FeedId.GAZETTE) ?? []) {
      cb(payload);
    }
  }
}

function makeStore(): { store: GazetteStore; conn: FakeConnection } {
  const conn = new FakeConnection();
  const store = new GazetteStore(conn as unknown as TugConnection);
  return { store, conn };
}

/** A persisted Reporter post as tugcast serializes it. */
function post(id: number, body: string): Record<string, unknown> {
  return {
    id,
    at_ms: 1_700_000_000_000 + id,
    author: "reporter",
    session_id: "sess-a",
    wake_reason: "turn-end",
    body,
  };
}

const stores: GazetteStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
});

describe("GazetteStore", () => {
  it("first snapshot kicks exactly one tail request and reads pending", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    const first = store.getSnapshot();
    expect(first.status).toBe("pending");
    expect(first.posts.length).toBe(0);
    expect(first.cardRows).toBe(DEFAULT_GAZETTE_CARD_ROWS);
    store.getSnapshot();
    expect(conn.frames.length).toBe(1);
    expect(conn.frames[0].feedId).toBe(FeedId.CONTROL);
    const decoded = JSON.parse(new TextDecoder().decode(conn.frames[0].payload));
    expect(decoded.action).toBe("list_gazette_posts");
  });

  it("the tail response settles to ready, oldest-first, fields decoded", () => {
    const { store } = makeStore();
    stores.push(store);
    store.getSnapshot();
    publishListGazettePostsOk({
      posts: [post(1, "first"), post(2, "second")] as unknown as GazettePostWire[],
    });
    const snap = store.getSnapshot();
    expect(snap.status).toBe("ready");
    expect(snap.posts.map((p) => p.body)).toEqual(["first", "second"]);
    const newest = snap.posts[1];
    expect(newest.id).toBe(2);
    expect(newest.author).toBe("reporter");
    expect(newest.sessionId).toBe("sess-a");
    expect(newest.wakeReason).toBe("turn-end");
    expect(newest.transient).toBe(false);
    expect(newest.requestId).toBeNull();
  });

  it("live frames fold, dedupe against the tail by ledger id, survive pending", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    // A live post lands while the tail load is still pending…
    conn.pushGazetteFrame(post(2, "second"));
    expect(store.getSnapshot().posts.map((p) => p.body)).toEqual(["second"]);
    // …then the tail arrives carrying the SAME post plus history.
    publishListGazettePostsOk({
      posts: [post(1, "first"), post(2, "second")] as unknown as GazettePostWire[],
    });
    expect(store.getSnapshot().posts.map((p) => p.body)).toEqual([
      "first",
      "second",
    ]);
    // A fresh live post appends; a re-delivery of the same rowid does not.
    conn.pushGazetteFrame(post(3, "third"));
    conn.pushGazetteFrame(post(3, "third"));
    expect(store.getSnapshot().posts.map((p) => p.body)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("an uncorrelated transient post is its own occurrence", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    // No rowid and no request id: nothing to dedupe on, so each delivery is
    // its own occurrence rather than a repeat of the last one.
    const transient = {
      at_ms: 1_700_000_000_000,
      author: "operator",
      body: "The Operator could not answer.",
      transient: true,
    };
    conn.pushGazetteFrame(transient);
    conn.pushGazetteFrame(transient);
    const snap = store.getSnapshot();
    expect(snap.posts.length).toBe(2);
    expect(snap.posts[0].id).toBeNull();
    expect(snap.posts[0].transient).toBe(true);
    expect(snap.posts[0].key).not.toBe(snap.posts[1].key);
  });

  it("a transient post carrying a request id is that one answer, once", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    const transient = {
      at_ms: 1_700_000_000_000,
      author: "operator",
      body: "Couldn't answer that.",
      request_id: "req-1",
      transient: true,
    };
    // Redelivered by a reconnect: the request id says it is the same answer
    // to the same question, so it lands once ([L26]).
    conn.pushGazetteFrame(transient);
    conn.pushGazetteFrame(transient);
    const snap = store.getSnapshot();
    expect(snap.posts.length).toBe(1);
    expect(snap.posts[0].requestId).toBe("req-1");
    expect(snap.posts[0].key).toBe("req:operator:req-1");
  });

  it("the channel caps at the render window, oldest-out", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    for (let id = 1; id <= DEFAULT_GAZETTE_CARD_ROWS + 5; id++) {
      conn.pushGazetteFrame(post(id, `post ${id}`));
    }
    const snap = store.getSnapshot();
    expect(snap.posts.length).toBe(DEFAULT_GAZETTE_CARD_ROWS);
    expect(snap.posts[0].body).toBe("post 6");
    expect(snap.posts[snap.posts.length - 1].body).toBe(
      `post ${DEFAULT_GAZETTE_CARD_ROWS + 5}`,
    );
  });

  it("refs survive parse; an unrenderable kind is dropped, the post is not", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    conn.pushGazetteFrame({
      ...post(1, "with refs"),
      refs: [
        { kind: "file", target: "tugdeck/src/x.css" },
        { kind: "sonnet", target: "nope" },
        { kind: "commit", target: "" },
        { kind: "commit", target: "a597790b0" },
      ],
    });
    const snap = store.getSnapshot();
    expect(snap.posts.length).toBe(1);
    expect(snap.posts[0].refs).toEqual([
      { kind: "file", target: "tugdeck/src/x.css" },
      { kind: "commit", target: "a597790b0" },
    ]);
  });

  it("snapshots are referentially stable between folds", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    const a = store.getSnapshot();
    const b = store.getSnapshot();
    expect(a).toBe(b);
    conn.pushGazetteFrame(post(1, "one"));
    const c = store.getSnapshot();
    expect(c).not.toBe(b);
    expect(store.getSnapshot()).toBe(c);
    // Malformed bodies and unknown authors change nothing.
    conn.pushGazetteFrame({ nonsense: true });
    conn.pushGazetteFrame({ ...post(9, "who?"), author: "columnist" });
    expect(store.getSnapshot()).toBe(c);
  });

  // -------------------------------------------------------------------------
  // The write path
  // -------------------------------------------------------------------------

  /** The Operator's answer to `requestId`, as tugcast serializes it. */
  function answer(
    id: number | null,
    requestId: string,
    body: string,
  ): Record<string, unknown> {
    return {
      ...(id === null ? {} : { id }),
      at_ms: 1_700_000_100_000,
      author: "operator",
      body,
      request_id: requestId,
      transient: id === null,
    };
  }

  it("submitQuestion sends GAZETTE_INPUT and goes pending", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    const requestId = store.submitQuestion("  what landed today?  ");
    expect(requestId).not.toBeNull();
    const sent = conn.frames.filter((f) => f.feedId === FeedId.GAZETTE_INPUT);
    expect(sent.length).toBe(1);
    const decoded = JSON.parse(new TextDecoder().decode(sent[0].payload));
    expect(decoded.body).toBe("what landed today?");
    expect(decoded.requestId).toBe(requestId);
    expect(store.getSnapshot().pendingRequestId).toBe(requestId);
  });

  it("an empty question is not a question, and one is asked at a time", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    expect(store.submitQuestion("   ")).toBeNull();
    expect(conn.frames.filter((f) => f.feedId === FeedId.GAZETTE_INPUT).length)
      .toBe(0);
    expect(store.submitQuestion("first")).not.toBeNull();
    expect(store.submitQuestion("second, while the first is in flight"))
      .toBeNull();
    expect(conn.frames.filter((f) => f.feedId === FeedId.GAZETTE_INPUT).length)
      .toBe(1);
  });

  it("the answer clears the wait and keys as the pending row did ([L26])", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    const requestId = store.submitQuestion("why is the wash pale")!;
    conn.pushGazetteFrame(answer(7, requestId, "Because the tint is low."));
    const snap = store.getSnapshot();
    expect(snap.pendingRequestId).toBeNull();
    expect(snap.posts.length).toBe(1);
    // The card renders its placeholder under exactly this key, so the row
    // survives the swap instead of being torn down and rebuilt.
    expect(snap.posts[0].key).toBe(`req:operator:${requestId}`);
    expect(snap.posts[0].id).toBe(7);
    expect(store.submitQuestion("another one")).not.toBeNull();
  });

  it("a transient failure post clears the wait too — nothing hangs", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    const requestId = store.submitQuestion("something unanswerable")!;
    conn.pushGazetteFrame(answer(null, requestId, "Couldn't answer that."));
    const snap = store.getSnapshot();
    expect(snap.pendingRequestId).toBeNull();
    expect(snap.posts[0].transient).toBe(true);
    expect(snap.posts[0].id).toBeNull();
  });

  it("an answer to some OTHER question leaves this one waiting", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    const requestId = store.submitQuestion("mine")!;
    conn.pushGazetteFrame(answer(7, "req-someone-else", "not yours"));
    expect(store.getSnapshot().pendingRequestId).toBe(requestId);
  });

  it("the user's own echoed question is a different row from its answer", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    const requestId = store.submitQuestion("what landed")!;
    // tugcast persists and broadcasts the question first ([P08]) — it carries
    // the same request id as the answer that follows it.
    conn.pushGazetteFrame({
      id: 6,
      at_ms: 1_700_000_099_000,
      author: "user",
      body: "what landed",
      request_id: requestId,
    });
    conn.pushGazetteFrame(answer(7, requestId, "Two commits."));
    const snap = store.getSnapshot();
    expect(snap.posts.map((p) => p.author)).toEqual(["user", "operator"]);
    expect(snap.posts[0].key).not.toBe(snap.posts[1].key);
  });

  it("a post the tail re-delivers without its request id still dedupes", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    const requestId = store.submitQuestion("what landed")!;
    conn.pushGazetteFrame(answer(7, requestId, "Two commits."));
    // The ledger does not persist a request id, so the tail's copy of that
    // same post keys differently — only the rowid is the same on both wires.
    publishListGazettePostsOk({
      posts: [
        {
          id: 7,
          at_ms: 1_700_000_100_000,
          author: "operator",
          body: "Two commits.",
        },
      ] as unknown as GazettePostWire[],
    });
    expect(store.getSnapshot().posts.length).toBe(1);
  });

  it("dispose unwires the frame registration, leaving no live callback", () => {
    const { store, conn } = makeStore();
    expect(conn.liveCallbacks(FeedId.GAZETTE)).toBe(1);
    store.getSnapshot();
    store.dispose();
    // [L27]: the acquisition is released, not merely guarded — the
    // connection is left holding nothing.
    expect(conn.liveCallbacks(FeedId.GAZETTE)).toBe(0);
    // And the CONTROL bus no longer reaches a disposed store.
    publishListGazettePostsOk({
      posts: [post(1, "after dispose")] as unknown as GazettePostWire[],
    });
    expect(store.getSnapshot().posts.length).toBe(0);
  });

  /**
   * [L27]'s third acquisition. Observed through the timer functions the store
   * actually calls rather than through a private field, so the assertion is
   * about the release happening, not about how it is bookkept.
   */
  it("dispose releases the pending question's timer", () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const live = new Set<unknown>();
    try {
      globalThis.setTimeout = ((fn: () => void, ms?: number) => {
        const handle = realSetTimeout(fn, ms);
        live.add(handle);
        return handle;
      }) as typeof globalThis.setTimeout;
      globalThis.clearTimeout = ((handle: unknown) => {
        live.delete(handle);
        return realClearTimeout(handle as Parameters<typeof realClearTimeout>[0]);
      }) as typeof globalThis.clearTimeout;

      const { store } = makeStore();
      store.getSnapshot();
      store.submitQuestion("a question left hanging");
      expect(live.size).toBe(1);
      store.dispose();
      expect(live.size).toBe(0);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });

  it("the answer releases the timer too, not just the pending marker", () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const live = new Set<unknown>();
    try {
      globalThis.setTimeout = ((fn: () => void, ms?: number) => {
        const handle = realSetTimeout(fn, ms);
        live.add(handle);
        return handle;
      }) as typeof globalThis.setTimeout;
      globalThis.clearTimeout = ((handle: unknown) => {
        live.delete(handle);
        return realClearTimeout(handle as Parameters<typeof realClearTimeout>[0]);
      }) as typeof globalThis.clearTimeout;

      const { store, conn } = makeStore();
      stores.push(store);
      store.getSnapshot();
      const requestId = store.submitQuestion("answered promptly")!;
      expect(live.size).toBe(1);
      conn.pushGazetteFrame(answer(7, requestId, "Here you go."));
      expect(live.size).toBe(0);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });
});
