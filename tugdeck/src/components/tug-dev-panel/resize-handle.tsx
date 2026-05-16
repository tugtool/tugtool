/**
 * `ResizeHandle` — narrow drag affordance on the left edge of the
 * dev panel. Pointer-drag updates the panel width.
 *
 * Implementation per [L06] (appearance via DOM/CSS, not React
 * state): the active drag writes the candidate width directly to a
 * CSS custom property on the panel root (`--tugx-devpanel-width`),
 * so the live drag stays out of React's render pipeline. When the
 * drag ends, the final value is committed to `tugDevPanelStore` —
 * a single React update — which persists to tugbank and triggers
 * the one re-render needed to settle the snapshot.
 *
 * Conformance:
 *  - [L02] state lives in `tugDevPanelStore`; React reads via
 *    `useSyncExternalStore` in the parent.
 *  - [L06] live drag is DOM-only; no per-frame React state.
 *  - [L23] persisted via tugbank (store handles the PUT).
 *
 * @module components/tug-dev-panel/resize-handle
 */

import React, { useCallback, useRef } from "react";

import { tugDevPanelStore } from "@/lib/tug-dev-panel-store/tug-dev-panel-store";
import {
  MIN_DEV_PANEL_WIDTH_PX,
  MIN_LEFT_GUTTER_PX,
} from "@/lib/tug-dev-panel-store/types";

export interface ResizeHandleProps {
  /**
   * Ref to the panel root element. The handle writes the live width
   * directly to its `style.setProperty("--tugx-devpanel-width", ...)`.
   */
  panelRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Compute the candidate width from a pointer x-coordinate. The panel
 * is anchored to the right edge; dragging the handle leftward
 * INCREASES width.
 */
function widthFromPointer(clientX: number, viewportWidth: number): number {
  const raw = viewportWidth - clientX;
  const maxAllowed = viewportWidth - MIN_LEFT_GUTTER_PX;
  if (raw < MIN_DEV_PANEL_WIDTH_PX) return MIN_DEV_PANEL_WIDTH_PX;
  if (raw > maxAllowed) return maxAllowed;
  return raw;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({ panelRef }) => {
  const draggingRef = useRef(false);
  const latestWidthRef = useRef<number | null>(null);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const panel = panelRef.current;
      if (panel === null) return;
      const w = widthFromPointer(e.clientX, window.innerWidth);
      latestWidthRef.current = w;
      // Live drag writes DOM-only — no React re-render per [L06].
      panel.style.setProperty("--tugx-devpanel-width", `${Math.round(w)}px`);
    },
    [panelRef],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      const handle = e.currentTarget as HTMLElement | null;
      if (handle && handle.hasPointerCapture?.(e.pointerId)) {
        handle.releasePointerCapture(e.pointerId);
      }
      // Commit the final width to the store (single React update +
      // tugbank PUT). Clear the inline custom property so the
      // store-derived width (read by the panel's React render) is
      // the source of truth going forward.
      const finalWidth = latestWidthRef.current;
      const panel = panelRef.current;
      if (panel !== null) {
        panel.style.removeProperty("--tugx-devpanel-width");
      }
      if (finalWidth !== null) {
        tugDevPanelStore.setWidth(finalWidth);
      }
      latestWidthRef.current = null;
    },
    [handlePointerMove, panelRef],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Left button only.
      if (e.button !== 0) return;
      e.preventDefault();
      draggingRef.current = true;
      // Seed latest with the current width derived from initial pointer
      // position so a pointerup without any move still commits cleanly.
      latestWidthRef.current = widthFromPointer(e.clientX, window.innerWidth);
      e.currentTarget.setPointerCapture(e.pointerId);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      // Visual feedback + suppress accidental text selection on the
      // rest of the page during the drag.
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [handlePointerMove, handlePointerUp],
  );

  return (
    <div
      className="tug-devpanel-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize dev panel"
      onPointerDown={handlePointerDown}
      data-tug-focus="refuse"
    />
  );
};
ResizeHandle.displayName = "ResizeHandle";
