/**
 * Defaults for the per-turn telemetry fields added to `TurnEntry`.
 * Tests that synthesize a `TurnEntry` for downstream rendering /
 * derivation checks spread these to satisfy the type without
 * stating values they don't care about. Tests that DO exercise
 * telemetry behavior override individual fields directly.
 *
 * Lives in `testing/` (not `__tests__/`) because it's shared across
 * test suites in tugdeck/.
 *
 * @module lib/code-session-store/testing/turn-entry-defaults
 */

import type { TurnCost, TurnEndReason, TurnEntry } from "../types";

export const ZERO_TURN_COST: TurnCost = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalCostUsd: 0,
};

export const TURN_ENTRY_TELEMETRY_DEFAULTS: Pick<
  TurnEntry,
  | "wallClockMs"
  | "awaitingApprovalMs"
  | "transportDowntimeMs"
  | "activeMs"
  | "ttftMs"
  | "ttftcMs"
  | "reconnectCount"
  | "maxStreamGapMs"
  | "turnEndReason"
  | "cost"
> = {
  wallClockMs: 0,
  awaitingApprovalMs: 0,
  transportDowntimeMs: 0,
  activeMs: 0,
  ttftMs: null,
  ttftcMs: null,
  reconnectCount: 0,
  maxStreamGapMs: 0,
  turnEndReason: "complete" as TurnEndReason,
  cost: ZERO_TURN_COST,
};
