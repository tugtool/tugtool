/**
 * Pure-logic tests for the Z1 asst-half end-state helpers. Pins the
 * turnEndReason -> (text, role) mapping and the corrected token model:
 * `turnWindowTokens` (resident window from the last tool-loop
 * iteration), `perTurnTokens` (signed window delta), and
 * `deriveContextWindows` (the transcript window-walk with zero-usage
 * carry-forward).
 *
 * The window numbers are pinned against captured session `7635e374`:
 * a real "local diffs" session whose four turns walk
 *   sessionInit 18575 -> window 19354 / 21852 / 21971 / 59196
 *   perTurn      +779 / +2498 / +119 / +37225
 * (the same numbers in the Sub-step J spec). Before the fix the
 * fourth turn's `result.usage` sum read 188.8K; the model reads the
 * honest 37.2K.
 */

import { describe, expect, it } from "bun:test";

import {
  deriveContextWindows,
  endStateBadgeFor,
  perTurnTokens,
  turnWindowTokens,
} from "@/lib/code-session-store/end-state";
import type { TurnCost } from "@/lib/code-session-store/types";

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

/**
 * A `TurnCost` whose `turnWindowTokens` equals `window`. The window
 * helpers read only the sum of the four token fields, so parking the
 * whole window in `cacheReadInputTokens` keeps the fixtures terse —
 * a real turn's window is dominated by cache-read anyway.
 */
function win(window: number): TurnCost {
  return cost({ cacheReadInputTokens: window });
}

describe("turnWindowTokens", () => {
  it("sums every token field — the resident context window", () => {
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

  it("returns 0 for a zero-usage turn", () => {
    expect(turnWindowTokens(cost({}))).toBe(0);
  });
});

describe("perTurnTokens", () => {
  it("signed delta — window(N) minus the prior window", () => {
    // Session 7635e374 turn 2: window 21852, prior window 19354.
    expect(perTurnTokens(win(21852), 19354)).toBe(2498);
  });

  it("first turn — measured against sessionInit", () => {
    // Session 7635e374 turn 1: window 19354, sessionInit 18575.
    expect(perTurnTokens(win(19354), 18575)).toBe(779);
  });

  it("negative when the window shrank — a /compact turn", () => {
    // No clamp: a turn that compacts the context reports the honest
    // negative. The old metric clamped this to 0.
    expect(perTurnTokens(win(60000), 200000)).toBe(-140000);
  });
});

describe("deriveContextWindows", () => {
  it("pins the captured session 7635e374 window walk", () => {
    const steps = deriveContextWindows(
      [win(19354), win(21852), win(21971), win(59196)],
      18575,
    );
    expect(steps.map((s) => s.window)).toEqual([19354, 21852, 21971, 59196]);
    expect(steps.map((s) => s.perTurn)).toEqual([779, 2498, 119, 37225]);
  });

  it("telescopes: sessionInit + Σ perTurn = window(latest)", () => {
    const sessionInit = 18575;
    const steps = deriveContextWindows(
      [win(19354), win(21852), win(21971), win(59196)],
      sessionInit,
    );
    const sum = steps.reduce((acc, s) => acc + s.perTurn, 0);
    expect(sessionInit + sum).toBe(steps[steps.length - 1].window);
  });

  it("a zero-usage turn carries the prior window forward, perTurn 0", () => {
    // Turn 2 is an interrupted/errored turn with an all-zero TurnCost:
    // window(2) = window(1), perTurn(2) = 0. Turn 3 measures against
    // the carried-forward window, not 0.
    const steps = deriveContextWindows(
      [win(19354), cost({}), win(21971)],
      18575,
    );
    expect(steps.map((s) => s.window)).toEqual([19354, 19354, 21971]);
    expect(steps.map((s) => s.perTurn)).toEqual([779, 0, 2617]);
  });

  it("a /compact turn reports a negative perTurn; the identity still holds", () => {
    const sessionInit = 18575;
    const steps = deriveContextWindows(
      [win(200000), win(60000), win(65000)],
      sessionInit,
    );
    expect(steps.map((s) => s.window)).toEqual([200000, 60000, 65000]);
    expect(steps.map((s) => s.perTurn)).toEqual([181425, -140000, 5000]);
    const sum = steps.reduce((acc, s) => acc + s.perTurn, 0);
    expect(sessionInit + sum).toBe(65000);
  });

  it("an empty transcript yields no steps", () => {
    expect(deriveContextWindows([], 18575)).toEqual([]);
  });
});
