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
  computeTimeSummary,
  computeTokensSummary,
  computeRichContextBreakdown,
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
    messages: [],
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

  it("token fields pass through raw — `usage` is per-turn, not subtracted", () => {
    // `cost_update.usage` reports each turn's own usage; the four
    // token fields are taken straight from `after`, never differenced
    // against `before`. Only `totalCostUsd` is cumulative.
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
    const cost = extractTurnCost(before, after);
    expect(cost.inputTokens).toBe(4);
    expect(cost.outputTokens).toBe(180);
    expect(cost.cacheCreationInputTokens).toBe(6_349);
    expect(cost.cacheReadInputTokens).toBe(31_204);
    // `total_cost_usd` IS cumulative — it alone is differenced.
    expect(cost.totalCostUsd).toBeCloseTo(0.06 - 0.045);
  });

  it("a short turn after a long one keeps its real (small) token counts", () => {
    // Regression pin: the old `after - before` subtraction clamped a
    // short reply following a long turn to zero tokens. Token fields
    // are now raw, so the short turn reports its true usage.
    const longTurn = costSnap({
      totalCostUsd: 0.146,
      usage: {
        input_tokens: 4,
        output_tokens: 408,
        cache_creation_input_tokens: 9_901,
        cache_read_input_tokens: 33_281,
      },
    });
    const shortTurn = costSnap({
      totalCostUsd: 0.178,
      usage: {
        input_tokens: 4,
        output_tokens: 161,
        cache_creation_input_tokens: 402,
        cache_read_input_tokens: 50_200,
      },
    });
    const cost = extractTurnCost(longTurn, shortTurn);
    expect(cost.inputTokens).toBe(4);
    expect(cost.outputTokens).toBe(161);
    expect(cost.cacheCreationInputTokens).toBe(402);
    expect(cost.cacheReadInputTokens).toBe(50_200);
  });

  it("clamps totalCostUsd when cumulative cost goes non-monotonic", () => {
    const before = costSnap({ totalCostUsd: 1.0, usage: {} });
    const after = costSnap({ totalCostUsd: 0.5, usage: {} });
    expect(extractTurnCost(before, after).totalCostUsd).toBe(0);
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
      pendingTurn: {
        turnKey: "k",
        submitAt: 1_000_000,
        isWake: false,
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
      pendingTurn: {
        turnKey: "k",
        submitAt: 1_000_000,
        isWake: false,
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
      queuedSends: [],
      transcript: [],
      rewindPreviews: new Map(),
      lastRewindResult: null,
      activeTurn: null,
      pendingDraftRestore: null,
      lastCost: null,
      apiRetry: null,
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
      interruptInFlightSegmentStartedAt: null,
      wakeTrigger: null,
      ...overrides,
    };
  }

  function inflight(submitAt: number): CodeSessionSnapshot["activeTurn"] {
    return { turnKey: "k", submitAt, isWake: false, messages: [] };
  }

  it("returns null when no turn is in flight", () => {
    expect(deriveInflightActiveMs(snap(), 1_002_000)).toBeNull();
  });

  it("returns wall-clock since submit when no pause segments exist", () => {
    const s = snap({ activeTurn: inflight(1_000_000) });
    expect(deriveInflightActiveMs(s, 1_001_500)).toBe(1_500);
  });

  it("returns 0 when now == submitAt (degenerate window)", () => {
    const s = snap({ activeTurn: inflight(1_000_000) });
    expect(deriveInflightActiveMs(s, 1_000_000)).toBe(0);
  });

  it("returns 0 when now < submitAt (clock skew)", () => {
    const s = snap({ activeTurn: inflight(1_000_000) });
    expect(deriveInflightActiveMs(s, 999_000)).toBe(0);
  });

  it("subtracts a single open awaiting-approval segment", () => {
    const s = snap({
      activeTurn: inflight(1_000_000),
      awaitingApprovalSegmentStartedAt: 1_000_300,
    });
    // wall = 1_000, open pause = (now - 1_000_300) = 700, active = 300
    expect(deriveInflightActiveMs(s, 1_001_000)).toBe(300);
  });

  it("subtracts a closed transport-downtime interval", () => {
    const s = snap({
      activeTurn: inflight(1_000_000),
      transportDowntimeIntervals: [[1_000_200, 1_000_500]],
    });
    // wall = 1_000, pause = 300, active = 700
    expect(deriveInflightActiveMs(s, 1_001_000)).toBe(700);
  });

  it("unions two yellow axes overlapping (NOT sum) — the regression this design guards", () => {
    const s = snap({
      activeTurn: inflight(1_000_000),
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
      activeTurn: inflight(1_000_000),
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
      activeTurn: inflight(1_000_000),
      // Pause covers more than wall-clock (clipped to window).
      awaitingApprovalIntervals: [[500_000, 2_000_000]],
    });
    expect(deriveInflightActiveMs(s, 1_001_000)).toBe(0);
  });

  it("clips a pause segment that began before submitAt to the in-flight window", () => {
    const s = snap({
      activeTurn: inflight(1_000_000),
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
      queuedSends: [],
      transcript: [],
      rewindPreviews: new Map(),
      lastRewindResult: null,
      activeTurn: null,
      pendingDraftRestore: null,
      lastCost: null,
      apiRetry: null,
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
      interruptInFlightSegmentStartedAt: null,
      wakeTrigger: null,
      ...overrides,
    };
  }
  function inflight(submitAt: number): CodeSessionSnapshot["activeTurn"] {
    return { turnKey: "k", submitAt, isWake: false, messages: [] };
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
    const s = snap({ activeTurn: inflight(1_000_000) });
    // No pause segments, wall = 1_500. Live derivation wins over fallback.
    expect(deriveTimeCellMs(s, 1_001_500, 999_999)).toBe(1_500);
  });

  it("subtracts overlapping yellow axes (NOT scalar sum) when in flight", () => {
    const s = snap({
      activeTurn: inflight(1_000_000),
      awaitingApprovalIntervals: [[1_000_200, 1_000_600]],
      transportDowntimeIntervals: [[1_000_400, 1_000_800]],
    });
    // Union [200, 800] = 600; wall = 1_000; active = 400.
    expect(deriveTimeCellMs(s, 1_001_000, 999_999)).toBe(400);
  });

  it("uses the fallback the moment the snapshot's in-flight slot clears (turn-complete freeze)", () => {
    // Simulate a freshly-committed turn: snapshot's activeTurn
    // is null, and the caller passes the just-committed activeMs as
    // the fallback. The cell should freeze at that committed value
    // rather than ticking back to 0 or any other transient state.
    expect(deriveTimeCellMs(snap(), 1_001_000, 7_777)).toBe(7_777);
  });
});

describe("computeTimeSummary", () => {
  it("returns zeros for an empty transcript", () => {
    expect(computeTimeSummary([])).toEqual({
      count: 0,
      totalActiveMs: 0,
      avgActiveMs: 0,
    });
  });

  it("returns the single turn's activeMs as both total and average", () => {
    const result = computeTimeSummary([turn({ activeMs: 4_200 })]);
    expect(result).toEqual({
      count: 1,
      totalActiveMs: 4_200,
      avgActiveMs: 4_200,
    });
  });

  it("sums and averages across multiple committed turns", () => {
    const transcript = [
      turn({ activeMs: 1_000 }),
      turn({ activeMs: 3_000 }),
      turn({ activeMs: 5_000 }),
    ];
    expect(computeTimeSummary(transcript)).toEqual({
      count: 3,
      totalActiveMs: 9_000,
      avgActiveMs: 3_000,
    });
  });

  it("rounds the average to the nearest ms", () => {
    const transcript = [
      turn({ activeMs: 1_000 }),
      turn({ activeMs: 1_001 }),
      turn({ activeMs: 1_001 }),
    ];
    // total = 3_002, count = 3, avg = 1000.6667 → round → 1001
    expect(computeTimeSummary(transcript).avgActiveMs).toBe(1_001);
  });

  it("includes interrupted turns in the sum and count", () => {
    // The summary reflects all committed turns regardless of terminal
    // reason — interrupted turns are still committed transcript rows
    // and their accumulated activeMs is part of the session's total.
    const transcript = [
      turn({ activeMs: 2_000, result: "success" }),
      turn({ activeMs: 500, result: "interrupted" }),
    ];
    expect(computeTimeSummary(transcript)).toEqual({
      count: 2,
      totalActiveMs: 2_500,
      avgActiveMs: 1_250,
    });
  });
});

describe("computeTokensSummary", () => {
  // A turn whose `turnWindowTokens` (sum of the four cost fields)
  // equals `n` — the whole window parked in cache-read keeps the
  // fixture terse, the way a real turn's window is cache-dominated.
  function win(n: number) {
    return turn({
      cost: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: n,
        totalCostUsd: 0,
      },
    });
  }

  it("returns zeros for an empty transcript", () => {
    expect(computeTokensSummary([], 18_575)).toEqual({
      count: 0,
      perTurn: [],
      totalTokens: 0,
      avgTokensPerTurn: 0,
    });
  });

  it("each turn's figure is its signed perTurn window delta", () => {
    // Captured session 7635e374: windows 19354 / 21852 / 21971 /
    // 59196 against sessionInit 18575 → perTurn 779 / 2498 / 119 /
    // 37225 (the same numbers Z1B shows).
    const r = computeTokensSummary(
      [win(19_354), win(21_852), win(21_971), win(59_196)],
      18_575,
    );
    expect(r.count).toBe(4);
    expect(r.perTurn).toEqual([779, 2_498, 119, 37_225]);
    // totalTokens telescopes to window(latest) − sessionInit.
    expect(r.totalTokens).toBe(59_196 - 18_575);
    // avg = 40621 / 4 = 10155.25 → round → 10155.
    expect(r.avgTokensPerTurn).toBe(10_155);
  });

  it("a /compact turn contributes an honest negative perTurn", () => {
    const r = computeTokensSummary([win(200_000), win(60_000)], 18_575);
    expect(r.perTurn).toEqual([181_425, -140_000]);
    // The sum still telescopes: 60000 − 18575.
    expect(r.totalTokens).toBe(60_000 - 18_575);
  });

  it("a null sessionInit walks from a zero bootstrap", () => {
    const r = computeTokensSummary([win(1_000), win(3_000)], null);
    expect(r.perTurn).toEqual([1_000, 2_000]);
    expect(r.totalTokens).toBe(3_000);
  });
});

describe("computeRichContextBreakdown", () => {
  const CONTEXT_MAX = 1_000_000;

  // tugcode's static estimate: the five categories, summing to 15_500.
  const staticBreakdown = {
    contextMax: CONTEXT_MAX,
    categories: [
      { id: "system_prompt", label: "System prompt", tokens: 3_500 } as const,
      { id: "system_tools", label: "System tools", tokens: 7_300 } as const,
      { id: "custom_agents", label: "Custom agents", tokens: 800 } as const,
      { id: "memory_files", label: "Memory files", tokens: 2_600 } as const,
      { id: "skills", label: "Skills", tokens: 1_300 } as const,
    ],
  };
  const RAW_STATIC_TOTAL = 15_500;

  it("returns null when no context_breakdown frame has landed", () => {
    expect(
      computeRichContextBreakdown({
        staticBreakdown: null,
        sessionInitTokens: 18_575,
        windowTokens: 27_927,
        contextMax: CONTEXT_MAX,
      }),
    ).toBeNull();
  });

  it("messages is feed-exact: window − sessionInit; totalUsed = window", () => {
    const r = computeRichContextBreakdown({
      staticBreakdown,
      sessionInitTokens: 18_575,
      windowTokens: 27_927,
      contextMax: CONTEXT_MAX,
    })!;
    expect(r).not.toBeNull();
    const messages = r.segments.find((s) => s.id === "messages")!;
    expect(messages.value).toBe(27_927 - 18_575);
    // totalUsed equals the window — identical to the CONTEXT cell.
    expect(r.totalUsed).toBe(27_927);
  });

  it("scales the five static categories to sum exactly to sessionInit", () => {
    const r = computeRichContextBreakdown({
      staticBreakdown,
      sessionInitTokens: 18_575,
      windowTokens: 27_927,
      contextMax: CONTEXT_MAX,
    })!;
    const staticIds = [
      "system_prompt",
      "system_tools",
      "custom_agents",
      "memory_files",
      "skills",
    ];
    const staticSum = r.segments
      .filter((s) => staticIds.includes(s.id))
      .reduce((acc, s) => acc + s.value, 0);
    // The scaled split sums EXACTLY to the feed-exact bootstrap.
    expect(staticSum).toBe(18_575);
  });

  it("segments run statics → messages → remainder; the arc fills contextMax", () => {
    const r = computeRichContextBreakdown({
      staticBreakdown,
      sessionInitTokens: 18_575,
      windowTokens: 27_927,
      contextMax: CONTEXT_MAX,
    })!;
    expect(r.segments.map((s) => s.id)).toEqual([
      "system_prompt",
      "system_tools",
      "custom_agents",
      "memory_files",
      "skills",
      "messages",
      "remainder",
    ]);
    const arcSum = r.segments.reduce((acc, s) => acc + s.value, 0);
    expect(arcSum).toBe(CONTEXT_MAX);
    const remainder = r.segments[r.segments.length - 1];
    expect(remainder.value).toBe(CONTEXT_MAX - 27_927);
  });

  it("pre-turn-1: no sessionInit, no window — bootstrap is the raw estimate", () => {
    // The session-open case: before turn 1 the feed has nothing, so
    // the cell shows tugcode's static-estimate total and messages = 0.
    const r = computeRichContextBreakdown({
      staticBreakdown,
      sessionInitTokens: null,
      windowTokens: null,
      contextMax: CONTEXT_MAX,
    })!;
    expect(r.totalUsed).toBe(RAW_STATIC_TOTAL);
    expect(r.segments.find((s) => s.id === "messages")!.value).toBe(0);
    const staticSum = r.segments
      .filter((s) => s.id !== "messages" && s.id !== "remainder")
      .reduce((acc, s) => acc + s.value, 0);
    expect(staticSum).toBe(RAW_STATIC_TOTAL);
  });

  it("autocompact_buffer is a reserved segment, NOT part of totalUsed", () => {
    const withBuffer = {
      contextMax: CONTEXT_MAX,
      categories: [
        ...staticBreakdown.categories,
        {
          id: "autocompact_buffer",
          label: "Autocompact buffer",
          tokens: 33_000,
        } as const,
      ],
    };
    const r = computeRichContextBreakdown({
      staticBreakdown: withBuffer,
      sessionInitTokens: 18_575,
      windowTokens: 27_927,
      contextMax: CONTEXT_MAX,
    })!;
    // totalUsed is bootstrap + messages — the reserved buffer is NOT
    // counted (it is reserved headroom, not occupied content).
    expect(r.totalUsed).toBe(27_927);
    const buffer = r.segments.find((s) => s.id === "autocompact_buffer")!;
    expect(buffer.value).toBe(33_000);
    // remainder = contextMax − totalUsed − reservedBuffer.
    const remainder = r.segments[r.segments.length - 1];
    expect(remainder.value).toBe(CONTEXT_MAX - 27_927 - 33_000);
    // The arc still fills exactly to contextMax.
    expect(r.segments.reduce((acc, s) => acc + s.value, 0)).toBe(CONTEXT_MAX);
  });

  it("messages clamps to 0 when the window has not yet exceeded the bootstrap", () => {
    const r = computeRichContextBreakdown({
      staticBreakdown,
      sessionInitTokens: 18_575,
      windowTokens: 18_575,
      contextMax: CONTEXT_MAX,
    })!;
    expect(r.segments.find((s) => s.id === "messages")!.value).toBe(0);
    expect(r.totalUsed).toBe(18_575);
  });

  it("clamps a negative contextMax to 0; remainder clamps to 0", () => {
    const r = computeRichContextBreakdown({
      staticBreakdown,
      sessionInitTokens: 18_575,
      windowTokens: 27_927,
      contextMax: -1,
    })!;
    expect(r.contextMax).toBe(0);
    expect(r.segments[r.segments.length - 1].value).toBe(0);
  });
});
