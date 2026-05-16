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
} from "@/lib/code-session-store/telemetry";
import {
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type {
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
