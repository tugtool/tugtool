/**
 * Pure-logic tests for the Z1 asst-half end-state helpers. Pins
 * the turnEndReason → (text, role) mapping, `turnWindowTokens`, and
 * the per-turn `perTurnTokens` window-delta contract.
 */

import { describe, expect, it } from "bun:test";

import {
  endStateBadgeFor,
  perTurnTokens,
  rollupLiveTurnUsage,
  turnWindowTokens,
} from "@/lib/code-session-store/end-state";
import type {
  LiveMessageUsage,
  LiveTurnUsage,
  TurnCost,
} from "@/lib/code-session-store/types";

describe("endStateBadgeFor", () => {
  it("maps complete → inherit (OK)", () => {
    // Inherit, not success: in a transcript of many committed
    // rows the green "OK" dots stack into a vertical column
    // that draws attention away from message content. The OK
    // badge should blend into the row's text colour; the
    // coloured tones are reserved for actionable outcomes.
    expect(endStateBadgeFor("complete")).toEqual({
      text: "OK",
      role: "inherit",
    });
  });

  it("maps interrupted → caution (interrupted)", () => {
    // Caution, not danger: the user initiated the stop.
    expect(endStateBadgeFor("interrupted")).toEqual({
      text: "interrupted",
      role: "caution",
    });
  });

  it("maps error → danger (error)", () => {
    expect(endStateBadgeFor("error")).toEqual({
      text: "error",
      role: "danger",
    });
  });

  it("maps transport_lost → caution (lost)", () => {
    // Caution, not danger: the wire-loss path is recoverable —
    // reconnect can deliver the outstanding output.
    expect(endStateBadgeFor("transport_lost")).toEqual({
      text: "lost",
      role: "caution",
    });
  });
});

function cost(overrides: Partial<TurnCost>): TurnCost {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalCostUsd: 0,
    ...overrides,
  };
}

describe("turnWindowTokens", () => {
  it("sums every token field — the context-window total at this turn", () => {
    expect(
      turnWindowTokens(
        cost({
          inputTokens: 100,
          outputTokens: 200,
          cacheCreationInputTokens: 300,
          cacheReadInputTokens: 400,
        }),
      ),
    ).toBe(1000);
  });

  it("returns 0 for a zero-cost turn", () => {
    expect(turnWindowTokens(cost({}))).toBe(0);
  });
});

describe("perTurnTokens", () => {
  // Real captured per-turn usages from a live session.
  const t1 = cost({
    inputTokens: 2940,
    cacheReadInputTokens: 9824,
    cacheCreationInputTokens: 5245,
    outputTokens: 188,
  }); // window = 18197, observedInput = 18009
  const t2 = cost({
    inputTokens: 4,
    cacheReadInputTokens: 33281,
    cacheCreationInputTokens: 9901,
    outputTokens: 408,
  }); // window = 43594
  const t3 = cost({
    inputTokens: 4,
    cacheReadInputTokens: 50200,
    cacheCreationInputTokens: 402,
    outputTokens: 161,
  }); // window = 50767

  it("first turn (no prior turn): delta degenerates to this turn's output", () => {
    // prevWindow = observed input (input + cache_read + cache_creation);
    // window − prevWindow = output. The session-init bootstrap lives in
    // cache_read / cache_creation and is excluded — never charged to
    // turn 1.
    expect(perTurnTokens(t1, undefined)).toBe(188);
  });

  it("subsequent turn: delta is window(turn) − window(prevTurn)", () => {
    expect(perTurnTokens(t2, t1)).toBe(43594 - 18197);
    expect(perTurnTokens(t3, t2)).toBe(50767 - 43594);
  });

  it("clamps to 0 when the window shrank (e.g. prompt-cache eviction)", () => {
    const big = cost({ cacheReadInputTokens: 50000 });
    const small = cost({ cacheReadInputTokens: 10000 });
    expect(perTurnTokens(small, big)).toBe(0);
  });

  it("session-init + Σ perTurnTokens telescopes to the final window", () => {
    const sessionInit =
      t1.inputTokens + t1.cacheReadInputTokens + t1.cacheCreationInputTokens;
    const sum =
      perTurnTokens(t1, undefined) +
      perTurnTokens(t2, t1) +
      perTurnTokens(t3, t2);
    expect(sessionInit + sum).toBe(turnWindowTokens(t3));
  });
});

describe("rollupLiveTurnUsage", () => {
  function msg(overrides: Partial<LiveMessageUsage>): LiveMessageUsage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      ...overrides,
    };
  }

  it("an empty byMessage map rolls up to all zeros", () => {
    const live: LiveTurnUsage = { byMessage: {} };
    expect(rollupLiveTurnUsage(live)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalCostUsd: 0,
    });
  });

  it("a single message rolls up to that message's token counts", () => {
    const live: LiveTurnUsage = {
      byMessage: {
        msg_a: msg({
          inputTokens: 3,
          outputTokens: 80,
          cacheCreationInputTokens: 7340,
          cacheReadInputTokens: 13148,
        }),
      },
    };
    expect(rollupLiveTurnUsage(live)).toEqual({
      inputTokens: 3,
      outputTokens: 80,
      cacheCreationInputTokens: 7340,
      cacheReadInputTokens: 13148,
      totalCostUsd: 0,
    });
  });

  it("sums every token field across a multi-message tool-loop turn", () => {
    // Real captured wire data: two assistant messages whose per-message
    // usages sum to the turn's result.usage.
    const live: LiveTurnUsage = {
      byMessage: {
        msg_a: msg({
          inputTokens: 3,
          outputTokens: 80,
          cacheCreationInputTokens: 7340,
          cacheReadInputTokens: 13148,
        }),
        msg_b: msg({
          inputTokens: 1,
          outputTokens: 12,
          cacheCreationInputTokens: 99,
          cacheReadInputTokens: 20488,
        }),
      },
    };
    expect(rollupLiveTurnUsage(live)).toEqual({
      inputTokens: 4,
      outputTokens: 92,
      cacheCreationInputTokens: 7439,
      cacheReadInputTokens: 33636,
      totalCostUsd: 0,
    });
  });

  it("the rollup carries no dollar cost — dollars land only at cost_update", () => {
    const live: LiveTurnUsage = {
      byMessage: { msg_a: msg({ outputTokens: 50 }) },
    };
    expect(rollupLiveTurnUsage(live).totalCostUsd).toBe(0);
  });
});
