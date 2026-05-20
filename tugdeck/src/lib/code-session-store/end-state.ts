/**
 * Pure-logic helpers for the Z1 asst-half end-state display.
 *
 * Used by the gallery's `gallery-tide-asst-half-stack.tsx` workshop
 * card and (when 20.4.15 lands) by the production tide-card Z1
 * asst-half renderer. The helpers are pinned here, not inline in
 * the gallery, so the mapping from `TurnEndReason` to badge text
 * and tone has one source of truth across the workshop and
 * production callsites.
 *
 * The end-state display surfaces three pieces of post-turn
 * information:
 *   - A terminal-state badge (OK / interrupted / errored / lost)
 *   - The turn's active-ms (machine-doing-work time)
 *   - The turn's per-turn token count (the context-window delta)
 *
 * Pure: no DOM, no React, no side effects. Safe to call from
 * `useMemo` / render bodies.
 */

import type { LiveTurnUsage, TurnCost, TurnEndReason } from "./types";

/**
 * The roles a terminal-state badge can take. Subset of
 * `TugBadgeRole` — the badge component carries more roles than
 * the end-state mapping uses, so this narrower type keeps the
 * helper's contract honest about its output set.
 *
 * `"inherit"` (vs the coloured tones) is the deliberate choice for
 * the `complete` outcome: in a transcript of many committed rows
 * the green "OK" dots otherwise compound into a vertical column
 * that draws the eye away from message content. The actionable
 * outcomes (`interrupted` / `error` / `transport_lost`) keep
 * their coloured tones because attention IS warranted there.
 */
export type EndStateBadgeRole = "inherit" | "caution" | "danger";

export interface EndStateBadge {
  /** Display text rendered inside the badge. */
  text: string;
  /** Tone driving the badge's color treatment. */
  role: EndStateBadgeRole;
}

/**
 * Map a `TurnEndReason` to its end-state badge text + tone:
 *
 * | turnEndReason     | text          | role     |
 * |-------------------|---------------|----------|
 * | `complete`        | "OK"          | inherit  |
 * | `interrupted`     | "interrupted" | caution  |
 * | `error`           | "error"       | danger   |
 * | `transport_lost`  | "lost"        | caution  |
 *
 * `complete` returns `role: "inherit"` so the OK badge paints in
 * the surrounding text colour and blends into the row's rhythm —
 * saving the coloured palettes for outcomes that warrant
 * attention. `transport_lost` is mapped to `caution` (not
 * `danger`) because the wire-loss path is recoverable — a
 * reconnect can deliver the outstanding output; `caution` reads
 * as "look at this" rather than "this failed."  `interrupted` is
 * also `caution` because the user initiated the stop; it isn't a
 * system error.
 */
export function endStateBadgeFor(reason: TurnEndReason): EndStateBadge {
  switch (reason) {
    case "complete":
      return { text: "OK", role: "inherit" };
    case "interrupted":
      return { text: "interrupted", role: "caution" };
    case "error":
      return { text: "error", role: "danger" };
    case "transport_lost":
      return { text: "lost", role: "caution" };
  }
}

/**
 * Total tokens in the model's context window at this turn — every
 * field of the per-turn `TurnCost`: the model's input (uncached
 * `input` + `cache_read` + `cache_creation`) plus its `output`.
 *
 * `TurnCost` is the raw per-turn `cost_update.usage` (see
 * `extractTurnCost`), so this is the context size AT this turn — it
 * grows turn over turn as the conversation accumulates. It is NOT a
 * per-turn delta; {@link perTurnTokens} computes that. Used as the
 * window term inside `perTurnTokens` and as the session-rollup
 * building block.
 */
export function turnWindowTokens(cost: TurnCost): number {
  return (
    cost.inputTokens +
    cost.outputTokens +
    cost.cacheReadInputTokens +
    cost.cacheCreationInputTokens
  );
}

/**
 * The per-turn token count shown on the Z1B asst-half — how much this
 * turn GREW the context window.
 *
 * ## Contract
 *
 * Z1B shows a **per-turn delta**, never a turn's gross API usage.
 * Gross usage re-reads the entire prior conversation as `cache_read`
 * every turn, so it tracks context size and would never sum to
 * anything meaningful. The delta does:
 *
 *   `perTurnTokens(turn N) = window(N) − window(N−1)`
 *
 * where `window` is {@link turnWindowTokens} — `input + output +
 * cache_read + cache_creation`, every term straight from
 * `cost_update.usage`. No local tokenizer; all feed numbers.
 *
 * The deltas telescope: `session-init + Σ perTurnTokens = window(last)`
 * — the live context rollup, exactly, by construction.
 *
 * **First turn** (`prevCost === undefined`): the prior window is the
 * session-init bootstrap (system prompt + tools + agents + memory +
 * skills), which equals this turn's *observed input* (`input +
 * cache_read + cache_creation` — the model's input, minus its
 * output). So the first turn's delta degenerates to its `output`: the
 * bootstrap is attributed to session-init and never charged to turn 1.
 *
 * Clamped ≥ 0 to defend against a non-monotonic window (e.g.
 * prompt-cache eviction shrinking `cache_read` between turns).
 */
export function perTurnTokens(
  cost: TurnCost,
  prevCost: TurnCost | undefined,
): number {
  const window = turnWindowTokens(cost);
  const prevWindow =
    prevCost === undefined
      ? cost.inputTokens +
        cost.cacheReadInputTokens +
        cost.cacheCreationInputTokens
      : turnWindowTokens(prevCost);
  return Math.max(0, window - prevWindow);
}

/**
 * Fold a {@link LiveTurnUsage} into a {@link TurnCost} — sum the
 * per-message token counts across the in-flight turn's messages.
 *
 * The per-message usages are additive: a tool-loop turn has one
 * assistant message per iteration, and their `streaming_usage` frames
 * sum to the turn's terminal `cost_update.usage` (verified against
 * live wire data). So the rollup of the live accumulation lands
 * exactly on the committed `TurnCost` the moment the turn completes —
 * the cells transition with no jump.
 *
 * `totalCostUsd` is `0`: dollar cost is cumulative-per-session and
 * only known at the terminal `cost_update`, never mid-turn. The cell
 * helpers ({@link turnWindowTokens} / {@link perTurnTokens}) read only
 * the four token fields, so the zero cost is inert.
 */
export function rollupLiveTurnUsage(live: LiveTurnUsage): TurnCost {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  for (const m of Object.values(live.byMessage)) {
    inputTokens += m.inputTokens;
    outputTokens += m.outputTokens;
    cacheCreationInputTokens += m.cacheCreationInputTokens;
    cacheReadInputTokens += m.cacheReadInputTokens;
  }
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalCostUsd: 0,
  };
}
