/**
 * useCompanionPopupBinding — observe DOM focus on an owner element and
 * fire a dismiss callback when focus transitions out of the owner's
 * subtree.
 *
 * Per `tugplan-tide-popup-bindings.md` [D05] (#companion-binding) /
 * [D05]'s rationale: companion popups (the editor's `@`/`/`/`:` typeahead;
 * future hover-style cards anchored to a host) auto-dismiss when the
 * user is no longer working in the host. The signal that "the user is
 * no longer working in the host" is **DOM focus leaving the owner
 * element's subtree** — not a chain first-responder change.
 *
 * Why DOM focus and not first responder: with the existing `TugButton`
 * discipline (`data-tug-focus="refuse"` + `suppressButtonFocusShift`),
 * clicking a service-popup trigger does NOT change first responder.
 * The signal that *does* change is DOM focus: Radix's
 * `FocusScope.onMountAutoFocus` programmatically focuses the first
 * menu item when the popup opens, blurring the editor's contentDOM.
 * Observing first responder would miss this case (the central
 * motivating bug); observing DOM focus catches it.
 *
 * ## Signal pipeline
 *
 *   1. Document-level `focusout` and `focusin` listeners (capture
 *      phase) installed in `useLayoutEffect` per [L03].
 *   2. Each listener queues a microtask that reads
 *      `document.activeElement` and asks `ownerEl.contains(...)`.
 *      The microtask defer is load-bearing: when DOM focus moves
 *      between two siblings inside the owner, `focusout` fires before
 *      `focusin`, and reading `activeElement` synchronously inside
 *      `focusout` may see `<body>` (the transient state). The
 *      microtask reads stable post-transition `activeElement`.
 *   3. A closure-local `isFocusedInside` boolean memoizes the last
 *      observation. `onShouldDismiss` fires exactly on the
 *      true→false transition (was-inside → now-outside). The hook
 *      re-arms automatically on the next inside-direction
 *      transition.
 *
 * ## Tuglaws
 *
 * - **[L02]** — DOM focus is browser-owned external state. The hook
 *   subscribes via DOM events and never mirrors the focus position
 *   into React state.
 * - **[L03]** — listeners install in `useLayoutEffect` so they are
 *   live before any user gesture can fire after a render.
 * - **[L06]** — DOM focus is appearance-zone state. The hook neither
 *   reads nor writes through React render state.
 * - **[L07]** — `onShouldDismiss` is captured in a ref so consumer
 *   re-renders that pass a fresh function identity do not tear down
 *   and re-install the document-level listeners.
 * - **[L22]** — browser focus events are the equivalent of a store-
 *   observer-API for DOM focus. The hook subscribes and dispatches
 *   a side effect; no React render cycle is interposed.
 * - **[L23]** — DOM focus is user-visible state the binding observes
 *   but does not own. The binding does not move focus on its own; it
 *   only signals when the owner has lost it. The consumer's
 *   `onShouldDismiss` callback owns the follow-up action.
 * - **[L24]** — `isFocusedInside` is structure-zone (a closure-local
 *   memoization variable inside `useLayoutEffect`); the DOM focus
 *   signal itself is appearance-zone (browser-owned). No new React
 *   state introduced.
 *
 * @module components/tugways/use-companion-popup-binding
 */

import { useLayoutEffect, useRef } from "react";

/** Options accepted by `useCompanionPopupBinding`. */
export interface CompanionPopupBindingOptions {
  /**
   * The owner DOM element whose focus subtree is observed. Pass the
   * element that loses DOM focus when the user's attention moves to
   * a sibling popup (e.g., the editor's `view.contentDOM`).
   *
   * Tolerant of `null` — when null, the hook installs no listeners
   * and `onShouldDismiss` is never called. This handles the common
   * pre-mount pattern where the consumer's owner ref hasn't settled
   * yet; once a non-null element is supplied on a later render, the
   * hook re-runs its effect and subscribes.
   */
  ownerEl: HTMLElement | null;
  /**
   * Callback invoked exactly once per outside transition. The hook
   * re-arms automatically when focus returns to the owner subtree;
   * subsequent outside transitions fire the callback again.
   *
   * The callback is captured in a ref ([L07]); consumers may pass a
   * fresh function identity each render without re-subscribing the
   * document-level listeners. Reads of consumer state from inside
   * the callback see the latest values.
   */
  onShouldDismiss: () => void;
}

/**
 * Observe DOM focus on `ownerEl`. When focus transitions out of the
 * owner's subtree (and stays out across the next microtask boundary,
 * to ride past in-subtree focus transitions), call `onShouldDismiss`
 * exactly once. Re-arms automatically when focus returns.
 *
 * See the module docstring for the full signal-pipeline rationale,
 * tuglaws compliance, and the why-not-first-responder discussion.
 */
export function useCompanionPopupBinding({
  ownerEl,
  onShouldDismiss,
}: CompanionPopupBindingOptions): void {
  // [L07]: hold the consumer's callback in a ref so a fresh function
  // identity on each render doesn't trigger an effect re-run that
  // tears down and re-installs the document-level listeners.
  const onShouldDismissRef = useRef(onShouldDismiss);
  useLayoutEffect(() => {
    onShouldDismissRef.current = onShouldDismiss;
  });

  useLayoutEffect(() => {
    if (ownerEl === null) return;
    if (typeof document === "undefined") return;

    // [L24] structure zone: closure-local memoization of "is focus
    // currently inside the owner's subtree?" Initialized from the
    // current document state so the first transition we observe is
    // truthful. If the editor mounts already focused, `isFocusedInside`
    // starts true; the first focusout to the popup correctly fires
    // dismiss.
    let isFocusedInside = ownerEl.contains(document.activeElement);

    function checkFocus(): void {
      if (ownerEl === null) return;
      const nowInside = ownerEl.contains(document.activeElement);
      if (isFocusedInside && !nowInside) {
        // True transition: was inside, now outside. Fire dismiss.
        onShouldDismissRef.current();
      }
      isFocusedInside = nowInside;
    }

    function onFocusOut(_e: FocusEvent): void {
      // Microtask defer. focusout fires BEFORE focusin during sibling-
      // to-sibling moves inside the owner's subtree; reading
      // activeElement synchronously here would see <body> and we'd
      // spuriously fire dismiss. Deferring one microtask lets the
      // matching focusin run first, so checkFocus reads the post-
      // transition activeElement.
      queueMicrotask(checkFocus);
    }

    function onFocusIn(_e: FocusEvent): void {
      // Symmetric microtask defer. The focusin handler updates
      // isFocusedInside back to true when focus returns; subsequent
      // focusout transitions then re-arm and fire dismiss correctly.
      queueMicrotask(checkFocus);
    }

    // Capture-phase document-level listeners. focusout/focusin bubble
    // by default, but listening at document with `capture: true`
    // sidesteps any intermediate `stopPropagation` an unrelated
    // ancestor handler might call. Symmetric to other capture-phase
    // listeners in the suite (responder-chain-provider, pane-focus-
    // controller).
    document.addEventListener("focusout", onFocusOut, { capture: true });
    document.addEventListener("focusin", onFocusIn, { capture: true });
    return () => {
      document.removeEventListener("focusout", onFocusOut, { capture: true });
      document.removeEventListener("focusin", onFocusIn, { capture: true });
    };
  }, [ownerEl]);
}
