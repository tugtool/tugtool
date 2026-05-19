/**
 * Pure-logic tests for the Z1 asst-half end-state helpers. Pins
 * the turnEndReason → (text, role) mapping and the
 * `totalTokensForTurn` summation.
 */

import { describe, expect, it } from "bun:test";

import {
  endStateBadgeFor,
  totalTokensForTurn,
} from "@/lib/code-session-store/end-state";
import type { TurnCost } from "@/lib/code-session-store/types";

describe("endStateBadgeFor", () => {
  it("maps complete → success (OK)", () => {
    expect(endStateBadgeFor("complete")).toEqual({
      text: "OK",
      role: "success",
    });
  });

  it("maps interrupted → caution (interrupted)", () => {
    // Caution, not danger: the user initiated the stop.
    expect(endStateBadgeFor("interrupted")).toEqual({
      text: "interrupted",
      role: "caution",
    });
  });

  it("maps error → danger (errored)", () => {
    expect(endStateBadgeFor("error")).toEqual({
      text: "errored",
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

describe("totalTokensForTurn", () => {
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

  it("sums every numeric field on TurnCost", () => {
    expect(
      totalTokensForTurn(
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
    expect(totalTokensForTurn(cost({}))).toBe(0);
  });

  it("handles a turn with only output tokens", () => {
    expect(totalTokensForTurn(cost({ outputTokens: 42 }))).toBe(42);
  });

  it("handles a turn with only cache fields populated", () => {
    expect(
      totalTokensForTurn(
        cost({ cacheReadInputTokens: 50, cacheCreationInputTokens: 50 }),
      ),
    ).toBe(100);
  });
});
