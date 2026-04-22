/**
 * TugPane — pane chrome and frame: title bar, tabs, content area,
 * drag/resize, z-order, and responder integration.
 *
 * Responsibilities:
 * - Absolutely-positioned `.tug-pane` at position/size from `stackState`
 * - Title bar, accessory / tab bar, and content portal target
 * - Drag: RAF appearance-zone mutation during, `onCardMoved` commit on end
 * - Resize: 8 handles, clamped to min-size, `onCardMoved` on end
 * - Bring to front via `onStackActivated` on pointer-down in the frame
 *
 * [D03] TugPane chrome, [D06] appearance-zone drag
 *
 * @module components/chrome/tug-pane
 */

import "../tugways/tug-pane.css";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp, Ellipsis, X, icons } from "lucide-react";
import type { CardState, TugPaneState } from "@/layout-tree";
import type { CardMeta, CardSizePolicy } from "@/card-registry";
import { DEFAULT_SIZE_POLICY, getRegistration } from "@/card-registry";
import { computeSnap, computeResizeSnap } from "@/snap";
import type { Rect, GuidePosition, SnapResult } from "@/snap";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { useSelectionBoundary } from "@/components/tugways/hooks/use-selection-boundary";
import { useRequiredResponderChain } from "@/components/tugways/responder-chain-provider";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { useDeckManager } from "@/deck-manager-context";
import { TugButton } from "@/components/tugways/internal/tug-button";
import * as paneContentRegistry from "@/components/chrome/pane-content-registry";
import * as paneRootRegistry from "@/components/chrome/pane-root-registry";

// ===========================================================================
// CardTitleBar (window title chrome)
// ===========================================================================

/**
 * Height of the card title bar in pixels. Must match --tug-chrome-height.
 * Used for collapsed-height calculation on the window frame.
 */
export const CARD_TITLE_BAR_HEIGHT = 36;

export interface CardTitleBarProps {
  title: string;
  icon?: string;
  closable?: boolean;
  collapsed: boolean;
  onCollapse: () => void;
  onClose?: () => void;
  onDragStart?: (event: React.PointerEvent) => void;
}

export function CardTitleBar({
  title,
  icon,
  closable = true,
  collapsed,
  onCollapse,
  onClose,
  onDragStart,
}: CardTitleBarProps) {
  const handleTitleBarPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest(".tug-button")) return;
      onDragStart?.(event);
    },
    [onDragStart],
  );

  const handleTitleBarDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest(".tug-button")) return;
      onCollapse();
    },
    [onCollapse],
  );

  const handleClosePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const handleClosePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (inside) {
        onClose?.();
      }
    },
    [onClose],
  );

  const handleCloseClick = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleCollapsePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );

  const handleCollapseClick = useCallback(() => {
    onCollapse();
  }, [onCollapse]);

  const IconComponent =
    icon && icons[icon as keyof typeof icons]
      ? icons[icon as keyof typeof icons]
      : null;

  return (
    <div
      className="tug-pane-title-bar"
      data-slot="tug-pane-title-bar"
      onPointerDown={handleTitleBarPointerDown}
      onDoubleClick={handleTitleBarDoubleClick}
      data-testid="tug-pane-title-bar"
    >
      {IconComponent && (
        <span className="tug-pane-icon" data-testid="tug-pane-icon">
          {React.createElement(IconComponent)}
        </span>
      )}

      <span className="tug-pane-title" data-testid="tug-pane-title">
        {title}
      </span>

      <div className="tug-pane-title-bar-controls" data-testid="tug-pane-title-bar-controls">
        <TugButton
          subtype="icon"
          emphasis="ghost"
          role="action"
          size="sm"
          icon={<Ellipsis />}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          aria-label="Card menu"
          data-testid="tug-pane-title-bar-menu-button"
        />

        <TugButton
          subtype="icon"
          emphasis="ghost"
          role="action"
          size="sm"
          icon={collapsed ? <ChevronUp /> : <ChevronDown />}
          onPointerDown={handleCollapsePointerDown}
          onClick={handleCollapseClick}
          aria-label={collapsed ? "Expand card" : "Collapse card"}
          aria-expanded={!collapsed}
          data-testid="tug-pane-title-bar-collapse-button"
        />

        {closable && (
          <TugButton
            subtype="icon"
            emphasis="ghost"
            role="action"
            size="sm"
            icon={<X />}
            data-no-activate
            onPointerDown={handleClosePointerDown}
            onPointerUp={handleClosePointerUp}
            onClick={handleCloseClick}
            aria-label="Close card"
            data-testid="tug-pane-close-button"
          />
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Portal + dirty contexts (card content consumes these)
// ===========================================================================

/**
 * React context: the pane frame's root element (`HTMLDivElement`, the
 * `.tug-pane-chrome` host). Sheet and tooltip layers portal here so overlays attach
 * inside the pane's chrome. Card content outside the `TugPane` tree
 * (e.g. `CardHost`) re-bridges this via `pane-root-registry`.
 */
export const TugPanePortalContext = createContext<HTMLDivElement | null>(null);

export const CardDirtyContext = createContext<(() => void) | null>(null);

/**
 * Returns a stable `markDirty` callback from `CardDirtyContext`, or a no-op
 * outside a provider. Card content uses this to participate in the pane's
 * debounced auto-save path alongside scroll/selection listeners.
 */
export function useCardDirty(): () => void {
  const markDirty = useContext(CardDirtyContext);
  return markDirty ?? noop;
}

function noop(): void {}

// ---------------------------------------------------------------------------
// snapshotCardRects
// ---------------------------------------------------------------------------

/**
 * Snapshot all `.tug-pane[data-pane-id]` elements as canvas-relative Rects.
 * Optionally excludes a pane by ID.
 */
function snapshotCardRects(
  canvasBounds: DOMRect | null,
  excludeId?: string,
): { id: string; rect: Rect }[] {
  const results: { id: string; rect: Rect }[] = [];
  const els = document.querySelectorAll<HTMLElement>(".tug-pane[data-pane-id]");
  els.forEach((el) => {
    const paneId = el.getAttribute("data-pane-id");
    if (!paneId || paneId === excludeId) return;
    const domRect = el.getBoundingClientRect();
    results.push({
      id: paneId,
      rect: {
        x: domRect.left - (canvasBounds ? canvasBounds.left : 0),
        y: domRect.top - (canvasBounds ? canvasBounds.top : 0),
        width: domRect.width,
        height: domRect.height,
      },
    });
  });
  return results;
}

// ---------------------------------------------------------------------------
// Canvas padding for resize clamping
//
// Resize handles are hard-clamped to the canvas edges with this padding.
// Dragging uses the relaxed Finder-style rules below instead.
// ---------------------------------------------------------------------------

const CANVAS_PADDING = 2;

// ---------------------------------------------------------------------------
// Finder-style title bar visibility constraints (drag only)
//
// When dragging, cards may overhang canvas edges, but enough of the title bar
// must remain visible and grabbable. Modeled after macOS Finder window
// constraining.
// ---------------------------------------------------------------------------

/** Minimum horizontal px of title bar visible when card overhangs left/right. */
const TITLE_BAR_VISIBLE_MIN_X = 100;

/** Minimum vertical px of title bar visible when card overhangs bottom. */
const TITLE_BAR_VISIBLE_MIN_Y = CARD_TITLE_BAR_HEIGHT;

// ---------------------------------------------------------------------------
// Snap gap configuration
//
// Gap in pixels between adjacent card edges when snapping. Positive values
// keep cards visually separated. Set to 0 for flush edges.
// ---------------------------------------------------------------------------

const SNAP_GAP_PX = 5;

/** Height of the title bar chrome inside `.tug-pane-body` (below the outer frame). */
const HEADER_HEIGHT_PX = 28;
const DEFAULT_MIN_CONTENT: { width: number; height: number } = { width: 100, height: 60 };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Props for the TugPane component (frame + pane chrome).
 */
export interface TugPaneProps {
  /** Window position, size, id, and collapsed state from DeckState. */
  stackState: TugPaneState;
  /** Default metadata for the window (from card registration). */
  meta: CardMeta;
  /**
   * Minimum content area size (below title bar + accessory).
   * Total min-size = header + accessory + this region.
   */
  minContentSize?: { width: number; height: number };
  /** Top accessory when single-tab; ignored when multi-tab tab bar is shown. */
  accessory?: React.ReactNode | null;
  /** All cards in this window; when length > 1, the tab bar is shown. */
  cards?: readonly CardState[];
  /**
   * Active card id for merge hit-testing and tab chrome.
   * Defaults to `stackState.activeCardId` when omitted.
   */
  activeCardId?: string;
  /** Title prefix when multi-tab: `"${cardTitle}: ${title}"`. */
  cardTitle?: string;
  /** Families for the [+] type picker (multi-tab). */
  acceptedFamilies?: readonly string[];
  /** Close the window or last card (from title bar). */
  onClose?: () => void;
  /** Called on drag-end or resize-end (structure-zone commit). */
  onCardMoved: (
    id: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;
  /** Called on pointer-down anywhere in the frame to bring the window to front.
   * The `paneId` is this frame's id — callers must resolve the pane's
   * active card id before invoking card-level APIs like `activateCard` /
   * `focusCard`. */
  onStackActivated: (paneId: string) => void;
  /**
   * Called when a card drag ends over another card's tab bar ([D45]).
   *
   * Receives the source card id, the target card id, and the insertion index
   * within the target's tab array. The active tab of the source card is merged
   * into the target card at insertIndex.
   *
   * Wired in DeckCanvas to `moveCardToPane`. When this prop is not provided,
   * card drag always falls back to onCardMoved (no merge behaviour).
   */
  onCardMerged?: (sourceCardId: string, targetCardId: string, insertIndex: number) => void;
  /** CSS z-index for stacking order. */
  zIndex: number;
  /**
   * Called when the user toggles collapse on the card header.
   * DeckCanvas wires this to `store.togglePaneCollapse(id)`.
   */
  onCardCollapsed?: (id: string) => void;
  /**
   * Size policy for this card type. Enforces min as a floor (content-reported
   * min cannot go below this) and max as a ceiling during resize.
   * Falls back to DEFAULT_SIZE_POLICY when omitted.
   */
  sizePolicy?: CardSizePolicy;
}

// ---------------------------------------------------------------------------
// Resize edge descriptors
// ---------------------------------------------------------------------------

type ResizeEdge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

// ---------------------------------------------------------------------------
// TugPane
// ---------------------------------------------------------------------------

/**
 * TugPane — positions, drags, resizes, and hosts a window's cards on the canvas.
 */
export function TugPane({
  stackState,
  meta,
  minContentSize: minContentSizeProp,
  accessory = null,
  cards,
  activeCardId: activeCardIdFromProps,
  cardTitle,
  acceptedFamilies,
  onClose,
  onCardMoved,
  onStackActivated,
  sizePolicy: sizePolicyProp,
  onCardMerged,
  zIndex,
  onCardCollapsed,
}: TugPaneProps) {
  const { id, position, size } = stackState;
  const collapsed = stackState.collapsed === true;
  const activeCardId = activeCardIdFromProps ?? stackState.activeCardId;

  // Ref to the frame DOM element for appearance-zone style mutations.
  const frameRef = useRef<HTMLDivElement>(null);

  // Resolved size policy: use prop or fall back to DEFAULT_SIZE_POLICY.
  const sizePolicy = sizePolicyProp ?? DEFAULT_SIZE_POLICY;

  // Min-size reported by chrome + accessory measurement, floored to sizePolicy.min.
  const [minSize, setMinSize] = useState<{ width: number; height: number }>({
    width: sizePolicy.min.width,
    height: sizePolicy.min.height,
  });

  // Latest minSize held in a ref so resize closure always sees current value
  // without needing to be re-created every time minSize state updates.
  const minSizeRef = useRef(minSize);
  minSizeRef.current = minSize;

  // Max-size from policy (undefined = unbounded). Held in a ref so the resize
  // closure always reads the current value without re-creation.
  const maxSizeRef = useRef(sizePolicy.max);
  maxSizeRef.current = sizePolicy.max;

  const stackId = id;
  const minContentSize = minContentSizeProp ?? DEFAULT_MIN_CONTENT;
  const store = useDeckManager();

  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const manager = useRequiredResponderChain();
  const keyboardTabNavSenderId = useId();

  useSelectionBoundary(stackId, contentRef);

  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const activeCardIdRef = useRef(activeCardId);
  activeCardIdRef.current = activeCardId;

  const performSelectCard = useCallback(
    (newCardId: string) => {
      const outgoingCardId = activeCardIdRef.current;
      if (outgoingCardId) {
        store.invokeSaveCallback(outgoingCardId);
      }
      store.setActiveCardInPane(stackId, newCardId);
    },
    [store, stackId],
  );

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    paneContentRegistry.register(stackId, el);
    return () => {
      paneContentRegistry.unregister(stackId);
    };
  }, [stackId]);

  useLayoutEffect(() => {
    if (!cardEl) return;
    paneRootRegistry.register(stackId, cardEl);
    return () => {
      paneRootRegistry.unregister(stackId);
    };
  }, [stackId, cardEl]);

  const handleChromeClose = useCallback(() => {
    const currentCards = cardsRef.current;
    const currentActiveId = activeCardIdRef.current;
    if (currentCards && currentCards.length > 1 && currentActiveId) {
      store.removeCard(stackId, currentActiveId);
    } else {
      onClose?.();
    }
  }, [onClose, store, stackId]);

  const handlePreviousTab = useCallback(() => {
    const currentCards = cardsRef.current;
    const currentActiveId = activeCardIdRef.current;
    if (!currentCards || currentCards.length <= 1 || !currentActiveId) return;
    const idx = currentCards.findIndex((c) => c.id === currentActiveId);
    if (idx === -1) return;
    const prevIdx = (idx - 1 + currentCards.length) % currentCards.length;
    manager.sendToFirstResponder({
      action: TUG_ACTIONS.SELECT_TAB,
      value: currentCards[prevIdx].id,
      sender: keyboardTabNavSenderId,
      phase: "discrete",
    });
  }, [manager, keyboardTabNavSenderId]);

  const handleNextTab = useCallback(() => {
    const currentCards = cardsRef.current;
    const currentActiveId = activeCardIdRef.current;
    if (!currentCards || currentCards.length <= 1 || !currentActiveId) return;
    const idx = currentCards.findIndex((c) => c.id === currentActiveId);
    if (idx === -1) return;
    const nextIdx = (idx + 1) % currentCards.length;
    manager.sendToFirstResponder({
      action: TUG_ACTIONS.SELECT_TAB,
      value: currentCards[nextIdx].id,
      sender: keyboardTabNavSenderId,
      phase: "discrete",
    });
  }, [manager, keyboardTabNavSenderId]);

  const handleJumpToTab = useCallback(
    (oneBasedIndex: number) => {
      const currentCards = cardsRef.current;
      if (!currentCards || currentCards.length === 0) return;
      if (oneBasedIndex < 1 || oneBasedIndex > currentCards.length) return;
      const targetCard = currentCards[oneBasedIndex - 1];
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.SELECT_TAB,
        value: targetCard.id,
        sender: keyboardTabNavSenderId,
        phase: "discrete",
      });
    },
    [manager, keyboardTabNavSenderId],
  );

  const { ResponderScope, responderRef } = useResponder({
    id: stackId,
    kind: "card",
    actions: {
      [TUG_ACTIONS.CLOSE]: (_event: ActionEvent) => handleChromeClose(),
      [TUG_ACTIONS.PREVIOUS_TAB]: (_event: ActionEvent) => handlePreviousTab(),
      [TUG_ACTIONS.NEXT_TAB]: (_event: ActionEvent) => handleNextTab(),
      [TUG_ACTIONS.JUMP_TO_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "number") return;
        handleJumpToTab(event.value);
      },
      [TUG_ACTIONS.SELECT_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        performSelectCard(event.value);
      },
      [TUG_ACTIONS.CLOSE_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        store.removeCard(stackId, event.value);
      },
      [TUG_ACTIONS.ADD_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        store.addCardToPane(stackId, event.value);
      },
      [TUG_ACTIONS.MINIMIZE]: (_event: ActionEvent) => {},
      [TUG_ACTIONS.TOGGLE_MENU]: (_event: ActionEvent) => {},
      [TUG_ACTIONS.FIND]: (_event: ActionEvent) => {
        console.info("find: stub — no find UI implemented yet");
      },
    },
  });

  const hasMultipleCards = cards !== undefined && cards.length > 1;
  const activeCard =
    hasMultipleCards && activeCardId
      ? cards!.find((c) => c.id === activeCardId)
      : undefined;
  const activeCardRegistration = activeCard
    ? getRegistration(activeCard.componentId)
    : undefined;

  const effectiveMeta: CardMeta = activeCardRegistration
    ? activeCardRegistration.defaultMeta
    : meta;

  const displayTitle = cardTitle
    ? `${cardTitle}: ${effectiveMeta.title}`
    : effectiveMeta.title;

  const resolvedAccessory: React.ReactNode | null = hasMultipleCards
    ? (
        <TugTabBar
          stackId={stackId}
          cards={cards!}
          activeCardId={activeCardId!}
          acceptedFamilies={acceptedFamilies}
        />
      )
    : accessory;

  const accessoryRef = useRef<HTMLDivElement>(null);
  const [accessoryHeight, setAccessoryHeight] = useState(0);

  useLayoutEffect(() => {
    const el = accessoryRef.current;
    if (!el) {
      setAccessoryHeight(0);
      return;
    }
    setAccessoryHeight(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(() => {
      setAccessoryHeight(el.getBoundingClientRect().height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resolvedAccessory]);

  // ---------------------------------------------------------------------------
  // onMinSizeChange — content-reported minimum drives resize clamp
  // ---------------------------------------------------------------------------

  const handleMinSizeChange = useCallback(
    (newSize: { width: number; height: number }) => {
      // Enforce policy min as floor: content cannot report a min below the policy.
      setMinSize({
        width: Math.max(newSize.width, sizePolicy.min.width),
        height: Math.max(newSize.height, sizePolicy.min.height),
      });
    },
    [sizePolicy.min.width, sizePolicy.min.height],
  );

  const totalMinWidth = minContentSize.width;
  const totalMinHeight = HEADER_HEIGHT_PX + accessoryHeight + minContentSize.height;

  useEffect(() => {
    handleMinSizeChange({
      width: totalMinWidth,
      height: totalMinHeight,
    });
  }, [handleMinSizeChange, totalMinWidth, totalMinHeight]);

  // ---------------------------------------------------------------------------
  // Drag system
  //
  // The drag mechanic is a three-phase state machine:
  //
  //   1. START (handleDragStart): snapshot all state, set up pointer capture,
  //      build caches for snap/merge hit-testing, attach move/up listeners.
  //
  //   2. FRAME (applyDragFrame, called via rAF from onPointerMove): compute
  //      clamped position, apply snap or free-drag, hit-test tab bars for
  //      merge feedback. All DOM mutations are appearance-zone.
  //
  //   3. END (onPointerUp): commit final position to store, handle merge-on-drop,
  //      clean up listeners and state.
  //
  // All drag state lives in refs — zero React re-renders during drag.
  //
  // Two drag modes (determined per-frame in applyDragFrame):
  //   - Free drag: no modifier. Position = clamped pointer delta.
  //   - Snap mode: Option held. Position snapped to other card edges.
  //
  // Merge: dragging over another card's tab bar highlights the drop target.
  // Releasing on the tab bar merges this card's active tab into the target.
  // ---------------------------------------------------------------------------

  // Whether a drag gesture is currently active.
  const dragActive = useRef(false);
  // Pending rAF handle; null when no frame is scheduled.
  const dragRafId = useRef<number | null>(null);
  // Client-space pointer coordinates captured at pointer-down.
  const dragStartPointer = useRef({ x: 0, y: 0 });
  // Canvas-relative card position captured at pointer-down.
  const dragStartPosition = useRef({ x: 0, y: 0 });
  // Canvas bounding rect snapshotted at drag-start; used for all clamping.
  const dragCanvasBounds = useRef<DOMRect | null>(null);
  // Most recent client-space pointer coordinates from onPointerMove.
  const latestDragPointer = useRef({ x: 0, y: 0 });

  // Track the tab bar element currently highlighted as a merge drop target.
  // Appearance-zone only: set/cleared via data-drop-target attribute. [D45, Rule 4]
  const dragDropTargetEl = useRef<HTMLElement | null>(null);

  /**
   * Snapshot all `.tug-tab-bar[data-pane-id]` elements at drag-start (excluding
   * our own pane). Used for hit-testing during drag and on pointer-up. [D45]
   */
  const dragTabBarCache = useRef<Array<{ paneId: string; rect: DOMRect; el: HTMLElement }>>([]);

  // Snap-related refs [D01, D03, D04]
  // Canvas-relative rects of all other cards, snapshotted at drag-start for computeSnap. [D04]
  const dragOtherRects = useRef<{ id: string; rect: Rect }[]>([]);
  // Active snap guide DOM elements; cleared on drop and on each rAF if guides change. [D03]
  const dragGuideEls = useRef<HTMLElement[]>([]);
  // Whether alt key is held during drag.
  const latestAltKey = useRef(false);
  // Snap result computed in the last rAF; read in onPointerUp to finalise snapped position. [D01]
  const lastSnapResult = useRef<SnapResult | null>(null);

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

      // Disable height transition during drag so the collapse animation does not
      // conflict with pointer-driven position updates. [D07, chrome.css]
      frame.setAttribute("data-gesture", "true");

      // === PHASE 1: SNAPSHOT ===
      // Capture all state needed for the drag gesture. Everything below runs
      // once at pointer-down and is read (not written) during the drag.

      // Snapshot canvas bounds and drag start state once.
      dragCanvasBounds.current = frame.parentElement?.getBoundingClientRect() ?? null;
      dragActive.current = true;
      dragStartPointer.current = { x: event.clientX, y: event.clientY };
      dragStartPosition.current = { x: position.x, y: position.y };
      latestDragPointer.current = { x: event.clientX, y: event.clientY };

      // Build tab bar cache for merge hit-testing. [D45]
      // Snapshot all .tug-tab-bar[data-pane-id] elements (excluding this pane).
      dragTabBarCache.current = [];
      const barEls = document.querySelectorAll<HTMLElement>(".tug-tab-bar[data-pane-id]");
      barEls.forEach((el) => {
        const paneId = el.getAttribute("data-pane-id");
        if (!paneId || paneId === id) return;
        dragTabBarCache.current.push({ paneId, rect: el.getBoundingClientRect(), el });
      });

      // Snapshot other card rects at drag-start for snap computation. [D04]
      // Convert to canvas-relative coordinates by subtracting canvas bounds offset.
      const canvasBounds = dragCanvasBounds.current;
      dragOtherRects.current = snapshotCardRects(canvasBounds, id);

      // Initialize drag state.
      latestAltKey.current = false;
      lastSnapResult.current = null;

      // === PHASE 2: FRAME (rAF callback) ===
      // Called once per animation frame during drag. Computes position,
      // applies snap or free-drag, hit-tests merge.
      // All mutations are appearance-zone (direct DOM, no React state).
      function applyDragFrame() {
        dragRafId.current = null;
        if (!dragActive.current) return;

        // Always solo card clamping.
        const pos = clampedPosition(
          latestDragPointer.current,
          dragStartPointer.current,
          dragStartPosition.current,
          dragCanvasBounds.current,
          { width: frame.offsetWidth, height: frame.offsetHeight },
        );

        if (latestAltKey.current) {
          // Snap mode: Option held. [D01]
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
            -SNAP_GAP_PX,
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
        } else {
          // Free drag: no snap modifier. Clear guides and snap result.
          lastSnapResult.current = null;
          clearGuideElements(dragGuideEls);
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

      // === POINTER HANDLERS ===
      function onPointerMove(e: PointerEvent) {
        latestDragPointer.current = { x: e.clientX, y: e.clientY };
        latestAltKey.current = e.altKey;
        if (dragRafId.current === null) {
          dragRafId.current = requestAnimationFrame(applyDragFrame);
        }
      }

      // === PHASE 3: DROP ===
      // Pointer released. Commit final position to store, handle merge,
      // clean up listeners and reset all drag state.
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

        // Re-enable height transition now that the drag gesture is complete. [D07]
        frame.removeAttribute("data-gesture");

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
        if (onCardMerged && activeCardId) {
          const cx = e.clientX;
          const cy = e.clientY;
          for (const entry of dragTabBarCache.current) {
            const r = entry.rect;
            if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
              const insertIndex = computeMergeInsertIndex(entry.el, cx);
              onCardMerged(id, entry.paneId, insertIndex);
              dragTabBarCache.current = [];
              // Reset all drag state.
              dragOtherRects.current = [];
              latestAltKey.current = false;
              lastSnapResult.current = null;
              return;
            }
          }
        }

        dragTabBarCache.current = [];

        // Compute final clamped position.
        const clampedPos = clampedPosition(
          { x: e.clientX, y: e.clientY },
          dragStartPointer.current,
          dragStartPosition.current,
          dragCanvasBounds.current,
          { width: frame.offsetWidth, height: frame.offsetHeight },
        );

        // Apply snapped position if snap was active at drop.
        const snapResult = lastSnapResult.current;
        const finalPos = {
          x: snapResult && snapResult.x !== null ? snapResult.x : clampedPos.x,
          y: snapResult && snapResult.y !== null ? snapResult.y : clampedPos.y,
        };

        frame.style.left = `${finalPos.x}px`;
        frame.style.top = `${finalPos.y}px`;

        onCardMoved(id, finalPos, { width: frame.offsetWidth, height: frame.offsetHeight });

        // Reset all drag state.
        dragOtherRects.current = [];
        latestAltKey.current = false;
        lastSnapResult.current = null;
      }

      frame.addEventListener("pointermove", onPointerMove);
      frame.addEventListener("pointerup", onPointerUp);
    },
    // position.x/y captured into dragStartPosition at drag-start; id, onCardMoved,
    // onCardMerged, and activeCardId are stable or handled via closure capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, onCardMoved, onCardMerged, activeCardId, position.x, position.y],
  );

  // ---------------------------------------------------------------------------
  // Resize system
  //
  // Same three-phase pattern as drag: snapshot at start, rAF frame updates,
  // commit on pointer-up. Supports 8 edge/corner handles, min-size clamping,
  // and snap-to-edge.
  // ---------------------------------------------------------------------------

  // Snap guide DOM elements for resize (separate from drag guides). [D03]
  const resizeGuideEls = useRef<HTMLElement[]>([]);

  const handleResizeStart = useCallback(
    (edge: ResizeEdge, event: React.PointerEvent) => {
      // Bring to front on resize unless Command is held (standard Mac modifier convention).
      // stopPropagation below prevents the frame's onPointerDown from firing, so we must
      // call onStackActivated explicitly here.
      if (!event.metaKey) {
        onStackActivated(id);
      }
      // Stop propagation so the frame's onPointerDown does not fire a second time.
      event.stopPropagation();

      if (!frameRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const frame: HTMLDivElement = frameRef.current!;

      const pid = event.nativeEvent.pointerId;
      frame.setPointerCapture(event.nativeEvent.pointerId);

      // Disable height transition during resize. [D07, chrome.css]
      frame.setAttribute("data-gesture", "true");

      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = position.x;
      const startTop = position.y;
      const startW = size.width;
      const startH = size.height;

      // Snapshot canvas bounds and other card rects for resize snapping. [D04]
      const resizeCanvasBounds = frame.parentElement?.getBoundingClientRect() ?? null;
      const resizeOtherCardRects = snapshotCardRects(resizeCanvasBounds, id);
      const resizeOtherRects = resizeOtherCardRects.map((r) => r.rect);

      const latestResizePointer = { x: startX, y: startY };
      let latestResizeModifier = event.nativeEvent.altKey;
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
          maxSizeRef.current,
        );

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
          const snapResult = computeResizeSnap(resizingEdges, resizeOtherRects, -SNAP_GAP_PX);

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
      }

      function onPointerMove(e: PointerEvent) {
        latestResizePointer.x = e.clientX;
        latestResizePointer.y = e.clientY;
        latestResizeModifier = e.altKey;
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

        // Re-enable height transition now that the resize gesture is complete. [D07]
        frame.removeAttribute("data-gesture");

        // Compute final resize with snap applied first, THEN clear guides. [D03]
        const r = computeAndApplyResize({ x: e.clientX, y: e.clientY }, e.altKey);
        clearGuideElements(resizeGuideEls);
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
    [id, onStackActivated, onCardMoved, position.x, position.y, size.width, size.height],
  );

  // ---------------------------------------------------------------------------
  // Frame pointer-down: bring card to front
  // ---------------------------------------------------------------------------

  const handleFramePointerDown = useCallback((event: React.PointerEvent) => {
    // Skip activation when Command is held (standard Mac modifier convention).
    if (!event.metaKey) {
      onStackActivated(id);
    }
  }, [id, onStackActivated]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // When collapsed, the frame height is locked to CARD_TITLE_BAR_HEIGHT + 2px border.
  // The card retains its full width for dragging. The stored `size.height` is preserved
  // and restored when the card expands.
  const COLLAPSED_FRAME_HEIGHT = CARD_TITLE_BAR_HEIGHT + 2;

  const frameHeight = collapsed ? COLLAPSED_FRAME_HEIGHT : size.height;

  const handleFrameCollapseToggle = useCallback(() => {
    onCardCollapsed?.(id);
  }, [id, onCardCollapsed]);

  const closable = effectiveMeta.closable !== false;

  const rootRefCallback = useCallback(
    (el: HTMLDivElement | null) => {
      setCardEl(el);
      responderRef(el);
    },
    [responderRef],
  );

  return (
    <div
      ref={frameRef}
      className="tug-pane"
      data-testid="tug-pane"
      data-pane-id={id}
      data-collapsed={collapsed ? "true" : "false"}
      onPointerDown={handleFramePointerDown}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: size.width,
        height: frameHeight,
        zIndex,
        boxSizing: "border-box",
      }}
    >
      {/* 8 resize handles -- hidden when collapsed; drag remains active [D07] */}
      {!collapsed && RESIZE_EDGES.map((edge) => (
        <div
          key={edge}
          className={`tug-pane-resize tug-pane-resize-${edge}`}
          onPointerDown={(e) => handleResizeStart(edge, e)}
        />
      ))}

      <TugPanePortalContext value={cardEl}>
        <div
          ref={rootRefCallback}
          className={collapsed ? "tug-pane-chrome tug-pane-chrome--collapsed" : "tug-pane-chrome"}
          data-slot="tug-pane"
          data-pane-id={stackId}
          data-collapsed={collapsed ? "true" : "false"}
        >
          <CardTitleBar
            title={displayTitle}
            icon={effectiveMeta.icon}
            closable={closable}
            collapsed={collapsed}
            onCollapse={handleFrameCollapseToggle}
            onClose={handleChromeClose}
            onDragStart={handleDragStart}
          />

          <div className="tug-pane-body" data-testid="tug-pane-body">
            <ResponderScope>
              <div
                ref={accessoryRef}
                className="tug-pane-accessory"
                data-testid="tug-pane-accessory"
                data-pane-id={stackId}
                style={resolvedAccessory == null ? { height: 0, overflow: "hidden" } : undefined}
              >
                {resolvedAccessory}
              </div>

              <div
                ref={contentRef}
                className="tug-pane-content"
                data-testid="tug-pane-content"
              />
            </ResponderScope>
          </div>
        </div>
      </TugPanePortalContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers (pure functions, testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Compute drag position with Finder-style constraining.
 *
 * The card may overhang any edge, but enough of its title bar must stay
 * visible and grabbable:
 * - Top: title bar top stays at or below y = 0 (cannot move above canvas).
 * - Bottom: at least TITLE_BAR_VISIBLE_MIN_Y of the title bar stays visible.
 * - Left/Right: at least TITLE_BAR_VISIBLE_MIN_X of the title bar stays visible.
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
    // Left/right: card can hang off either side, but TITLE_BAR_VISIBLE_MIN_X must stay visible.
    x = Math.max(-(frameSize.width - TITLE_BAR_VISIBLE_MIN_X),
                 Math.min(x, canvasBounds.width - TITLE_BAR_VISIBLE_MIN_X));
    // Top: title bar stays at or below CANVAS_PADDING (matches resize top constraint).
    // Bottom: at least TITLE_BAR_VISIBLE_MIN_Y of title bar stays visible.
    y = Math.max(CANVAS_PADDING, Math.min(y, canvasBounds.height - TITLE_BAR_VISIBLE_MIN_Y));
  }

  return { x, y };
}

/**
 * Compute new bounding rect after resizing on the given edge.
 *
 * Width and height are clamped to minSize (floor) and maxSize (ceiling).
 * When canvasBounds is provided, the resulting rect is hard-clamped so the
 * card cannot extend beyond the canvas edges (accounting for CANVAS_PADDING).
 * Unlike drag (which uses relaxed Finder-style rules), resize is rigid.
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
  maxSize?: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const dx = pointer.x - startPointer.x;
  const dy = pointer.y - startPointer.y;

  let left = startLeft;
  let top = startTop;
  let width = startW;
  let height = startH;

  if (edge.includes("e")) {
    width = Math.max(minSize.width, startW + dx);
    if (maxSize) width = Math.min(maxSize.width, width);
  }
  if (edge.includes("w")) {
    let newW = Math.max(minSize.width, startW - dx);
    if (maxSize) newW = Math.min(maxSize.width, newW);
    left = startLeft + (startW - newW);
    width = newW;
  }
  if (edge.includes("s")) {
    height = Math.max(minSize.height, startH + dy);
    if (maxSize) height = Math.min(maxSize.height, height);
  }
  if (edge.includes("n")) {
    let newH = Math.max(minSize.height, startH - dy);
    if (maxSize) newH = Math.min(maxSize.height, newH);
    top = startTop + (startH - newH);
    height = newH;
  }

  // Hard-clamp to canvas bounds so the card cannot be resized past any canvas edge.
  if (canvasBounds) {
    const maxRight = canvasBounds.width - CANVAS_PADDING;
    const maxBottom = canvasBounds.height - CANVAS_PADDING;

    // Clamp right edge: prevent card from extending past canvas right.
    if (left + width > maxRight) {
      if (edge.includes("e")) {
        width = Math.max(minSize.width, maxRight - left);
      } else if (edge.includes("w")) {
        left = Math.max(CANVAS_PADDING, left);
        width = startLeft + startW - left;
        if (width < minSize.width) {
          width = minSize.width;
          left = startLeft + startW - width;
        }
      }
    }
    // Clamp left edge.
    if (left < CANVAS_PADDING) {
      const rightEdge = left + width;
      left = CANVAS_PADDING;
      width = Math.max(minSize.width, rightEdge - left);
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
    // Clamp top edge.
    if (top < CANVAS_PADDING) {
      const bottomEdge = top + height;
      top = CANVAS_PADDING;
      height = Math.max(minSize.height, bottomEdge - top);
    }
  }

  return { left, top, width, height };
}
