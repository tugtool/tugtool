/**
 * CardFrame — React component for an absolutely-positioned card with move, resize, and z-order.
 *
 * The card frame contains:
 * - A React CardHeader rendered as a child.
 * - A card content area where card DOM is mounted (accessible via getCardAreaElement imperative method).
 * - Eight resize handles (4 edges + 4 corners).
 *
 * All mutations (move end, resize end, focus, close) fire callbacks so
 * DeckManager owns the DeckState mutations and serialization.
 *
 * Implements CardFrameHandle via forwardRef + useImperativeHandle for
 * DeckManager compatibility during the transition period (Steps 3-6).
 * Removed in Step 7 when DeckCanvas replaces imperative calls.
 *
 * Spec S03, Spec S03a
 * [D02] React synthetic events for all pointer interactions
 * [D03] Ref-based style mutation during drag (no setState during pointermove)
 * [D06] Key panel focus model with title bar tint
 * [D08] useImperativeHandle transition for DeckManager compatibility
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
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

const DEFAULT_BORDER_RADIUS = "6px";
const DEFAULT_HEADER_RADIUS = "5px";

// ---- Types ----

/**
 * Imperative handle exposed to DeckManager via forwardRef + useImperativeHandle.
 * Transitional bridge (Steps 3-6); removed in Step 7.
 */
export interface CardFrameHandle {
  /** Update the CSS z-index of the card frame root element. */
  setZIndex(z: number): void;
  /** Mutate style.left/top directly (no state update). */
  updatePosition(x: number, y: number): void;
  /** Mutate style.width/height directly (no state update). */
  updateSize(width: number, height: number): void;
  /** Toggle the key-panel title bar tint on the header. */
  setKey(isKey: boolean): void;
  /**
   * Apply border-radius and position offset for docked panel appearance.
   * Replaces DeckManager's querySelector-based updateDockedStyles().
   */
  setDockedStyle(
    corners: [boolean, boolean, boolean, boolean],
    offset: { dx: number; dy: number }
  ): void;
  /** Reset to default rounded-corner solo appearance. */
  resetDockedStyle(): void;
  /** Return the root element of the card frame. */
  getElement(): HTMLElement;
  /** Return the card content area element. */
  getCardAreaElement(): HTMLElement;
  /** Return the current CardState (with live-updated position/size). */
  getCardState(): CardState;
  /** Update card metadata in the header (called by ReactCardAdapter on active tab). */
  updateMeta(meta: TugCardMeta): void;
  /** Unmount the React root and remove the element from the DOM. */
  destroy(): void;
}

// ---- Props ----

export interface CardFrameProps {
  panelState: CardState;
  meta: TugCardMeta;
  isKey: boolean;
  zIndex: number;
  canvasEl: HTMLElement;
  callbacks: CardFrameCallbacks;
  children?: React.ReactNode;
}

// ---- Component ----

export const CardFrame = forwardRef<CardFrameHandle, CardFrameProps>(
  function CardFrame(
    { panelState, meta: initialMeta, isKey: initialIsKey, zIndex, canvasEl, callbacks },
    ref
  ) {
    // ---- State ----
    // isKey and meta trigger re-renders (controlled by DeckManager or ReactCardAdapter).
    const [isKey, setIsKeyState] = useState(initialIsKey);
    const [meta, setMetaState] = useState<TugCardMeta>(initialMeta);

    // ---- Refs ----
    const rootRef = useRef<HTMLDivElement>(null);
    const cardAreaRef = useRef<HTMLDivElement>(null);
    // Live copy of cardState for imperative updates (no re-render during drag).
    const cardStateRef = useRef<CardState>(panelState);

    // ---- Imperative handle ----

    useImperativeHandle(
      ref,
      () => ({
        setZIndex(z: number) {
          if (rootRef.current) {
            rootRef.current.style.zIndex = String(z);
          }
        },
        updatePosition(x: number, y: number) {
          cardStateRef.current.position = { x, y };
          if (rootRef.current) {
            rootRef.current.style.left = `${x}px`;
            rootRef.current.style.top = `${y}px`;
          }
        },
        updateSize(width: number, height: number) {
          cardStateRef.current.size = { width, height };
          if (rootRef.current) {
            rootRef.current.style.width = `${width}px`;
            rootRef.current.style.height = `${height}px`;
          }
        },
        setKey(k: boolean) {
          setIsKeyState(k);
        },
        setDockedStyle(
          corners: [boolean, boolean, boolean, boolean],
          offset: { dx: number; dy: number }
        ) {
          if (!rootRef.current) return;
          const r = (v: boolean) => (v ? DEFAULT_BORDER_RADIUS : "0");
          const hr = (v: boolean) => (v ? DEFAULT_HEADER_RADIUS : "0");
          rootRef.current.style.borderRadius = `${r(corners[0])} ${r(corners[1])} ${r(corners[2])} ${r(corners[3])}`;

          const header = rootRef.current.querySelector(
            ".card-header"
          ) as HTMLElement | null;
          if (header) {
            header.style.borderRadius = `${hr(corners[0])} ${hr(corners[1])} 0 0`;
          }
          const content = cardAreaRef.current;
          if (content) {
            content.style.borderRadius = `0 0 ${hr(corners[2])} ${hr(corners[3])}`;
          }

          // Apply 1px overlap offset. Logical CardState position is unchanged.
          const { x, y } = cardStateRef.current.position;
          rootRef.current.style.left = `${x + offset.dx}px`;
          rootRef.current.style.top = `${y + offset.dy}px`;
        },
        resetDockedStyle() {
          if (!rootRef.current) return;
          rootRef.current.style.borderRadius = DEFAULT_BORDER_RADIUS;
          const header = rootRef.current.querySelector(
            ".card-header"
          ) as HTMLElement | null;
          if (header) {
            header.style.borderRadius = `${DEFAULT_HEADER_RADIUS} ${DEFAULT_HEADER_RADIUS} 0 0`;
          }
          const content = cardAreaRef.current;
          if (content) {
            content.style.borderRadius = `0 0 ${DEFAULT_HEADER_RADIUS} ${DEFAULT_HEADER_RADIUS}`;
          }
          // Restore DOM position to logical position
          const { x, y } = cardStateRef.current.position;
          rootRef.current.style.left = `${x}px`;
          rootRef.current.style.top = `${y}px`;
        },
        getElement(): HTMLElement {
          return rootRef.current!;
        },
        getCardAreaElement(): HTMLElement {
          return cardAreaRef.current!;
        },
        getCardState(): CardState {
          return cardStateRef.current;
        },
        updateMeta(newMeta: TugCardMeta) {
          setMetaState(newMeta);
        },
        destroy() {
          // Removal from DOM is handled by the parent (DeckManager unmounts the React root).
          // This is a no-op — root.unmount() handles cleanup.
        },
      }),
      []
    );

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
      [callbacks, canvasEl]
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
      [callbacks, canvasEl]
    );

    // ---- Render ----

    const { x, y } = panelState.position;
    const { width, height } = panelState.size;

    return (
      <div
        ref={rootRef}
        className="card-frame"
        style={{
          left: `${x}px`,
          top: `${y}px`,
          width: `${width}px`,
          height: `${height}px`,
          zIndex,
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
        />

        <div ref={cardAreaRef} className="card-frame-content" />

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
);
