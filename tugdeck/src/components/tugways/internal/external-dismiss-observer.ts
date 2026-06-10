/**
 * external-dismiss-observer — the "user clicked outside any popup" predicate for
 * close-focus restoration.
 *
 * A popup-class surface (popover, menu) restores focus to its opener on close —
 * UNLESS the close was triggered by the user clicking some other surface, in
 * which case that surface should keep focus and the engine must not yank it back.
 * Every popup-class surface lives inside the single canvas-overlay root, so the
 * test is simply: did a `pointerdown` during the open lifetime land OUTSIDE that
 * root? This is the one close-focus signal the focus engine cannot derive from
 * its own state — the responder chain and key view know nothing about where the
 * pointer went.
 *
 * Two pieces: a pure containment function ({@link isOutsideOverlay}, unit-tested
 * with no DOM) and a hook ({@link useExternalPointerdownObserver}) that installs
 * a document capture-phase listener while the surface is open and records the
 * verdict in a ref the consumer reads at close time.
 *
 * Mirrors the predicate `useServicePopupBinding` carries for menus; extracted
 * here so the engine focus trap (`useFocusTrap`) and the menu binding can share
 * one implementation as menus migrate.
 *
 * Laws: [L22]/[L24] — a document observer held in refs and installed in a layout
 * effect (structure zone), never React state.
 */

import { useLayoutEffect, useRef, type MutableRefObject } from "react";

/**
 * Whether `target` is OUTSIDE `overlayRoot` — a pointerdown that did not land on
 * any popup-class surface. A `null` target counts as outside. `overlayRoot` is
 * anything with a DOM-`contains` method (the canvas overlay root in production; a
 * fake in tests).
 */
export function isOutsideOverlay(
  target: Node | null,
  overlayRoot: Pick<Node, "contains">,
): boolean {
  if (target === null) return true;
  return !overlayRoot.contains(target);
}

/**
 * While `active`, watch document `pointerdown`s (capture phase, so we observe the
 * click before any popup-internal handler can `stopPropagation`) and record
 * whether one landed outside `overlayRoot`. Returns a ref the consumer reads at
 * close time: `true` means the user dismissed by clicking elsewhere, so close
 * focus should NOT be restored. Resets to `false` on each (re)activation; the
 * listener is removed on deactivate / unmount.
 */
export function useExternalPointerdownObserver(
  active: boolean,
  overlayRoot: Pick<Node, "contains">,
): MutableRefObject<boolean> {
  const wasExternalRef = useRef(false);
  // Read the latest root at event time without re-installing the listener.
  const overlayRootRef = useRef(overlayRoot);
  overlayRootRef.current = overlayRoot;

  useLayoutEffect(() => {
    if (!active || typeof document === "undefined") return;
    wasExternalRef.current = false;
    const onPointerDown = (e: PointerEvent): void => {
      if (isOutsideOverlay(e.target as Node | null, overlayRootRef.current)) {
        wasExternalRef.current = true;
      }
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [active]);

  return wasExternalRef;
}
