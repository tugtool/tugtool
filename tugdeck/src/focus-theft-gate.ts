/**
 * focus-theft-gate.ts — the one question every programmatic refocus
 * path must ask before calling `.focus()` ([A8]).
 *
 * ## Why this exists
 *
 * When the framework wants to restore keyboard focus into a card —
 * after a reload, a tab switch, a pane activation, or an app-level
 * re-activation — it needs to know whether doing so would steal focus
 * from the user. Past incidents ([R07]) showed individual refocus
 * helpers diverging on what "safe" means, each patching a slightly
 * different edge case. This module is the single source of truth.
 *
 * Every callsite that would otherwise write its own
 * `if (document.hasFocus() && activeElement === body)` check routes
 * through {@link canProgrammaticallyFocus} instead.
 *
 * ## The decision tree
 *
 * Given a target card and the current deck state, in order:
 *
 *   1. `state.hasFocus === false` → **false** (app is backgrounded —
 *      touching `.focus()` while another window owns the caret is
 *      how [R07] reloads-steal-typing bugs happen).
 *   2. The target is not the current focus destination (from
 *      {@link isFocusDestination}) → **false** (the caller's model
 *      of "active card" is stale; refuse rather than racing).
 *   3. `document.activeElement === document.body` → **true**
 *      (nothing to steal).
 *   4. Focus is already inside the target card's host element
 *      (opt-in via `opts.targetCardHostEl`) → **true** (refocus is
 *      either a no-op or a caret refinement within the same card).
 *   5. Focus is inside a non-focus-capturing chrome element (see
 *      {@link isNonFocusCapturingChrome}) → **true** (transient
 *      focus on drag handles, tab buttons between clicks, etc. —
 *      the user hasn't actually moved focus to a new control).
 *   6. Otherwise → **false** (the user has focus somewhere real;
 *      don't steal).
 *
 * ## Opting chrome elements in
 *
 * Chrome elements that briefly own `activeElement` between
 * interactions — pane drag handles, pane-header collapse buttons,
 * tab buttons, etc. — mark themselves with
 * `data-tug-chrome="non-focus-capturing"`. The predicate is
 * ancestor-aware (matches any ancestor with the attribute) so a
 * wrapping chrome region covers its descendants without per-leaf
 * tagging.
 *
 * The allowlist is deliberately conservative: it starts small and
 * grows one callsite at a time. Nothing else gets treated as
 * "safe to steal from" — real inputs, buttons in card content,
 * editor surfaces, and any untagged chrome all return `false`.
 *
 * ## Framework-local, no global state, no DOM mutation
 *
 * This module is pure. It reads `document.activeElement`, checks
 * the element against the deck store's snapshot, and returns a
 * boolean. No side effects — callers decide whether to act.
 */

import type { DeckState } from "./layout-tree";
import { isFocusDestination } from "./deck-store-selectors";

/**
 * Data attribute that chrome elements set to opt out of being
 * treated as "the user has real focus here." Applied either
 * directly on the focusable element or on an ancestor wrapping a
 * region of chrome.
 */
const CHROME_MARKER_ATTR = "data-tug-chrome";
const CHROME_MARKER_VALUE = "non-focus-capturing";

/**
 * True when `el` is inside (or is) an element marked as
 * non-focus-capturing chrome. Used to distinguish "focus is on a
 * drag handle during a pane move" from "user is typing in this
 * control." Null and non-element nodes return false.
 *
 * Implementation note: Element.closest matches the element itself
 * first, then walks ancestors. This makes `data-tug-chrome` work
 * whether it sits on the focused element or on a wrapping region.
 */
export function isNonFocusCapturingChrome(el: Element | null): boolean {
  if (!el) return false;
  return el.closest(`[${CHROME_MARKER_ATTR}="${CHROME_MARKER_VALUE}"]`) !== null;
}

/**
 * Options for {@link canProgrammaticallyFocus}. Kept optional so
 * callsites that don't yet know their card host element can still
 * use the gate — the host-element check just falls through in that
 * case (branch 4 returns false; later branches still apply).
 */
export interface CanProgrammaticallyFocusOptions {
  /**
   * The target card's host content element, if known. When
   * provided, focus already inside this element counts as "safe
   * to refocus" (the caller is refining caret position within the
   * same card, not stealing from elsewhere).
   */
  targetCardHostEl?: HTMLElement | null;
}

/**
 * Returns `true` iff it's safe for a programmatic refocus helper
 * to call `.focus()` on something inside the target card. See the
 * file header for the full decision tree.
 *
 * This function is the central gate: every programmatic refocus
 * path in the framework consults it before stealing the caret.
 * Never add a local `document.hasFocus()` check alongside — that's
 * how the pre-[A8] divergence happened.
 *
 * Non-React-safe: reads `document.activeElement` directly, so
 * callers that care about timing should invoke it inside
 * `useLayoutEffect` (same phase the refocus would run in).
 */
export function canProgrammaticallyFocus(
  targetCardId: string,
  state: DeckState,
  opts?: CanProgrammaticallyFocusOptions,
): boolean {
  // Branch 1: app not foreground.
  if (!state.hasFocus) return false;

  // Branch 2: target isn't the focus destination right now.
  if (!isFocusDestination(targetCardId, state)) return false;

  // Guard against non-browser contexts. If there's no document,
  // there's no focus to steal — treat as safe.
  if (typeof document === "undefined") return true;

  const active = document.activeElement;

  // Branch 3: body has focus — nothing to steal.
  if (active === null || active === document.body) return true;

  // Branch 4: focus is already inside the target card.
  const hostEl = opts?.targetCardHostEl ?? null;
  if (hostEl !== null && hostEl.contains(active)) return true;

  // Branch 5: focus is on non-focus-capturing chrome.
  if (isNonFocusCapturingChrome(active)) return true;

  // Branch 6: user has focus somewhere real. Don't steal.
  return false;
}
