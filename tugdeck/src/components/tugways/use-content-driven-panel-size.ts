/**
 * useContentDrivenPanelSize — consumer hook for content-driven panel growth.
 *
 * Drives the transient size of a TugSplitPanel based on content-size
 * signals from a source element (typically an overflow-auto editor).
 * Interacts with the panel exclusively via the two handle methods
 * dedicated to this path:
 *
 *   panel.setTransientSize(pct)  — grow the pane to fit content
 *   panel.restoreUserSize()      — snap back to the user's saved size
 *
 * These methods are gated by the sync flag in `TugSplitPane`, so this
 * hook cannot accidentally trigger the user-drag path (no userSize
 * update, no tugbank write). The persistence-vs-transient separation
 * is enforced by the primitive — the hook just picks the right method
 * for the signal.
 *
 * ## Formula
 *
 *   overflow = source.scrollHeight > source.clientHeight
 *   empty    = source dataset["empty"] === "true"
 *   chrome   = wrapperEl.clientHeight - source.offsetHeight
 *   fitPct   = ((source.scrollHeight + chrome) / groupEl.offsetHeight) * 100
 *
 *   empty    → panel.restoreUserSize()
 *   overflow → panel.setTransientSize(fitPct)
 *   else     → no-op (stable; no mid-edit shrink, see reset plan L8)
 *
 * ## Representation
 *
 * All sash positions are in percent (0..100) — the unit used by the
 * handle, the library's store, and tugbank. Pixel signals from content
 * are converted to a percentage of the group's height once per
 * recompute; everything downstream stays in percent.
 *
 * ## Observers
 *
 * - MutationObserver on the source's subtree: typing, paste,
 *   `data-empty` flips, style/class mutations from theme or settings
 *   stores.
 * - ResizeObserver on the panel element: container rewraps. Filtered
 *   to inline-size changes only so our own block-size writes do not
 *   echo.
 *
 * The panel element is derived from the source via
 * `source.closest("[data-panel]")`. The library renders each panel as
 * `<div data-panel><div>...</div></div>`; the first child is the
 * wrapper used for chrome measurement.
 *
 * Laws: [L03] useLayoutEffect for registrations, [L06] appearance via
 *       DOM writes, [L07] refs in handlers, [L13] instant writes, no
 *       CSS transition, [L22] DOM observations drive DOM writes.
 */

import { useLayoutEffect, type RefObject } from "react";
import type { TugSplitPanelHandle } from "./tug-split-pane";

export interface UseContentDrivenPanelSizeOptions {
  /** Ref to the panel's imperative handle. */
  panelRef: RefObject<TugSplitPanelHandle | null>;
  /**
   * Ref to the scroll-source element inside the panel. Must use
   * `overflow-y: auto` (or equivalent) so its `scrollHeight` reports
   * intrinsic content height when overflowing. The `data-empty="true"`
   * attribute on the same element acts as the explicit snap-back
   * signal.
   */
  sourceRef: RefObject<HTMLElement | null>;
  /**
   * When false, the hook installs no observers and never writes to the
   * panel size. Used by consumers that want to suspend content-driven
   * sizing while the panel is pegged elsewhere (e.g. a maximize toggle
   * that owns the pane size while active). Defaults to true.
   */
  enabled?: boolean;
}

export function useContentDrivenPanelSize(
  opts: UseContentDrivenPanelSizeOptions,
): void {
  const { panelRef, sourceRef, enabled = true } = opts;
  useLayoutEffect(() => {
    if (!enabled) return;
    const panel = panelRef.current;
    const source = sourceRef.current;
    if (!panel || !source) return;

    const panelEl = source.closest<HTMLElement>("[data-panel]");
    if (!panelEl) return;
    const groupEl = panelEl.parentElement;
    if (!groupEl) return;
    const wrapperEl = panelEl.firstElementChild as HTMLElement | null;
    if (!wrapperEl) return;

    let lastInlineSize = 0;

    const recompute = () => {
      const empty = source.getAttribute("data-empty") === "true";
      if (empty) {
        panel.restoreUserSize();
        return;
      }
      const overflow = source.scrollHeight > source.clientHeight;
      if (!overflow) return; // stable; no mid-edit shrink

      const groupPx = groupEl.offsetHeight;
      if (groupPx <= 0) return;
      const chromePx = wrapperEl.clientHeight - source.offsetHeight;
      const fitPct = ((source.scrollHeight + chromePx) / groupPx) * 100;
      const currentPct = panel.getSize();
      if (Math.abs(fitPct - currentPct) < 0.1) return;
      panel.setTransientSize(fitPct);
    };

    const mo = new MutationObserver(recompute);
    mo.observe(source, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "class", "data-empty"],
    });

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const inlineSize =
        entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      if (inlineSize === lastInlineSize) return;
      lastInlineSize = inlineSize;
      recompute();
    });
    ro.observe(panelEl);

    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [panelRef, sourceRef, enabled]);
}
