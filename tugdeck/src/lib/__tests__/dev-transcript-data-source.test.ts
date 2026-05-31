/**
 * dev-transcript-data-source.test.ts — pin the invariants of the
 * substrate-aware row layout. Under [D07] the data source projects:
 *   - 1 row per wake turn (no `user_message` Message at head → assistant row only)
 *   - 2 rows per normal turn (user + assistant)
 *   - +1 row per in-flight turn (1 if wake, 2 if normal)
 *   - +1 row per queued send (ghost)
 *
 * The previous test file pinned the OLD substrate shape extensively
 * (`turn.userMessage.text`, `snap.activeTurn`, etc.) — those
 * pins were rewritten here to assert the substrate's behavior through
 * the data-source's public surface (kindForIndex / idForIndex / rowAt
 * / numberOfItems / buildRowLayout). Internal helpers
 * (`assistantRowIndexForTurn` / `userRowIndexForTurn`) are pinned
 * because the Z2 popovers route scroll clicks through them.
 */

import { describe, expect, test } from "bun:test";

import {
  DevTranscriptDataSource,
  assistantRowIndexForTurn,
  buildRowLayout,
  userRowIndexForTurn,
} from "@/lib/dev-transcript-data-source";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type {
  ActiveTurnSnapshot,
  CodeSessionSnapshot,
  QueuedSend,
  TurnEntry,
} from "@/lib/code-session-store";

import {
  assistantText,
  turnEntry,
  userMessage,
} from "../code-session-store/__tests__/_helpers/messages";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function normalTurn(turnKey: string, userText: string, assistantTextBody: string): TurnEntry {
  return turnEntry({
    turnKey,
    msgId: `msg-${turnKey}`,
    messages: [
      userMessage({ turnKey, text: userText }),
      assistantText({ msgId: `msg-${turnKey}`, blockIndex: 0, text: assistantTextBody }),
    ],
  });
}

function wakeTurn(turnKey: string, assistantTextBody: string): TurnEntry {
  return turnEntry({
    turnKey,
    msgId: `msg-${turnKey}`,
    messages: [
      assistantText({ msgId: `msg-${turnKey}`, blockIndex: 0, text: assistantTextBody }),
    ],
  });
}

function activeTurn(args: {
  turnKey: string;
  isWake: boolean;
  withText?: string;
}): ActiveTurnSnapshot {
  const messages: import("@/lib/code-session-store").Message[] = [];
  if (!args.isWake) {
    messages.push(userMessage({ turnKey: args.turnKey, text: args.withText ?? "" }));
  }
  if (args.withText !== undefined && args.isWake) {
    messages.push(assistantText({ msgId: "live", blockIndex: 0, text: args.withText }));
  }
  return { turnKey: args.turnKey, submitAt: 0, isWake: args.isWake, messages };
}

function snapshotWith(args: {
  transcript?: ReadonlyArray<TurnEntry>;
  activeTurn?: ActiveTurnSnapshot | null;
  queuedSends?: ReadonlyArray<QueuedSend>;
}): CodeSessionSnapshot {
  return {
    phase: "idle",
    transportState: "online",
    interruptInFlight: false,
    tugSessionId: "s",
    displayLabel: "test",
    sessionMode: "new",
    activeMsgId: null,
    canSubmit: true,
    canInterrupt: false,
    pendingApproval: null,
    pendingQuestion: null,
    queuedSends: args.queuedSends ?? [],
    transcript: args.transcript ?? [],
    rewindPreviews: new Map(),
    lastRewindResult: null,
    activeTurn: args.activeTurn ?? null,
    pendingDraftRestore: null,
    lastCost: null,
    permissionDenials: [],
    liveTurnUsage: null,
    sessionInitTokens: null,
    lastContextBreakdown: null,
    lastError: null,
    lastReplayResult: null,
    replayPreflightActive: false,
    replaySoftBudgetElapsed: false,
    replayTimeoutDwellActive: false,
    awaitingApprovalIntervals: [],
    awaitingApprovalSegmentStartedAt: null,
    transportDowntimeIntervals: [],
    transportDowntimeSegmentStartedAt: null,
    interruptInFlightIntervals: [],
    wakeTrigger: null,
    interruptInFlightSegmentStartedAt: null,
  };
}

function storeWith(snap: CodeSessionSnapshot): CodeSessionStore {
  return {
    getSnapshot: () => snap,
    subscribe: () => () => {},
    streamingDocument: { get: () => undefined, observe: () => () => {} },
  } as unknown as CodeSessionStore;
}

// ---------------------------------------------------------------------------
// Layout invariants
// ---------------------------------------------------------------------------

describe("[D07] row layout: variable rows per turn driven by user_message presence", () => {
  test("empty snapshot has zero rows", () => {
    const layout = buildRowLayout(snapshotWith({}));
    expect(layout.totalRows).toBe(0);
  });

  test("normal committed turn contributes 2 rows; wake turn contributes 1", () => {
    const layout = buildRowLayout(
      snapshotWith({
        transcript: [
          normalTurn("t1", "hi", "hello"),
          wakeTurn("t2", "monitor fired"),
          normalTurn("t3", "x", "y"),
        ],
      }),
    );
    expect(layout.totalRows).toBe(2 + 1 + 2);
    expect(layout.turnHasUserPerTurn).toEqual([true, false, true]);
    expect(layout.turnStartRow).toEqual([0, 2, 3]);
  });

  test("in-flight normal turn adds 2 rows; in-flight wake adds 1", () => {
    const wakeLayout = buildRowLayout(
      snapshotWith({
        activeTurn: activeTurn({ turnKey: "live", isWake: true }),
      }),
    );
    expect(wakeLayout.totalRows).toBe(1);
    expect(wakeLayout.activeHasUser).toBe(false);

    const normalLayout = buildRowLayout(
      snapshotWith({
        activeTurn: activeTurn({ turnKey: "live", isWake: false, withText: "x" }),
      }),
    );
    expect(normalLayout.totalRows).toBe(2);
    expect(normalLayout.activeHasUser).toBe(true);
  });

  test("queued sends add one ghost row each at the tail", () => {
    const layout = buildRowLayout(
      snapshotWith({
        transcript: [normalTurn("t1", "x", "y")],
        queuedSends: [
          { turnKey: "q1", text: "queued", atoms: [] },
          { turnKey: "q2", text: "another", atoms: [] },
        ],
      }),
    );
    expect(layout.totalRows).toBe(2 + 2);
    expect(layout.ghostStartRow).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// idForIndex stability across inflight → committed
// ---------------------------------------------------------------------------

describe("[L26] idForIndex stability: `${turnKey}-{user,assistant}` survives inflight → committed", () => {
  test("normal turn: inflight ids match the committed pair's ids", () => {
    const liveSnap = snapshotWith({
      activeTurn: activeTurn({ turnKey: "T", isWake: false, withText: "hi" }),
    });
    const ds = new DevTranscriptDataSource(storeWith(liveSnap));
    expect(ds.idForIndex(0)).toBe("T-user");
    expect(ds.idForIndex(1)).toBe("T-assistant");

    const committedSnap = snapshotWith({
      transcript: [normalTurn("T", "hi", "hello")],
    });
    const ds2 = new DevTranscriptDataSource(storeWith(committedSnap));
    expect(ds2.idForIndex(0)).toBe("T-user");
    expect(ds2.idForIndex(1)).toBe("T-assistant");
  });

  test("wake turn: only `${turnKey}-assistant` is ever minted (no -user key)", () => {
    const liveSnap = snapshotWith({
      activeTurn: activeTurn({ turnKey: "W", isWake: true, withText: "wake" }),
    });
    const ds = new DevTranscriptDataSource(storeWith(liveSnap));
    expect(ds.numberOfItems()).toBe(1);
    expect(ds.idForIndex(0)).toBe("W-assistant");

    const committedSnap = snapshotWith({ transcript: [wakeTurn("W", "wake")] });
    const ds2 = new DevTranscriptDataSource(storeWith(committedSnap));
    expect(ds2.numberOfItems()).toBe(1);
    expect(ds2.idForIndex(0)).toBe("W-assistant");
  });
});

// ---------------------------------------------------------------------------
// Row descriptors expose committed turn / active turn / queued send
// ---------------------------------------------------------------------------

describe("rowAt produces a descriptor consumers can narrow on", () => {
  test("normal committed: row 0 is `user` with turn payload; row 1 is `assistant`", () => {
    const snap = snapshotWith({
      transcript: [normalTurn("T", "hello", "world")],
    });
    const ds = new DevTranscriptDataSource(storeWith(snap));
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("assistant");
    expect(ds.rowAt(0).turn?.turnKey).toBe("T");
    expect(ds.rowAt(1).turn?.turnKey).toBe("T");
  });

  test("in-flight normal: row 0 is `user` carrying activeTurn; row 1 is `assistant`", () => {
    const active = activeTurn({ turnKey: "L", isWake: false, withText: "hi" });
    const snap = snapshotWith({ activeTurn: active });
    const ds = new DevTranscriptDataSource(storeWith(snap));
    expect(ds.kindForIndex(0)).toBe("user");
    expect(ds.kindForIndex(1)).toBe("assistant");
    expect(ds.rowAt(0).activeTurn).toBe(active);
    expect(ds.rowAt(1).activeTurn).toBe(active);
  });

  test("ghost: a queued send produces a `ghost` row with the queued payload", () => {
    const snap = snapshotWith({
      queuedSends: [{ turnKey: "Q", text: "later", atoms: [] }],
    });
    const ds = new DevTranscriptDataSource(storeWith(snap));
    expect(ds.numberOfItems()).toBe(1);
    expect(ds.kindForIndex(0)).toBe("ghost");
    const row = ds.rowAt(0);
    expect(row.kind).toBe("ghost");
    expect(row.queued?.text).toBe("later");
  });
});

// ---------------------------------------------------------------------------
// Per-turn row index helpers (consumed by Z2 popover scroll-to-row)
// ---------------------------------------------------------------------------

describe("userRowIndexForTurn / assistantRowIndexForTurn", () => {
  test("normal-only transcript: alternating user/assistant row indices", () => {
    const transcript: TurnEntry[] = [
      normalTurn("t1", "a", "A"),
      normalTurn("t2", "b", "B"),
    ];
    expect(userRowIndexForTurn(0, transcript)).toBe(0);
    expect(assistantRowIndexForTurn(0, transcript)).toBe(1);
    expect(userRowIndexForTurn(1, transcript)).toBe(2);
    expect(assistantRowIndexForTurn(1, transcript)).toBe(3);
  });

  test("wake-in-middle transcript: assistant indices reflect variable rows-per-turn", () => {
    const transcript: TurnEntry[] = [
      normalTurn("t1", "a", "A"), // rows 0, 1
      wakeTurn("t2", "Wake"), // row 2 (no user row)
      normalTurn("t3", "c", "C"), // rows 3, 4
    ];
    expect(assistantRowIndexForTurn(0, transcript)).toBe(1);
    expect(assistantRowIndexForTurn(1, transcript)).toBe(2);
    expect(assistantRowIndexForTurn(2, transcript)).toBe(4);
    // Callers gate on `turn.messages[0]?.kind === "user_message"`
    // before calling userRowIndexForTurn; the helper itself doesn't
    // know the turn kind.
    expect(userRowIndexForTurn(0, transcript)).toBe(0);
    expect(userRowIndexForTurn(2, transcript)).toBe(3);
  });
});
