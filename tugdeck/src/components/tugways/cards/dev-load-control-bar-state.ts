/**
 * dev-load-control-bar-state — the pure state machine behind the Z0
 * `TugControlBar` in the dev transcript ([recency P09]).
 *
 * The bar carries three things over its life — a **loading** progress
 * indicator (cold restore or load-previous, card modal), a **prompt**
 * ("There are N earlier messages…", non-modal), or **nothing**. Two pure
 * functions, unit-tested in isolation from React/DOM:
 *
 *   - {@link deriveControlBarState} — maps the current inputs (store
 *     snapshot + scroll edges + the lingering flag) to the visual state.
 *   - {@link reduceLingering} — the small transition the "lingering after
 *     a load-previous" flag follows: set on load-previous completion,
 *     cleared the next time the user reaches the bottom or submits.
 *
 * The host calls these to toggle the bar's DOM (`data-visible`, the
 * `modal` flag) imperatively ([L06]); these functions hold no React/DOM.
 *
 * @module components/tugways/cards/dev-load-control-bar-state
 */

/** Which load is in flight (drives progress source + Cancel routing). */
export type ControlBarLoadKind = "restore" | "previous";

/** The bar's resolved visual state. */
export type ControlBarState =
  | { kind: "hidden" }
  | { kind: "loading"; loadKind: ControlBarLoadKind }
  | { kind: "prompt"; earlierCount: number; lingering: boolean };

export interface ControlBarInputs {
  /** A load (cold restore or load-previous) is in flight → modal progress. */
  loadActive: boolean;
  /** Which load is active (null when none). */
  loadKind: ControlBarLoadKind | null;
  /** Whether older messages remain to page in (drives the prompt). */
  hasOlder: boolean;
  /** Count of older (unloaded) messages, for the prompt copy. */
  earlierCount: number;
  /** The user has scrolled to the top of the transcript. */
  atTop: boolean;
  /** Post-load-previous lingering flag (see {@link reduceLingering}). */
  lingering: boolean;
}

/**
 * Resolve the bar's visual state. Precedence:
 *   1. A load in flight → `loading` (modal progress), regardless of scroll.
 *   2. Older messages remain AND the user is at the top OR lingering after
 *      a load-previous → `prompt` (non-modal).
 *   3. Otherwise → `hidden`.
 *
 * `lingering` is already cleared by {@link reduceLingering} on
 * scroll-to-bottom / submit, so the prompt persists exactly until then.
 */
export function deriveControlBarState(input: ControlBarInputs): ControlBarState {
  if (input.loadActive && input.loadKind !== null) {
    return { kind: "loading", loadKind: input.loadKind };
  }
  if (input.hasOlder && (input.atTop || input.lingering)) {
    return {
      kind: "prompt",
      earlierCount: input.earlierCount,
      lingering: input.lingering,
    };
  }
  return { kind: "hidden" };
}

/** Whether the bar is shown at all (a convenience over the state kind). */
export function controlBarVisible(state: ControlBarState): boolean {
  return state.kind !== "hidden";
}

/** Whether the bar should hold the card modal (only while loading). */
export function controlBarModal(state: ControlBarState): boolean {
  return state.kind === "loading";
}

/** Events that move the lingering flag. */
export type LingeringEvent =
  | { type: "load-previous-complete" }
  | { type: "scrolled-to-bottom" }
  | { type: "submit" };

/**
 * Transition the post-load-previous lingering flag: a completed
 * load-previous starts it (so the prompt stays put for "load more" even
 * though held scroll left the user below the top); reaching the bottom or
 * submitting clears it. A cold restore does not start it (it lands at the
 * bottom — nothing to linger over).
 */
export function reduceLingering(prev: boolean, event: LingeringEvent): boolean {
  switch (event.type) {
    case "load-previous-complete":
      return true;
    case "scrolled-to-bottom":
    case "submit":
      return false;
  }
}
