/**
 * Pinning tests for `mergeTurnTelemetry` + `deriveTurnTelemetry` —
 * the merge contract designed in plan `#step-20-3-3` and implemented
 * as the first task of `#step-20-3-4`. Three cases pinned per the
 * spike record:
 *
 *  (a) Live turn with full telemetry — derived block matches what the
 *      reducer would commit; merge of `(undefined, derived)` returns
 *      that block verbatim.
 *  (b) Replayed turn with persisted record — inline payload arrives
 *      on the wire event; merge of `(inline, derived)` returns
 *      `inline` (the inline source IS the same payload the live path
 *      computed last time, persisted via SessionLedger).
 *  (c) Replayed turn with NO persisted record — wire event carries
 *      `telemetry: undefined`; merge falls back to `derived` (which
 *      reads zeros for cost + timing on the replay path since no
 *      `cost_update` was issued and the reducer's clock anchors
 *      weren't populated — correct behavior, no crash, no fabricated
 *      value).
 */

import { describe, expect, it } from "bun:test";

import type { CodeSessionState } from "@/lib/code-session-store/reducer";
import {
  deriveTurnTelemetry,
  mergeTurnTelemetry,
  type TurnTelemetry,
} from "@/lib/code-session-store/telemetry";

/**
 * Minimal `CodeSessionState` stub that satisfies the fields
 * `deriveTurnTelemetry` reads. Other fields are left undefined and
 * cast through — the helper doesn't read them. Pattern matches the
 * existing telemetry.test.ts shape.
 */
function fakeStateForDerive(overrides: Partial<CodeSessionState> = {}): CodeSessionState {
  return {
    awaitingApprovalSince: null,
    awaitingApprovalAccumulatedMs: 0,
    transportNonOnlineSince: null,
    transportDowntimeAccumulatedMs: 0,
    firstAssistantDeltaAt: null,
    firstToolUseAt: null,
    transportReconnectCount: 0,
    maxStreamGapMs: 0,
    costAtSubmit: null,
    lastCost: null,
    ...overrides,
  } as unknown as CodeSessionState;
}

const ZERO_TELEMETRY: TurnTelemetry = {
  cost: {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalCostUsd: 0,
  },
  wallClockMs: 0,
  awaitingApprovalMs: 0,
  transportDowntimeMs: 0,
  activeMs: 0,
  ttftMs: null,
  ttftcMs: null,
  reconnectCount: 0,
  maxStreamGapMs: 0,
};

describe("deriveTurnTelemetry", () => {
  it("derives a fully-populated block from live reducer state", () => {
    const state = fakeStateForDerive({
      awaitingApprovalSince: null,
      awaitingApprovalAccumulatedMs: 1_000,
      transportNonOnlineSince: null,
      transportDowntimeAccumulatedMs: 500,
      firstAssistantDeltaAt: 1_100,
      firstToolUseAt: 1_300,
      transportReconnectCount: 2,
      maxStreamGapMs: 250,
      costAtSubmit: null,
      lastCost: {
        totalCostUsd: 0.05,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20,
        },
        modelUsage: null,
        numTurns: 1,
        durationMs: 1_000,
        durationApiMs: 800,
      },
    });
    const submitAt = 1_000;
    const endedAt = 5_000;
    const block = deriveTurnTelemetry(state, submitAt, endedAt);
    expect(block).toEqual({
      cost: {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 20,
        totalCostUsd: 0.05,
      },
      wallClockMs: 4_000,
      awaitingApprovalMs: 1_000,
      transportDowntimeMs: 500,
      activeMs: 2_500,
      ttftMs: 100,
      ttftcMs: 300,
      reconnectCount: 2,
      maxStreamGapMs: 250,
    });
  });

  it("derives zeros on replay-shaped state (no cost_update, no clock anchors)", () => {
    const state = fakeStateForDerive();
    const submitAt = 1_000;
    const endedAt = 1_000;
    const block = deriveTurnTelemetry(state, submitAt, endedAt);
    expect(block).toEqual(ZERO_TELEMETRY);
  });

  it("preserves in-flight awaiting-approval interval across turn end", () => {
    const state = fakeStateForDerive({
      awaitingApprovalSince: 2_000,
      awaitingApprovalAccumulatedMs: 0,
    });
    const block = deriveTurnTelemetry(state, 1_000, 5_000);
    expect(block.awaitingApprovalMs).toBe(3_000);
  });

  it("preserves in-flight transport-downtime interval across turn end", () => {
    const state = fakeStateForDerive({
      transportNonOnlineSince: 3_000,
      transportDowntimeAccumulatedMs: 100,
    });
    const block = deriveTurnTelemetry(state, 1_000, 5_000);
    expect(block.transportDowntimeMs).toBe(2_100);
  });

  it("returns null ttft when no assistant delta was observed", () => {
    const state = fakeStateForDerive({ firstAssistantDeltaAt: null });
    expect(deriveTurnTelemetry(state, 1_000, 5_000).ttftMs).toBeNull();
  });

  it("returns null ttftc when no tool_use was observed", () => {
    const state = fakeStateForDerive({ firstToolUseAt: null });
    expect(deriveTurnTelemetry(state, 1_000, 5_000).ttftcMs).toBeNull();
  });
});

describe("mergeTurnTelemetry", () => {
  const inlinePayload: TurnTelemetry = {
    cost: {
      inputTokens: 999,
      outputTokens: 888,
      cacheCreationInputTokens: 77,
      cacheReadInputTokens: 66,
      totalCostUsd: 0.12345,
    },
    wallClockMs: 12_345,
    awaitingApprovalMs: 1_234,
    transportDowntimeMs: 234,
    activeMs: 10_877,
    ttftMs: 250,
    ttftcMs: 600,
    reconnectCount: 1,
    maxStreamGapMs: 99,
  };

  const derivedPayload: TurnTelemetry = {
    cost: {
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 4,
      totalCostUsd: 0.01,
    },
    wallClockMs: 100,
    awaitingApprovalMs: 0,
    transportDowntimeMs: 0,
    activeMs: 100,
    ttftMs: null,
    ttftcMs: null,
    reconnectCount: 0,
    maxStreamGapMs: 0,
  };

  it("(case a — live) returns derived block when inline is undefined", () => {
    expect(mergeTurnTelemetry(undefined, derivedPayload)).toBe(derivedPayload);
  });

  it("(case b — replay with persisted) returns inline block verbatim", () => {
    expect(mergeTurnTelemetry(inlinePayload, derivedPayload)).toBe(
      inlinePayload,
    );
  });

  it("(case c — replay without persisted) returns derived block when wire omits telemetry", () => {
    // Replay path that arrives without a persisted row: derived
    // produces zeros (no cost_update, no clock anchors); merge falls
    // back to derived; the result is correct-by-construction
    // (zero telemetry rather than a fabricated value or a crash).
    expect(mergeTurnTelemetry(undefined, ZERO_TELEMETRY)).toBe(ZERO_TELEMETRY);
  });

  it("inline wins even when derived has nonzero values (replay-overlapping-live edge)", () => {
    // Defends against a future code path that might race derived and
    // inline against each other: the wire shape is authoritative when
    // present. The supervisor's persisted row was written by the live
    // reducer during the original turn, so trusting it over a fresh
    // derive on replay is the right call.
    expect(mergeTurnTelemetry(inlinePayload, derivedPayload).cost.totalCostUsd).toBe(
      0.12345,
    );
  });
});
