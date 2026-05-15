/**
 * `TideTranscriptDataSource` adapter unit tests.
 *
 * Coverage:
 *  - Empty state: `numberOfItems = 0`.
 *  - In-flight pair appears on `send` and carries the turnKey-derived
 *    React id.
 *  - **Id stability across `turn_complete`.** The ids the data source
 *    returns for the in-flight pair MUST be byte-identical to the ids
 *    it returns for the committed pair after `turn_complete` —
 *    same React key in, same React key out. This is the invariant that
 *    prevents the cell wrapper from unmounting at turn boundary
 *    (which previously caused `scrollTop` to silently clamp to 0).
 *  - Kinds use the unified `"user"` / `"code"` vocabulary — no
 *    streaming/committed kind split (see {@link TideTranscriptCellKind}
 *    for why the split was removed).
 *  - `rowAt` payload: `inflight` for the in-flight `user`, `turn` for
 *    every committed row, `turnKey` for every `code` row.
 *  - Id stability across snapshot ticks for committed rows.
 *  - Multi-turn: per-turn ids correct across N committed turns.
 *  - `subscribe` proxies to the underlying store.
 *  - `getVersion()` is `Object.is`-stable across non-mutating reads
 *    and changes identity on every reducer dispatch.
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
import { TideTranscriptDataSource } from "@/lib/tide-transcript-data-source";

function buildStore(): { store: CodeSessionStore; conn: TestFrameChannel } {
  const conn = new TestFrameChannel();
  const store = new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    sessionMode: "new",
  });
  return { store, conn };
}

/**
 * Hand-craft a complete `success` turn with a caller-supplied `msgId`.
 * Used when a test needs more than one committed turn — the golden
 * fixture only carries one `msg_id` token, so the second turn is
 * synthesized rather than loaded.
 */
function driveSyntheticSuccessTurn(
  conn: TestFrameChannel,
  msgId: string,
  finalText: string,
): void {
  // First partial — drives submitting → awaiting_first_token, sets
  // activeMsgId.
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: finalText.slice(0, 1),
    is_partial: true,
    rev: 0,
    seq: 0,
  });
  // Second partial — awaiting_first_token → streaming.
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: finalText.slice(0, Math.min(2, finalText.length)),
    is_partial: true,
    rev: 1,
    seq: 0,
  });
  // Terminal assistant_text — full text.
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: finalText,
    is_partial: false,
    rev: 0,
    seq: 1,
  });
  // turn_complete success.
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "turn_complete",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    result: "success",
  });
}

describe("TideTranscriptDataSource — empty state", () => {
  it("returns 0 items on a fresh idle store", () => {
    const { store } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    expect(ds.numberOfItems()).toBe(0);
  });

  it("getVersion returns the snapshot reference and is stable across reads", () => {
    const { store } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    const v1 = ds.getVersion();
    const v2 = ds.getVersion();
    // Same as `store.getSnapshot()` reference, and stable across reads.
    expect(Object.is(v1, v2)).toBe(true);
    expect(v1).toBe(store.getSnapshot());
  });
});

describe("TideTranscriptDataSource — in-flight pair", () => {
  it("appears on send with unified kinds [user, code] and turnKey-derived ids", () => {
    const { store } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("hi", []);

    const turnKey = store.getSnapshot().inflightUserMessage?.turnKey;
    expect(typeof turnKey).toBe("string");
    expect((turnKey ?? "").length).toBeGreaterThan(0);

    expect(ds.numberOfItems()).toBe(2);
    // Single `"code"` kind for the assistant row — no streaming /
    // committed split (the split forced cellRenderers to hold two
    // entries for what is structurally one row, opening a lambda-
    // identity trap that re-mounted the cell at turn_complete).
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("code");
    expect(ds.idForIndex(0)).toBe(`${turnKey}-user`);
    expect(ds.idForIndex(1)).toBe(`${turnKey}-code`);

    const userRow = ds.rowAt(0);
    expect(userRow.kind).toBe("user");
    expect(userRow.inflight?.text).toBe("hi");
    expect(userRow.turn).toBeUndefined();
    expect(userRow.turnKey).toBe(turnKey);

    const codeRow = ds.rowAt(1);
    expect(codeRow.kind).toBe("code");
    expect(codeRow.turn).toBeUndefined();
    expect(codeRow.inflight).toBeUndefined();
    expect(codeRow.turnKey).toBe(turnKey);
  });

  it("the id does NOT change when activeMsgId becomes set — turnKey is stable from send", () => {
    // Earlier revisions transitioned the id from an `inflight` seed
    // to `activeMsgId` on first delta. That mid-turn id change
    // re-mounted the React cell wrapper, briefly tore down the
    // streaming markdown subtree, collapsed `scrollHeight` below
    // `clientHeight`, and triggered the browser's silent
    // `scrollTop = 0` clamp — the user-visible "scroll jumps to top"
    // regression. The turnKey-based id is generated once at send and
    // is byte-identical for every subsequent read.
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("hi", []);
    const idUserBefore = ds.idForIndex(0);
    const idCodeBefore = ds.idForIndex(1);

    // session_init / system_metadata — no activeMsgId yet.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[0]);
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[1]);
    expect(store.getSnapshot().activeMsgId).toBeNull();
    expect(ds.idForIndex(0)).toBe(idUserBefore);
    expect(ds.idForIndex(1)).toBe(idCodeBefore);

    // First assistant_text — assigns activeMsgId. The id MUST NOT
    // change — turnKey is the React key seed, not activeMsgId.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[2]);
    expect(store.getSnapshot().activeMsgId).toBe(FIXTURE_IDS.MSG_ID);
    expect(ds.idForIndex(0)).toBe(idUserBefore);
    expect(ds.idForIndex(1)).toBe(idCodeBefore);

    // Subsequent partials — same invariant.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[3]);
    expect(ds.idForIndex(0)).toBe(idUserBefore);
    expect(ds.idForIndex(1)).toBe(idCodeBefore);
  });

  it("commits with byte-identical ids on turn_complete(success) — the React key survives", () => {
    // The core invariant of the architecture: the React key the data
    // source returns for the in-flight pair is the SAME string the
    // data source returns for the committed pair. React's reconciler
    // matches keys before unmount/mount decisions; an identical key
    // means the cell wrapper instance persists across `turn_complete`,
    // its DOM identity holds, every `useLayoutEffect` subscription
    // inside it survives unchanged, and the scrollport's geometry
    // does not collapse at the boundary.
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("hi", []);
    // Capture ids while in-flight (before any frames land).
    const idUserMid = ds.idForIndex(0);
    const idCodeMid = ds.idForIndex(1);
    expect(ds.kindForIndex(1)).toBe("code");

    // Drain the whole turn through to turn_complete.
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }

    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().inflightUserMessage).toBeNull();

    // Now committed pair. numberOfItems is still 2 (committed pair
    // replaces the in-flight pair 1-for-1).
    expect(ds.numberOfItems()).toBe(2);
    expect(ds.kindForIndex(0)).toBe("user");
    // Kind STAYS `"code"` — no streaming/committed split anymore.
    expect(ds.kindForIndex(1)).toBe("code");
    // The critical id-stability invariant.
    expect(ds.idForIndex(0)).toBe(idUserMid);
    expect(ds.idForIndex(1)).toBe(idCodeMid);

    const userRow = ds.rowAt(0);
    expect(userRow.kind).toBe("user");
    expect(userRow.turn?.userMessage.text).toBe("hi");
    expect(userRow.inflight).toBeUndefined();

    const codeRow = ds.rowAt(1);
    expect(codeRow.kind).toBe("code");
    // The cell renderer reads `row.turn !== undefined` to decide
    // whether it's rendering a committed body. Verify the payload
    // is present at commit.
    expect(codeRow.turn).toBeDefined();
    expect(codeRow.turn?.msgId).toBe(FIXTURE_IDS.MSG_ID);
    expect(codeRow.turn?.assistant.length).toBe(28); // test-01 fixture's terminal length
    // The turnKey on the committed row must equal the inflight
    // turnKey — that's how the id stays stable across the boundary.
    expect(codeRow.turnKey).toBe(codeRow.turn?.turnKey);
  });
});

describe("TideTranscriptDataSource — id stability", () => {
  it("returns the same id for the same committed row across snapshot ticks", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("hi", []);
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }

    // Capture once; read again — strings must be equal (data source
    // mints fresh strings per call, React's reconciler keys by value).
    const userId = ds.idForIndex(0);
    const codeId = ds.idForIndex(1);
    expect(ds.idForIndex(0)).toBe(userId);
    expect(ds.idForIndex(1)).toBe(codeId);
    // The committed pair's turnKey is the id's prefix.
    const turn0 = ds.rowAt(0).turn;
    expect(turn0).toBeDefined();
    expect(userId).toBe(`${turn0?.turnKey}-user`);
    expect(codeId).toBe(`${turn0?.turnKey}-code`);
  });
});

describe("TideTranscriptDataSource — multi-turn", () => {
  it("renders N committed turns at indices 0..2N-1 with distinct per-turn keys", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    // Turn 1 — drive through to commit.
    store.send("first", []);
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }
    expect(store.getSnapshot().phase).toBe("idle");
    expect(ds.numberOfItems()).toBe(2);
    const turn1Key = ds.rowAt(1).turn?.turnKey;
    expect(typeof turn1Key).toBe("string");
    expect(ds.idForIndex(1)).toBe(`${turn1Key}-code`);

    // Turn 2 — start streaming; capture in-flight turnKey.
    const msgId2 = FIXTURE_IDS.MSG_ID_N(2);
    store.send("second", []);
    expect(ds.numberOfItems()).toBe(4);
    // Mid-flight: 2 committed + 2 in-flight. All assistant rows use
    // the unified `"code"` kind.
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("code");
    expect(ds.kindForIndex(2)).toBe("user");
    expect(ds.kindForIndex(3)).toBe("code");
    const turn2KeyInflight = store.getSnapshot().inflightUserMessage?.turnKey;
    expect(typeof turn2KeyInflight).toBe("string");
    expect(turn2KeyInflight).not.toBe(turn1Key); // distinct keys per turn
    expect(ds.idForIndex(2)).toBe(`${turn2KeyInflight}-user`);
    expect(ds.idForIndex(3)).toBe(`${turn2KeyInflight}-code`);

    driveSyntheticSuccessTurn(conn, msgId2, "second response text");

    expect(store.getSnapshot().phase).toBe("idle");
    expect(ds.numberOfItems()).toBe(4);
    expect(ds.kindForIndex(1)).toBe("code");
    expect(ds.kindForIndex(3)).toBe("code");

    // Turn 1's ids are unchanged across turn 2's lifecycle.
    expect(ds.idForIndex(0)).toBe(`${turn1Key}-user`);
    expect(ds.idForIndex(1)).toBe(`${turn1Key}-code`);
    // Turn 2's committed ids are byte-identical to its in-flight ids
    // (same turnKey carried from pendingUserMessage onto TurnEntry).
    expect(ds.idForIndex(2)).toBe(`${turn2KeyInflight}-user`);
    expect(ds.idForIndex(3)).toBe(`${turn2KeyInflight}-code`);

    // Row payloads round-trip the per-turn data.
    expect(ds.rowAt(0).turn?.msgId).toBe(FIXTURE_IDS.MSG_ID);
    expect(ds.rowAt(0).turn?.userMessage.text).toBe("first");
    expect(ds.rowAt(2).turn?.msgId).toBe(msgId2);
    expect(ds.rowAt(2).turn?.userMessage.text).toBe("second");
    expect(ds.rowAt(3).turn?.assistant).toBe("second response text");
  });
});

describe("TideTranscriptDataSource — subscribe + getVersion", () => {
  it("subscribe fires on snapshot ticks and unsubscribes correctly", () => {
    const { store } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    let calls = 0;
    const unsubscribe = ds.subscribe(() => {
      calls += 1;
    });

    store.send("a", []);
    expect(calls).toBeGreaterThanOrEqual(1);

    const callsAfterSend = calls;
    unsubscribe();

    // After unsubscribe, no further dispatches should fire the listener.
    store.interrupt();
    expect(calls).toBe(callsAfterSend);
  });

  it("getVersion identity changes across reducer dispatches", () => {
    const { store } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    const v0 = ds.getVersion();
    store.send("a", []);
    const v1 = ds.getVersion();

    expect(Object.is(v0, v1)).toBe(false);

    // No state change between reads — identity stable.
    const v1b = ds.getVersion();
    expect(Object.is(v1, v1b)).toBe(true);
  });
});
