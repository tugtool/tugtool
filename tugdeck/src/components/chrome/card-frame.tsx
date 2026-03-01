/**
 * CardFrame — React component for an absolutely-positioned card with move, resize, and z-order.
 *
 * The card frame contains:
 * - A React CardHeader rendered as a child.
 * - Card content rendered as React children (TabBar + card content).
 * - Eight resize handles (4 edges + 4 corners).
 *
 * All mutations (move end, resize end, focus, close) fire callbacks so
 * DeckManager owns the DeckState mutations and serialization.
 *
 * In the unified single-root architecture (Step 7+), CardFrame no longer uses
 * forwardRef + useImperativeHandle. DeckCanvas manages panel element refs
 * directly via PanelContainer for imperative sash drag operations.
 *
 * Docked styling (corner radii, 1px overlap) is applied declaratively via
 * `dockedCorners` and `positionOffset` props. DeckManager computes these from
 * shared edges and passes them through DeckCanvas to CardFrame — no imperative
 * DOM mutation needed for docked corner/position adjustments.
 *
 * Spec S03
 * [D02] React synthetic events for all pointer interactions
 * [D03] Ref-based style mutation during drag (no setState during pointermove)
 * [D04] Unified single React root — forwardRef/useImperativeHandle removed
 * [D06] Key panel focus model with title bar tint
 */

import React, {
  useRef,
  useCallback,
} from "react";
import type { CardState } from "@/layout-tree";
import type { TugCardMeta } from "@/cards/card";
import { CardHeader } from "@/components/chrome/card-header";

// ---- Callbacks ----

export interface CardFrameCallbacks {
  /** Called when the user finishes dragging the panel to a new position. */
  onMoveEnd: (x: number, y: number) => void;
  /** Called when the user finishes resizing the panel. */
  onResizeEnd: (x: number, y: number, width: number, height: number) => void;
  /** Called when the panel receives focus (click anywhere). */
  onFocus: (opts?: { suppressZOrder?: boolean }) => void;
  /** Called when the close button in the header is clicked. */
  onClose: () => void;
  /** Called on every pointermove during header drag. Return the (potentially snapped) position. */
  onMoving?: (x: number, y: number) => { x: number; y: number };
  /** Called on every pointermove during resize. Return the (potentially snapped) geometry. */
  onResizing?: (
    x: number,
    y: number,
    width: number,
    height: number
  ) => { x: number; y: number; width: number; height: number };
}

/** Minimum floating panel dimension in pixels */
const MIN_SIZE_PX = 100;

/** Drag threshold before a pointerdown becomes a drag (not a focus click) */
const DRAG_THRESHOLD_PX = 3;

/** Height of the header bar in pixels */
export const CARD_TITLE_BAR_HEIGHT = 28;

/** Inset from canvas edges — panels can't be positioned flush against the viewport */
const CANVAS_INSET_PX = 2;

/** Default border radius for solo (undocked) card frames */
const DEFAULT_BORDER_RADIUS = "6px";

/** Default border radius for card headers (slightly smaller than frame) */
const DEFAULT_HEADER_RADIUS = "5px";

// ---- Props ----

export interface CardFrameProps {
  panelState: CardState;
  meta: TugCardMeta;
  isKey: boolean;
  zIndex: number;
  canvasEl: HTMLElement;
  callbacks: CardFrameCallbacks;
  /**
   * External ref to the root element. Provided by DeckCanvas PanelContainer
   * so DeckManager can mutate styles during sash drag without React re-renders.
   */
  rootRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * Docked corner mask: [TL, TR, BR, BL].
   * true = rounded corner (default 6px), false = square corner (0px).
   * Computed by DeckManager from shared edges and passed as props.
   * When undefined, all corners are rounded (solo/undocked appearance).
   */
  dockedCorners?: [boolean, boolean, boolean, boolean];
  /**
   * Position offset for 1px overlap between docked panels.
   * Applied additively to panelState.position during render.
   * Computed by DeckManager from shared edges and passed as props.
   * When undefined, no offset is applied.
   */
  positionOffset?: { dx: number; dy: number };
  children?: React.ReactNode;
}

// ---- Component ----

export function CardFrame({
  panelState,
  meta,
  isKey,
  zIndex,
  canvasEl,
  callbacks,
  rootRef: externalRootRef,
  dockedCorners,
  positionOffset,
  children,
}: CardFrameProps) {
  // ---- Refs ----
  const internalRootRef = useRef<HTMLDivElement>(null);
  // Use the external ref if provided (from DeckCanvas), otherwise the internal one
  const rootRef = externalRootRef ?? internalRootRef;

  // Live copy of cardState for ref-based style mutation during drag (no re-render)
  const cardStateRef = useRef<CardState>(panelState);
  // Keep cardStateRef in sync with panelState (updated on each render from DeckManager)
  cardStateRef.current = panelState;

  // ---- Pointer: focus on root pointerdown ----

  const handleRootPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      callbacks.onFocus({ suppressZOrder: e.metaKey });
    },
    [callbacks]
  );

  // ---- Pointer: header drag ----

  const handleDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startY = e.clientY;
      const startPanelX = cardStateRef.current.position.x;
      const startPanelY = cardStateRef.current.position.y;
      let dragging = false;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!dragging && dist > DRAG_THRESHOLD_PX) {
          dragging = true;
        }
        if (!dragging) return;

        const canvasRect = canvasEl.getBoundingClientRect();
        let newX = Math.max(
          CANVAS_INSET_PX,
          Math.min(
            canvasRect.width -
              cardStateRef.current.size.width -
              CANVAS_INSET_PX,
            startPanelX + dx
          )
        );
        let newY = Math.max(
          CANVAS_INSET_PX,
          Math.min(
            canvasRect.height -
              cardStateRef.current.size.height -
              CANVAS_INSET_PX,
            startPanelY + dy
          )
        );

        if (callbacks.onMoving) {
          const snapped = callbacks.onMoving(newX, newY);
          newX = snapped.x;
          newY = snapped.y;
        }

        cardStateRef.current.position = { x: newX, y: newY };
        if (rootRef.current) {
          rootRef.current.style.left = `${newX}px`;
          rootRef.current.style.top = `${newY}px`;
        }
      };

      const onUp = (_ev: PointerEvent) => {
        target.releasePointerCapture(e.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);

        if (dragging) {
          callbacks.onMoveEnd(
            cardStateRef.current.position.x,
            cardStateRef.current.position.y
          );
        }
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [callbacks, canvasEl, rootRef]
  );

  // ---- Pointer: resize drag ----

  const handleResizePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      dir: "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se"
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = cardStateRef.current.size.width;
      const startH = cardStateRef.current.size.height;
      const startPX = cardStateRef.current.position.x;
      const startPY = cardStateRef.current.position.y;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const canvasRect = canvasEl.getBoundingClientRect();

        let newX = startPX;
        let newY = startPY;
        let newW = startW;
        let newH = startH;

        // Horizontal sizing
        if (dir === "e" || dir === "ne" || dir === "se") {
          newW = Math.max(MIN_SIZE_PX, startW + dx);
        } else if (dir === "w" || dir === "nw" || dir === "sw") {
          const candidateW = Math.max(MIN_SIZE_PX, startW - dx);
          newX = startPX + (startW - candidateW);
          newW = candidateW;
        }

        // Vertical sizing
        if (dir === "s" || dir === "sw" || dir === "se") {
          newH = Math.max(MIN_SIZE_PX, startH + dy);
        } else if (dir === "n" || dir === "nw" || dir === "ne") {
          const candidateH = Math.max(MIN_SIZE_PX, startH - dy);
          newY = startPY + (startH - candidateH);
          newH = candidateH;
        }

        // Clamp to canvas bounds (with inset)
        if (newX < CANVAS_INSET_PX) {
          newW += newX - CANVAS_INSET_PX;
          newX = CANVAS_INSET_PX;
        }
        if (newY < CANVAS_INSET_PX) {
          newH += newY - CANVAS_INSET_PX;
          newY = CANVAS_INSET_PX;
        }
        if (newX + newW > canvasRect.width - CANVAS_INSET_PX) {
          newW = canvasRect.width - CANVAS_INSET_PX - newX;
        }
        if (newY + newH > canvasRect.height - CANVAS_INSET_PX) {
          newH = canvasRect.height - CANVAS_INSET_PX - newY;
        }
        // Re-enforce minimum size after viewport clamping
        newW = Math.max(MIN_SIZE_PX, newW);
        newH = Math.max(MIN_SIZE_PX, newH);

        if (callbacks.onResizing) {
          const snapped = callbacks.onResizing(newX, newY, newW, newH);
          newX = snapped.x;
          newY = snapped.y;
          newW = snapped.width;
          newH = snapped.height;
        }

        cardStateRef.current.position = { x: newX, y: newY };
        cardStateRef.current.size = { width: newW, height: newH };
        if (rootRef.current) {
          rootRef.current.style.left = `${newX}px`;
          rootRef.current.style.top = `${newY}px`;
          rootRef.current.style.width = `${newW}px`;
          rootRef.current.style.height = `${newH}px`;
        }
      };

      const onUp = (_ev: PointerEvent) => {
        target.releasePointerCapture(e.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);

        callbacks.onResizeEnd(
          cardStateRef.current.position.x,
          cardStateRef.current.position.y,
          cardStateRef.current.size.width,
          cardStateRef.current.size.height
        );
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [callbacks, canvasEl, rootRef]
  );

  // ---- Render ----

  const { x, y } = panelState.position;
  const { width, height } = panelState.size;
  const dx = positionOffset?.dx ?? 0;
  const dy = positionOffset?.dy ?? 0;

  // Compute border-radius from dockedCorners prop.
  // true = rounded (DEFAULT_BORDER_RADIUS), false = square (0px).
  // When dockedCorners is undefined, all corners are rounded (solo appearance).
  const c = dockedCorners ?? [true, true, true, true];
  const r = (v: boolean) => (v ? DEFAULT_BORDER_RADIUS : "0");
  const hr = (v: boolean) => (v ? DEFAULT_HEADER_RADIUS : "0");
  const frameBorderRadius = `${r(c[0])} ${r(c[1])} ${r(c[2])} ${r(c[3])}`;
  const headerBorderRadius = `${hr(c[0])} ${hr(c[1])} 0 0`;
  const contentBorderRadius = `0 0 ${hr(c[2])} ${hr(c[3])}`;

  return (
    <div
      ref={rootRef}
      className="card-frame"
      style={{
        left: `${x + dx}px`,
        top: `${y + dy}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex,
        borderRadius: frameBorderRadius,
      }}
      onPointerDown={handleRootPointerDown}
    >
      <CardHeader
        meta={meta}
        isKey={isKey}
        showCollapse={false}
        onClose={callbacks.onClose}
        onCollapse={() => {}}
        onDragStart={handleDragStart}
        style={{ borderRadius: headerBorderRadius }}
      />

      <div className="card-frame-content" style={{ borderRadius: contentBorderRadius }}>
        {children}
      </div>

      {(
        ["n", "s", "e", "w", "nw", "ne", "sw", "se"] as const
      ).map((dir) => (
        <div
          key={dir}
          className={`card-frame-resize card-frame-resize-${dir}`}
          onPointerDown={(e) => handleResizePointerDown(e, dir)}
        />
      ))}
    </div>
  );
}
