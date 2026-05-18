/**
 * Pure-logic tests for `telemetry.ts` — `perTurnContextSize`,
 * `extractTurnCost`, `deriveSessionTotals`, and the `liveTurn*`
 * family. No reducer, no React.
 */

import { describe, it, expect } from "bun:test";

import {
  perTurnContextSize,
  extractTurnCost,
  deriveSessionTotals,
  liveTurnWallClockMs,
  liveTurnAwaitingApprovalMs,
  liveTurnTransportDowntimeMs,
  liveTurnActiveMs,
  unionPauseMs,
  deriveInflightActiveMs,
  deriveTimeCellMs,
  type PauseSegment,
} from "@/lib/code-session-store/telemetry";
import {
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type {
  CodeSessionSnapshot,
  CostSnapshot,
  TurnEntry,
} from "@/lib/code-session-store/types";
import { TURN_ENTRY_TELEMETRY_DEFAULTS } from "@/lib/code-session-store/testing/turn-entry-defaults";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

function fresh(): CodeSessionState {
  return createInitialState(FIXTURE_IDS.TUG_SESSION_ID, "test", "new");
}

function turn(overrides: Partial<TurnEntry>): TurnEntry {
  return {
    turnKey: "k",
    msgId: "m",
    userMessage: { text: "", attachments: [], submitAt: 0 },
    thinking: "",
    assistant: "",
    toolCalls: [],
    controlRequests: [],
    result: "success",
    endedAt: 0,
    ...TURN_ENTRY_TELEMETRY_DEFAULTS,
    ...overrides,
  };
}

function costSnap(overrides: Partial<CostSnapshot> = {}): CostSnapshot {
  return {
    totalCostUsd: 0,
    numTurns: null,
    durationMs: null,
    durationApiMs: null,
    usage: null,
    modelUsage: null,
    ...overrides,
  };
}

describe("telemetry — perTurnContextSize", () => {
  it("sums input + cache_read + cache_creation (NOT output)", () => {
    const t = turn({
      cost: {
        inputTokens: 100,
        outputTokens: 5_000,
        cacheReadInputTokens: 12_000,
        cacheCreationInputTokens: 6_000,
        totalCostUsd: 0,
      },
    });
    expect(perTurnContextSize(t)).toBe(18_100);
  });
});

describe("telemetry — extractTurnCost", () => {
  it("returns zeros when `after` is null", () => {
    expect(extractTurnCost(null, null)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalCostUsd: 0,
    });
  });

  it("returns `after` directly when `before` is null", () => {
    const after = costSnap({
      totalCostUsd: 0.05,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40,
      },
    });
    expect(extractTurnCost(null, after)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationInputTokens: 30,
      cacheReadInputTokens: 40,
      totalCostUsd: 0.05,
    });
  });

  it("computes `after - before` for cumulative shape", () => {
    const before = costSnap({
      totalCostUsd: 0.045,
      usage: {
        input_tokens: 3,
        output_tokens: 10,
        cache_creation_input_tokens: 6_180,
        cache_read_input_tokens: 12_507,
      },
    });
    const after = costSnap({
      totalCostUsd: 0.06,
      usage: {
        input_tokens: 4,
        output_tokens: 180,
        cache_creation_input_tokens: 6_349,
        cache_read_input_tokens: 31_204,
      },
    });
    expect(extractTurnCost(before, after)).toEqual({
      inputTokens: 1,
      outputTokens: 170,
      cacheCreationInputTokens: 169,
      cacheReadInputTokens: 18_697,
      totalCostUsd: expect.any(Number),
    });
    expect(extractTurnCost(before, after).totalCostUsd).toBeCloseTo(0.015);
  });

  it("clamps non-monotonic deltas to zero", () => {
    const before = costSnap({
      totalCostUsd: 1.0,
      usage: {
        input_tokens: 100,
        output_tokens: 100,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 100,
      },
    });
    const after = costSnap({
      totalCostUsd: 0.5,
      usage: {
        input_tokens: 50,
        output_tokens: 200,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    });
    const delta = extractTurnCost(before, after);
    expect(delta.inputTokens).toBe(0); // 50 - 100 → clamped
    expect(delta.outputTokens).toBe(100); // 200 - 100
    expect(delta.cacheCreationInputTokens).toBe(0);
    expect(delta.cacheReadInputTokens).toBe(0);
    expect(delta.totalCostUsd).toBe(0); // 0.5 - 1.0 → clamped
  });
});

describe("telemetry — deriveSessionTotals", () => {
  it("sums per-turn fields across a multi-turn transcript", () => {
    const transcript: TurnEntry[] = [
      turn({
        wallClockMs: 1000,
        awaitingApprovalMs: 100,
        transportDowntimeMs: 50,
        activeMs: 850,
        cost: {
          inputTokens: 3,
          outputTokens: 10,
          cacheReadInputTokens: 20,
          cacheCreationInputTokens: 40,
          totalCostUsd: 0.045,
        },
      }),
      turn({
        wallClockMs: 2000,
        awaitingApprovalMs: 0,
        transportDowntimeMs: 0,
        activeMs: 2000,
        cost: {
          inputTokens: 4,
          outputTokens: 180,
          cacheReadInputTokens: 60,
          cacheCreationInputTokens: 80,
          totalCostUsd: 0.015,
        },
      }),
    ];
    const totals = deriveSessionTotals(transcript);
    expect(totals.totalWallClockMs).toBe(3000);
    expect(totals.totalAwaitingApprovalMs).toBe(100);
    expect(totals.totalTransportDowntimeMs).toBe(50);
    expect(totals.totalActiveMs).toBe(2850);
    expect(totals.totalInputTokens).toBe(7);
    expect(totals.totalOutputTokens).toBe(190);
    expect(totals.totalCacheReadTokens).toBe(80);
    expect(totals.totalCacheCreationTokens).toBe(120);
    expect(totals.totalCostUsd).toBeCloseTo(0.06);
    expect(totals.turnCount).toBe(2);
  });

  it("zero turns produces zero totals", () => {
    const totals = deriveSessionTotals([]);
    expect(totals).toEqual({
      totalWallClockMs: 0,
      totalAwaitingApprovalMs: 0,
      totalTransportDowntimeMs: 0,
      totalActiveMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      totalCostUsd: 0,
      turnCount: 0,
    });
  });
});

describe("telemetry — liveTurn* helpers", () => {
  it("liveTurnWallClockMs returns 0 when no turn is in flight", () => {
    expect(liveTurnWallClockMs(fresh(), 1_000_000)).toBe(0);
  });

  it("liveTurnWallClockMs returns `now - submitAt` when a turn is in flight", () => {
    const state: CodeSessionState = {
      ...fresh(),
      pendingUserMessage: {
        text: "",
        atoms: [],
        submitAt: 1_000_000,
        turnKey: "k",
      },
    };
    expect(liveTurnWallClockMs(state, 1_001_500)).toBe(1_500);
  });

  it("liveTurnAwaitingApprovalMs folds the in-progress interval into the accumulator", () => {
    const state: CodeSessionState = {
      ...fresh(),
      awaitingApprovalAccumulatedMs: 500,
      awaitingApprovalSince: 1_000_000,
    };
    expect(liveTurnAwaitingApprovalMs(state, 1_000_750)).toBe(1_250);
  });

  it("liveTurnTransportDowntimeMs folds the in-progress non-online interval", () => {
    const state: CodeSessionState = {
      ...fresh(),
      transportDowntimeAccumulatedMs: 100,
      transportNonOnlineSince: 1_000_000,
    };
    expect(liveTurnTransportDowntimeMs(state, 1_000_300)).toBe(400);
  });

  it("liveTurnActiveMs = wall - awaiting - downtime, clamped ≥ 0", () => {
    const state: CodeSessionState = {
      ...fresh(),
      pendingUserMessage: {
        text: "",
        atoms: [],
        submitAt: 1_000_000,
        turnKey: "k",
      },
      awaitingApprovalAccumulatedMs: 200,
      awaitingApprovalSince: null,
      transportDowntimeAccumulatedMs: 100,
      transportNonOnlineSince: null,
    };
    // wall = 1000, awaiting = 200, downtime = 100 → active = 700
    expect(liveTurnActiveMs(state, 1_001_000)).toBe(700);
  });
});

// ---------------------------------------------------------------------------
// Overlap-correct live in-flight derivation — `unionPauseMs` +
// `deriveInflightActiveMs`. The headline regression this guards is
// the over-subtraction bug that scalar-sum derivations fall into
// whenever two pause axes overlap.
// ---------------------------------------------------------------------------

describe("unionPauseMs", () => {
  it("returns 0 for zero segments", () => {
    expect(unionPauseMs([], 1_000, 2_000)).toBe(0);
  });

  it("returns 0 for a degenerate window (end <= start)", () => {
    expect(unionPauseMs([[1_500, 1_800]], 2_000, 2_000)).toBe(0);
    expect(unionPauseMs([[1_500, 1_800]], 2_000, 1_900)).toBe(0);
  });

  it("treats an open segment ([start, null]) as ending at the window end", () => {
    const segments: PauseSegment[] = [[1_500, null]];
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(500);
  });

  it("sums two non-overlapping closed segments", () => {
    const segments: PauseSegment[] = [
      [1_100, 1_300],
      [1_500, 1_900],
    ];
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(200 + 400);
  });

  it("unions two overlapping closed segments (NOT their sum)", () => {
    const segments: PauseSegment[] = [
      [1_100, 1_500],
      [1_300, 1_700],
    ];
    // Naive sum would be 400 + 400 = 800. Union is [1_100, 1_700] = 600.
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(600);
  });

  it("unions three segments with pairwise overlap (A∩B, B∩C, A∩C)", () => {
    const segments: PauseSegment[] = [
      [1_100, 1_400], // A
      [1_300, 1_600], // B (overlaps A, overlaps C)
      [1_500, 1_700], // C (overlaps B; does not directly overlap A)
    ];
    // All three merge into [1_100, 1_700] = 600.
    // Naive sum would be 300 + 300 + 200 = 800.
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(600);
  });

  it("merges identical segments into a single contribution", () => {
    const segments: PauseSegment[] = [
      [1_200, 1_500],
      [1_200, 1_500],
    ];
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(300);
  });

  it("merges a segment fully contained within another into the outer", () => {
    const segments: PauseSegment[] = [
      [1_100, 1_900],
      [1_300, 1_500],
    ];
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(800);
  });

  it("clips a segment that starts before the window", () => {
    const segments: PauseSegment[] = [[500, 1_200]];
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(200);
  });

  it("clips a segment that ends after the window", () => {
    const segments: PauseSegment[] = [[1_800, 2_500]];
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(200);
  });

  it("clips a segment that straddles the entire window", () => {
    const segments: PauseSegment[] = [[500, 2_500]];
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(1_000);
  });

  it("drops a segment fully outside the window", () => {
    const segments: PauseSegment[] = [
      [200, 500],
      [2_500, 3_000],
    ];
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(0);
  });

  it("clips an open segment whose start is before the window", () => {
    const segments: PauseSegment[] = [[500, null]];
    expect(unionPauseMs(segments, 1_000, 2_000)).toBe(1_000);
  });
});

describe("deriveInflightActiveMs", () => {
  /**
   * Minimal `CodeSessionSnapshot` builder for the live-derivation
   * helper. Only fields `deriveInflightActiveMs` reads are populated
   * meaningfully; everything else defaults to a quiescent shape that
   * passes the type check.
   */
  function snap(
    overrides: Partial<CodeSessionSnapshot> = {},
  ): CodeSessionSnapshot {
    return {
      phase: "streaming",
      transportState: "online",
      interruptInFlight: false,
      tugSessionId: "tug-1",
      displayLabel: "test",
      sessionMode: "new",
      activeMsgId: "msg",
      canSubmit: false,
      canInterrupt: true,
      pendingApproval: null,
      pendingQuestion: null,
      controlRequestLog: [],
      queuedSends: 0,
      transcript: [],
      inflightUserMessage: null,
      pendingDraftRestore: null,
      lastCost: null,
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
      interruptInFlightSegmentStartedAt: null,
      ...overrides,
    };
  }

  function inflight(submitAt: number): CodeSessionSnapshot["inflightUserMessage"] {
    return { text: "", atoms: [], submitAt, turnKey: "k" };
  }

  it("returns null when no turn is in flight", () => {
    expect(deriveInflightActiveMs(snap(), 1_002_000)).toBeNull();
  });

  it("returns wall-clock since submit when no pause segments exist", () => {
    const s = snap({ inflightUserMessage: inflight(1_000_000) });
    expect(deriveInflightActiveMs(s, 1_001_500)).toBe(1_500);
  });

  it("returns 0 when now == submitAt (degenerate window)", () => {
    const s = snap({ inflightUserMessage: inflight(1_000_000) });
    expect(deriveInflightActiveMs(s, 1_000_000)).toBe(0);
  });

  it("returns 0 when now < submitAt (clock skew)", () => {
    const s = snap({ inflightUserMessage: inflight(1_000_000) });
    expect(deriveInflightActiveMs(s, 999_000)).toBe(0);
  });

  it("subtracts a single open awaiting-approval segment", () => {
    const s = snap({
      inflightUserMessage: inflight(1_000_000),
      awaitingApprovalSegmentStartedAt: 1_000_300,
    });
    // wall = 1_000, open pause = (now - 1_000_300) = 700, active = 300
    expect(deriveInflightActiveMs(s, 1_001_000)).toBe(300);
  });

  it("subtracts a closed transport-downtime interval", () => {
    const s = snap({
      inflightUserMessage: inflight(1_000_000),
      transportDowntimeIntervals: [[1_000_200, 1_000_500]],
    });
    // wall = 1_000, pause = 300, active = 700
    expect(deriveInflightActiveMs(s, 1_001_000)).toBe(700);
  });

  it("unions two yellow axes overlapping (NOT sum) — the regression this design guards", () => {
    const s = snap({
      inflightUserMessage: inflight(1_000_000),
      // Awaiting-approval dialog open [200, 600]
      awaitingApprovalIntervals: [[1_000_200, 1_000_600]],
      // Transport restoring [400, 800] — overlaps awaiting in [400, 600]
      transportDowntimeIntervals: [[1_000_400, 1_000_800]],
    });
    // Naive scalar sum would subtract 400 + 400 = 800 → active = 200.
    // Correct union [200, 800] = 600 → active = 400.
    expect(deriveInflightActiveMs(s, 1_001_000)).toBe(400);
  });

  it("unions all three yellow axes when interrupt-in-flight overlaps both", () => {
    const s = snap({
      inflightUserMessage: inflight(1_000_000),
      awaitingApprovalIntervals: [[1_000_100, 1_000_400]],
      transportDowntimeIntervals: [[1_000_300, 1_000_700]],
      interruptInFlightSegmentStartedAt: 1_000_500,
    });
    // Now = 1_001_000. Open interrupt = [500, 1000]. Awaiting = [100, 400].
    // Transport = [300, 700]. Union = [100, 400] ∪ [300, 1000] = [100, 1000] = 900.
    // active = 1000 - 900 = 100.
    expect(deriveInflightActiveMs(s, 1_001_000)).toBe(100);
  });

  it("clamps to 0 when the union of pauses covers the entire wall-clock", () => {
    const s = snap({
      inflightUserMessage: inflight(1_000_000),
      // Pause covers more than wall-clock (clipped to window).
      awaitingApprovalIntervals: [[500_000, 2_000_000]],
    });
    expect(deriveInflightActiveMs(s, 1_001_000)).toBe(0);
  });

  it("clips a pause segment that began before submitAt to the in-flight window", () => {
    const s = snap({
      inflightUserMessage: inflight(1_000_000),
      // Transport disconnect that began 200 ms before submit, closed 300 ms after.
      transportDowntimeIntervals: [[999_800, 1_000_300]],
    });
    // Window = [1_000_000, 1_001_000]. Clipped interval = [1_000_000, 1_000_300] = 300.
    // active = 1_000 - 300 = 700.
    expect(deriveInflightActiveMs(s, 1_001_000)).toBe(700);
  });
});

describe("deriveTimeCellMs", () => {
  function snap(
    overrides: Partial<CodeSessionSnapshot> = {},
  ): CodeSessionSnapshot {
    return {
      phase: "streaming",
      transportState: "online",
      interruptInFlight: false,
      tugSessionId: "tug-1",
      displayLabel: "test",
      sessionMode: "new",
      activeMsgId: "msg",
      canSubmit: false,
      canInterrupt: true,
      pendingApproval: null,
      pendingQuestion: null,
      controlRequestLog: [],
      queuedSends: 0,
      transcript: [],
      inflightUserMessage: null,
      pendingDraftRestore: null,
      lastCost: null,
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
      interruptInFlightSegmentStartedAt: null,
      ...overrides,
    };
  }
  function inflight(submitAt: number): CodeSessionSnapshot["inflightUserMessage"] {
    return { text: "", atoms: [], submitAt, turnKey: "k" };
  }

  it("falls back to the post-commit value when no turn is in flight", () => {
    // Idle / post-commit: derivation returns null; helper returns the
    // fallback (typically the just-committed TurnEntry.activeMs).
    expect(deriveTimeCellMs(snap(), 1_001_000, 4_200)).toBe(4_200);
  });

  it("returns 0 fallback for a never-submitted card", () => {
    expect(deriveTimeCellMs(snap(), 1_001_000, 0)).toBe(0);
  });

  it("returns the live in-flight active duration when a turn is in flight", () => {
    const s = snap({ inflightUserMessage: inflight(1_000_000) });
    // No pause segments, wall = 1_500. Live derivation wins over fallback.
    expect(deriveTimeCellMs(s, 1_001_500, 999_999)).toBe(1_500);
  });

  it("subtracts overlapping yellow axes (NOT scalar sum) when in flight", () => {
    const s = snap({
      inflightUserMessage: inflight(1_000_000),
      awaitingApprovalIntervals: [[1_000_200, 1_000_600]],
      transportDowntimeIntervals: [[1_000_400, 1_000_800]],
    });
    // Union [200, 800] = 600; wall = 1_000; active = 400.
    expect(deriveTimeCellMs(s, 1_001_000, 999_999)).toBe(400);
  });

  it("uses the fallback the moment the snapshot's in-flight slot clears (turn-complete freeze)", () => {
    // Simulate a freshly-committed turn: snapshot's inflightUserMessage
    // is null, and the caller passes the just-committed activeMs as
    // the fallback. The cell should freeze at that committed value
    // rather than ticking back to 0 or any other transient state.
    expect(deriveTimeCellMs(snap(), 1_001_000, 7_777)).toBe(7_777);
  });
});
