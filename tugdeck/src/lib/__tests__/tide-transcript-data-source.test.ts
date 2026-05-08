/**
 * Step 10 — `TideTranscriptDataSource` adapter unit tests.
 *
 * Coverage:
 *  - Empty state: `numberOfItems = 0`.
 *  - In-flight pair appears on `send`; ids start at the `"inflight"`
 *    seed and transition exactly once when `activeMsgId` is set.
 *  - Kinds transition `code-streaming` → `code-committed` at commit.
 *  - Id stability across snapshot ticks for committed rows.
 *  - Multi-turn: kinds and ids correct across N committed turns.
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
import {
  INFLIGHT_ID_SEED,
  TideTranscriptDataSource,
} from "@/lib/tide-transcript-data-source";

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
  it("appears on send with kinds [user, code-streaming] and the inflight seed", () => {
    const { store } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("hi", []);

    expect(ds.numberOfItems()).toBe(2);
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("code-streaming");
    expect(ds.idForIndex(0)).toBe(`${INFLIGHT_ID_SEED}-user`);
    expect(ds.idForIndex(1)).toBe(`${INFLIGHT_ID_SEED}-code`);

    const userRow = ds.rowAt(0);
    expect(userRow.kind).toBe("user");
    expect(userRow.inflight?.text).toBe("hi");
    expect(userRow.turn).toBeUndefined();

    const codeRow = ds.rowAt(1);
    expect(codeRow.kind).toBe("code-streaming");
    expect(codeRow.turn).toBeUndefined();
    expect(codeRow.inflight).toBeUndefined();
  });

  it("transitions ids exactly once when activeMsgId becomes set", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("hi", []);
    // Pre-first-delta — seed-prefixed.
    expect(ds.idForIndex(0)).toBe(`${INFLIGHT_ID_SEED}-user`);
    expect(ds.idForIndex(1)).toBe(`${INFLIGHT_ID_SEED}-code`);

    // session_init / system_metadata — no activeMsgId yet.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[0]);
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[1]);
    expect(store.getSnapshot().activeMsgId).toBeNull();
    expect(ds.idForIndex(0)).toBe(`${INFLIGHT_ID_SEED}-user`);

    // First assistant_text — assigns activeMsgId. The id transitions
    // from `inflight-...` to `${activeMsgId}-...`.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[2]);
    expect(store.getSnapshot().activeMsgId).toBe(FIXTURE_IDS.MSG_ID);
    expect(ds.idForIndex(0)).toBe(`${FIXTURE_IDS.MSG_ID}-user`);
    expect(ds.idForIndex(1)).toBe(`${FIXTURE_IDS.MSG_ID}-code`);

    // Subsequent partials must not change ids — the transition is
    // exactly once per turn.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[3]);
    expect(ds.idForIndex(0)).toBe(`${FIXTURE_IDS.MSG_ID}-user`);
    expect(ds.idForIndex(1)).toBe(`${FIXTURE_IDS.MSG_ID}-code`);
  });

  it("commits to [user, code-committed] with the same ids on turn_complete(success)", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("hi", []);
    // Drive into streaming so activeMsgId is set, then capture ids.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[0]);
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[1]);
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[2]);
    const idUserMid = ds.idForIndex(0);
    const idCodeMid = ds.idForIndex(1);
    expect(idUserMid).toBe(`${FIXTURE_IDS.MSG_ID}-user`);
    expect(idCodeMid).toBe(`${FIXTURE_IDS.MSG_ID}-code`);
    expect(ds.kindForIndex(1)).toBe("code-streaming");

    // Drain the rest of the turn (cost, message, terminal text, turn_complete).
    for (let i = 3; i < probe.events.length; i += 1) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().inflightUserMessage).toBeNull();

    // Now committed pair. numberOfItems is 2 (no in-flight pair).
    expect(ds.numberOfItems()).toBe(2);
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("code-committed");
    // Ids stable across the commit boundary — the wrapper key survives,
    // only the cell renderer underneath swaps because the kind changed.
    expect(ds.idForIndex(0)).toBe(idUserMid);
    expect(ds.idForIndex(1)).toBe(idCodeMid);

    const userRow = ds.rowAt(0);
    expect(userRow.kind).toBe("user");
    expect(userRow.turn?.userMessage.text).toBe("hi");
    expect(userRow.inflight).toBeUndefined();

    const codeRow = ds.rowAt(1);
    expect(codeRow.kind).toBe("code-committed");
    expect(codeRow.turn?.msgId).toBe(FIXTURE_IDS.MSG_ID);
    expect(codeRow.turn?.assistant.length).toBe(28); // test-01 fixture's terminal length
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

    // Read ids twice over the same idle snapshot — must be string-equal
    // (the data source mints a new string per call, so what matters is
    // the value, not reference; React's reconciler keys by value).
    expect(ds.idForIndex(0)).toBe(`${FIXTURE_IDS.MSG_ID}-user`);
    expect(ds.idForIndex(1)).toBe(`${FIXTURE_IDS.MSG_ID}-code`);
    expect(ds.idForIndex(0)).toBe(`${FIXTURE_IDS.MSG_ID}-user`);
    expect(ds.idForIndex(1)).toBe(`${FIXTURE_IDS.MSG_ID}-code`);
  });
});

describe("TideTranscriptDataSource — multi-turn", () => {
  it("renders N committed turns at indices 0..2N-1 with per-turn ids", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    // Turn 1 — fixture-driven, msgId = MSG_ID.
    store.send("first", []);
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }
    expect(store.getSnapshot().phase).toBe("idle");
    expect(ds.numberOfItems()).toBe(2);

    // Turn 2 — synthetic, msgId = MSG_ID_N(2).
    const msgId2 = FIXTURE_IDS.MSG_ID_N(2);
    store.send("second", []);
    expect(ds.numberOfItems()).toBe(4);
    // Mid-flight: 2 committed + 2 in-flight.
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("code-committed");
    expect(ds.kindForIndex(2)).toBe("user");
    expect(ds.kindForIndex(3)).toBe("code-streaming");
    // In-flight pair seeded — activeMsgId still null between send and
    // first delta of turn 2.
    expect(ds.idForIndex(2)).toBe(`${INFLIGHT_ID_SEED}-user`);
    expect(ds.idForIndex(3)).toBe(`${INFLIGHT_ID_SEED}-code`);

    driveSyntheticSuccessTurn(conn, msgId2, "second response text");

    expect(store.getSnapshot().phase).toBe("idle");
    expect(ds.numberOfItems()).toBe(4);
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("code-committed");
    expect(ds.kindForIndex(2)).toBe("user");
    expect(ds.kindForIndex(3)).toBe("code-committed");
    expect(ds.idForIndex(0)).toBe(`${FIXTURE_IDS.MSG_ID}-user`);
    expect(ds.idForIndex(1)).toBe(`${FIXTURE_IDS.MSG_ID}-code`);
    expect(ds.idForIndex(2)).toBe(`${msgId2}-user`);
    expect(ds.idForIndex(3)).toBe(`${msgId2}-code`);

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
