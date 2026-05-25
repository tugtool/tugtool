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
import type { TurnEntry } from "@/lib/code-session-store";
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
  assistantRowIndexForTurn,
  TideTranscriptDataSource,
  userRowIndexForTurn,
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

describe("userRowIndexForTurn / assistantRowIndexForTurn", () => {
  // A stub transcript of N non-wake turns, just enough to satisfy
  // the helpers' signature. The body fields don't matter to the
  // index helpers — only `userMessage.text` and
  // `userMessage.attachments.length` are read (via `isWakeTurn`).
  function nonWakeTranscript(n: number): ReadonlyArray<TurnEntry> {
    return Array.from(
      { length: n },
      (_, i) =>
        ({
          turnKey: `tk-${i}`,
          msgId: `msg-${i}`,
          userMessage: { text: "u", attachments: [], submitAt: 0 },
          thinking: "",
          assistant: "a",
          toolCalls: [],
          result: "success",
          endedAt: 0,
          wallClockMs: 0,
          awaitingApprovalMs: 0,
          transportDowntimeMs: 0,
          activeMs: 0,
          ttftMs: null,
          ttftcMs: null,
          reconnectCount: 0,
          maxStreamGapMs: 0,
          turnEndReason: "complete",
          cost: {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalCostUsd: 0,
          },
        }) satisfies TurnEntry,
    );
  }

  it("maps a 0-based turn index onto its user / assistant row pair", () => {
    // Each committed (non-wake) turn is two rows — user at 2k, code at 2k+1.
    const t = nonWakeTranscript(3);
    expect(userRowIndexForTurn(0, t)).toBe(0);
    expect(assistantRowIndexForTurn(0, t)).toBe(1);
    expect(userRowIndexForTurn(1, t)).toBe(2);
    expect(assistantRowIndexForTurn(1, t)).toBe(3);
    expect(userRowIndexForTurn(2, t)).toBe(4);
    expect(assistantRowIndexForTurn(2, t)).toBe(5);
  });

  it("addresses the `user` / `code` rows of a real multi-turn data source", () => {
    // Pin the mapping against the live adapter the Z2 popovers'
    // entry-number scroll relies on: each turn shows BOTH entry
    // numbers, and clicking one must land on the matching transcript
    // row. The displayed sequence number is that row index + 1.
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("first", []);
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }
    const msgId2 = FIXTURE_IDS.MSG_ID_N(2);
    store.send("second", []);
    driveSyntheticSuccessTurn(conn, msgId2, "second response text");

    const transcript = store.getSnapshot().transcript;
    expect(ds.numberOfItems()).toBe(4);
    expect(ds.kindForIndex(userRowIndexForTurn(0, transcript))).toBe("user");
    expect(ds.kindForIndex(assistantRowIndexForTurn(0, transcript))).toBe("code");
    expect(ds.kindForIndex(userRowIndexForTurn(1, transcript))).toBe("user");
    expect(ds.kindForIndex(assistantRowIndexForTurn(1, transcript))).toBe("code");
    // Turn 0 spans transcript entries #0001 (user) and #0002 (code);
    // turn 1 spans #0003 and #0004. `#NNNN` is row index + 1.
    expect(userRowIndexForTurn(0, transcript) + 1).toBe(1);
    expect(assistantRowIndexForTurn(0, transcript) + 1).toBe(2);
    expect(userRowIndexForTurn(1, transcript) + 1).toBe(3);
    expect(assistantRowIndexForTurn(1, transcript) + 1).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Slice 1c-a — wake single-row layout
// ---------------------------------------------------------------------------

/**
 * Drive a complete wake bracket through `TestFrameChannel`: wake_started
 * IPC frame → assistant_text → turn_complete. Commits a wake `TurnEntry`
 * whose `userMessage.text === ""` (the empty-text sentinel from [D01]).
 */
function driveWakeTurn(
  conn: TestFrameChannel,
  msgId: string,
  assistantText: string,
  options: { taskId?: string; summary?: string } = {},
): void {
  const taskId = options.taskId ?? "wake-task-id";
  const summary = options.summary ?? "wake summary";
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "wake_started",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    session_id: FIXTURE_IDS.CLAUDE_SESSION_ID,
    wake_trigger: {
      task_id: taskId,
      tool_use_id: "wake-tool-use-id",
      status: "completed",
      summary,
      output_file: "",
    },
    ipc_version: 2,
  });
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: assistantText,
    is_partial: false,
    status: "complete",
    seq: 0,
    rev: 0,
    ipc_version: 2,
  });
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "turn_complete",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    seq: 1,
    result: "success",
    ipc_version: 2,
  });
}

describe("TideTranscriptDataSource — wake single-row layout [D06]", () => {
  it("a single committed wake turn occupies ONE row, not two (code only — no user row)", () => {
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    driveWakeTurn(conn, FIXTURE_IDS.MSG_ID_N(1), "wake-content");

    expect(ds.numberOfItems()).toBe(1);
    expect(ds.kindForIndex(0)).toBe("code");
    const row = ds.rowAt(0);
    expect(row.kind).toBe("code");
    expect(row.turn?.userMessage.text).toBe("");
    expect(row.turn?.assistant).toBe("wake-content");
  });

  it("idForIndex for a wake row returns `${turnKey}-code` — the `-user` key is never minted", () => {
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    driveWakeTurn(conn, FIXTURE_IDS.MSG_ID_N(1), "wake-content");

    const turn = store.getSnapshot().transcript[0];
    expect(ds.idForIndex(0)).toBe(`${turn.turnKey}-code`);
    // The `-user` key should NOT appear anywhere in the layout — the
    // wake has only one row, addressed by the code key.
    expect(ds.idForIndex(0)).not.toContain("-user");
  });

  it("mixed transcript [user, wake, user] lays out as 5 rows, not 6", () => {
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    // Turn 0 — normal user-initiated.
    store.send("first", []);
    driveSyntheticSuccessTurn(conn, FIXTURE_IDS.MSG_ID_N(1), "first response");
    // Turn 1 — wake.
    driveWakeTurn(conn, FIXTURE_IDS.MSG_ID_N(2), "wake response");
    // Turn 2 — normal user-initiated.
    store.send("third", []);
    driveSyntheticSuccessTurn(conn, FIXTURE_IDS.MSG_ID_N(3), "third response");

    expect(ds.numberOfItems()).toBe(5);
    // Layout: [user(t0), code(t0), code(t1-wake), user(t2), code(t2)]
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("code");
    expect(ds.kindForIndex(2)).toBe("code");
    expect(ds.kindForIndex(3)).toBe("user");
    expect(ds.kindForIndex(4)).toBe("code");
    // The wake's row (index 2) maps to transcript[1].
    expect(ds.rowAt(2).turn?.assistant).toBe("wake response");
    // The user-initiated turn at transcript[2] starts at row 3.
    expect(ds.rowAt(3).turn?.userMessage.text).toBe("third");
  });

  it("userRowIndexForTurn returns -1 for a wake turn at that index", () => {
    const { store, conn } = buildStore();
    new TideTranscriptDataSource(store);

    store.send("first", []);
    driveSyntheticSuccessTurn(conn, FIXTURE_IDS.MSG_ID_N(1), "r1");
    driveWakeTurn(conn, FIXTURE_IDS.MSG_ID_N(2), "wake-r");
    store.send("third", []);
    driveSyntheticSuccessTurn(conn, FIXTURE_IDS.MSG_ID_N(3), "r3");

    const transcript = store.getSnapshot().transcript;
    expect(userRowIndexForTurn(0, transcript)).toBe(0);
    expect(userRowIndexForTurn(1, transcript)).toBe(-1); // wake — no user row
    expect(userRowIndexForTurn(2, transcript)).toBe(3); // shifted by wake's single row
  });

  it("assistantRowIndexForTurn returns the wake's single row for a wake turn, normal offset for non-wake", () => {
    const { store, conn } = buildStore();
    new TideTranscriptDataSource(store);

    store.send("first", []);
    driveSyntheticSuccessTurn(conn, FIXTURE_IDS.MSG_ID_N(1), "r1");
    driveWakeTurn(conn, FIXTURE_IDS.MSG_ID_N(2), "wake-r");
    store.send("third", []);
    driveSyntheticSuccessTurn(conn, FIXTURE_IDS.MSG_ID_N(3), "r3");

    const transcript = store.getSnapshot().transcript;
    expect(assistantRowIndexForTurn(0, transcript)).toBe(1);
    expect(assistantRowIndexForTurn(1, transcript)).toBe(2); // wake's single row
    expect(assistantRowIndexForTurn(2, transcript)).toBe(4);
  });

  it("an in-flight wake (waking phase, empty-text inflightUserMessage) takes 1 row, not 2", () => {
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    // Open a wake bracket but do NOT commit it — leaves the wake's
    // empty-text marker on inflightUserMessage.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "wake_started",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      session_id: FIXTURE_IDS.CLAUDE_SESSION_ID,
      wake_trigger: {
        task_id: "in-flight-wake",
        tool_use_id: "u",
        status: "completed",
        summary: "s",
        output_file: "",
      },
      ipc_version: 2,
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("waking");
    expect(snap.inflightUserMessage?.text).toBe("");

    // 0 committed + 1 in-flight wake row = 1 row.
    expect(ds.numberOfItems()).toBe(1);
    expect(ds.kindForIndex(0)).toBe("code");
    const row = ds.rowAt(0);
    expect(row.kind).toBe("code");
    // No `inflight` payload for the wake's streaming code row — the
    // empty-text marker is internal, not user content.
    expect(row.inflight).toBeUndefined();
    expect(row.turnKey).toBe(snap.inflightUserMessage?.turnKey);
  });

  it("an in-flight normal user turn still takes 2 rows (no regression)", () => {
    const { store } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("hello", []);
    expect(ds.numberOfItems()).toBe(2);
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("code");
  });

  it("layout is reference-stable across rowAt calls for the same snapshot (memoization)", () => {
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    store.send("first", []);
    driveSyntheticSuccessTurn(conn, FIXTURE_IDS.MSG_ID_N(1), "r1");
    driveWakeTurn(conn, FIXTURE_IDS.MSG_ID_N(2), "wake-r");

    // Multiple rowAt calls within one render should return rows whose
    // `turn` references are `Object.is`-equal to the snapshot's
    // transcript entries (no defensive copies, no rebuilds per call).
    const snap = store.getSnapshot();
    const row0a = ds.rowAt(0);
    const row0b = ds.rowAt(0);
    expect(Object.is(row0a.turn, row0b.turn)).toBe(true);
    expect(Object.is(row0a.turn, snap.transcript[0])).toBe(true);

    const wakeRowA = ds.rowAt(2);
    const wakeRowB = ds.rowAt(2);
    expect(Object.is(wakeRowA.turn, wakeRowB.turn)).toBe(true);
    expect(Object.is(wakeRowA.turn, snap.transcript[1])).toBe(true);
  });

  it("a wake committed turn's id is byte-identical across the inflight → committed transition", () => {
    // Pin the [L26] invariant: the same `turnKey` used during waking
    // is preserved onto `TurnEntry.turnKey` at turn_complete, so the
    // cell wrapper survives the bracket without remounting.
    const { store, conn } = buildStore();
    const ds = new TideTranscriptDataSource(store);

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "wake_started",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      session_id: FIXTURE_IDS.CLAUDE_SESSION_ID,
      wake_trigger: {
        task_id: "t",
        tool_use_id: "u",
        status: "completed",
        summary: "s",
        output_file: "",
      },
      ipc_version: 2,
    });
    const inflightTurnKey = store.getSnapshot().inflightUserMessage!.turnKey;
    const inflightId = ds.idForIndex(0);
    expect(inflightId).toBe(`${inflightTurnKey}-code`);

    // Commit the wake.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID_N(1),
      text: "wake content",
      is_partial: false,
      status: "complete",
      seq: 0,
      rev: 0,
      ipc_version: 2,
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID_N(1),
      seq: 1,
      result: "success",
      ipc_version: 2,
    });
    const committedId = ds.idForIndex(0);
    expect(committedId).toBe(inflightId);
  });
});
