/**
 * Pure-logic telemetry helpers — derived views on `TurnEntry` /
 * `CodeSessionState` that the per-turn surface and chrome consume.
 *
 * The reducer captures discrete per-turn signals (timestamps,
 * accumulators, cost snapshots). This module turns those signals into
 * the shapes consumers actually want — per-turn context size, session
 * totals, live in-flight clocks — without any time source, DOM, or
 * React. The lone external coupling is `Date.now()`-style numbers
 * passed in as `now` parameters by the call site.
 *
 * Conformance:
 *   - No DOM, no React, no module-mutable state.
 *   - No `Date.now()` reads inside this module — callers supply `now`
 *     for the `liveTurn*` family so the helpers stay deterministic and
 *     trivially testable.
 *   - No imports from the reducer (the reducer imports from here, not
 *     the other way around) — avoids a circular dependency.
 *
 * @module lib/code-session-store/telemetry
 */

import type { CodeSessionState } from "./reducer";
import type { CostSnapshot, TurnCost, TurnEntry } from "./types";

/**
 * The model's view of "context tokens consumed at the boundary of this
 * turn." Sum of the input + cache-read + cache-creation token counts.
 * Output tokens are NOT part of context — they're the model's response,
 * not its input.
 *
 * Used by the window-utilization gauge (numerator) against the model's
 * static context-window max (denominator).
 */
export function perTurnContextSize(turn: TurnEntry): number {
  return (
    turn.cost.inputTokens +
    turn.cost.cacheReadInputTokens +
    turn.cost.cacheCreationInputTokens
  );
}

/**
 * Compute the per-turn cost delta as `after - before`, clamped ≥ 0.
 * Handles the cumulative-per-session shape (the empirically observed
 * shape per Investigation A) — the delta is the new turn's contribution.
 * Tolerates the alternate hypothesis (already per-turn) because in that
 * case `before` would equal `null` at every turn boundary and the delta
 * degenerates to `after`.
 *
 *   - `before === null`: first turn of the session (or no `cost_update`
 *     ever observed before this turn). Return `after` directly.
 *   - `after === null`: no `cost_update` ever fired for this turn. Return
 *     all zeros.
 *   - Both present: compute field-wise `after - before`, clamped ≥ 0.
 *     The clamp defends against any non-monotonic `cost_update.usage`
 *     behavior (e.g. a model swap that resets the cumulative counter).
 *
 * The `usage` payload structure varies — modern Claude emits
 * `{input_tokens, output_tokens, cache_creation_input_tokens,
 *  cache_read_input_tokens}` at the top of `usage` — but the same
 * field names also appear in `modelUsage[<model>]`. This helper reads
 * from `usage` (the aggregate view); a future per-model breakdown
 * would build separate `TurnCost` records from `modelUsage`.
 */
export function extractTurnCost(
  before: CostSnapshot | null,
  after: CostSnapshot | null,
): TurnCost {
  if (after === null) {
    return ZERO_TURN_COST;
  }
  const afterUsage = readUsage(after.usage);
  const beforeUsage = before === null ? ZERO_USAGE : readUsage(before.usage);
  const beforeCostUsd = before === null ? 0 : before.totalCostUsd;
  return {
    inputTokens: clampNonNegative(afterUsage.inputTokens - beforeUsage.inputTokens),
    outputTokens: clampNonNegative(afterUsage.outputTokens - beforeUsage.outputTokens),
    cacheCreationInputTokens: clampNonNegative(
      afterUsage.cacheCreationInputTokens - beforeUsage.cacheCreationInputTokens,
    ),
    cacheReadInputTokens: clampNonNegative(
      afterUsage.cacheReadInputTokens - beforeUsage.cacheReadInputTokens,
    ),
    totalCostUsd: clampNonNegative(after.totalCostUsd - beforeCostUsd),
  };
}

/**
 * Session-level totals derived by summing per-turn fields across the
 * committed transcript. Pure folds — no time source, no live in-flight
 * accounting.
 */
export interface SessionTotals {
  totalWallClockMs: number;
  totalAwaitingApprovalMs: number;
  totalTransportDowntimeMs: number;
  totalActiveMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  turnCount: number;
}

export function deriveSessionTotals(
  transcript: ReadonlyArray<TurnEntry>,
): SessionTotals {
  let totalWallClockMs = 0;
  let totalAwaitingApprovalMs = 0;
  let totalTransportDowntimeMs = 0;
  let totalActiveMs = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCostUsd = 0;
  for (const t of transcript) {
    totalWallClockMs += t.wallClockMs;
    totalAwaitingApprovalMs += t.awaitingApprovalMs;
    totalTransportDowntimeMs += t.transportDowntimeMs;
    totalActiveMs += t.activeMs;
    totalInputTokens += t.cost.inputTokens;
    totalOutputTokens += t.cost.outputTokens;
    totalCacheReadTokens += t.cost.cacheReadInputTokens;
    totalCacheCreationTokens += t.cost.cacheCreationInputTokens;
    totalCostUsd += t.cost.totalCostUsd;
  }
  return {
    totalWallClockMs,
    totalAwaitingApprovalMs,
    totalTransportDowntimeMs,
    totalActiveMs,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    totalCostUsd,
    turnCount: transcript.length,
  };
}

/**
 * Live wall-clock duration of the in-flight turn (`now -
 * pendingUserMessage.submitAt`). Returns `0` when no turn is in flight.
 */
export function liveTurnWallClockMs(
  state: CodeSessionState,
  now: number,
): number {
  if (state.pendingUserMessage === null) {
    return 0;
  }
  return Math.max(0, now - state.pendingUserMessage.submitAt);
}

/**
 * Live awaiting-approval duration — the committed accumulator plus the
 * live in-progress interval when `awaitingApprovalSince !== null`.
 */
export function liveTurnAwaitingApprovalMs(
  state: CodeSessionState,
  now: number,
): number {
  const accumulated = state.awaitingApprovalAccumulatedMs;
  if (state.awaitingApprovalSince === null) {
    return accumulated;
  }
  return accumulated + Math.max(0, now - state.awaitingApprovalSince);
}

/**
 * Live transport-downtime duration — the committed accumulator plus the
 * live in-progress interval when `transportNonOnlineSince !== null`
 * (covers both `transportState === "offline"` and `"restoring"`).
 */
export function liveTurnTransportDowntimeMs(
  state: CodeSessionState,
  now: number,
): number {
  const accumulated = state.transportDowntimeAccumulatedMs;
  if (state.transportNonOnlineSince === null) {
    return accumulated;
  }
  return accumulated + Math.max(0, now - state.transportNonOnlineSince);
}

/**
 * Live machine-doing-work duration — `live wall − live awaiting − live
 * downtime`, clamped ≥ 0. The headline "assistant response time" for
 * an in-flight turn.
 */
export function liveTurnActiveMs(
  state: CodeSessionState,
  now: number,
): number {
  const wall = liveTurnWallClockMs(state, now);
  const awaiting = liveTurnAwaitingApprovalMs(state, now);
  const downtime = liveTurnTransportDowntimeMs(state, now);
  return Math.max(0, wall - awaiting - downtime);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ZERO_TURN_COST: TurnCost = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalCostUsd: 0,
});

interface UsageView {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

const ZERO_USAGE: UsageView = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
});

function numericField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Read the four token-count fields from a `cost_update.usage` payload,
 * tolerating both snake_case (the wire shape) and camelCase variants.
 * Anthropic emits snake_case; the tolerance defends against any future
 * adapter that pre-normalizes.
 */
function readUsage(usage: unknown): UsageView {
  if (usage === null || typeof usage !== "object") {
    return ZERO_USAGE;
  }
  const r = usage as Record<string, unknown>;
  return {
    inputTokens: numericField(r, "input_tokens") || numericField(r, "inputTokens"),
    outputTokens: numericField(r, "output_tokens") || numericField(r, "outputTokens"),
    cacheCreationInputTokens:
      numericField(r, "cache_creation_input_tokens") ||
      numericField(r, "cacheCreationInputTokens"),
    cacheReadInputTokens:
      numericField(r, "cache_read_input_tokens") || numericField(r, "cacheReadInputTokens"),
  };
}

function clampNonNegative(n: number): number {
  return n > 0 ? n : 0;
}
