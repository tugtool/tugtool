/**
 * CardFrame -- absolutely-positioned frame with drag, resize, z-index, and
 * min-size clamping.
 *
 * **Authoritative references:**
 * - design-system-concepts.md [D03] CardFrame/Tugcard separation,
 *   [D06] Appearance-zone drag
 * - Spec S04: CardFrameProps, CardFrameInjectedProps
 * - Risk R02: two-zone drag boundary (appearance-zone during, structure-zone on end)
 *
 * ## Responsibilities
 *
 * - Render an absolutely-positioned div at position/size from `cardState`
 * - Inject `onDragStart` and `onMinSizeChange` into Tugcard via `renderContent`
 * - Drag: RAF appearance-zone mutation during, `onCardMoved` structure-zone commit on end
 * - Resize: 8 edge/corner handles, clamped to min-size, `onCardMoved` on end
 * - Bring to front via `onCardFocused` on any pointer-down in the frame
 *
 * ## onCardClosed wiring
 *
 * `onCardClosed` is NOT injected via `CardFrameInjectedProps`. Instead, DeckCanvas
 * passes a `renderContent` function whose factory closure already binds `onClose`
 * to `onCardClosed(id)`. CardFrame calls `renderContent(injected)` exactly once
 * and never needs to know about the close callback.
 *
 * @module components/chrome/card-frame
 */

import React, { useCallback, useRef, useState } from "react";
import type { CardState } from "@/layout-tree";

// ---------------------------------------------------------------------------
// Types (Spec S04)
// ---------------------------------------------------------------------------

/**
 * Props injected by CardFrame into the content returned by `renderContent`.
 *
 * **Authoritative reference:** Spec S04 CardFrameInjectedProps.
 *
 * Note: `card-registry.ts` re-declares a compatible interface locally to avoid
 * a forward-dependency on this file. The two declarations are structurally
 * identical; this file is the authoritative source.
 */
export interface CardFrameInjectedProps {
  /** Tugcard header calls this on pointer-down to initiate drag. */
  onDragStart: (event: React.PointerEvent) => void;
  /** Tugcard calls this to report its computed minimum size to CardFrame. */
  onMinSizeChange: (size: { width: number; height: number }) => void;
}

/**
 * Props for the CardFrame component.
 *
 * **Authoritative reference:** Spec S04 CardFrameProps.
 */
export interface CardFrameProps {
  /** Card position, size, and id from DeckState. */
  cardState: CardState;
  /**
   * Render function that receives injected callbacks and returns the Tugcard.
   * The factory closure (from the card registry) is responsible for wiring
   * the Tugcard's `onClose` prop to `onCardClosed(id)`.
   */
  renderContent: (injected: CardFrameInjectedProps) => React.ReactNode;
  /** Called on drag-end or resize-end (structure-zone commit). */
  onCardMoved: (
    id: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;
  /** Called when the Tugcard's close action fires (wired via renderContent factory). */
  onCardClosed: (id: string) => void;
  /** Called on pointer-down anywhere in the frame to bring the card to front. */
  onCardFocused: (id: string) => void;
  /** CSS z-index for stacking order. */
  zIndex: number;
  /** Whether this card is the focused (topmost) card. Drives visual focus styles. */
  isFocused: boolean;
}

// ---------------------------------------------------------------------------
// Resize edge descriptors
// ---------------------------------------------------------------------------

type ResizeEdge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

// ---------------------------------------------------------------------------
// CardFrame
// ---------------------------------------------------------------------------

/**
 * CardFrame -- positions, drags, resizes, and stacks a single card on the canvas.
 */
export function CardFrame({
  cardState,
  renderContent,
  onCardMoved,
  onCardFocused,
  zIndex,
  isFocused,
}: CardFrameProps) {
  const { id, position, size } = cardState;

  // Ref to the frame DOM element for appearance-zone style mutations.
  const frameRef = useRef<HTMLDivElement>(null);

  // Min-size reported by Tugcard. Default per spec: 150×100.
  const [minSize, setMinSize] = useState<{ width: number; height: number }>({
    width: 150,
    height: 100,
  });

  // Latest minSize held in a ref so resize closure always sees current value
  // without needing to be re-created every time minSize state updates.
  const minSizeRef = useRef(minSize);
  minSizeRef.current = minSize;

  // ---------------------------------------------------------------------------
  // onMinSizeChange (injected into Tugcard via renderContent)
  // ---------------------------------------------------------------------------

  const handleMinSizeChange = useCallback(
    (newSize: { width: number; height: number }) => {
      setMinSize(newSize);
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Drag mechanic
  // ---------------------------------------------------------------------------

  // All drag state lives in refs -- zero React re-renders during drag.
  const dragActive = useRef(false);
  const dragRafId = useRef<number | null>(null);
  const dragStartPointer = useRef({ x: 0, y: 0 });
  const dragStartPosition = useRef({ x: 0, y: 0 });
  const dragCanvasBounds = useRef<DOMRect | null>(null);
  const latestDragPointer = useRef({ x: 0, y: 0 });

  const handleDragStart = useCallback(
    (event: React.PointerEvent) => {
      if (!frameRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const frame: HTMLDivElement = frameRef.current!;

      // Capture pointer on the frame element for reliable move/up tracking outside bounds.
      frame.setPointerCapture(event.nativeEvent.pointerId);

      // Snapshot canvas bounds and drag start state once.
      dragCanvasBounds.current = frame.parentElement?.getBoundingClientRect() ?? null;
      dragActive.current = true;
      dragStartPointer.current = { x: event.clientX, y: event.clientY };
      dragStartPosition.current = { x: position.x, y: position.y };
      latestDragPointer.current = { x: event.clientX, y: event.clientY };

      function applyDragFrame() {
        dragRafId.current = null;
        if (!dragActive.current) return;
        const pos = clampedPosition(
          latestDragPointer.current,
          dragStartPointer.current,
          dragStartPosition.current,
          dragCanvasBounds.current,
          { width: frame.offsetWidth, height: frame.offsetHeight },
        );
        frame.style.left = `${pos.x}px`;
        frame.style.top = `${pos.y}px`;
      }

      function onPointerMove(e: PointerEvent) {
        latestDragPointer.current = { x: e.clientX, y: e.clientY };
        if (dragRafId.current === null) {
          dragRafId.current = requestAnimationFrame(applyDragFrame);
        }
      }

      function onPointerUp(e: PointerEvent) {
        if (!dragActive.current) return;
        dragActive.current = false;
        if (dragRafId.current !== null) {
          cancelAnimationFrame(dragRafId.current);
          dragRafId.current = null;
        }
        frame.removeEventListener("pointermove", onPointerMove);
        frame.removeEventListener("pointerup", onPointerUp);
        frame.releasePointerCapture(e.pointerId);

        const finalPos = clampedPosition(
          { x: e.clientX, y: e.clientY },
          dragStartPointer.current,
          dragStartPosition.current,
          dragCanvasBounds.current,
          { width: frame.offsetWidth, height: frame.offsetHeight },
        );
        frame.style.left = `${finalPos.x}px`;
        frame.style.top = `${finalPos.y}px`;
        onCardMoved(id, finalPos, { width: frame.offsetWidth, height: frame.offsetHeight });
      }

      frame.addEventListener("pointermove", onPointerMove);
      frame.addEventListener("pointerup", onPointerUp);
    },
    // position.x/y captured into dragStartPosition at drag-start; id and onCardMoved are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, onCardMoved, position.x, position.y],
  );

  // ---------------------------------------------------------------------------
  // Resize mechanic
  // ---------------------------------------------------------------------------

  const handleResizeStart = useCallback(
    (edge: ResizeEdge, event: React.PointerEvent) => {
      // Stop propagation so the frame's onPointerDown does not also fire onCardFocused
      // for the resize handle. onCardFocused is already called by the frame's handler
      // which fires before this (pointer-down bubbles up). We call stopPropagation to
      // avoid a second onCardFocused call but the first is fine.
      event.stopPropagation();

      if (!frameRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const frame: HTMLDivElement = frameRef.current!;

      frame.setPointerCapture(event.nativeEvent.pointerId);

      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = position.x;
      const startTop = position.y;
      const startW = size.width;
      const startH = size.height;

      const latestResizePointer = { x: startX, y: startY };
      let resizeRafId: number | null = null;
      let resizeActive = true;

      function applyResizeFrame() {
        resizeRafId = null;
        if (!resizeActive) return;
        const r = resizeDelta(
          latestResizePointer,
          { x: startX, y: startY },
          startLeft,
          startTop,
          startW,
          startH,
          edge,
          minSizeRef.current,
        );
        frame.style.left = `${r.left}px`;
        frame.style.top = `${r.top}px`;
        frame.style.width = `${r.width}px`;
        frame.style.height = `${r.height}px`;
      }

      function onPointerMove(e: PointerEvent) {
        latestResizePointer.x = e.clientX;
        latestResizePointer.y = e.clientY;
        if (resizeRafId === null) {
          resizeRafId = requestAnimationFrame(applyResizeFrame);
        }
      }

      function onPointerUp(e: PointerEvent) {
        if (!resizeActive) return;
        resizeActive = false;
        if (resizeRafId !== null) {
          cancelAnimationFrame(resizeRafId);
          resizeRafId = null;
        }
        frame.removeEventListener("pointermove", onPointerMove);
        frame.removeEventListener("pointerup", onPointerUp);
        frame.releasePointerCapture(e.pointerId);

        const r = resizeDelta(
          { x: e.clientX, y: e.clientY },
          { x: startX, y: startY },
          startLeft,
          startTop,
          startW,
          startH,
          edge,
          minSizeRef.current,
        );
        frame.style.left = `${r.left}px`;
        frame.style.top = `${r.top}px`;
        frame.style.width = `${r.width}px`;
        frame.style.height = `${r.height}px`;
        onCardMoved(id, { x: r.left, y: r.top }, { width: r.width, height: r.height });
      }

      frame.addEventListener("pointermove", onPointerMove);
      frame.addEventListener("pointerup", onPointerUp);
    },
    // minSizeRef.current is always current; position/size are start values read at resize-start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, onCardMoved, position.x, position.y, size.width, size.height],
  );

  // ---------------------------------------------------------------------------
  // Frame pointer-down: bring card to front
  // ---------------------------------------------------------------------------

  const handleFramePointerDown = useCallback(() => {
    onCardFocused(id);
  }, [id, onCardFocused]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const injected: CardFrameInjectedProps = {
    onDragStart: handleDragStart,
    onMinSizeChange: handleMinSizeChange,
  };

  return (
    <div
      ref={frameRef}
      className="card-frame"
      data-testid="card-frame"
      data-card-id={id}
      data-focused={isFocused ? "true" : "false"}
      onPointerDown={handleFramePointerDown}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex,
        boxSizing: "border-box",
      }}
    >
      {/* 8 resize handles -- CSS classes defined in chrome.css */}
      {RESIZE_EDGES.map((edge) => (
        <div
          key={edge}
          className={`card-frame-resize card-frame-resize-${edge}`}
          onPointerDown={(e) => handleResizeStart(edge, e)}
        />
      ))}

      {/* Tugcard rendered once with injected callbacks */}
      {renderContent(injected)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers (pure functions, testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Compute drag position from current pointer, start pointer, start position,
 * and optional canvas bounds clamping.
 */
function clampedPosition(
  pointer: { x: number; y: number },
  startPointer: { x: number; y: number },
  startPosition: { x: number; y: number },
  canvasBounds: DOMRect | null,
  frameSize: { width: number; height: number },
): { x: number; y: number } {
  let x = startPosition.x + (pointer.x - startPointer.x);
  let y = startPosition.y + (pointer.y - startPointer.y);

  if (canvasBounds) {
    x = Math.max(0, Math.min(x, canvasBounds.width - frameSize.width));
    y = Math.max(0, Math.min(y, canvasBounds.height - frameSize.height));
  }

  return { x, y };
}

/**
 * Compute new bounding rect after resizing on the given edge.
 * Width and height are clamped to minSize.
 */
function resizeDelta(
  pointer: { x: number; y: number },
  startPointer: { x: number; y: number },
  startLeft: number,
  startTop: number,
  startW: number,
  startH: number,
  edge: ResizeEdge,
  minSize: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const dx = pointer.x - startPointer.x;
  const dy = pointer.y - startPointer.y;

  let left = startLeft;
  let top = startTop;
  let width = startW;
  let height = startH;

  if (edge.includes("e")) {
    width = Math.max(minSize.width, startW + dx);
  }
  if (edge.includes("w")) {
    const newW = Math.max(minSize.width, startW - dx);
    left = startLeft + (startW - newW);
    width = newW;
  }
  if (edge.includes("s")) {
    height = Math.max(minSize.height, startH + dy);
  }
  if (edge.includes("n")) {
    const newH = Math.max(minSize.height, startH - dy);
    top = startTop + (startH - newH);
    height = newH;
  }

  return { left, top, width, height };
}
