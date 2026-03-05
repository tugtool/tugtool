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
import { computeSnap, computeResizeSnap, findSharedEdges, computeSets, computeSetHullPolygon } from "@/snap";
import type { Rect, GuidePosition, SnapResult, SharedEdge } from "@/snap";

// ---------------------------------------------------------------------------
// Module-level counter for unique SVG flash filter IDs [Spec S03]
// ---------------------------------------------------------------------------

let nextFlashId = 0;

// ---------------------------------------------------------------------------
// Shadow extension constant [Spec S02]
//
// px beyond border-box for exterior edges in clip-path: inset().
// Derived from --td-card-shadow-active: 0 2px 8px rgba(0,0,0,0.4).
// 20px = blur(8) * 2 + offset(2) + margin — generous enough to show full shadow.
// ---------------------------------------------------------------------------

const SHADOW_EXTEND_PX = 20;

// ---------------------------------------------------------------------------
// Snap modifier key configuration [D01]
//
// To change the snap modifier, update SNAP_MODIFIER_KEY. All behavior follows.
// ---------------------------------------------------------------------------

const SNAP_MODIFIER_KEY: keyof Pick<PointerEvent, "altKey" | "ctrlKey" | "shiftKey" | "metaKey"> =
  "altKey";

function isSnapModifier(e: PointerEvent): boolean {
  return e[SNAP_MODIFIER_KEY];
}

// ---------------------------------------------------------------------------
// Canvas padding configuration
//
// Uniform padding applied to all four sides of the canvas for move/resize
// clamping. Set to 0 for flush edges. Increase for a gutter around the canvas.
// ---------------------------------------------------------------------------

const CANVAS_PADDING = 2;

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
  /**
   * Called when a card drag ends over another card's tab bar ([D45]).
   *
   * Receives the source card id, the target card id, and the insertion index
   * within the target's tab array. The active tab of the source card is merged
   * into the target card at insertIndex.
   *
   * Wired in DeckCanvas to store.mergeTab. When this prop is not provided,
   * card drag always falls back to onCardMoved (no merge behaviour).
   */
  onCardMerged?: (sourceCardId: string, targetCardId: string, insertIndex: number) => void;
  /**
   * The id of the active tab on this card. Used by the merge hit-test in
   * onPointerUp to determine which tab gets merged into the target card.
   */
  activeTabId?: string;
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
  onCardMerged,
  activeTabId,
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

  // Track the tab bar element currently highlighted as a merge drop target.
  // Appearance-zone only: set/cleared via data-drop-target attribute. [D45, Rule 4]
  const dragDropTargetEl = useRef<HTMLElement | null>(null);

  /**
   * Snapshot all .tug-tab-bar[data-card-id] elements at drag-start (excluding
   * our own card). Used for hit-testing during drag and on pointer-up. [D45]
   */
  const dragTabBarCache = useRef<Array<{ cardId: string; rect: DOMRect; el: HTMLElement }>>([]);

  // Snap-related refs [D01, D03, D04]
  // Other card rects snapshotted at drag-start (canvas-relative, keyed by id). [D04]
  const dragOtherRects = useRef<{ id: string; rect: Rect }[]>([]);
  // Active snap guide DOM elements for cleanup. [D03]
  const dragGuideEls = useRef<HTMLElement[]>([]);
  // Set member card ids and frame elements (empty if not in a set). [D02]
  const dragSetMembers = useRef<{ id: string; el: HTMLElement }[]>([]);
  // Parallel to dragSetMembers: original DOM positions at drag-start. [D02]
  const dragSetOrigins = useRef<{ x: number; y: number }[]>([]);
  // Snap modifier state from latest pointer event. [D01]
  const latestSnapModifier = useRef(false);
  // Previous frame's snap modifier value for break-out transition detection. [D05]
  const prevSnapModifier = useRef(false);
  // Most recent snap result, carried from rAF closure to onPointerUp. [D01]
  const lastSnapResult = useRef<SnapResult | null>(null);
  // Computed border width of the .tugcard element, read once at drag-start. [D56]
  // Passed to computeSnap so adjacent card borders collapse into a single visual line.
  const dragBorderWidth = useRef(0);
  // Set member IDs at drag-start (including this card if in a set). Used at drop
  // to detect whether the card has newly joined a set (flash only on new membership). [D54]
  const dragSetMemberIdsAtDragStart = useRef<string[]>([]);
  // Bounding-box extension of the set beyond the dragged card at drag-start. [D02]
  // Stored as { left, top, right, bottom } offsets (non-negative px amounts) so the
  // clamp logic can use the full set bounding box when constraining to canvas bounds.
  const dragSetBBoxOffset = useRef<{ left: number; top: number; right: number; bottom: number }>({
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  });

  /**
   * Set a tab bar element as the current drag drop target (appearance-zone).
   * Clears the previous target before applying the new one. [D45, Rule 4]
   */
  function setDragDropTarget(el: HTMLElement | null): void {
    if (dragDropTargetEl.current === el) return;
    if (dragDropTargetEl.current) {
      dragDropTargetEl.current.removeAttribute("data-card-drag-target");
    }
    dragDropTargetEl.current = el;
    if (el) {
      el.setAttribute("data-card-drag-target", "true");
    }
  }

  /**
   * Compute insertion index for a merge into a target tab bar's tab array,
   * based on pointer X coordinate vs tab midpoints. Uses the same approach
   * as TabDragCoordinator.computeReorderIndex. [D45]
   */
  function computeMergeInsertIndex(barEl: HTMLElement, pointerX: number): number {
    const tabEls = barEl.querySelectorAll<HTMLElement>('.tug-tab:not([data-overflow="hidden"])');
    if (tabEls.length === 0) return 0;
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      if (pointerX < rect.left + rect.width / 2) return i;
    }
    return tabEls.length;
  }

  /**
   * Render snap guide DOM elements from a list of guide positions. [D03]
   * Creates or reuses <div> elements with .snap-guide-line CSS classes.
   * Appends to container; removes excess guide elements.
   * Works for both move-drag (dragGuideEls) and resize (resizeGuideEls).
   */
  function syncGuideElements(
    guideRef: React.MutableRefObject<HTMLElement[]>,
    guides: GuidePosition[],
    container: HTMLElement,
  ): void {
    // Create or update guide elements
    for (let i = 0; i < guides.length; i++) {
      const guide = guides[i];
      let el = guideRef.current[i];
      if (!el) {
        el = document.createElement("div");
        el.classList.add("snap-guide-line");
        container.appendChild(el);
        guideRef.current.push(el);
      }
      // Reset axis classes
      el.classList.remove("snap-guide-line-x", "snap-guide-line-y");
      if (guide.axis === "x") {
        el.classList.add("snap-guide-line-x");
        el.style.left = `${guide.position}px`;
        el.style.top = "";
      } else {
        el.classList.add("snap-guide-line-y");
        el.style.top = `${guide.position}px`;
        el.style.left = "";
      }
    }
    // Remove excess guide elements
    while (guideRef.current.length > guides.length) {
      const excess = guideRef.current.pop();
      if (excess && excess.parentNode) {
        excess.parentNode.removeChild(excess);
      }
    }
  }

  /**
   * Remove all snap guide elements from the DOM and clear tracking ref. [D03]
   * Works for both move-drag (dragGuideEls) and resize (resizeGuideEls).
   */
  function clearGuideElements(guideRef: React.MutableRefObject<HTMLElement[]>): void {
    for (const el of guideRef.current) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    guideRef.current = [];
  }

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

      // Build tab bar cache for merge hit-testing. [D45]
      // Snapshot all .tug-tab-bar[data-card-id] elements (excluding this card).
      dragTabBarCache.current = [];
      const barEls = document.querySelectorAll<HTMLElement>(".tug-tab-bar[data-card-id]");
      barEls.forEach((el) => {
        const cid = el.getAttribute("data-card-id");
        if (!cid || cid === id) return;
        dragTabBarCache.current.push({ cardId: cid, rect: el.getBoundingClientRect(), el });
      });

      // Snapshot other card rects at drag-start for snap computation. [D04]
      // Convert to canvas-relative coordinates by subtracting canvas bounds offset.
      const canvasBounds = dragCanvasBounds.current;
      dragOtherRects.current = [];
      const cardFrameEls = document.querySelectorAll<HTMLElement>(".card-frame[data-card-id]");
      cardFrameEls.forEach((el) => {
        const cid = el.getAttribute("data-card-id");
        if (!cid || cid === id) return;
        const domRect = el.getBoundingClientRect();
        const rect: Rect = {
          x: domRect.left - (canvasBounds ? canvasBounds.left : 0),
          y: domRect.top - (canvasBounds ? canvasBounds.top : 0),
          width: domRect.width,
          height: domRect.height,
        };
        dragOtherRects.current.push({ id: cid, rect });
      });

      // Compute set membership at drag-start for set-move behavior. [D02]
      // Build allCardRects with this card prepended.
      const thisRect: Rect = {
        x: position.x,
        y: position.y,
        width: frame.offsetWidth,
        height: frame.offsetHeight,
      };
      const allCardRects = [{ id, rect: thisRect }, ...dragOtherRects.current];
      const sharedEdges = findSharedEdges(allCardRects);
      const sets = computeSets(
        allCardRects.map((c) => c.id),
        sharedEdges,
      );

      // Find the set this card belongs to (if any).
      dragSetMembers.current = [];
      dragSetOrigins.current = [];
      dragSetMemberIdsAtDragStart.current = [];
      for (const cardSet of sets) {
        if (cardSet.cardIds.includes(id) && cardSet.cardIds.length >= 2) {
          // Snapshot the full set membership at drag-start (including this card). [D54]
          dragSetMemberIdsAtDragStart.current = cardSet.cardIds.slice();
          for (const memberId of cardSet.cardIds) {
            if (memberId === id) continue;
            const memberEl = document.querySelector<HTMLElement>(
              `.card-frame[data-card-id="${memberId}"]`,
            );
            if (memberEl) {
              dragSetMembers.current.push({ id: memberId, el: memberEl });
              dragSetOrigins.current.push({
                x: parseFloat(memberEl.style.left) || 0,
                y: parseFloat(memberEl.style.top) || 0,
              });
            }
          }
          break;
        }
      }

      // Compute the bounding-box extension of the set relative to the dragged card. [D02]
      // This measures how far the set extends beyond the card's own edges so that
      // clampedPosition can use the full set bounding box during set-move clamping.
      {
        const cardLeft = position.x;
        const cardTop = position.y;
        const cardRight = position.x + frame.offsetWidth;
        const cardBottom = position.y + frame.offsetHeight;
        let setBBoxLeft = cardLeft;
        let setBBoxTop = cardTop;
        let setBBoxRight = cardRight;
        let setBBoxBottom = cardBottom;
        for (const origin of dragSetOrigins.current) {
          // member frame dimensions from the DOM element (already pushed into dragSetMembers)
          const memberIdx = dragSetOrigins.current.indexOf(origin);
          const memberEl = dragSetMembers.current[memberIdx]?.el;
          if (!memberEl) continue;
          const mRight = origin.x + memberEl.offsetWidth;
          const mBottom = origin.y + memberEl.offsetHeight;
          if (origin.x < setBBoxLeft) setBBoxLeft = origin.x;
          if (origin.y < setBBoxTop) setBBoxTop = origin.y;
          if (mRight > setBBoxRight) setBBoxRight = mRight;
          if (mBottom > setBBoxBottom) setBBoxBottom = mBottom;
        }
        dragSetBBoxOffset.current = {
          left: cardLeft - setBBoxLeft,
          top: cardTop - setBBoxTop,
          right: setBBoxRight - cardRight,
          bottom: setBBoxBottom - cardBottom,
        };
      }

      // Read .tugcard computed border width once at drag-start for border collapse. [D56]
      // Parsed to a number for use as computeSnap's borderWidth parameter.
      const tugcardEl = frame.querySelector<HTMLElement>(".tugcard");
      dragBorderWidth.current = tugcardEl
        ? parseFloat(getComputedStyle(tugcardEl).borderTopWidth) || 0
        : 0;

      // Initialize snap modifier state. [D01]
      latestSnapModifier.current = false;
      prevSnapModifier.current = false;
      lastSnapResult.current = null;

      function applyDragFrame() {
        dragRafId.current = null;
        if (!dragActive.current) return;
        // During set-move, clamp using the full set bounding box so no set member
        // can be dragged outside the canvas. During solo drag, use just the frame size. [D02]
        //
        // clampedPosition returns the card top-left after clamping. For set-move we
        // instead clamp the set bounding box top-left (= card pos - bbo.{left,top}), then
        // add bbo.{left,top} back to recover the card position.
        const bbo = dragSetBBoxOffset.current;
        const setMoveActive = dragSetMembers.current.length > 0 && !latestSnapModifier.current;
        let pos: { x: number; y: number };
        if (setMoveActive) {
          // Shift the effective start position to the set's top-left corner, clamp the full
          // set bounding box within the canvas, then restore the card's position within the set.
          const setBBoxStart = {
            x: dragStartPosition.current.x - bbo.left,
            y: dragStartPosition.current.y - bbo.top,
          };
          const setBBoxSize = {
            width: frame.offsetWidth + bbo.left + bbo.right,
            height: frame.offsetHeight + bbo.top + bbo.bottom,
          };
          const setPos = clampedPosition(
            latestDragPointer.current,
            dragStartPointer.current,
            setBBoxStart,
            dragCanvasBounds.current,
            setBBoxSize,
          );
          pos = { x: setPos.x + bbo.left, y: setPos.y + bbo.top };
        } else {
          pos = clampedPosition(
            latestDragPointer.current,
            dragStartPointer.current,
            dragStartPosition.current,
            dragCanvasBounds.current,
            { width: frame.offsetWidth, height: frame.offsetHeight },
          );
        }

        // Break-out detection: snap modifier pressed during set-move. [D05]
        // If modifier transitions false->true while set members exist, detach.
        if (
          dragSetMembers.current.length > 0 &&
          latestSnapModifier.current === true &&
          prevSnapModifier.current === false
        ) {
          // Snapshot remaining members before clearing (used for corner recompute below).
          const remainingMembers = dragSetMembers.current.slice();

          // Commit each set member's current DOM position to the store.
          for (const member of remainingMembers) {
            const memberPos = {
              x: parseFloat(member.el.style.left) || 0,
              y: parseFloat(member.el.style.top) || 0,
            };
            const memberSize = {
              width: member.el.offsetWidth,
              height: member.el.offsetHeight,
            };
            onCardMoved(member.id, memberPos, memberSize);
          }
          // Detach: clear set members so this card enters snap mode.
          dragSetMembers.current = [];
          dragSetOrigins.current = [];
          // Directly clear clip-path and data-in-set on the detached card's .tugcard.
          // Break-out detection runs BEFORE frame.style.left/top is written, so
          // getBoundingClientRect still sees the previous frame's position. Calling
          // updateSetAppearance here would incorrectly see the detached card as still
          // adjacent to the set. Direct DOM manipulation gives immediate visual
          // correctness without position dependency. [D07]
          // The remaining set members' clip-paths are updated by the store subscriber,
          // which fires synchronously from the onCardMoved calls above. [D07]
          const breakoutTugcard = frame.querySelector<HTMLElement>(".tugcard");
          if (breakoutTugcard) {
            breakoutTugcard.style.clipPath = "";
          }
          frame.removeAttribute("data-in-set");

          // Flash full perimeter of the detached card. [D55]
          flashCardPerimeter(frame);

          // Clear the pre-drag set snapshot so the drag-end postActionSetUpdate
          // does not see "was in set, now solo" and fire a second break-out flash. [D55]
          dragSetMemberIdsAtDragStart.current = [];
        }

        // Update previous snap modifier for next frame's break-out check.
        prevSnapModifier.current = latestSnapModifier.current;

        // Determine behavior based on modifier and set membership.
        if (latestSnapModifier.current && dragSetMembers.current.length === 0) {
          // Snap mode: modifier held, solo card or just broke out. [D01]
          const movingRect: Rect = {
            x: pos.x,
            y: pos.y,
            width: frame.offsetWidth,
            height: frame.offsetHeight,
          };
          const snapResult = computeSnap(
            movingRect,
            dragOtherRects.current.map((r) => r.rect),
            undefined,
            dragBorderWidth.current,
          );
          lastSnapResult.current = snapResult;
          if (snapResult.x !== null) {
            pos.x = snapResult.x;
          }
          if (snapResult.y !== null) {
            pos.y = snapResult.y;
          }
          // Render snap guides via DOM manipulation. [D03]
          const container = frame.parentElement;
          if (container) {
            syncGuideElements(dragGuideEls, snapResult.guides, container);
          }
        } else if (!latestSnapModifier.current && dragSetMembers.current.length === 0) {
          // Free drag: solo card, no snap modifier. Clear guides and snap result.
          lastSnapResult.current = null;
          clearGuideElements(dragGuideEls);
        } else if (dragSetMembers.current.length > 0 && !latestSnapModifier.current) {
          // Set-move: modifier not held, move all set members by the same clamped delta
          // as the main card so no member slides relative to any other. [D02]
          // Use the clamped card position (pos) minus the drag-start position to get
          // the actual effective displacement (which may differ from raw pointer delta
          // when the set bounding box is clamped at the canvas edge).
          const clampedDeltaX = pos.x - dragStartPosition.current.x;
          const clampedDeltaY = pos.y - dragStartPosition.current.y;
          for (let i = 0; i < dragSetMembers.current.length; i++) {
            const member = dragSetMembers.current[i];
            const origin = dragSetOrigins.current[i];
            member.el.style.left = `${origin.x + clampedDeltaX}px`;
            member.el.style.top = `${origin.y + clampedDeltaY}px`;
          }
          // No shadow element to translate — clip-path is intrinsic to each card and
          // moves automatically with the card's box model. [D01, D05]
        }

        frame.style.left = `${pos.x}px`;
        frame.style.top = `${pos.y}px`;

        // Hit-test tab bars for drop target visual feedback. [D45, Rule 4]
        const cx = latestDragPointer.current.x;
        const cy = latestDragPointer.current.y;
        let found: HTMLElement | null = null;
        for (const entry of dragTabBarCache.current) {
          const r = entry.rect;
          if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
            found = entry.el;
            break;
          }
        }
        setDragDropTarget(found);
      }

      function onPointerMove(e: PointerEvent) {
        latestDragPointer.current = { x: e.clientX, y: e.clientY };
        // Update snap modifier state from pointer event. [D01]
        latestSnapModifier.current = isSnapModifier(e);
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

        // Remove snap guides immediately on drop. [D03]
        // Must happen before any early return (e.g. merge) to prevent guide leaks.
        clearGuideElements(dragGuideEls);

        // Clear drop target highlight before committing. [D45, Rule 4]
        setDragDropTarget(null);
        // Belt-and-suspenders: clear attribute on all cached bar elements.
        for (const entry of dragTabBarCache.current) {
          entry.el.removeAttribute("data-card-drag-target");
        }

        // Hit-test tab bars for merge on drop. [D45]
        // Merge takes priority over snap-on-drop. [D06]
        if (onCardMerged && activeTabId) {
          const cx = e.clientX;
          const cy = e.clientY;
          for (const entry of dragTabBarCache.current) {
            const r = entry.rect;
            if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
              const insertIndex = computeMergeInsertIndex(entry.el, cx);
              onCardMerged(id, entry.cardId, insertIndex);
              dragTabBarCache.current = [];
              // Reset all snap/set state before returning.
              dragOtherRects.current = [];
              dragSetMembers.current = [];
              dragSetOrigins.current = [];
              dragSetMemberIdsAtDragStart.current = [];
              dragSetBBoxOffset.current = { left: 0, top: 0, right: 0, bottom: 0 };
              latestSnapModifier.current = false;
              prevSnapModifier.current = false;
              lastSnapResult.current = null;
              // Recompute clip-path after merge so set appearance reflects the new layout. [D01]
              updateSetAppearance(dragCanvasBounds.current, frame.parentElement);
              return;
            }
          }
        }

        dragTabBarCache.current = [];

        // Compute final position for the dragged card. [S03]
        // During set-move, clamp using the full set bounding box (same logic as applyDragFrame). [D02]
        const bboUp = dragSetBBoxOffset.current;
        const setMoveActiveUp = dragSetMembers.current.length > 0;
        let clampedPos: { x: number; y: number };
        if (setMoveActiveUp) {
          const setBBoxStart = {
            x: dragStartPosition.current.x - bboUp.left,
            y: dragStartPosition.current.y - bboUp.top,
          };
          const setBBoxSize = {
            width: frame.offsetWidth + bboUp.left + bboUp.right,
            height: frame.offsetHeight + bboUp.top + bboUp.bottom,
          };
          const setPos = clampedPosition(
            { x: e.clientX, y: e.clientY },
            dragStartPointer.current,
            setBBoxStart,
            dragCanvasBounds.current,
            setBBoxSize,
          );
          clampedPos = { x: setPos.x + bboUp.left, y: setPos.y + bboUp.top };
        } else {
          clampedPos = clampedPosition(
            { x: e.clientX, y: e.clientY },
            dragStartPointer.current,
            dragStartPosition.current,
            dragCanvasBounds.current,
            { width: frame.offsetWidth, height: frame.offsetHeight },
          );
        }

        // Apply snapped position if snap was active at drop. [S03 priority 2]
        const snapResult = lastSnapResult.current;
        const finalPos = {
          x: snapResult && snapResult.x !== null ? snapResult.x : clampedPos.x,
          y: snapResult && snapResult.y !== null ? snapResult.y : clampedPos.y,
        };

        frame.style.left = `${finalPos.x}px`;
        frame.style.top = `${finalPos.y}px`;
        onCardMoved(id, finalPos, { width: frame.offsetWidth, height: frame.offsetHeight });

        // Commit set members' final positions if set-move completed without break-out. [D02]
        for (const member of dragSetMembers.current) {
          const memberPos = {
            x: parseFloat(member.el.style.left) || 0,
            y: parseFloat(member.el.style.top) || 0,
          };
          const memberSize = {
            width: member.el.offsetWidth,
            height: member.el.offsetHeight,
          };
          onCardMoved(member.id, memberPos, memberSize);
        }

        // Flash set perimeter / break-out flash on drop. [D54, D55]
        postActionSetUpdate(id, dragSetMemberIdsAtDragStart.current, dragCanvasBounds.current, frame.parentElement);

        // Reset all snap/set state.
        dragOtherRects.current = [];
        dragSetMembers.current = [];
        dragSetOrigins.current = [];
        dragSetMemberIdsAtDragStart.current = [];
        dragSetBBoxOffset.current = { left: 0, top: 0, right: 0, bottom: 0 };
        latestSnapModifier.current = false;
        prevSnapModifier.current = false;
        lastSnapResult.current = null;
      }

      frame.addEventListener("pointermove", onPointerMove);
      frame.addEventListener("pointerup", onPointerUp);
    },
    // position.x/y captured into dragStartPosition at drag-start; id, onCardMoved,
    // onCardMerged, and activeTabId are stable or handled via closure capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, onCardMoved, onCardMerged, activeTabId, position.x, position.y],
  );

  // ---------------------------------------------------------------------------
  // Resize mechanic
  // ---------------------------------------------------------------------------

  // Snap guide DOM elements for resize (separate from drag guides). [D03]
  const resizeGuideEls = useRef<HTMLElement[]>([]);

  // syncResizeGuides and clearResizeGuides are now handled by the shared
  // syncGuideElements(resizeGuideEls, ...) and clearGuideElements(resizeGuideEls) calls. [D03]

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

      // Snapshot canvas bounds and other card rects for resize snapping. [D04]
      const resizeCanvasBounds = frame.parentElement?.getBoundingClientRect() ?? null;
      const resizeOtherRects: Rect[] = [];
      const cardFrameEls = document.querySelectorAll<HTMLElement>(".card-frame[data-card-id]");
      cardFrameEls.forEach((el) => {
        const cid = el.getAttribute("data-card-id");
        if (!cid || cid === id) return;
        const domRect = el.getBoundingClientRect();
        resizeOtherRects.push({
          x: domRect.left - (resizeCanvasBounds ? resizeCanvasBounds.left : 0),
          y: domRect.top - (resizeCanvasBounds ? resizeCanvasBounds.top : 0),
          width: domRect.width,
          height: domRect.height,
        });
      });

      // Snapshot set membership at resize-start for post-resize flash detection. [D54]
      // Build all card rects (including this card) and find which set this card belongs to.
      const resizeAllRects: { id: string; rect: Rect }[] = [];
      const resizeAllFrameEls = document.querySelectorAll<HTMLElement>(".card-frame[data-card-id]");
      resizeAllFrameEls.forEach((el) => {
        const cid = el.getAttribute("data-card-id");
        if (!cid) return;
        const domRect = el.getBoundingClientRect();
        resizeAllRects.push({
          id: cid,
          rect: {
            x: domRect.left - (resizeCanvasBounds ? resizeCanvasBounds.left : 0),
            y: domRect.top - (resizeCanvasBounds ? resizeCanvasBounds.top : 0),
            width: domRect.width,
            height: domRect.height,
          },
        });
      });
      const resizePreSharedEdges = findSharedEdges(resizeAllRects);
      const resizePreSets = computeSets(
        resizeAllRects.map((c) => c.id),
        resizePreSharedEdges,
      );
      const resizePreSet = resizePreSets.find((s) => s.cardIds.includes(id));
      const resizePreSetMemberIds: string[] = resizePreSet ? resizePreSet.cardIds.slice() : [];

      // Detect sash neighbor: if this card is in a set AND the edge being resized is a shared
      // edge with a neighbor, store the sash neighbor info for co-resize. [Fix 3]
      // Only single-edge resizes (n, s, e, w) can be sash; corners skip sash detection.
      let sashNeighborId: string | null = null;
      let sashNeighborEdge: "n" | "s" | "e" | "w" | null = null;
      let sashNeighborEl: HTMLElement | null = null;
      let sashNeighborStartLeft = 0;
      let sashNeighborStartTop = 0;
      let sashNeighborStartW = 0;
      let sashNeighborStartH = 0;

      const isSingleEdge = edge === "n" || edge === "s" || edge === "e" || edge === "w";
      if (isSingleEdge && resizePreSet) {
        for (const sharedEdge of resizePreSharedEdges) {
          // Check if this shared edge involves the current card and the resize edge.
          let neighborId: string | null = null;
          let neighborEdge: "n" | "s" | "e" | "w" | null = null;

          if (edge === "e" && sharedEdge.axis === "vertical" && sharedEdge.cardAId === id) {
            // This card's right edge = neighbor's left edge; neighbor's left moves east.
            neighborId = sharedEdge.cardBId;
            neighborEdge = "w";
          } else if (edge === "w" && sharedEdge.axis === "vertical" && sharedEdge.cardBId === id) {
            // This card's left edge = neighbor's right edge; neighbor's right moves west.
            neighborId = sharedEdge.cardAId;
            neighborEdge = "e";
          } else if (edge === "s" && sharedEdge.axis === "horizontal" && sharedEdge.cardAId === id) {
            // This card's bottom edge = neighbor's top edge; neighbor's top moves south.
            neighborId = sharedEdge.cardBId;
            neighborEdge = "n";
          } else if (edge === "n" && sharedEdge.axis === "horizontal" && sharedEdge.cardBId === id) {
            // This card's top edge = neighbor's bottom edge; neighbor's bottom moves north.
            neighborId = sharedEdge.cardAId;
            neighborEdge = "s";
          }

          if (neighborId && neighborEdge) {
            const neighborEl = document.querySelector<HTMLElement>(
              `.card-frame[data-card-id="${neighborId}"]`,
            );
            if (neighborEl) {
              sashNeighborId = neighborId;
              sashNeighborEdge = neighborEdge;
              sashNeighborEl = neighborEl;
              sashNeighborStartLeft = parseFloat(neighborEl.style.left) || 0;
              sashNeighborStartTop = parseFloat(neighborEl.style.top) || 0;
              sashNeighborStartW = neighborEl.offsetWidth;
              sashNeighborStartH = neighborEl.offsetHeight;
            }
            break;
          }
        }
      }

      const latestResizePointer = { x: startX, y: startY };
      let latestResizeModifier = isSnapModifier(event.nativeEvent);
      let resizeRafId: number | null = null;
      let resizeActive = true;

      function computeAndApplyResize(pointer: { x: number; y: number }, snapModifier: boolean): {
        left: number; top: number; width: number; height: number;
      } {
        const r = resizeDelta(
          pointer,
          { x: startX, y: startY },
          startLeft,
          startTop,
          startW,
          startH,
          edge,
          minSizeRef.current,
          resizeCanvasBounds,
        );

        // Sash co-resize: when a shared edge is grabbed and modifier is NOT held,
        // apply the opposite resize to the neighbor so the shared edge moves as a sash. [Fix 3]
        if (sashNeighborEl && sashNeighborEdge && !snapModifier) {
          const minW = minSizeRef.current.width;
          const minH = minSizeRef.current.height;
          let neighborLeft = sashNeighborStartLeft;
          let neighborTop = sashNeighborStartTop;
          let neighborW = sashNeighborStartW;
          let neighborH = sashNeighborStartH;

          if (edge === "e" && sashNeighborEdge === "w") {
            // Grabbed card grows right → neighbor's left moves right (neighbor gets narrower).
            // delta for the shared edge = r.left + r.width - (startLeft + startW)
            const sharedEdgePos = r.left + r.width;
            const neighborRight = sashNeighborStartLeft + sashNeighborStartW;
            neighborLeft = sharedEdgePos;
            neighborW = Math.max(minW, neighborRight - sharedEdgePos);
            // If neighbor would be clamped, clamp the grabbed card's right edge too.
            if (neighborRight - sharedEdgePos < minW) {
              const clampedSharedEdge = neighborRight - minW;
              neighborLeft = clampedSharedEdge;
              neighborW = minW;
              r.width = Math.max(minW, clampedSharedEdge - r.left);
            }
          } else if (edge === "w" && sashNeighborEdge === "e") {
            // Grabbed card grows left → neighbor's right moves left (neighbor gets narrower).
            const sharedEdgePos = r.left;
            const neighborLeft0 = sashNeighborStartLeft;
            neighborW = Math.max(minW, sharedEdgePos - neighborLeft0);
            if (sharedEdgePos - neighborLeft0 < minW) {
              const clampedSharedEdge = neighborLeft0 + minW;
              neighborW = minW;
              r.left = clampedSharedEdge;
              r.width = Math.max(minW, startLeft + startW - clampedSharedEdge);
            }
          } else if (edge === "s" && sashNeighborEdge === "n") {
            // Grabbed card grows down → neighbor's top moves down (neighbor gets shorter).
            const sharedEdgePos = r.top + r.height;
            const neighborBottom = sashNeighborStartTop + sashNeighborStartH;
            neighborTop = sharedEdgePos;
            neighborH = Math.max(minH, neighborBottom - sharedEdgePos);
            if (neighborBottom - sharedEdgePos < minH) {
              const clampedSharedEdge = neighborBottom - minH;
              neighborTop = clampedSharedEdge;
              neighborH = minH;
              r.height = Math.max(minH, clampedSharedEdge - r.top);
            }
          } else if (edge === "n" && sashNeighborEdge === "s") {
            // Grabbed card grows up → neighbor's bottom moves up (neighbor gets shorter).
            const sharedEdgePos = r.top;
            const neighborTop0 = sashNeighborStartTop;
            neighborH = Math.max(minH, sharedEdgePos - neighborTop0);
            if (sharedEdgePos - neighborTop0 < minH) {
              const clampedSharedEdge = neighborTop0 + minH;
              neighborH = minH;
              r.top = clampedSharedEdge;
              r.height = Math.max(minH, startTop + startH - clampedSharedEdge);
            }
          }

          // Apply neighbor dimensions to its DOM element.
          sashNeighborEl.style.left = `${neighborLeft}px`;
          sashNeighborEl.style.top = `${neighborTop}px`;
          sashNeighborEl.style.width = `${neighborW}px`;
          sashNeighborEl.style.height = `${neighborH}px`;

          // No snap guides for sash resize (cards are already aligned).
          clearGuideElements(resizeGuideEls);
          return r;
        }

        // Apply snap-to-edge if modifier is held. [D01]
        if (snapModifier) {
          // Build the set of edges being actively resized (absolute canvas coords).
          const resizingEdges: { top?: number; bottom?: number; left?: number; right?: number } =
            {};
          if (edge.includes("n")) resizingEdges.top = r.top;
          if (edge.includes("s")) resizingEdges.bottom = r.top + r.height;
          if (edge.includes("w")) resizingEdges.left = r.left;
          if (edge.includes("e")) resizingEdges.right = r.left + r.width;

          // Pass borderWidth=1 so adjacent-edge resize snaps overlap by 1px for border collapse. [D56]
          const snapResult = computeResizeSnap(resizingEdges, resizeOtherRects, 1);

          // Apply snapped values back to the rect, clamped to minSize.
          let { left, top, width, height } = r;
          if (snapResult.left !== undefined) {
            const newW = Math.max(minSizeRef.current.width, left + width - snapResult.left);
            left = left + width - newW;
            width = newW;
          }
          if (snapResult.right !== undefined) {
            width = Math.max(minSizeRef.current.width, snapResult.right - left);
          }
          if (snapResult.top !== undefined) {
            const newH = Math.max(minSizeRef.current.height, top + height - snapResult.top);
            top = top + height - newH;
            height = newH;
          }
          if (snapResult.bottom !== undefined) {
            height = Math.max(minSizeRef.current.height, snapResult.bottom - top);
          }

          // Render resize snap guides. [D03]
          const container = frame.parentElement;
          if (container) {
            syncGuideElements(resizeGuideEls, snapResult.guides, container);
          }

          return { left, top, width, height };
        } else {
          clearGuideElements(resizeGuideEls);
          return r;
        }
      }

      function applyResizeFrame() {
        resizeRafId = null;
        if (!resizeActive) return;
        const r = computeAndApplyResize(latestResizePointer, latestResizeModifier);
        frame.style.left = `${r.left}px`;
        frame.style.top = `${r.top}px`;
        frame.style.width = `${r.width}px`;
        frame.style.height = `${r.height}px`;
        // During sash co-resize both cards change size/position each frame, so the shared
        // edge moves and each card's interior vs exterior edges may change proportionally.
        // Call updateSetAppearance once per frame to keep clip-path values correct for both
        // the resizing card and the sash neighbor throughout the gesture. [D06, Spec S01]
        if (sashNeighborEl && !latestResizeModifier) {
          updateSetAppearance(resizeCanvasBounds, frame.parentElement);
        }
      }

      function onPointerMove(e: PointerEvent) {
        latestResizePointer.x = e.clientX;
        latestResizePointer.y = e.clientY;
        latestResizeModifier = isSnapModifier(e);
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

        // Compute final resize with snap applied first, THEN clear guides. [D03]
        // clearGuideElements must come AFTER computeAndApplyResize so that when snap
        // is active, syncGuideElements inside computeAndApplyResize does not re-create
        // guides that were already cleared.
        const r = computeAndApplyResize({ x: e.clientX, y: e.clientY }, isSnapModifier(e));
        clearGuideElements(resizeGuideEls);
        frame.style.left = `${r.left}px`;
        frame.style.top = `${r.top}px`;
        frame.style.width = `${r.width}px`;
        frame.style.height = `${r.height}px`;
        onCardMoved(id, { x: r.left, y: r.top }, { width: r.width, height: r.height });

        // Commit sash neighbor's final position if sash mode was active. [Fix 3]
        if (sashNeighborId && sashNeighborEl && !isSnapModifier(e)) {
          const neighborPos = {
            x: parseFloat(sashNeighborEl.style.left) || 0,
            y: parseFloat(sashNeighborEl.style.top) || 0,
          };
          const neighborSize = {
            width: sashNeighborEl.offsetWidth,
            height: sashNeighborEl.offsetHeight,
          };
          onCardMoved(sashNeighborId, neighborPos, neighborSize);
        }

        // Flash set perimeter / break-out flash on resize end. [D54, D55]
        postActionSetUpdate(id, resizePreSetMemberIds, resizeCanvasBounds, frame.parentElement);
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
// Set appearance: squared corners and clip-path shadow control [D08, D01, D02]
// ---------------------------------------------------------------------------

/**
 * Compute the `clip-path: inset(...)` CSS value for a single card based on its
 * shared edges within the set. [Spec S01, D04]
 *
 * For each of the four sides (top, right, bottom, left):
 * - Interior (shared with a neighbor): inset = `0px` (clips shadow at border-box edge).
 * - Exterior (no shared neighbor): inset = `-SHADOW_EXTEND_PX` (extends clip region to show shadow).
 *
 * SharedEdge convention:
 * - `axis: "vertical"`, `cardAId` → cardA's **right** edge is shared (interior for cardA).
 * - `axis: "vertical"`, `cardBId` → cardB's **left** edge is shared (interior for cardB).
 * - `axis: "horizontal"`, `cardAId` → cardA's **bottom** edge is shared (interior for cardA).
 * - `axis: "horizontal"`, `cardBId` → cardB's **top** edge is shared (interior for cardB).
 *
 * Returns an empty string when the card has no interior edges (all exterior — full shadow visible).
 *
 * @param cardId - The id of the card to compute clip-path for.
 * @param sharedEdges - All shared edges in the current layout.
 */
function computeClipPathForCard(cardId: string, sharedEdges: SharedEdge[]): string {
  let topInterior = false;
  let rightInterior = false;
  let bottomInterior = false;
  let leftInterior = false;

  for (const edge of sharedEdges) {
    if (edge.axis === "vertical") {
      if (edge.cardAId === cardId) {
        // cardA's right edge is shared.
        rightInterior = true;
      } else if (edge.cardBId === cardId) {
        // cardB's left edge is shared.
        leftInterior = true;
      }
    } else {
      // axis === "horizontal"
      if (edge.cardAId === cardId) {
        // cardA's bottom edge is shared.
        bottomInterior = true;
      } else if (edge.cardBId === cardId) {
        // cardB's top edge is shared.
        topInterior = true;
      }
    }
  }

  // If no edges are interior, return empty string (no clip-path needed — full shadow visible).
  if (!topInterior && !rightInterior && !bottomInterior && !leftInterior) {
    return "";
  }

  const ext = `-${SHADOW_EXTEND_PX}px`;
  const top = topInterior ? "0px" : ext;
  const right = rightInterior ? "0px" : ext;
  const bottom = bottomInterior ? "0px" : ext;
  const left = leftInterior ? "0px" : ext;

  return `inset(${top} ${right} ${bottom} ${left})`;
}

/**
 * Update the visual appearance of all cards based on their current set membership.
 *
 * For cards in a set:
 *   - Sets `data-in-set="true"` on `.card-frame` (CSS squares corners). [D08]
 *   - Computes `clip-path: inset(...)` per Spec S01 and applies it to the `.tugcard`
 *     child element, clipping shadow on interior (shared) edges while showing shadow
 *     on exterior edges. [D01, D02, D04]
 *
 * For solo cards:
 *   - Removes `data-in-set` attribute (CSS restores rounded corners).
 *   - Clears `clip-path` on `.tugcard` (full shadow visible on all sides).
 *
 * No DOM elements are created or removed. All mutations are direct style/attribute
 * writes on existing elements, safe to call at any time including mid-gesture. [D05]
 *
 * Called after any move or resize action completes, and once on initial load. [D08, D09]
 *
 * @param canvasBounds - Canvas DOMRect used to convert viewport rects to canvas-relative coords.
 * @param containerEl - The ResponderScope element (kept for API compatibility; used for z-index reordering context).
 */
export function updateSetAppearance(canvasBounds: DOMRect | null, containerEl: HTMLElement | null): void {
  const allFrameEls = document.querySelectorAll<HTMLElement>(".card-frame[data-card-id]");
  const rects: { id: string; rect: Rect }[] = [];
  allFrameEls.forEach((el) => {
    const cid = el.getAttribute("data-card-id");
    if (!cid) return;
    const domRect = el.getBoundingClientRect();
    rects.push({
      id: cid,
      rect: {
        x: domRect.left - (canvasBounds ? canvasBounds.left : 0),
        y: domRect.top - (canvasBounds ? canvasBounds.top : 0),
        width: domRect.width,
        height: domRect.height,
      },
    });
  });

  const sharedEdges = findSharedEdges(rects);
  const sets = computeSets(rects.map((c) => c.id), sharedEdges);

  // Build a set membership lookup: cardId → true if in any set.
  const inSetIds = new Set<string>();
  for (const cardSet of sets) {
    for (const cid of cardSet.cardIds) {
      inSetIds.add(cid);
    }
  }

  allFrameEls.forEach((el) => {
    const cardId = el.getAttribute("data-card-id");
    if (!cardId) return;

    const tugcardEl = el.querySelector<HTMLElement>(".tugcard");

    if (inSetIds.has(cardId)) {
      // Mark as in-set (CSS squares corners). [D08]
      el.setAttribute("data-in-set", "true");
      // Apply clip-path: inset() to .tugcard to control shadow visibility on each edge. [D01, D02, D04]
      if (tugcardEl) {
        const clipPath = computeClipPathForCard(cardId, sharedEdges);
        tugcardEl.style.clipPath = clipPath;
      }
    } else {
      // Solo card: restore rounded corners and clear clip-path (full shadow visible on all sides).
      el.removeAttribute("data-in-set");
      if (tugcardEl) {
        tugcardEl.style.clipPath = "";
      }
    }
  });

  // Adjust z-indices so that set members are consecutive (no non-set card between them). [D08]
  // This is an appearance-zone change: direct DOM mutation, not React state.
  //
  // Algorithm:
  // 1. Collect all card elements with their current z-index.
  // 2. Sort by current z-index (ascending).
  // 3. Build a new z-order where, when we encounter the highest-z member of a set,
  //    all set members are emitted consecutively at that position.
  // 4. Apply new z-indices to DOM elements.
  {
    // Build list of all card elements with current z-index values.
    const cardZList: Array<{ id: string; el: HTMLElement; z: number }> = [];
    allFrameEls.forEach((el) => {
      const cid = el.getAttribute("data-card-id");
      if (!cid) return;
      const z = parseInt(el.style.zIndex, 10);
      cardZList.push({ id: cid, el, z: isNaN(z) ? 0 : z });
    });

    // Sort by current z-index ascending.
    cardZList.sort((a, b) => a.z - b.z);

    // Build a map from cardId to which set it belongs to (index into sets array).
    const cardSetIndex = new Map<string, number>();
    for (let i = 0; i < sets.length; i++) {
      for (const cid of sets[i].cardIds) {
        cardSetIndex.set(cid, i);
      }
    }

    // For each set, find the highest z-index among its members (the "anchor" position).
    const setMaxZ: number[] = sets.map(() => -Infinity);
    for (const entry of cardZList) {
      const si = cardSetIndex.get(entry.id);
      if (si !== undefined && entry.z > setMaxZ[si]) {
        setMaxZ[si] = entry.z;
      }
    }

    // Rebuild z-order: process cards in ascending z-index order.
    // When we encounter the anchor of a set (highest-z member), emit all set members
    // consecutively. Non-set cards and set members that have already been emitted are skipped/placed normally.
    const emittedSets = new Set<number>();
    const newZOrder: Array<{ el: HTMLElement; newZ: number }> = [];
    let nextZ = cardZList.length > 0 ? cardZList[0].z : 1;

    // We need to assign z-indices while keeping relative order.
    // Strategy: iterate cards in ascending z order. When we hit a set's anchor (highest-z member),
    // first emit all other members of that set (lowest-z first), then the anchor itself.
    // Skip cards already emitted as part of their set's earlier anchor pass.
    const alreadyEmitted = new Set<string>();

    for (const entry of cardZList) {
      if (alreadyEmitted.has(entry.id)) continue;

      const si = cardSetIndex.get(entry.id);
      if (si !== undefined && !emittedSets.has(si)) {
        // Check if this is the anchor (highest-z) member of the set.
        if (entry.z === setMaxZ[si]) {
          // Emit all set members consecutively at this position.
          // Sort set members by their original z-index to preserve relative order within set.
          const setMembers = cardZList.filter((e) => cardSetIndex.get(e.id) === si);
          setMembers.sort((a, b) => a.z - b.z);
          for (const member of setMembers) {
            newZOrder.push({ el: member.el, newZ: nextZ });
            nextZ++;
            alreadyEmitted.add(member.id);
          }
          emittedSets.add(si);
        } else {
          // Not the anchor yet — skip this card; it will be emitted when we reach the anchor.
          continue;
        }
      } else if (si === undefined) {
        // Non-set card: emit at next available position.
        newZOrder.push({ el: entry.el, newZ: nextZ });
        nextZ++;
        alreadyEmitted.add(entry.id);
      }
      // If si is defined but set already emitted, card was already handled — skip.
    }

    // Apply new z-indices to DOM.
    for (const { el, newZ } of newZOrder) {
      el.style.zIndex = String(newZ);
    }
  }

}

// ---------------------------------------------------------------------------
// Post-action set detection and flash (shared by move and resize) [D54]
// ---------------------------------------------------------------------------

/**
 * After a move or resize action completes, detect whether the card has joined,
 * left, or changed sets and fire the appropriate flash animation. [D54, D55]
 *
 * This function:
 * 1. Queries all `.card-frame[data-card-id]` elements from the DOM.
 * 2. Builds rects relative to canvas bounds.
 * 3. Calls `findSharedEdges(rects)` and `computeSets(ids, sharedEdges)`.
 * 4. Finds the set containing `cardId` (if any).
 * 5. Compares sorted `preActionSetMemberIds` vs post-action set member IDs.
 * 6. If set membership CHANGED and card is now in a set → `flashSetPerimeter`.
 * 7. If card WAS in a set but is now NOT in any set → `flashCardPerimeter` (break-out flash).
 *
 * @param cardId - The id of the moved or resized card.
 * @param preActionSetMemberIds - Set member IDs captured before the action started (empty if solo).
 * @param canvasBounds - Canvas DOMRect used to convert viewport rects to canvas-relative coords.
 */
function postActionSetUpdate(
  cardId: string,
  preActionSetMemberIds: string[],
  canvasBounds: DOMRect | null,
  containerEl: HTMLElement | null,
): void {
  const postRects: { id: string; rect: Rect }[] = [];
  const allFrameEls = document.querySelectorAll<HTMLElement>(".card-frame[data-card-id]");
  allFrameEls.forEach((el) => {
    const cid = el.getAttribute("data-card-id");
    if (!cid) return;
    const domRect = el.getBoundingClientRect();
    postRects.push({
      id: cid,
      rect: {
        x: domRect.left - (canvasBounds ? canvasBounds.left : 0),
        y: domRect.top - (canvasBounds ? canvasBounds.top : 0),
        width: domRect.width,
        height: domRect.height,
      },
    });
  });

  const postSharedEdges = findSharedEdges(postRects);
  const postSets = computeSets(
    postRects.map((c) => c.id),
    postSharedEdges,
  );
  const mySet = postSets.find((s) => s.cardIds.includes(cardId));

  if (mySet) {
    // Card is now in a set — flash only if membership changed. [D54]
    const startIds = preActionSetMemberIds.slice().sort();
    const endIds = mySet.cardIds.slice().sort();
    const setChanged =
      startIds.length !== endIds.length || startIds.some((sid, i) => sid !== endIds[i]);
    if (setChanged) {
      flashSetPerimeter(mySet.cardIds, postRects, containerEl);
    }
  } else if (preActionSetMemberIds.length > 0) {
    // Card was in a set but is now solo — break-out flash. [D55]
    const frameEl = document.querySelector<HTMLElement>(
      `.card-frame[data-card-id="${cardId}"]`,
    );
    if (frameEl) {
      flashCardPerimeter(frameEl);
    }
  }

  // Update set appearance (squared corners, hull shadows) after any move/resize. [D08]
  updateSetAppearance(canvasBounds, containerEl);
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
    x = Math.max(CANVAS_PADDING, Math.min(x, canvasBounds.width - frameSize.width - CANVAS_PADDING));
    y = Math.max(CANVAS_PADDING, Math.min(y, canvasBounds.height - frameSize.height - CANVAS_PADDING));
  }

  return { x, y };
}

/**
 * Compute new bounding rect after resizing on the given edge.
 * Width and height are clamped to minSize.
 * When canvasBounds is provided, the resulting rect is also clamped so the
 * card cannot extend beyond the canvas edges (accounting for CANVAS_PADDING).
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
  canvasBounds?: DOMRect | null,
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

  // Clamp to canvas bounds so the card cannot be resized past any canvas edge. [D04]
  if (canvasBounds) {
    const maxRight = canvasBounds.width - CANVAS_PADDING;
    const maxBottom = canvasBounds.height - CANVAS_PADDING;

    // Clamp right edge: prevent card from extending past canvas right.
    if (left + width > maxRight) {
      if (edge.includes("e")) {
        // Shrink width when resizing from east edge.
        width = Math.max(minSize.width, maxRight - left);
      } else if (edge.includes("w")) {
        // Resizing from west: the right edge is fixed; clamp left so left >= CANVAS_PADDING.
        left = Math.max(CANVAS_PADDING, left);
        width = startLeft + startW - left;
        if (width < minSize.width) {
          width = minSize.width;
          left = startLeft + startW - width;
        }
      }
    }
    // Clamp left edge: prevent card from going left of canvas left.
    if (left < CANVAS_PADDING) {
      left = CANVAS_PADDING;
      width = startLeft + startW - left;
      if (width < minSize.width) width = minSize.width;
    }

    // Clamp bottom edge: prevent card from extending past canvas bottom.
    if (top + height > maxBottom) {
      if (edge.includes("s")) {
        height = Math.max(minSize.height, maxBottom - top);
      } else if (edge.includes("n")) {
        top = Math.max(CANVAS_PADDING, top);
        height = startTop + startH - top;
        if (height < minSize.height) {
          height = minSize.height;
          top = startTop + startH - height;
        }
      }
    }
    // Clamp top edge: prevent card from going above canvas top.
    if (top < CANVAS_PADDING) {
      top = CANVAS_PADDING;
      height = startTop + startH - top;
      if (height < minSize.height) height = minSize.height;
    }
  }

  return { left, top, width, height };
}

// ---------------------------------------------------------------------------
// Flash overlay helpers (appearance-zone, [D54], Spec S03)
// ---------------------------------------------------------------------------

/** Glow expansion in px for the SVG flash glow filter. */
const SVG_FLASH_GLOW_BLUR = 4;

/**
 * Create a single SVG hull flash element for a newly formed set. [D02, Spec S03]
 *
 * Replaces the per-card overlay approach. Computes the outer hull polygon of
 * all set cards, draws a single SVG <path> with accent stroke and glow filter,
 * and appends it to the ResponderScope (containerEl). Self-removes on animationend.
 *
 * @param setCardIds - IDs of all cards in the set.
 * @param cardRects - Canvas-relative rects for all cards.
 * @param containerEl - The ResponderScope element to append the SVG to.
 */
export function flashSetPerimeter(
  setCardIds: string[],
  cardRects: { id: string; rect: Rect }[],
  containerEl: HTMLElement | null,
): void {
  if (!containerEl) return;

  // Collect rects for all cards in the set.
  const rects: Rect[] = [];
  for (const cardId of setCardIds) {
    const entry = cardRects.find((r) => r.id === cardId);
    if (entry) rects.push(entry.rect);
  }

  // Compute hull polygon. Guard against degenerate input per [D06].
  const hull = computeSetHullPolygon(rects);
  if (hull.length < 3) return;

  // Compute hull bounding box with glow padding so the filter has room to breathe.
  const pad = SVG_FLASH_GLOW_BLUR * 2;
  const hullMinX = hull.reduce((m, p) => Math.min(m, p.x), Infinity);
  const hullMinY = hull.reduce((m, p) => Math.min(m, p.y), Infinity);
  const hullMaxX = hull.reduce((m, p) => Math.max(m, p.x), -Infinity);
  const hullMaxY = hull.reduce((m, p) => Math.max(m, p.y), -Infinity);
  const bx = hullMinX - pad;
  const by = hullMinY - pad;
  const bw = hullMaxX - hullMinX + pad * 2;
  const bh = hullMaxY - hullMinY + pad * 2;

  // Unique filter ID to avoid cross-SVG filter collisions when multiple flashes are active.
  const uid = nextFlashId++;

  // Build SVG path data in SVG-local coordinates (hull coords minus bounding box origin).
  const svgPath =
    hull.map((p, i) => `${i === 0 ? "M" : "L"}${p.x - bx},${p.y - by}`).join(" ") + " Z";

  // Create SVG element.
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("set-flash-svg");
  svg.style.left = `${bx}px`;
  svg.style.top = `${by}px`;
  svg.style.width = `${bw}px`;
  svg.style.height = `${bh}px`;

  // Glow filter: feGaussianBlur + feMerge to render both blurred glow and crisp stroke.
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", `set-flash-glow-${uid}`);
  filter.setAttribute("x", "-50%");
  filter.setAttribute("y", "-50%");
  filter.setAttribute("width", "200%");
  filter.setAttribute("height", "200%");

  const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("stdDeviation", String(SVG_FLASH_GLOW_BLUR));
  blur.setAttribute("result", "blur");

  const merge = document.createElementNS("http://www.w3.org/2000/svg", "feMerge");
  const mergeNodeBlur = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
  mergeNodeBlur.setAttribute("in", "blur");
  const mergeNodeSrc = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
  mergeNodeSrc.setAttribute("in", "SourceGraphic");

  merge.appendChild(mergeNodeBlur);
  merge.appendChild(mergeNodeSrc);
  filter.appendChild(blur);
  filter.appendChild(merge);
  defs.appendChild(filter);
  svg.appendChild(defs);

  // Hull path with accent stroke and glow filter.
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", svgPath);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "var(--td-accent)");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("filter", `url(#set-flash-glow-${uid})`);
  svg.appendChild(path);

  // Self-remove after animation completes.
  svg.addEventListener("animationend", () => {
    if (svg.parentNode) svg.parentNode.removeChild(svg);
  });

  containerEl.appendChild(svg);
}

/**
 * Create a full-perimeter .card-flash-overlay on a single card's frame.
 *
 * Used on break-out to flash the detached card's entire perimeter. All four
 * borders are intact (no suppression). Cards are always fully rounded. [D55]
 *
 * @param cardFrameEl - The .card-frame element of the detached card.
 */
export function flashCardPerimeter(cardFrameEl: HTMLElement): void {
  const overlay = document.createElement("div");
  overlay.classList.add("card-flash-overlay");

  // Full perimeter: no edge suppression, no clip-path restriction.
  // Cards are always fully rounded — use CSS default border-radius.

  // Self-remove after animation completes.
  overlay.addEventListener("animationend", () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  });

  cardFrameEl.appendChild(overlay);
}
