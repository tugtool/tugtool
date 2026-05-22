/**
 * tide-card-sash-grip.tsx — Z2 sash grip.
 *
 * A pointer drag-handle pinned to one end of the Tide card's Z2
 * status bar. The status bar sits between the transcript and the
 * prompt entry, directly above the split-pane sash; with the bar
 * occupying that band, the sash's own thin hit line is easy to miss.
 * A grip at each end of the bar gives the sash a generous, obvious
 * grab target — the user can resize the card from the status bar
 * itself, not just the hairline below it.
 *
 * The grip drives the bottom (prompt-entry) panel directly: a pointer
 * drag tracks `clientY` against the panel's pixel size captured at
 * gesture start, and feeds live sizes through
 * `TugSplitPanelHandle.dragResizePixels`. During the drag the resize
 * is gated — visual only, nothing persisted; on pointer release a
 * single `commit` call routes the settled layout into tugbank,
 * exactly as a native sash drag does at pointer-up.
 *
 * The grip is a redundant pointer affordance for the split pane's own
 * sash, which stays keyboard-focusable for arrow-key resize — so the
 * grip is `aria-hidden`: it adds no new control to the a11y tree.
 *
 * Laws:
 *  - [L06] the drag's pressed state is a DOM `data-dragging`
 *    attribute plus a document-root cursor class — never React state.
 *  - [L07] the pointer handlers read drag bookkeeping from a ref.
 *  - [L19] file pair (`.tsx` + `.css`); root carries
 *    `data-slot="tide-card-sash-grip"`.
 *  - [L20] owns only the `--tugx-tide-sash-grip-*` slots; no base
 *    tokens authored.
 *
 * @module components/tugways/cards/tide-card-sash-grip
 */

import "./tide-card-sash-grip.css";

import React, { useCallback, useRef } from "react";
import { GripHorizontal } from "lucide-react";

import type { TugSplitPanelHandle } from "../tug-split-pane";

/**
 * Document-root class applied for the duration of a drag so the
 * resize cursor holds even as the captured pointer travels off the
 * grip and over the transcript or entry pane.
 */
const DRAGGING_CLASS = "tide-card-sash-dragging";

export interface TideCardSashGripProps {
  /**
   * Handle for the split pane's bottom (prompt-entry) panel. The grip
   * resizes this panel; the sash position follows from it.
   */
  entryPanelRef: React.RefObject<TugSplitPanelHandle | null>;
  /** Which end of the status bar the grip is pinned to. */
  side: "start" | "end";
  /**
   * Disables the drag — mirrors the split pane's own `disabled`
   * state (the card is maximized, so the sash is frozen).
   */
  disabled?: boolean;
}

/** Per-gesture drag bookkeeping, held in a ref ([L07]). */
interface DragState {
  /** The captured pointer's id. */
  pointerId: number;
  /** `clientY` at pointer-down. */
  startY: number;
  /** Bottom-panel pixel size at pointer-down. */
  startPx: number;
  /** Most recent applied (library-clamped) pixel size. */
  appliedPx: number;
}

/**
 * One end-of-status-bar sash grip. Render two — `side="start"` and
 * `side="end"` — flanking the Z2 status content.
 */
export function TideCardSashGrip({
  entryPanelRef,
  side,
  disabled = false,
}: TideCardSashGripProps): React.ReactElement {
  const dragRef = useRef<DragState | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Left button only. Bail when react-resizable-panels' document
      // capture-phase handler already claimed this pointer-down for
      // the sash's own hit region — the grip's bottom edge can overlap
      // it, and the sash drag does the same job, so just yield.
      if (disabled || event.button !== 0 || event.defaultPrevented) return;
      const panel = entryPanelRef.current;
      if (panel === null) return;
      event.preventDefault();
      const el = event.currentTarget;
      el.setPointerCapture(event.pointerId);
      const startPx = panel.getSizePixels();
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startPx,
        appliedPx: startPx,
      };
      el.dataset.dragging = "true";
      document.documentElement.classList.add(DRAGGING_CLASS);
    },
    [disabled, entryPanelRef],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === null || event.pointerId !== drag.pointerId) return;
      const panel = entryPanelRef.current;
      if (panel === null) return;
      // The grip sits at the bottom of the TOP panel: dragging it down
      // moves the sash down, shrinking the bottom (entry) panel. The
      // target is computed from the immutable gesture-start anchors,
      // not an accumulated delta, so min/max clamping never drifts.
      const targetPx = drag.startPx - (event.clientY - drag.startY);
      drag.appliedPx = panel.dragResizePixels(targetPx);
    },
    [entryPanelRef],
  );

  const handlePointerEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === null || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      const el = event.currentTarget;
      delete el.dataset.dragging;
      document.documentElement.classList.remove(DRAGGING_CLASS);
      if (el.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
      // Persist only a gesture that moved the sash — a stray click on
      // the grip leaves the size untouched and writes nothing.
      if (drag.appliedPx !== drag.startPx) {
        entryPanelRef.current?.dragResizePixels(drag.appliedPx, {
          commit: true,
        });
      }
    },
    [entryPanelRef],
  );

  return (
    <div
      className="tide-card-sash-grip"
      data-slot="tide-card-sash-grip"
      data-side={side}
      data-disabled={disabled || undefined}
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <GripHorizontal className="tide-card-sash-grip-icon" aria-hidden="true" />
    </div>
  );
}
