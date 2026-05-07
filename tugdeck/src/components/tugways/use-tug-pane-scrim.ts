/**
 * useTugPaneScrim — request the host pane's scrim layer.
 *
 * Modal-class consumers (sheets, future modal surfaces) call this hook
 * to drive the host pane's built-in scrim. The hook returns a stable
 * `{ show, hide }` pair: `show()` raises the scrim (incrementing a
 * per-chrome ref count); `hide()` lowers it (decrementing the count).
 * When the count crosses zero, the pane's `data-scrim` attribute
 * toggles and the chrome's CSS fades the scrim in or out.
 *
 * Pairing: every `show()` must be matched by a `hide()`. The intended
 * shape inside a modal consumer is:
 *
 *     useLayoutEffect(() => {
 *       if (!open) return;
 *       scrim.show();
 *       return () => scrim.hide();
 *     }, [open, scrim]);
 *
 * The cleanup return guarantees that an unmount-while-open path
 * matches the show. The ref count handles overlapping callers (a sheet
 * inside a sheet, or a sheet plus a future loading scrim sharing the
 * same pane chrome) without anybody fighting over the attribute.
 *
 * Standalone fallback: when no `TugPanePortalContext` is in scope
 * (gallery preview, unit test rendered without a `TugPane`), the chrome
 * ref is null and both callbacks no-op. Same shape as
 * `useCanvasOverlay`'s document.body fallback — a pane-less consumer
 * does not crash, it just renders without a scrim.
 *
 * Tuglaw alignment:
 *   * [L06] The scrim is appearance-zone state. Visibility is driven by
 *     a DOM attribute and CSS transition, not React state.
 *   * [L20] The scrim element and its tokens belong to `TugPane`. This
 *     hook only requests visibility — it does not own the surface.
 *   * [L24] The ref count is structural state (lives in a module-level
 *     registry). The attribute is appearance state. The two are bridged
 *     in the registry, not in React's render cycle.
 *
 * @module components/tugways/use-tug-pane-scrim
 */

import { useCallback, useContext, useMemo } from "react";

import { TugPanePortalContext } from "@/components/chrome/tug-pane";
import * as paneScrimRegistry from "@/lib/pane-scrim-registry";

export type TugPaneScrimController = {
  /** Raise the scrim on the host pane. Idempotent in standalone scope. */
  show: () => void;
  /** Lower the scrim on the host pane. Idempotent in standalone scope. */
  hide: () => void;
};

/**
 * Return a `{ show, hide }` controller for the host pane's scrim. The
 * returned object identity is stable across renders for a given chrome
 * element so consumers can put it in a `useLayoutEffect` dep array
 * without re-firing on unrelated parent renders.
 */
export function useTugPaneScrim(): TugPaneScrimController {
  const chromeEl = useContext(TugPanePortalContext);

  const show = useCallback(() => {
    paneScrimRegistry.increment(chromeEl);
  }, [chromeEl]);

  const hide = useCallback(() => {
    paneScrimRegistry.decrement(chromeEl);
  }, [chromeEl]);

  return useMemo(() => ({ show, hide }), [show, hide]);
}
