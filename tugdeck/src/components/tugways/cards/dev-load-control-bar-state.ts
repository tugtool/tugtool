/**
 * dev-load-control-bar-state — the pure state machine behind the Z0
 * `TugControlBar` in the dev transcript ([recency P09]).
 *
 * The bar carries three things over its life — a **loading** progress
 * indicator (a cold restore or a load-previous, plus a brief dwell tail
 * after the last progress tick), a **prompt** ("There are N earlier
 * turns…"), or **nothing**.
 *
 *   - {@link deriveControlBarState} — maps the current inputs to the visual
 *     state. `loadingDisplay` (load in flight OR within the post-load dwell)
 *     wins; otherwise the prompt shows while it has been *summoned* (after a
 *     load completes, or on reaching the top) and not yet dismissed.
 *
 * The host owns the timing: it holds `loadingDisplay` true for a dwell past
 * the final progress tick, and toggles `promptShown` on the summon/dismiss
 * events (load-tail-ended / reached-top vs. scrolled-away / submit). This
 * function holds no React/DOM.
 *
 * @module components/tugways/cards/dev-load-control-bar-state
 */

/** Which load is in flight (drives progress source + Cancel routing). */
export type ControlBarLoadKind = "restore" | "previous";

/** The bar's resolved visual state. */
export type ControlBarState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "prompt"; earlierTurns: number };

export interface ControlBarInputs {
  /** Progress is displayed: a load is in flight, or the host is within the
   *  dwell tail that holds the bar a beat past the final progress tick. */
  loadingDisplay: boolean;
  /** Whether older turns remain to page in (drives the prompt). */
  hasOlder: boolean;
  /** Count of older (unloaded) turns, for the prompt copy. */
  earlierTurns: number;
  /** The "load more" prompt has been summoned (load completed, or the user
   *  reached the top) and not yet dismissed (scroll / submit). */
  promptShown: boolean;
}

/**
 * Resolve the bar's visual state. Precedence:
 *   1. `loadingDisplay` → `loading` (progress), regardless of scroll.
 *   2. Older messages remain AND the prompt has been summoned → `prompt`.
 *   3. Otherwise → `hidden`.
 */
export function deriveControlBarState(input: ControlBarInputs): ControlBarState {
  if (input.loadingDisplay) {
    return { kind: "loading" };
  }
  if (input.hasOlder && input.promptShown) {
    return { kind: "prompt", earlierTurns: input.earlierTurns };
  }
  return { kind: "hidden" };
}

/** Whether the bar is shown at all (a convenience over the state kind). */
export function controlBarVisible(state: ControlBarState): boolean {
  return state.kind !== "hidden";
}
