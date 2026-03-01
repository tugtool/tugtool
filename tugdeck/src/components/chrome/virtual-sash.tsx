/**
 * VirtualSash — React component for shared-edge multi-panel resize.
 *
 * Renders an absolutely-positioned hit target at a shared boundary between
 * docked panels. Uses React pointer events with pointer capture for drag.
 * Mutates panel DOM positions and sizes via ref-based callbacks during
 * pointermove (no React re-render). Calls onDragEnd on pointerup so
 * DeckManager can commit the new layout and trigger a re-render.
 *
 * CSS classes (.virtual-sash, .virtual-sash-vertical, .virtual-sash-horizontal)
 * are preserved from the vanilla implementation for visual continuity.
 *
 * [D02] React synthetic events, [D03] Ref-based style mutation during drag
 * Spec S05, #step-8
 */

import React, { useRef, useCallback } from "react";
import type { SharedEdge } from "@/snap";

export interface SashGroup {
  axis: "vertical" | "horizontal";
  boundary: number;
  overlapStart: number;
  overlapEnd: number;
  edges: SharedEdge[];
}

export interface PanelSnapshot {
  id: string;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
}

export interface VirtualSashCallbacks {
  /** Called on pointermove with live panel size/position updates. */
  onUpdatePanelSize: (panelId: string, width: number, height: number) => void;
  onUpdatePanelPosition: (panelId: string, x: number, y: number) => void;
  /**
   * Called on pointerup. Receives the final delta so DeckManager can commit
   * updated panel state and trigger a re-render + save.
   */
  onDragEnd: (
    axis: "vertical" | "horizontal",
    aSideIds: string[],
    bSideIds: string[],
    delta: number
  ) => void;
}

export interface VirtualSashProps {
  group: SashGroup;
  /** Current panel snapshots for the panels involved in this sash group. */
  panels: PanelSnapshot[];
  callbacks: VirtualSashCallbacks;
}

const MIN_SIZE = 100;

export function VirtualSash({ group, panels, callbacks }: VirtualSashProps) {
  const sashRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (downEvent: React.PointerEvent<HTMLDivElement>) => {
      downEvent.preventDefault();
      downEvent.stopPropagation();

      const sashEl = sashRef.current;
      if (!sashEl) return;

      sashEl.setPointerCapture(downEvent.pointerId);

      const aSideIds = new Set<string>(group.edges.map((e) => e.cardAId));
      const bSideIds = new Set<string>(group.edges.map((e) => e.cardBId));

      const aPanels = panels.filter((p) => aSideIds.has(p.id));
      const bPanels = panels.filter((p) => bSideIds.has(p.id));

      if (aPanels.length === 0 || bPanels.length === 0) return;

      const startClientX = downEvent.clientX;
      const startClientY = downEvent.clientY;

      const handlePointerMove = (e: PointerEvent) => {
        if (group.axis === "vertical") {
          let dx = e.clientX - startClientX;
          for (const s of aPanels) {
            dx = Math.max(dx, -(s.startW - MIN_SIZE));
          }
          for (const s of bPanels) {
            dx = Math.min(dx, s.startW - MIN_SIZE);
          }
          for (const s of aPanels) {
            callbacks.onUpdatePanelSize(s.id, s.startW + dx, s.startH);
          }
          for (const s of bPanels) {
            callbacks.onUpdatePanelPosition(s.id, s.startX + dx, s.startY);
            callbacks.onUpdatePanelSize(s.id, s.startW - dx, s.startH);
          }
          // Move the sash element to track the boundary
          sashEl.style.left = `${group.boundary - 4 + dx}px`;
        } else {
          let dy = e.clientY - startClientY;
          for (const s of aPanels) {
            dy = Math.max(dy, -(s.startH - MIN_SIZE));
          }
          for (const s of bPanels) {
            dy = Math.min(dy, s.startH - MIN_SIZE);
          }
          for (const s of aPanels) {
            callbacks.onUpdatePanelSize(s.id, s.startW, s.startH + dy);
          }
          for (const s of bPanels) {
            callbacks.onUpdatePanelPosition(s.id, s.startX, s.startY + dy);
            callbacks.onUpdatePanelSize(s.id, s.startW, s.startH - dy);
          }
          // Move the sash element to track the boundary
          sashEl.style.top = `${group.boundary - 4 + dy}px`;
        }
      };

      const handlePointerUp = (e: PointerEvent) => {
        sashEl.releasePointerCapture(downEvent.pointerId);
        sashEl.removeEventListener("pointermove", handlePointerMove);
        sashEl.removeEventListener("pointerup", handlePointerUp);
        sashEl.removeEventListener("pointercancel", handlePointerUp);

        const delta =
          group.axis === "vertical"
            ? e.clientX - startClientX
            : e.clientY - startClientY;

        // Clamp delta to prevent panels below MIN_SIZE
        let clampedDelta = delta;
        for (const s of aPanels) {
          if (group.axis === "vertical") {
            clampedDelta = Math.max(clampedDelta, -(s.startW - MIN_SIZE));
          } else {
            clampedDelta = Math.max(clampedDelta, -(s.startH - MIN_SIZE));
          }
        }
        for (const s of bPanels) {
          if (group.axis === "vertical") {
            clampedDelta = Math.min(clampedDelta, s.startW - MIN_SIZE);
          } else {
            clampedDelta = Math.min(clampedDelta, s.startH - MIN_SIZE);
          }
        }

        callbacks.onDragEnd(
          group.axis,
          Array.from(aSideIds),
          Array.from(bSideIds),
          clampedDelta
        );
      };

      sashEl.addEventListener("pointermove", handlePointerMove);
      sashEl.addEventListener("pointerup", handlePointerUp);
      sashEl.addEventListener("pointercancel", handlePointerUp);
    },
    [group, panels, callbacks]
  );

  const axisClass =
    group.axis === "vertical" ? "virtual-sash-vertical" : "virtual-sash-horizontal";

  const style: React.CSSProperties =
    group.axis === "vertical"
      ? {
          left: group.boundary - 4,
          top: group.overlapStart,
          height: group.overlapEnd - group.overlapStart,
        }
      : {
          top: group.boundary - 4,
          left: group.overlapStart,
          width: group.overlapEnd - group.overlapStart,
        };

  return (
    <div
      ref={sashRef}
      className={`virtual-sash ${axisClass}`}
      style={style}
      onPointerDown={handlePointerDown}
    />
  );
}
