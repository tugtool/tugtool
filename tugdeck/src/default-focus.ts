/**
 * default-focus.ts — fallback focus targets for cards with no saved
 * `bag.focus` snapshot.
 *
 * A card whose saved bag has no `focus` snapshot — a fresh card, a
 * neighbor card just promoted to active by a tab-close handoff, or a
 * card whose author never tagged a preferred focus target — still
 * needs to receive the caret on activation. Otherwise the user's
 * focus is stranded on the outgoing card and they lose their place.
 *
 * The chain in {@link DEFAULT_FOCUS_SELECTORS} encodes a four-step
 * priority order: card-author opt-in (`data-tug-focus-key="primary"`)
 * first, falling back to any tagged focus target, then to the first
 * persisted form control, and finally to a generic focusable
 * descendant. The catch-all keeps cards without tug-specific metadata
 * sensible by default.
 *
 * ## Why a separate module
 *
 * The utilities here have no React dependency — they read DOM and
 * write `deckTrace` events, both of which are framework-local.
 * Splitting them out lets `focus-transfer.ts` consume them without
 * importing a React component module (which would also create a
 * circular import: `card-host.tsx` already imports from
 * `focus-transfer.ts`).
 *
 * The historical home was `card-host.tsx`, where `[A3]`'s
 * `useLayoutEffect` was the sole consumer. After `[A3]` retires
 * the helper's default-
 * focus path becomes the only production caller.
 *
 * ## Tuglaws
 *
 *   - **L23** — fallback path preserves user-visible state by giving
 *     the activated card *some* focus target rather than leaving the
 *     caret stranded on the outgoing card.
 *   - **L10** — single responsibility: resolve and apply default
 *     focus inside a card root.
 *
 * @module default-focus
 */

import { deckTrace, formatElement } from "./deck-trace";

/**
 * Local replica of `card-host.tsx`'s `isElementHidden`. Detects
 * elements that are visually absent because some ancestor (or the
 * element itself) is `display: none`. `offsetParent` is null in that
 * case for non-`position: fixed` elements; we accept fixed-positioned
 * elements as "not hidden" because they intentionally have no
 * `offsetParent` but remain visible.
 *
 * Replicated rather than imported to keep this module independent of
 * any React component file. The third copy (after `card-host.tsx`'s
 * private one and `focus-transfer.ts`'s replica) is acceptable at
 * this scope — promoting `isElementHidden` into a shared utility
 * module would touch a far wider import surface for no behavior gain.
 */
function isElementHidden(el: HTMLElement | null): boolean {
  if (el === null) return false;
  if (el.offsetParent === null) {
    const style =
      typeof window !== "undefined" &&
      typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(el)
        : null;
    if (style !== null && style.position === "fixed") return false;
    return true;
  }
  return false;
}

/**
 * Default focus selector fallback chain, tried in priority order. A
 * card whose saved bag has no `focus` snapshot (fresh card, or a
 * card that was saved without focus on it) still needs to receive
 * the caret on activation — otherwise tab-switch-to-fresh-card
 * leaves focus stranded on the outgoing card's input, which is
 * broken UX.
 *
 * Priority order:
 *   1. `[data-tug-focus-key="primary"]` — card author's declared
 *      primary focus target. Highest signal; authors who care
 *      about default focus opt in by tagging their preferred
 *      element.
 *   2. `[data-tug-focus-key]` with any value — any tagged focus
 *      target. Allows cards to declare a focus target without
 *      naming it "primary" specifically.
 *   3. `[data-tug-state-key]` — first persisted form control.
 *      Gallery-input-style cards with no explicit focus-key still
 *      get their first input focused.
 *   4. Generic focusable — input / textarea / select / button /
 *      contenteditable / tabindex>=0. Catch-all so cards without
 *      any tug-specific metadata still receive a sensible default.
 */
export const DEFAULT_FOCUS_SELECTORS: readonly string[] = [
  '[data-tug-focus-key="primary"]',
  "[data-tug-focus-key]",
  "[data-tug-state-key]",
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
];

/**
 * Resolve the default focus target inside `cardRoot` using the
 * priority chain above. Returns the first selector that matches a
 * live, connected, non-hidden element.
 */
export function resolveDefaultFocusTarget(cardRoot: HTMLElement): {
  el: HTMLElement | null;
  selector: string;
} {
  for (const selector of DEFAULT_FOCUS_SELECTORS) {
    const el = cardRoot.querySelector<HTMLElement>(selector);
    if (el !== null && el.isConnected && !isElementHidden(el)) {
      return { el, selector };
    }
  }
  return { el: null, selector: "" };
}

/**
 * Apply the default focus target for a card that has no saved
 * focus snapshot. Emits a `focus-call` deck-trace event so the
 * activation is observable on the same channel as snapshot-based
 * restores.
 *
 * Respects existing focus inside the card — if the user's caret
 * is already somewhere in `cardRoot`, that wins over the default
 * (same semantics as `applyFocusSnapshot`).
 *
 * `opts.preventScroll` forwards to the underlying `focus()` call.
 * Pass `true` from sites where the user-visible scroll position
 * must not change as a side effect of the focus claim — notably
 * the window-focus reactivation path, where the focus call is a
 * synchronous re-claim against an element the browser has already
 * focused, and any scroll-into-view would visibly move the
 * surrounding card content (e.g. dragging a tide-card transcript
 * down to keep the editor in view).
 */
export function traceApplyDefaultFocus(
  site: string,
  cardId: string,
  cardRoot: HTMLElement,
  opts?: { preventScroll?: boolean },
): void {
  const doc = cardRoot.ownerDocument;
  const activeBefore = formatElement(doc.activeElement);

  // Respect any focus already inside the card. Matches
  // `applyFocusSnapshot`'s contract — a click that landed during
  // the restore window wins over the default.
  const currentActive = doc.activeElement;
  if (currentActive instanceof HTMLElement && cardRoot.contains(currentActive)) {
    deckTrace.record({
      kind: "focus-call",
      site,
      cardId,
      targetSelector: "already-inside-card",
      activeBefore,
      activeAfter: activeBefore,
      hidden: false,
    });
    return;
  }

  const { el: target, selector: targetSelector } =
    resolveDefaultFocusTarget(cardRoot);
  if (target !== null) {
    if (opts?.preventScroll === true) {
      target.focus({ preventScroll: true });
    } else {
      target.focus();
    }
  }

  const activeAfter = formatElement(doc.activeElement);
  deckTrace.record({
    kind: "focus-call",
    site,
    cardId,
    targetSelector: target !== null ? targetSelector : "none",
    activeBefore,
    activeAfter,
    hidden: target !== null ? isElementHidden(target) : false,
  });
}
