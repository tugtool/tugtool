/**
 * CanvasOverlayRoot — the single canvas-level overlay container.
 *
 * Mounted once inside `<DeckCanvas />` as a sibling of the inner
 * pane-container `<div>` (not a descendant). Renders one `<div>` with
 * `position: fixed; inset: 0; pointer-events: none` so popup-class
 * primitives that portal into it escape every pane's `overflow: hidden`
 * clip while sitting visually above the entire pane tree. Children opt
 * back into pointer events with `pointer-events: auto`.
 *
 * ## Single-root invariant
 *
 * Today there is exactly one `<DeckCanvas />` per tab and therefore
 * exactly one `<CanvasOverlayRoot />`. The registry stores a single
 * element. A second concurrent registration replaces the previous one
 * and emits a dev-mode warning — the warning is informative; replacing
 * is also the right behavior under HMR (Vite may briefly mount a
 * replacement before unmounting the old one).
 *
 * ## L19 expectations
 *
 * - `data-slot="tug-canvas-overlay-root"` on the rendered `<div>` for
 *   stable querying / e2e tests.
 * - No `@tug-pairings` annotation — the root has no foreground/background
 *   pairings to declare; it is transparent.
 * - No `@tug-renders-on` annotation — the root sets no color-related
 *   properties; the `audit:tokens lint` rule only fires for `color` /
 *   `fill` / `border-color` declarations without a paired surface.
 * - No dedicated CSS file. The four declarations are inline because
 *   the root has no theming hooks. If the root grows to need per-theme
 *   tokens later, promote to a CSS file at that time.
 * - Empty props interface — the call site is unambiguous.
 *
 * ## Lifecycle
 *
 * Registers itself with `canvas-overlay-registry` in `useLayoutEffect`
 * and unregisters in cleanup. The synchronous-notify contract on the
 * registry means consumers observe the new root inside the same commit
 * cycle that registered it.
 *
 * ## Focus-discipline disambiguation
 *
 * Per `tugplan-tide-overlay-framework.md` [D01] (#mental-model), this
 * root no longer carries `data-tug-focus="refuse"`. Pane-focus-
 * controller's "skip clicks inside the canvas overlay" check keys on
 * `data-slot="tug-canvas-overlay-root"` (the slot above) directly,
 * decoupled from the button-class chain-promotion / browser-focus-
 * prevention semantics that `data-tug-focus="refuse"` now exclusively
 * controls. One attribute, one semantic. Modals portaled here (sheets,
 * popovers, completions) are free to claim first responder without
 * inheriting an ill-fitting refuse marker.
 *
 * See (#mental-model) for the five-subsystem architecture (portals,
 * responder chain, focus events, pane focus controller, focus-
 * discipline markers) this root participates in.
 *
 * Laws: [L02] consumers observe the registered root via the registry's
 *        `subscribe` API + `useSyncExternalStore` (in `use-canvas-overlay.ts`),
 *        [L03] register/unregister run in `useLayoutEffect` so the root
 *        is reachable before any consumer's effect-time portal call,
 *        [L06] no React state on this component — the root element
 *        identity is the only state and it is captured via ref,
 *        [L19] component authoring guide adherence (see above),
 *        [L25] mounted at the Deck level by `<DeckCanvas />`, not by
 *        any pane or card.
 *
 * Decisions: [D01] canvas-scoped (not body-scoped),
 *            [D07] mount inside `DeckCanvas`'s outer responder wrapper
 *            as a sibling of the pane container,
 *            [D09] root component lives in `chrome/`; registry + hook
 *            live in `lib/` (substrates consume the hook).
 *
 * Framework decisions:
 *   - `tugplan-tide-overlay-framework.md` [D01] — focus-discipline
 *     attribute disambiguation; pane-focus-controller selector decoupled
 *     from `data-tug-focus="refuse"`.
 *
 * @module components/chrome/canvas-overlay-root
 */

import { useLayoutEffect, useRef } from "react";

import * as canvasOverlayRegistry from "@/lib/canvas-overlay-registry";

// ---- Props ----

/**
 * `<CanvasOverlayRoot />` takes no props. The single-root invariant is
 * encoded structurally: there is one DeckCanvas, which mounts one
 * `<CanvasOverlayRoot />`. Adding configurability would invite
 * accidental multi-mount (and the registry's dev warning is exactly
 * the signal that someone added that bug).
 */
export interface CanvasOverlayRootProps {}

// ---- Component ----

/**
 * Render the canvas overlay root. The element is registered with the
 * `canvas-overlay-registry` on mount and unregistered on unmount. The
 * inline style is the entire visual contract — no CSS file is needed
 * for four declarations.
 */
export function CanvasOverlayRoot(_props: CanvasOverlayRootProps): React.ReactElement {
  const elRef = useRef<HTMLDivElement | null>(null);

  // useLayoutEffect (not useEffect) so the registration is visible to
  // any consumer whose own useLayoutEffect runs in the same commit
  // — the mount-time race window described in the plan's
  // (#overlay-root-contract). Order of effects is bottom-up; sibling
  // order matches JSX order. Putting `<CanvasOverlayRoot />` early in
  // DeckCanvas's JSX shrinks (but does not eliminate) the gap. The
  // `useSyncExternalStore` consumer in `use-canvas-overlay.ts`
  // re-renders on the subsequent registration so the gap is invisible
  // for inactive overlays. [L03]
  useLayoutEffect(() => {
    const el = elRef.current;
    if (el === null) return;
    canvasOverlayRegistry.register(el);
    return () => {
      canvasOverlayRegistry.unregister(el);
    };
  }, []);

  // Three layout properties live inline (no token reference, no
  // theming need); z-index lives on a CSS class in chrome.css so it
  // can read the `--tug-z-overlay-base` token. One rule, no new
  // file. [D09 implementation note]
  //
  // The pane-focus-controller's "skip canvas-overlay click" check
  // keys on `data-slot="tug-canvas-overlay-root"` (the slot below) —
  // not on a focus-discipline marker. Per `tugplan-tide-overlay-
  // framework.md` [D01] (#mental-model), focus-discipline attributes
  // (`data-tug-focus="refuse"`) are scoped to button-class chain-
  // promotion / browser-focus-prevention semantics, decoupled from
  // pane-focus-controller behavior. The slot attribute is the
  // direct, unambiguous selector for "I'm inside the canvas overlay
  // tier" — which is what the controller actually wants. Sheets,
  // popups, completions etc. portaled here are free to claim first
  // responder (e.g., a sheet's modal content) without inheriting an
  // ill-fitting refuse marker.
  return (
    <div
      ref={elRef}
      data-slot="tug-canvas-overlay-root"
      className="tug-canvas-overlay-root"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
      }}
    />
  );
}
