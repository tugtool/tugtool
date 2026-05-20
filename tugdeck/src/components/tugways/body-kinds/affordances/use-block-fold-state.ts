/**
 * `useBlockFoldState` — shared collapse-state hook for body kinds.
 *
 * Every body kind with an expand / collapse axis (`FileBlock`,
 * `DiffBlock`, `TerminalBlock`, `AgentTranscriptBlock`, and the body
 * kinds yet to come) needs the exact same four-part state machine:
 *
 *  1. **Controlled / uncontrolled resolution.** A `collapsed` prop,
 *     when supplied, makes the parent the owner; when omitted, the
 *     body kind owns the value internally. No `useEffect` syncs the
 *     prop into state — the prop is read directly on every render so
 *     the two modes stay cleanly separable (a sync effect would
 *     create a "prop says X, local state says Y" divergence after a
 *     click in uncontrolled mode).
 *  2. **Mount-in-saved-state.** The [A9] component-state axis stores
 *     the uncontrolled flag; `useSavedComponentState` reads it
 *     synchronously in render and seeds `useState`'s initializer, so
 *     the first paint already reflects the user's last-saved fold.
 *  3. **Capture registration.** `useComponentStatePreservation`
 *     registers the resolved flag for capture so a Developer > Reload
 *     round-trips it.
 *  4. **The toggle.** A reference-stable setter that updates the
 *     internal state (uncontrolled only) and fires the change
 *     notification.
 *
 * Before this hook each body kind hand-rolled all four — four copies
 * that had to be kept in lockstep by hand. The hook is the single
 * definition; the body kinds supply only what genuinely differs: the
 * `defaultCollapsed` seed (line count over a cap, recursion past a
 * depth cap, …) and the optional controlled prop / notification.
 *
 * The companion affordance is `BlockFoldCue` — the chevron + label
 * button. A body kind pairs `useBlockFoldState` (state) with
 * `BlockFoldCue` (the control) and the fold feature is complete.
 *
 * Persisted shape. The hook owns the whole `{ collapsed: boolean }`
 * preservation bag for its key. A body kind that needs to persist
 * *more* than the fold (a per-node expand map, a scroll position)
 * keeps that on its own separate key / axis — the fold key is the
 * hook's exclusively.
 *
 * Laws:
 *  - [L02] saved state enters React through `useSyncExternalStore`
 *    (inside `useSavedComponentState`); the hook never reaches around
 *    it.
 *  - [L03] capture registration happens in a `useLayoutEffect`
 *    (inside `useComponentStatePreservation`).
 *  - [L06] `collapsed` is logical state — it controls *which* subtree
 *    renders, not *how* a rendered element looks — so it is React
 *    state, not a DOM attribute the hook writes.
 *
 * @module components/tugways/body-kinds/affordances/use-block-fold-state
 */

import React from "react";

import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "@/components/tugways/use-component-state-preservation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseBlockFoldStateOptions {
  /**
   * Controlled collapsed value. When defined, the parent owns the
   * state: `collapsed` mirrors this prop and `setCollapsed` only
   * fires the change notification (the parent is expected to flip
   * the prop). When undefined, the hook owns the value internally.
   */
  collapsed?: boolean;

  /**
   * The collapsed value used on the very first uncontrolled mount
   * when there is no saved state — typically a threshold-derived
   * boolean (line count over the cap, recursion depth past the
   * cap). Ignored in controlled mode and whenever a saved value
   * exists for `componentStatePreservationKey`.
   */
  defaultCollapsed: boolean;

  /**
   * Change notification, fired with the next value on every toggle.
   * In controlled mode it is the parent's cue to update the
   * `collapsed` prop; in uncontrolled mode it is purely
   * informational. Optional — a body kind with no controlled
   * consumer (e.g. `AgentTranscriptBlock`) omits it.
   */
  onToggleCollapsed?: (next: boolean) => void;

  /**
   * [A9] component-state-preservation key. When set, the resolved
   * `collapsed` flag is persisted into `bag.components` so a
   * Developer > Reload restores the fold, and the saved value seeds
   * the uncontrolled initial state. Undefined opts out (gallery,
   * standalone) — the hook still tracks state, it just is not
   * preserved.
   */
  componentStatePreservationKey?: string;
}

export interface BlockFoldState {
  /**
   * The resolved collapsed value. The controlled prop wins when
   * provided; otherwise the hook's internal state.
   */
  collapsed: boolean;

  /**
   * Toggle the fold to `next`. Updates the hook's internal state in
   * uncontrolled mode (a no-op on internal state in controlled mode),
   * then fires `onToggleCollapsed`. Reference-stable across renders
   * except when the controlled prop or `onToggleCollapsed` identity
   * changes. A body kind that needs extra side effects on toggle
   * (e.g. first-responder promotion) wraps this in its own callback.
   */
  setCollapsed: (next: boolean) => void;
}

/** The serialized shape this hook owns on the [A9] component-state axis. */
interface FoldPersistedState {
  collapsed?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Resolve a body kind's expand / collapse state. See the module
 * header for the model. Returns the resolved `collapsed` flag and a
 * reference-stable `setCollapsed` toggle; the body kind hands
 * `setCollapsed` (or a wrapper around it) to its `BlockFoldCue`.
 */
export function useBlockFoldState(
  options: UseBlockFoldStateOptions,
): BlockFoldState {
  const {
    collapsed: collapsedProp,
    defaultCollapsed,
    onToggleCollapsed,
    componentStatePreservationKey,
  } = options;

  // Mount-in-saved-state: read the saved fold synchronously in render
  // so `useState`'s initializer seeds local state with the user's
  // last-saved value. The initializer runs once; there is no
  // post-mount apply path.
  const saved = useSavedComponentState<FoldPersistedState>(
    componentStatePreservationKey,
  );
  const [localCollapsed, setLocalCollapsed] = React.useState<boolean>(() =>
    typeof saved?.collapsed === "boolean" ? saved.collapsed : defaultCollapsed,
  );

  // Computed-value resolution — the prop wins when provided, local
  // state covers the uncontrolled case. Read directly every render.
  const collapsed =
    collapsedProp !== undefined ? collapsedProp : localCollapsed;

  const setCollapsed = React.useCallback(
    (next: boolean) => {
      // In controlled mode the parent owns the value; touching local
      // state would create a divergent second source of truth.
      if (collapsedProp === undefined) {
        setLocalCollapsed(next);
      }
      onToggleCollapsed?.(next);
    },
    [collapsedProp, onToggleCollapsed],
  );

  // Register the resolved flag for [A9] capture. Persisting the
  // resolved value (not just local state) is correct: in controlled
  // mode the parent's prop is the live truth, and that is what a
  // reload should restore.
  useComponentStatePreservation<FoldPersistedState>({
    componentStatePreservationKey,
    captureState: () => ({ collapsed }),
  });

  return { collapsed, setCollapsed };
}
