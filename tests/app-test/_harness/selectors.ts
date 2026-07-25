/**
 * selectors.ts — shared selectors for strings and marks the app-tests mirror
 * from product source.
 *
 * A test that spells a product string inline goes stale silently when the
 * product renames it: the selector still parses, `querySelector` still returns
 * `null`, and the failure reads as a behavior regression instead of a rename.
 * Renaming `aria-label="Route this input"` once broke seven files that way.
 *
 * Every constant here names the product file it mirrors. When that source
 * changes, this module is the one place to update — and because it lives in
 * `_harness/`, `app-test-changed` prints a SWEEP ADVISED advisory for the edit,
 * which is the correct scope for a selector rename.
 *
 * Engine marks are grouped separately: they are written by the focus engine's
 * projection, not by a component, and they are the vocabulary [P07] assertions
 * speak in ("the keyboard is here" is `[data-key-view]`, not
 * `contains(document.activeElement)`).
 */

/** Mirrors `aria-label` in `tugdeck/src/components/tugways/tug-prompt-entry.tsx`. */
export const ROUTE_BUTTON = 'button[aria-label="Route this input"]';

/** Mirrors the dialog island class names in `tugdeck/src/components/chrome/`. */
export const QUESTION_DIALOG = ".session-question-dialog";
export const PERMISSION_DIALOG = ".session-permission-dialog";

/**
 * Engine marks, written by `FocusManager`/`FocusContext` projection in
 * `tugdeck/src/components/tugways/focus-manager.ts`.
 */
export const KEY_VIEW = "[data-key-view]";
export const KEY_VIEW_KBD = "[data-key-view-kbd]";
export const KEY_WITHIN = "[data-key-within]";
export const KEY_CURSOR = "[data-key-cursor]";
export const DEFAULT_RING = "[data-default-ring]";
export const FIRST_RESPONDER = "[data-first-responder]";
export const FOCUSABLE = "[data-tug-focusable]";

/**
 * The keyboard sink: where the engine parks `document.activeElement` on the
 * `engine-routed` route. It lives OUTSIDE every card host, which is exactly why
 * card-containment of `document.activeElement` is not a test for "the keyboard
 * is in this card."
 */
export const KEY_SINK = "[data-tug-key-sink]";

/** The card host wrapper for a given card id. */
export function cardHost(cardId: string): string {
  return `[data-card-host][data-card-id=${JSON.stringify(cardId)}]`;
}

/**
 * A page-side expression that is true when the keyboard is in `cardId`, stated
 * as an engine fact with the dom-granted case as an explicit alternative.
 *
 * Under the focus engine there are two legal shapes: the engine parks the sink
 * outside the card and marks the card's key view (`engine-routed`), or it
 * grants a text surface real DOM focus inside the card (`dom-granted`). Either
 * satisfies "the keyboard is here"; only the second one puts
 * `document.activeElement` inside the card host.
 *
 * The deck-side half reads `getActiveCardId()` — the composite first-responder
 * bit, which is the card the engine follows as its key card. Not
 * `getFocusedCardId()`, despite the name: that one reports the TOPMOST pane's
 * active card, a z-order fact that never goes null while any pane exists.
 */
export function keyboardIsInCard(cardId: string): string {
  const host = JSON.stringify(cardHost(cardId));
  return `(function(){
  var host = document.querySelector(${host});
  if (host === null) return false;
  if (typeof window.__tug === "undefined") return false;
  if (window.__tug.getActiveCardId() !== ${JSON.stringify(cardId)}) return false;
  var keyView = host.querySelector(${JSON.stringify(KEY_VIEW)});
  var fr = document.querySelector(${JSON.stringify(FIRST_RESPONDER)});
  var frInCard = fr !== null && host.contains(fr);
  var domGranted = document.activeElement !== null && host.contains(document.activeElement);
  return keyView !== null || frInCard || domGranted;
})()`;
}
