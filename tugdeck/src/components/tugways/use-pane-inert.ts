/**
 * usePaneInert — toggle the `inert` attribute on an element, synced to an
 * `active` flag, with cleanup.
 *
 * The shared modality primitive behind pane-modal surfaces. `TugSheet`
 * inerts the whole `.tug-pane-body` (centered modal); `TugControlBar`
 * inerts just the transcript region below it (top-anchored modal — the
 * bar itself stays interactive). Both want the same one thing: while
 * `active`, the target is `inert` (a keyboard + pointer dead zone); when
 * not, the attribute is absent; an unmount-while-active path clears it.
 *
 * Tuglaw alignment:
 *   * [L06] Inertness is appearance-zone state expressed as a DOM
 *     attribute, never React state.
 *   * [L03] Applied in `useLayoutEffect` so the dead zone is live before
 *     the browser paints the modal.
 *
 * `target === null` (the host element not yet resolved, or a pane-less
 * standalone render) is a no-op, mirroring `useTugPaneScrim`'s null-chrome
 * fallback.
 *
 * @module components/tugways/use-pane-inert
 */

import { useLayoutEffect } from "react";

export function usePaneInert(target: Element | null, active: boolean): void {
  useLayoutEffect(() => {
    if (target === null) return;
    if (!active) {
      // Defensive clear: a prior active cycle on this same target may
      // have left the attribute set (its cleanup runs only on dep change
      // / unmount).
      target.removeAttribute("inert");
      return;
    }
    target.setAttribute("inert", "");
    return () => {
      target.removeAttribute("inert");
    };
  }, [target, active]);
}
