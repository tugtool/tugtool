/**
 * Pin the `SessionStateChangesStore` external-store contract:
 *
 *   - First `getSnapshot` for a session kicks a load + returns pending.
 *   - `list_session_state_changes_ok` settles to ready with the loaded rows.
 *   - Local triple publishes after settle append a fresh row.
 *   - Local triple publishes during the load window merge correctly
 *     (no duplicate when the loaded history already includes them).
 *   - `invalidate` re-triggers the load.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  _resetSessionStateChangesStoreForTest,
  SessionStateChangesStore,
} from "@/lib/session-state-changes-store";
import {
  _resetLocalSessionStateChangeForTest,
  publishLocalSessionStateChange,
} from "@/lib/session-state-changes-local-events";
import {
  _resetTideSessionLedgerEventsForTest,
  publishListSessionStateChangesOk,
} from "@/lib/tide-session-ledger-events";
import type { TugConnection } from "@/connection";
import { FeedId, type FeedIdValue } from "@/protocol";

interface RecordedFrame {
  feedId: FeedIdValue;
  payload: Uint8Array;
}

class FakeConnection {
  readonly frames: RecordedFrame[] = [];
  send(feedId: FeedIdValue, payload: Uint8Array): void {
    this.frames.push({ feedId, payload });
  }
}

function makeConn(): FakeConnection {
  return new FakeConnection();
}

function asConn(conn: FakeConnection): TugConnection {
  return conn as unknown as TugConnection;
}

async function flushMicrotasks(): Promise<void> {
  // Two awaits guarantees the loader's `then` callback has flushed
  // even if the bus publish ran synchronously inside the same tick.
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  _resetLocalSessionStateChangeForTest();
  _resetTideSessionLedgerEventsForTest();
  _resetSessionStateChangesStoreForTest();
});

afterEach(() => {
  _resetLocalSessionStateChangeForTest();
  _resetTideSessionLedgerEventsForTest();
  _resetSessionStateChangesStoreForTest();
});

describe("SessionStateChangesStore — kick load + ready", () => {
  it("first getSnapshot triggers load and returns pending", () => {
    const conn = makeConn();
    const store = new SessionStateChangesStore(asConn(conn));
    const snap = store.getSnapshot("sess-A");
    expect(snap.status).toBe("pending");
    expect(snap.rows.length).toBe(0);
    expect(conn.frames.length).toBe(1);
    expect(conn.frames[0]!.feedId).toBe(FeedId.CONTROL);
  });

  it("settles to ready when list_session_state_changes_ok arrives", async () => {
    const conn = makeConn();
    const store = new SessionStateChangesStore(asConn(conn));
    let ticks = 0;
    store.subscribe(() => ticks++);
    store.getSnapshot("sess-B");
    publishListSessionStateChangesOk({
      tug_session_id: "sess-B",
      rows: [
        {
          at_ms: 100,
          phase: "idle",
          transport_state: "online",
          interrupt_in_flight: false,
        },
      ],
    });
    await flushMicrotasks();
    const snap = store.getSnapshot("sess-B");
    expect(snap.status).toBe("ready");
    expect(snap.rows.length).toBe(1);
    expect(snap.rows[0]).toEqual({
      atMs: 100,
      phase: "idle",
      transportState: "online",
      interruptInFlight: false,
    });
    expect(ticks).toBeGreaterThanOrEqual(1);
  });
});

describe("SessionStateChangesStore — live append", () => {
  it("appends a local publish after the load has settled", async () => {
    const conn = makeConn();
    const store = new SessionStateChangesStore(asConn(conn));
    store.getSnapshot("sess-C");
    publishListSessionStateChangesOk({
      tug_session_id: "sess-C",
      rows: [
        {
          at_ms: 100,
          phase: "idle",
          transport_state: "online",
          interrupt_in_flight: false,
        },
      ],
    });
    await flushMicrotasks();

    publishLocalSessionStateChange({
      tugSessionId: "sess-C",
      atMs: 200,
      phase: "submitting",
      transportState: "online",
      interruptInFlight: false,
    });
    const snap = store.getSnapshot("sess-C");
    expect(snap.status).toBe("ready");
    expect(snap.rows.length).toBe(2);
    expect(snap.rows[1]!.phase).toBe("submitting");
  });

  it("ignores local publishes for sessions that no one is observing", () => {
    const conn = makeConn();
    const store = new SessionStateChangesStore(asConn(conn));
    // No getSnapshot call for sess-D — the store has no cache entry.
    publishLocalSessionStateChange({
      tugSessionId: "sess-D",
      atMs: 100,
      phase: "idle",
      transportState: "online",
      interruptInFlight: false,
    });
    // Now observe sess-D — should kick a fresh load (pending), not
    // a stale "ready" with the unsolicited local row.
    const snap = store.getSnapshot("sess-D");
    expect(snap.status).toBe("pending");
    expect(snap.rows.length).toBe(0);
  });

  it("dedupes a local publish that the load already returned", async () => {
    // Scenario: triple change fires → local publish → wire write → load
    // returns the same triple. The store should keep only one row.
    const conn = makeConn();
    const store = new SessionStateChangesStore(asConn(conn));
    store.getSnapshot("sess-E");
    publishLocalSessionStateChange({
      tugSessionId: "sess-E",
      atMs: 100,
      phase: "submitting",
      transportState: "online",
      interruptInFlight: false,
    });
    // Now the load resolves with that same row from the persisted ledger.
    publishListSessionStateChangesOk({
      tug_session_id: "sess-E",
      rows: [
        {
          at_ms: 100,
          phase: "submitting",
          transport_state: "online",
          interrupt_in_flight: false,
        },
      ],
    });
    await flushMicrotasks();
    const snap = store.getSnapshot("sess-E");
    expect(snap.status).toBe("ready");
    expect(snap.rows.length).toBe(1);
  });

  it("filters local publishes by tug_session_id", async () => {
    const conn = makeConn();
    const store = new SessionStateChangesStore(asConn(conn));
    store.getSnapshot("sess-F");
    publishListSessionStateChangesOk({
      tug_session_id: "sess-F",
      rows: [],
    });
    await flushMicrotasks();

    // Publish for a different session — must NOT land in sess-F's
    // cache.
    publishLocalSessionStateChange({
      tugSessionId: "sess-OTHER",
      atMs: 100,
      phase: "submitting",
      transportState: "online",
      interruptInFlight: false,
    });
    const snap = store.getSnapshot("sess-F");
    expect(snap.rows.length).toBe(0);
  });
});

describe("SessionStateChangesStore — invalidate", () => {
  it("drops the cache and re-triggers the load on next observe", async () => {
    const conn = makeConn();
    const store = new SessionStateChangesStore(asConn(conn));
    store.getSnapshot("sess-G");
    publishListSessionStateChangesOk({
      tug_session_id: "sess-G",
      rows: [
        {
          at_ms: 100,
          phase: "idle",
          transport_state: "online",
          interrupt_in_flight: false,
        },
      ],
    });
    await flushMicrotasks();
    expect(conn.frames.length).toBe(1);

    store.invalidate("sess-G");
    const fresh = store.getSnapshot("sess-G");
    expect(fresh.status).toBe("pending");
    expect(fresh.rows.length).toBe(0);
    expect(conn.frames.length).toBe(2);
  });
});
