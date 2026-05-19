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
 *   - The turn's total token count
 *
 * Pure: no DOM, no React, no side effects. Safe to call from
 * `useMemo` / render bodies.
 */

import type { TurnCost, TurnEndReason } from "./types";

/**
 * The four roles a terminal-state badge can take. Subset of
 * `TugBadgeRole` — the badge component carries more roles than
 * the end-state mapping uses, so this narrower type keeps the
 * helper's contract honest about its output set.
 */
export type EndStateBadgeRole = "success" | "caution" | "danger";

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
 * | `complete`        | "OK"          | success  |
 * | `interrupted`     | "interrupted" | caution  |
 * | `error`           | "error"       | danger   |
 * | `transport_lost`  | "lost"        | caution  |
 *
 * `transport_lost` is mapped to `caution` (not `danger`) because
 * the wire-loss path is recoverable — a reconnect can deliver the
 * outstanding output; `caution` reads as "look at this" rather
 * than "this failed." `interrupted` is also `caution` because the
 * user initiated the stop; it isn't a system error.
 */
export function endStateBadgeFor(reason: TurnEndReason): EndStateBadge {
  switch (reason) {
    case "complete":
      return { text: "OK", role: "success" };
    case "interrupted":
      return { text: "interrupted", role: "caution" };
    case "error":
      return { text: "error", role: "danger" };
    case "transport_lost":
      return { text: "lost", role: "caution" };
  }
}

/**
 * Total token count for a turn — the sum of every numeric field on
 * `TurnCost`. Same shape the per-turn Tokens cell + the Tokens
 * popover use, hoisted out of the gallery so the end-state display
 * does not duplicate the formula.
 */
export function totalTokensForTurn(cost: TurnCost): number {
  return (
    cost.inputTokens +
    cost.outputTokens +
    cost.cacheReadInputTokens +
    cost.cacheCreationInputTokens
  );
}
