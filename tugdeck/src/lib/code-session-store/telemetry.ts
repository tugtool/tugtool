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
import type {
  CodeSessionSnapshot,
  CostSnapshot,
  TurnCost,
  TurnEntry,
} from "./types";

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

// ---------------------------------------------------------------------------
// Per-area popover summaries — count / total / average shapes consumed
// by the Tide status-row popovers (`Time`, `Tokens`) per plan
// `#step-20-4-7-a`. Built on top of {@link deriveSessionTotals} so the
// session-wide sums are computed once; the popover-specific helpers
// add the popover surface's specific shape (count + average for the
// per-area summary footer).
// ---------------------------------------------------------------------------
//
// Why two purpose-named helpers instead of one generic surface: each
// popover has its own footer copy and its own units (ms vs tokens),
// and the renderers downstream want a typed shape they can destructure
// without manually re-computing averages. The two helpers stay tiny
// because they delegate the actual summation to `deriveSessionTotals`.

/**
 * Per-turn timing summary for the `Time` status-area popover.
 *
 *   - `count`: number of committed turns in `transcript[]`.
 *   - `totalActiveMs`: sum of `TurnEntry.activeMs` across the transcript.
 *   - `avgActiveMs`: arithmetic mean, rounded to the nearest ms; `0`
 *     when `count === 0` (avoids a NaN footer for fresh sessions).
 *
 * Active-time is the "machine doing work" measure the indicator's
 * green-axis paint represents — wall-clock minus pause time. The
 * popover surfaces this same measure across the committed transcript
 * so the user sees the per-turn breakdown that matches the headline
 * cell value.
 */
export interface TurnTimingSummary {
  count: number;
  totalActiveMs: number;
  avgActiveMs: number;
}

/**
 * Compute the `Time` popover's summary block from the committed
 * transcript. In-flight turns are NOT included by design — the popover's
 * row log shows committed turns only; live in-flight time is surfaced
 * separately in the popover footer by the renderer (via
 * {@link deriveInflightActiveMs}). See plan `#step-20-4-7-a`.
 */
export function computeTimeSummary(
  transcript: ReadonlyArray<TurnEntry>,
): TurnTimingSummary {
  const totals = deriveSessionTotals(transcript);
  return {
    count: totals.turnCount,
    totalActiveMs: totals.totalActiveMs,
    avgActiveMs:
      totals.turnCount === 0
        ? 0
        : Math.round(totals.totalActiveMs / totals.turnCount),
  };
}

/**
 * Per-turn token summary for the `Tokens` status-area popover.
 * `totalTokens` is the sum across all four token categories — the
 * single number the cell headline shows — and `avgTokensPerTurn` is
 * the per-turn arithmetic mean (rounded), `0` for an empty transcript.
 *
 * The four per-category totals are exposed alongside so the renderer
 * can break the value down into "input + output + cache-read +
 * cache-creation" if the popover surface wants that detail.
 */
export interface TurnTokensSummary {
  count: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalTokens: number;
  avgTokensPerTurn: number;
}

/**
 * Categorical tone for {@link computeContextBreakdown} and
 * {@link computeRichContextBreakdown} output. Structurally compatible
 * with `TugArcGaugeSegmentTone` (the gauge primitive's segments-mode
 * tone enum) — the gallery popover (and 20.4.10's production
 * composition) can hand a breakdown's `segments` array directly to
 * `TugArcGauge` in segments mode without mapping or casting.
 *
 * Two parallel vocabularies coexist:
 *
 * - **Wire-level cost tones** (`input` / `cache-read` / `cache-creation`
 *   / `output` / `remainder`): emitted by `computeContextBreakdown` —
 *   the popover's fallback view from `#step-20-4-7-c`.
 *
 * - **`/context`-style category tones** (`system_prompt` / `system_tools`
 *   / `custom_agents` / `memory_files` / `skills` / `messages` /
 *   `autocompact_buffer`): emitted by `computeRichContextBreakdown`
 *   when the snapshot carries a `lastContextBreakdown` from the
 *   tugcode → reducer → supervisor round-trip (`#step-20-4-7-d`).
 *   `mcp_tools` is intentionally absent — Tug treats MCP as out of
 *   scope; no MCP tone ever appears.
 *
 * `remainder` straddles both uses since the auto-synthesized
 * fill-the-gap slice is shape-uniform across either vocabulary.
 *
 * Declared locally here rather than imported from the components
 * layer so the library boundary stays one-way: `lib` doesn't depend
 * on `components`.
 */
export type ContextBreakdownTone =
  // Wire-level cost vocabulary.
  | "input"
  | "cache-read"
  | "cache-creation"
  | "output"
  | "remainder"
  // `/context`-style category vocabulary.
  | "system_prompt"
  | "system_tools"
  | "custom_agents"
  | "memory_files"
  | "skills"
  | "messages"
  | "autocompact_buffer";

/**
 * One segment in a context-window categorical breakdown. Mirrors the
 * shape `TugArcGauge`'s segments mode consumes ({@link ContextBreakdownTone}
 * matches its tone union exactly), so the popover renderer can pass
 * the array through without translation.
 */
export interface ContextBreakdownSegment {
  /** Stable identity for the segment across renders. */
  id: string;
  /** Categorical tone — paired with the matching `--tugx-arc-gauge-segment-<tone>-color` slot. */
  tone: ContextBreakdownTone;
  /** Token count for this category (clamped to ≥ 0). */
  value: number;
  /** Human-readable label for the legend. */
  label: string;
}

/**
 * Output shape of {@link computeContextBreakdown}: the five segments
 * needed to paint the categorical arc + the headline `totalUsed`
 * count (sum of all four non-remainder categories) + the originating
 * `contextMax` so the popover footer can render `used / max`.
 */
export interface ContextBreakdown {
  segments: ReadonlyArray<ContextBreakdownSegment>;
  /**
   * Sum of input + cache-read + cache-creation + output for the turn,
   * clamped to ≥ 0 on each axis. NOT clamped against `contextMax` —
   * over-saturation (rare) surfaces as `totalUsed > contextMax` so
   * the renderer can show the imbalance honestly.
   */
  totalUsed: number;
  /** The model's context-window cap as passed in (clamped to ≥ 0). */
  contextMax: number;
}

/**
 * Decompose a committed turn's token usage into the five-segment
 * shape the Context popover (`#step-20-4-7-c`) paints: the four
 * token categories Anthropic emits in `cost_update.usage` (input,
 * cache-read, cache-creation, output) plus an auto-computed
 * `remainder` slice representing the unused window capacity. The
 * remainder is `max(0, contextMax − sum-of-used)`; if the turn
 * over-saturated the window (sum > contextMax), the remainder
 * clamps to 0 and `totalUsed > contextMax` signals the imbalance.
 *
 * Negative values on any axis (defensive against malformed inputs)
 * clamp to 0. `contextMax <= 0` clamps to 0 too; the result is then
 * five-segment but with remainder = 0.
 *
 * Pure: no DOM, no React, no time source. The caller picks which
 * turn to decompose; the popover's contract is "most-recent committed
 * turn" but the helper itself takes any `TurnEntry`.
 */
export function computeContextBreakdown(
  turn: TurnEntry,
  contextMax: number,
): ContextBreakdown {
  const safeContextMax = Math.max(0, contextMax);
  const input = Math.max(0, turn.cost.inputTokens);
  const cacheRead = Math.max(0, turn.cost.cacheReadInputTokens);
  const cacheCreation = Math.max(0, turn.cost.cacheCreationInputTokens);
  const output = Math.max(0, turn.cost.outputTokens);
  const totalUsed = input + cacheRead + cacheCreation + output;
  const remainder = Math.max(0, safeContextMax - totalUsed);
  return {
    segments: [
      { id: "input", tone: "input", value: input, label: "Input" },
      { id: "cache-read", tone: "cache-read", value: cacheRead, label: "Cache (read)" },
      {
        id: "cache-creation",
        tone: "cache-creation",
        value: cacheCreation,
        label: "Cache (creation)",
      },
      { id: "output", tone: "output", value: output, label: "Output" },
      { id: "remainder", tone: "remainder", value: remainder, label: "Unused" },
    ],
    totalUsed,
    contextMax: safeContextMax,
  };
}

/**
 * Build the rich `/context`-style breakdown for the Context popover
 * (`#step-20-4-7-d`). Three-way resolution:
 *
 * 1. **`lastContextBreakdown` present (live or bind-attach):** return
 *    the rich per-category breakdown sourced from the
 *    `context_breakdown` wire frame. Variable length (6 or 7
 *    categories depending on autocompact-on / autocompact-off) plus
 *    the auto-synthesized `remainder` slice. The wire-frame
 *    `context_max` wins over `fallbackContextMax` — it's the
 *    authoritative cap for the model the session is running against.
 *
 * 2. **No breakdown frame, transcript has committed turns:** fall back
 *    to {@link computeContextBreakdown} against the last committed
 *    turn — the 20.4.7.C cost_update-derived view, with the original
 *    5-tone cost vocabulary. This path keeps the popover useful
 *    against older tugcode that hasn't shipped the new frame, against
 *    a tugcode session that opted out, and in the first few seconds
 *    after a fresh spawn before the first `context_breakdown` lands.
 *
 * 3. **No breakdown frame and no transcript:** return `null`. The
 *    renderer paints the empty-state body ("No committed turns yet.").
 *
 * Per the spike's 5–10% accuracy bar, the rich-path numbers are not
 * byte-exact against Claude Code's `/context` terminal output —
 * tugcode's local tokenization sits a few percent off the canonical
 * count. The popover shows numbers in the right ballpark; this is
 * intentional, not a bug.
 *
 * Pure: no DOM, no React, no time source.
 */
export function computeRichContextBreakdown(
  lastContextBreakdown: ContextBreakdownSnapshotInput | null,
  transcript: ReadonlyArray<TurnEntry>,
  fallbackContextMax: number,
): ContextBreakdown | null {
  if (lastContextBreakdown !== null) {
    const safeContextMax = Math.max(0, lastContextBreakdown.contextMax);
    const segments: ContextBreakdownSegment[] = [];
    let totalUsed = 0;
    for (const c of lastContextBreakdown.categories) {
      const value = Math.max(0, c.tokens);
      totalUsed += value;
      segments.push({
        id: c.id,
        // Wire-frame category ids map 1:1 to the categorical-tone half
        // of `ContextBreakdownTone` — the two enums were designed
        // together (see `types.ts` `ContextBreakdownCategoryId` and
        // `TugArcGaugeSegmentTone`). The cast is safe by construction.
        tone: c.id,
        value,
        label: c.label,
      });
    }
    const remainder = Math.max(0, safeContextMax - totalUsed);
    segments.push({
      id: "remainder",
      tone: "remainder",
      value: remainder,
      label: "Unused",
    });
    return { segments, totalUsed, contextMax: safeContextMax };
  }
  if (transcript.length > 0) {
    return computeContextBreakdown(transcript[transcript.length - 1], fallbackContextMax);
  }
  return null;
}

/**
 * Shape this helper reads out of the snapshot's
 * {@link CodeSessionSnapshot.lastContextBreakdown} field. Declared as
 * a structural type so the caller can pass either the snapshot's
 * field directly or any other source carrying the same shape
 * (test fixtures, supervisor-side prefetch, etc.).
 */
export interface ContextBreakdownSnapshotInput {
  contextMax: number;
  categories: ReadonlyArray<{
    id: ContextBreakdownTone;
    label: string;
    tokens: number;
  }>;
}

/**
 * Compute the `Tokens` popover's summary block from the committed
 * transcript. Same in-flight contract as {@link computeTimeSummary}:
 * row log + this summary cover committed turns only; the renderer
 * adds the live in-flight token contribution to the footer separately.
 */
export function computeTokensSummary(
  transcript: ReadonlyArray<TurnEntry>,
): TurnTokensSummary {
  const totals = deriveSessionTotals(transcript);
  const totalTokens =
    totals.totalInputTokens +
    totals.totalOutputTokens +
    totals.totalCacheReadTokens +
    totals.totalCacheCreationTokens;
  return {
    count: totals.turnCount,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    totalCacheReadTokens: totals.totalCacheReadTokens,
    totalCacheCreationTokens: totals.totalCacheCreationTokens,
    totalTokens,
    avgTokensPerTurn:
      totals.turnCount === 0 ? 0 : Math.round(totalTokens / totals.turnCount),
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
 *
 * Note: this helper SUBTRACTS the two scalar accumulators, so it
 * over-subtracts whenever the two pause axes overlap (e.g. transport
 * goes restoring during an awaiting-approval dialog). The
 * snapshot-projection helper {@link deriveInflightActiveMs} uses the
 * union of per-axis intervals across all three yellow axes (adding
 * interrupt-in-flight) and is the recommended derivation for the
 * gallery's live `Time` cell. `liveTurnActiveMs` is preserved for
 * backwards-compatibility and for the per-turn-summary surfaces that
 * already accept the over-subtraction.
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
// Overlap-correct live in-flight active derivation
// ---------------------------------------------------------------------------

/**
 * One pause segment as understood by {@link unionPauseMs}: a tuple
 * whose second element is either the close timestamp (closed
 * segment) or `null` (the segment is still open and treated as
 * ending at the window's end).
 */
export type PauseSegment = readonly [number, number | null];

/**
 * Compute the duration of the UNION of pause segments from any number
 * of axes, clipped to `[windowStart, windowEnd]`. Currently-open
 * segments (`[start, null]`) are treated as having `end = windowEnd`.
 *
 * The naive sum of per-axis durations over-counts whenever segments
 * overlap (an awaiting-approval dialog while transport is restoring
 * contributes twice if you sum them, swallowing real Claude-active
 * time in the live-clock derivation). The union counts each
 * overlapping millisecond exactly once.
 *
 * Algorithm: sort-and-sweep. Each segment is first normalized
 * (open → `windowEnd`, then clipped to `[windowStart, windowEnd]`),
 * skipping any segment that's empty after clipping. The sweep merges
 * adjacent or overlapping intervals as it walks the sorted list,
 * summing each merged region's length.
 *
 * Time-complexity is O(n log n) in the total number of segments,
 * dominated by the sort. For a single in-flight turn the total is
 * typically < 10 (one awaiting-approval dialog, one transport blip,
 * one interrupt-in-flight = three segments), so the constant factor
 * is what matters; the algorithm is the smallest correct one rather
 * than the most performant possible.
 *
 * Returns `0` when `windowEnd <= windowStart` (degenerate window) or
 * when no segment falls inside the window.
 */
export function unionPauseMs(
  segments: ReadonlyArray<PauseSegment>,
  windowStart: number,
  windowEnd: number,
): number {
  if (windowEnd <= windowStart) {
    return 0;
  }
  const clipped: Array<[number, number]> = [];
  for (const [rawStart, rawEnd] of segments) {
    const end = rawEnd ?? windowEnd;
    const start = Math.max(windowStart, rawStart);
    const cappedEnd = Math.min(windowEnd, end);
    if (cappedEnd <= start) {
      continue;
    }
    clipped.push([start, cappedEnd]);
  }
  if (clipped.length === 0) {
    return 0;
  }
  clipped.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let mergeStart = clipped[0][0];
  let mergeEnd = clipped[0][1];
  for (let i = 1; i < clipped.length; i++) {
    const [start, end] = clipped[i];
    if (start <= mergeEnd) {
      if (end > mergeEnd) {
        mergeEnd = end;
      }
    } else {
      total += mergeEnd - mergeStart;
      mergeStart = start;
      mergeEnd = end;
    }
  }
  total += mergeEnd - mergeStart;
  return total;
}

/**
 * Compose the live in-flight active duration from snapshot fields and
 * the current wall-clock. Returns `null` when no turn is in flight
 * (`inflightUserMessage === null`).
 *
 *   liveActiveMs = max(
 *     0,
 *     (nowMs - submitAt) - unionPauseMs(allYellowSegments, submitAt, nowMs)
 *   )
 *
 * Yellow segments = union across all three axes (awaiting-approval +
 * transport-downtime + interrupt-in-flight). The same yellow
 * conditions that flip the `TugStateIndicator` to caution are exactly
 * what open each axis's segment; the live clock pauses while any
 * axis is open and resumes when the union of axes becomes empty —
 * no separate "is the indicator yellow" check is required. Overlapping
 * pauses contribute only once. See {@link unionPauseMs} for the
 * algorithm and {@link PauseSegment} for the input shape.
 */
/**
 * Renderer convenience over {@link deriveInflightActiveMs}. Returns
 * the live in-flight active duration while a turn is in flight, and
 * falls back to a caller-supplied post-commit value (typically the
 * just-committed `TurnEntry.activeMs`, or `0` for a never-submitted
 * card) when no turn is in flight. Never returns `null` — the
 * fallback covers every post-commit / idle / errored path the
 * underlying derivation reports as not-applicable.
 *
 *   - In-flight: ticks up at the granularity of the caller's `tickAt`
 *     (see `useLifecycleTick` for the 1 Hz heartbeat that drives the
 *     gallery + production renderers).
 *   - Pauses when any yellow axis is open — the same overlap-correct
 *     union {@link deriveInflightActiveMs} computes.
 *   - Freezes at turn-complete: the snapshot's `inflightUserMessage`
 *     becomes `null`, the underlying derivation returns `null`, and
 *     this helper returns the committed `activeMs` (the caller's
 *     fallback).
 *   - Resets at the next submit: a fresh `inflightUserMessage` makes
 *     the derivation re-engage from the new `submitAt`.
 *
 * Pure: no time source, no DOM, no React. Callers pass `tickAt`.
 */
export function deriveTimeCellMs(
  snap: CodeSessionSnapshot,
  tickAt: number,
  postCommitFallbackMs: number,
): number {
  const live = deriveInflightActiveMs(snap, tickAt);
  return live ?? postCommitFallbackMs;
}

export function deriveInflightActiveMs(
  snap: CodeSessionSnapshot,
  nowMs: number,
): number | null {
  if (snap.inflightUserMessage === null) {
    return null;
  }
  const submitAt = snap.inflightUserMessage.submitAt;
  if (nowMs <= submitAt) {
    return 0;
  }
  const wall = nowMs - submitAt;
  const segments: PauseSegment[] = [];
  for (const interval of snap.awaitingApprovalIntervals) {
    segments.push(interval);
  }
  if (snap.awaitingApprovalSegmentStartedAt !== null) {
    segments.push([snap.awaitingApprovalSegmentStartedAt, null]);
  }
  for (const interval of snap.transportDowntimeIntervals) {
    segments.push(interval);
  }
  if (snap.transportDowntimeSegmentStartedAt !== null) {
    segments.push([snap.transportDowntimeSegmentStartedAt, null]);
  }
  for (const interval of snap.interruptInFlightIntervals) {
    segments.push(interval);
  }
  if (snap.interruptInFlightSegmentStartedAt !== null) {
    segments.push([snap.interruptInFlightSegmentStartedAt, null]);
  }
  const pause = unionPauseMs(segments, submitAt, nowMs);
  return Math.max(0, wall - pause);
}

// ---------------------------------------------------------------------------
// Per-turn telemetry block — the persistable shape
// ---------------------------------------------------------------------------

/**
 * The persistable per-turn telemetry block — exactly the subset of
 * `TurnEntry` fields that need to survive HMR / Reload / app relaunch
 * via the sqlite SessionLedger (see plan `#step-20-3-3` /
 * `#step-20-3-4`). Two sources can populate it:
 *
 *  - **Live path** — the reducer at `handleTurnComplete` computes
 *    every field from in-memory clock anchors + cost snapshots via
 *    {@link deriveTurnTelemetry}.
 *  - **Replay path** — the supervisor reads previously-persisted
 *    rows from the SessionLedger and inlines this exact shape on
 *    the replayed `turn_complete` wire event. The reducer takes
 *    the inlined payload as-is via {@link mergeTurnTelemetry}.
 *
 * The shape is byte-identical across the two sources by construction;
 * `mergeTurnTelemetry` just decides which source wins (inline if
 * present, else the live derivation). One reducer code path, two
 * data sources, single source of truth for the COMPUTATION (the
 * reducer's clock + cost machinery — see `deriveTurnTelemetry`).
 */
export interface TurnTelemetry {
  cost: TurnCost;
  wallClockMs: number;
  awaitingApprovalMs: number;
  transportDowntimeMs: number;
  activeMs: number;
  ttftMs: number | null;
  ttftcMs: number | null;
  reconnectCount: number;
  maxStreamGapMs: number;
}

/**
 * Derive the per-turn telemetry block from reducer state at the
 * moment a turn ends. Lifts the computation out of
 * `buildTurnEntry` so it has a pinning surface and so the same
 * shape is what the persistence layer round-trips.
 *
 * `submitAt` and `endedAt` are the same wall-clock millisecond
 * timestamps `buildTurnEntry` derives — passed in so this helper
 * stays pure and the timestamps the reducer chose are the
 * timestamps the telemetry block reports.
 */
export function deriveTurnTelemetry(
  state: CodeSessionState,
  submitAt: number,
  endedAt: number,
): TurnTelemetry {
  const wallClockMs = Math.max(0, endedAt - submitAt);
  const awaitingApprovalMs =
    state.awaitingApprovalSince === null
      ? state.awaitingApprovalAccumulatedMs
      : state.awaitingApprovalAccumulatedMs +
        Math.max(0, endedAt - state.awaitingApprovalSince);
  const transportDowntimeMs =
    state.transportNonOnlineSince === null
      ? state.transportDowntimeAccumulatedMs
      : state.transportDowntimeAccumulatedMs +
        Math.max(0, endedAt - state.transportNonOnlineSince);
  const activeMs = Math.max(
    0,
    wallClockMs - awaitingApprovalMs - transportDowntimeMs,
  );
  const ttftMs =
    state.firstAssistantDeltaAt === null
      ? null
      : Math.max(0, state.firstAssistantDeltaAt - submitAt);
  const ttftcMs =
    state.firstToolUseAt === null
      ? null
      : Math.max(0, state.firstToolUseAt - submitAt);
  const cost = extractTurnCost(state.costAtSubmit, state.lastCost);
  return {
    cost,
    wallClockMs,
    awaitingApprovalMs,
    transportDowntimeMs,
    activeMs,
    ttftMs,
    ttftcMs,
    reconnectCount: state.transportReconnectCount,
    maxStreamGapMs: state.maxStreamGapMs,
  };
}

/**
 * Pick the authoritative per-turn telemetry block.
 *
 *  - `inline !== undefined` → replay path. The supervisor read this
 *    block from the SessionLedger and attached it to the replayed
 *    `turn_complete` event. Use it verbatim — the values were
 *    computed by the live reducer during the original turn and
 *    persisted at the same `handleTurnComplete` callsite that's
 *    consulting this function now.
 *  - `inline === undefined` → live path. The wire didn't carry a
 *    telemetry payload; the reducer's just-derived block is the
 *    authoritative one and the live path also schedules an effect
 *    to persist it for the next reload.
 *
 * Trivial by construction — the entire merge is `inline ?? derived`.
 * Exists as a named helper so the contract is grep-able, the call
 * site reads as intent, and the test surface has a single function
 * to pin.
 */
export function mergeTurnTelemetry(
  inline: TurnTelemetry | undefined,
  derived: TurnTelemetry,
): TurnTelemetry {
  return inline ?? derived;
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
