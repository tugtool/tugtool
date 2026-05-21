/**
 * Pure-logic helpers for the tide-card Z1B end-state display.
 *
 * Used by the production Z1B status row (`tide-card-z1b.tsx`). The
 * helpers live in this module, not inline in the component, so the
 * mapping from `TurnEndReason` to badge text and tone has one
 * source of truth.
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

import type { LiveMessageUsage, TurnEndReason } from "./types";

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
 * The resident context window after a turn — `window(N)`. Sum of all
 * four token fields of the turn's LAST tool-loop iteration's `usage`:
 * the model's input (`input` + `cache_read` + `cache_creation`) plus
 * its `output`.
 *
 * `TurnCost` carries the last iteration's `usage` (see
 * `extractTurnCost`), NOT the per-iteration sum `result.usage` would
 * give — so this is the model's true context occupancy after the
 * turn. It is NOT a per-turn delta; `perTurnTokens` and
 * `deriveContextWindows` compute that.
 *
 * A zero-usage turn (an interrupted/errored turn with no measurable
 * iteration) returns `0` here — callers that need the resident window
 * use `deriveContextWindows`, which carries the prior window forward
 * across such turns.
 */
export function turnWindowTokens(usage: LiveMessageUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens
  );
}

/**
 * The signed per-turn token count — how much this turn changed the
 * resident context window:
 *
 *   perTurnTokens(N) = window(N) - prevWindow
 *
 * where `window(N)` is `turnWindowTokens` of this turn's
 * last-iteration `usage` and `prevWindow` is the resident window after
 * the prior turn (the caller resolves it: `sessionInitTokens` for the
 * first turn, the prior turn's window otherwise).
 *
 * Signed, never clamped. A turn that grows the window is positive; a
 * `/compact` that shrinks it is an honest negative. The deltas
 * telescope: `sessionInit + sum of perTurnTokens = window(latest)`,
 * exactly, by construction. No local tokenizer — every term is a feed
 * number.
 *
 * This is the per-turn primitive used for the in-flight turn (whose
 * `usage` is never all-zero once a frame has landed). For a whole
 * committed transcript — including the zero-usage carry-forward — use
 * `deriveContextWindows`, which special-cases a turn whose `usage` is
 * all-zero (this helper would read its `window` as `0` and report
 * `-prevWindow`).
 */
export function perTurnTokens(
  usage: LiveMessageUsage,
  prevWindow: number,
): number {
  return turnWindowTokens(usage) - prevWindow;
}

/** One turn's resident context window and the signed delta into it. */
export interface ContextWindowStep {
  /**
   * `window(N)` — the resident context tokens after this turn. Equals
   * `turnWindowTokens` of the turn's `usage`, EXCEPT a zero-usage turn
   * carries the prior turn's window forward.
   */
  window: number;
  /**
   * `window(N) - window(N-1)`, signed. `0` for a zero-usage turn.
   * This is the figure the `TOKENS` cell and Z1B show.
   */
  perTurn: number;
}

/**
 * Walk a transcript's per-turn `usage` and produce, per turn, the
 * resident context window and the signed per-turn delta into it.
 *
 *   - `window(0)` = `sessionInit` (the bootstrap before any turn).
 *   - `window(N)` = `turnWindowTokens` of turn N's `usage`, EXCEPT a
 *     zero-usage turn (`turnWindowTokens === 0` — an interrupted /
 *     errored turn with no measurable iteration) carries the prior
 *     window forward: `window(N) = window(N-1)`.
 *   - `perTurn(N)` = `window(N) - window(N-1)`, signed — `0` for a
 *     zero-usage turn, negative at a `/compact`.
 *
 * Identity: `sessionInit + sum of perTurn = window(latest)` —
 * telescopes exactly, every turn including compactions.
 *
 * Pure: no DOM, no React, no time source. Safe in `useMemo` / render.
 */
export function deriveContextWindows(
  usages: ReadonlyArray<LiveMessageUsage>,
  sessionInit: number,
): ReadonlyArray<ContextWindowStep> {
  const steps: ContextWindowStep[] = [];
  let prevWindow = sessionInit;
  for (const usage of usages) {
    const raw = turnWindowTokens(usage);
    const window = raw === 0 ? prevWindow : raw;
    steps.push({ window, perTurn: window - prevWindow });
    prevWindow = window;
  }
  return steps;
}
