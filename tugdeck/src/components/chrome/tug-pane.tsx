/**
 * TugPane — pane chrome and frame: title bar, tabs, content area,
 * drag/resize, z-order, and responder integration.
 *
 * Responsibilities:
 * - Absolutely-positioned `.tug-pane` at position/size from `stackState`
 * - Title bar, accessory / tab bar, and content portal target
 * - Drag: RAF appearance-zone mutation during, `onCardMoved` commit on end
 * - Resize: 8 handles, clamped to min-size, `onCardMoved` on end
 *
 * Pane activation (bring-to-front on pointer-down) is driven by the
 * document-level capture-phase listener in `pane-focus-controller.ts`
 * — not by any React handler on this frame. The frame's own
 * `data-focused` attribute is also written by that module, not
 * rendered from a prop here.
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
  useSyncExternalStore,
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
import { useRequiredResponderChain } from "@/components/tugways/responder-chain-provider";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { useDeckManager } from "@/deck-manager-context";
import { TugButton } from "@/components/tugways/internal/tug-button";
import {
  TugPopover,
  TugPopoverAnchor,
  TugPopoverContent,
  type TugPopoverHandle,
} from "@/components/tugways/tug-popover";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useFocusManager } from "@/components/tugways/use-focusable";
import { cardSettingsStore } from "@/lib/card-settings-store";
import { cardTitleStore } from "@/lib/card-title-store";
import * as paneContentRegistry from "@/components/chrome/pane-content-registry";
import * as paneFrameRegistry from "@/components/chrome/pane-frame-registry";
import * as paneRootRegistry from "@/components/chrome/pane-root-registry";
import {
  captureFocusForDragStart,
  transferFocusForActivation,
} from "@/focus-transfer";

// ===========================================================================
// CardTitleBar (window title chrome)
// ===========================================================================

/**
 * Height of the card title bar in pixels. Must match --tug-chrome-height.
 * Used for collapsed-height calculation on the window frame.
 */
export const CARD_TITLE_BAR_HEIGHT = 36;

/**
 * Imperative handle on CardTitleBar — lets the surrounding TugPane
 * route the chain-action close (Cmd-W) through the same confirm popover
 * the X button opens, so a `confirmClose` pane never bypasses the guard.
 */
export interface CardTitleBarHandle {
  /**
   * Run the title-bar close flow as if the X button had been clicked.
   * When `confirmClose` is `true` the popover opens; when `false` the
   * pane closes immediately via `onClose`.
   */
  requestClose: () => void;
}

export interface CardTitleBarProps {
  title: string;
  icon?: string;
  closable?: boolean;
  collapsed: boolean;
  /**
   * Click handler for the title bar's `…` (Ellipsis) settings button.
   * Wired by TugPane to invoke the active card's settings controller
   * (registered in `cardSettingsStore` via `useCardSettings`) —
   * `toggle()` on each click, so a second press dismisses the sheet.
   * The button is disabled whenever `settingsEnabled` is false, so
   * this handler only ever runs for a card that registered settings.
   */
  onSettingsClick?: () => void;
  /**
   * Whether the active card has a settings sheet registered for the
   * `…` button. Driven by `cardSettingsStore.hasController(
   * activeCardId)` via `useSyncExternalStore` in the surrounding
   * TugPane. [L02]
   *
   * When false the `…` button still renders — pane chrome is
   * structurally constant regardless of which card is active — but
   * paints disabled, so a card with no settings shows the affordance
   * without a dead no-op behind it. Defaults to `true` so a
   * standalone `CardTitleBar` keeps a working button.
   */
  settingsEnabled?: boolean;
  /**
   * Whether the active card's settings sheet is currently presented.
   * When true, the title bar's `…` button paints as highlighted so
   * the user sees the button's state mirror the sheet's. Driven by
   * `cardSettingsStore.isOpen(activeCardId)` via `useSyncExternalStore`
   * in the surrounding TugPane. [L02]
   */
  settingsActive?: boolean;
  /**
   * Number of cards in this pane. Drives only the *wording* of the
   * close-confirmation popover the title-bar X button opens:
   *
   *   - `cardCount > 1` → "Close N Tabs?" with a "Close All" confirm
   *     button.
   *   - `cardCount <= 1` → "Close Card?" with a "Close" confirm
   *     button.
   *
   * Whether the popover opens at all is governed by `confirmClose`,
   * not this prop. Option-click on X bypasses the popover regardless
   * and closes the pane immediately. Either way the X click activates a
   * background pane first (the button carries no `data-no-activate`),
   * so the user sees the pane they are about to discard.
   *
   * Defaults to `1` (single-card wording) so callers that don't pass
   * the prop get the single-card popover copy.
   */
  cardCount?: number;
  /**
   * Whether the X button (and the imperative `requestClose()` handle)
   * routes through the close-confirm popover. When `false`, X-click and
   * Cmd-W both close the pane immediately — no popover. When `true`,
   * the popover opens and `onClose` fires only once the user confirms.
   *
   * The Option-click escape hatch always closes immediately regardless
   * of this flag.
   */
  confirmClose?: boolean;
  onCollapse: () => void;
  onClose?: () => void;
  onDragStart?: (event: React.PointerEvent) => void;
}

export const CardTitleBar = React.forwardRef<CardTitleBarHandle, CardTitleBarProps>(
function CardTitleBar({
  title,
  icon,
  closable = true,
  collapsed,
  cardCount = 1,
  confirmClose = false,
  onCollapse,
  onClose,
  onDragStart,
  onSettingsClick,
  settingsEnabled = true,
  settingsActive = false,
}: CardTitleBarProps, ref) {
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

  // Imperative handle on the close-confirm popover. The popover is
  // rendered for every pane — single-tab and multi-tab alike — and
  // anchored to the X button via a `TugPopoverAnchor` (not a
  // `TugPopoverTrigger`); see the comment on the render block below
  // for why.
  const closeConfirmPopoverRef = useRef<TugPopoverHandle>(null);

  // Drives the popover's copy only — not whether it appears.
  const isMultiTab = cardCount > 1;

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
      if (!inside) return;
      // Option-click is the power-user escape hatch: close the pane
      // immediately, no confirmation. On a `confirmClose` pane a plain
      // click opens the confirm popover instead — two clicks to
      // discard a pane. On a pane that doesn't opt in, a plain click
      // is functionally identical to Option-click.
      if (event.altKey || !confirmClose) {
        onClose?.();
      } else {
        closeConfirmPopoverRef.current?.open();
      }
    },
    [onClose, confirmClose],
  );

  const handleCloseClick = useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      // Keyboard activation (Enter / Space) lands here with no
      // preceding pointerup; mouse clicks also re-enter here after
      // `handleClosePointerUp` already acted. Opening the popover a
      // second time is idempotent (`TugPopover.open()` just
      // setState(true), a no-op when already open), and the
      // Option-bypass close is safe to repeat — the pane is gone
      // after the first call.
      if (event?.altKey || !confirmClose) {
        onClose?.();
        return;
      }
      closeConfirmPopoverRef.current?.open();
    },
    [onClose, confirmClose],
  );

  const handleConfirmClose = useCallback(() => {
    closeConfirmPopoverRef.current?.close();
    onClose?.();
  }, [onClose]);

  const handleCancelClose = useCallback(() => {
    closeConfirmPopoverRef.current?.close();
  }, []);

  // The Cancel / Close buttons are authored into the popover's own trapped focus
  // mode (the `useFocusTrap` mode `TugPopover` pushes while open): Tab cycles only
  // these two — you cannot escape the confirm popover — and the engine moves the
  // key view between them, driving each outlined button's promotion to its filled
  // role style + ring (the fill follows the ring). Pane close is a non-destructive
  // `action`-role confirmation, so the default seeds Close (Return accepts), as
  // the engine KEY VIEW (`armKeyboardRestore`) rather than a bare `.focus()`.
  const popoverCloseButtonRef = useRef<HTMLButtonElement>(null);
  const closeConfirmFocusManager = useFocusManager();
  const closeConfirmFocusGroup = useId();
  const CLOSE_CONFIRM_CANCEL_ORDER = 0;
  const CLOSE_CONFIRM_CLOSE_ORDER = 1;

  const handlePopoverOpenAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      closeConfirmFocusManager?.armKeyboardRestore(
        `${closeConfirmFocusGroup}:${CLOSE_CONFIRM_CLOSE_ORDER}`,
      );
    },
    [closeConfirmFocusManager, closeConfirmFocusGroup],
  );

  // Imperative bridge for the surrounding TugPane: route Cmd-W through
  // the same flow the X button uses, so a `confirmClose` pane gets the
  // popover on keyboard close too rather than slipping past the guard.
  React.useImperativeHandle(ref, () => ({
    requestClose: () => {
      if (confirmClose) {
        closeConfirmPopoverRef.current?.open();
      } else {
        onClose?.();
      }
    },
  }), [confirmClose, onClose]);

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
          disabled={!settingsEnabled}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          onClick={onSettingsClick}
          aria-label="Card settings"
          aria-expanded={settingsActive}
          data-active={settingsActive ? "true" : undefined}
          data-testid="tug-pane-title-bar-settings-button"
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
          // Pane-level close confirmation: every pane's X button —
          // single-tab and multi-tab alike — opens a "Close …?"
          // confirm popover, so a pane is never discarded on a single
          // stray click. Option-click on X bypasses the popover and
          // closes immediately (see `handleClosePointerUp`).
          //
          // The X button is the popover's `TugPopoverAnchor` — NOT a
          // `TugPopoverTrigger`. Why Anchor instead of Trigger:
          //
          //   - `TugPopoverTrigger` composes Radix's auto-toggle
          //     `onClick` onto the host element via `Slot.mergeProps`.
          //     The X button's pointer-capture flow opens the popover
          //     imperatively on `pointerup`; React then commits the
          //     state transition before the trailing `click` event
          //     fires; Radix's toggle reads the just-committed
          //     `open=true` from its closure and inverts to
          //     `open=false` — closing the popover the user just
          //     opened. The "popover briefly flashes" bug.
          //   - `TugPopoverAnchor` provides positioning only — no
          //     toggle, no `onClick` composition. Open is purely
          //     imperative via `closeConfirmPopoverRef.current.open()`
          //     and the popover stays open until the user clicks
          //     Confirm / Cancel, presses Escape, or clicks outside.
          //
          // We also pass `dismissOnChainActivity={false}` so the
          // popover doesn't self-close on its own
          // `cancelDialog` re-emit (which `TugPopover.handleOpenChange(false)`
          // dispatches on every close) — the inner shell's
          // observeDispatch would otherwise see that dispatch (sender
          // is the popover's own senderId, but only the SHELL's
          // observer filters self; the outer subscription doesn't).
          // Click-outside and Escape are still handled by Radix's
          // DismissableLayer regardless of this flag.
          //
          // The button carries no `data-no-activate`: clicking X on a
          // background pane brings it forward before the popover
          // opens, so the user sees what they are about to discard.
          <TugPopover ref={closeConfirmPopoverRef} dismissOnChainActivity={false}>
            <TugPopoverAnchor asChild>
              <TugButton
                subtype="icon"
                emphasis="ghost"
                role="action"
                size="sm"
                icon={<X />}
                onPointerDown={handleClosePointerDown}
                onPointerUp={handleClosePointerUp}
                onClick={handleCloseClick}
                aria-label={
                  isMultiTab ? `Close pane (${cardCount} tabs)` : "Close card"
                }
                data-testid="tug-pane-close-button"
              />
            </TugPopoverAnchor>
            <TugPopoverContent
              side="bottom"
              sideOffset={6}
              onOpenAutoFocus={handlePopoverOpenAutoFocus}
            >
              <div
                data-slot="tug-pane-close-confirm"
                className="tug-confirm-popover"
              >
                <div className="tug-confirm-popover-actions">
                  <TugPushButton
                    emphasis="outlined"
                    role="action"
                    size="sm"
                    onClick={handleCancelClose}
                    focusGroup={closeConfirmFocusGroup}
                    focusOrder={CLOSE_CONFIRM_CANCEL_ORDER}
                  >
                    Cancel
                  </TugPushButton>
                  <TugPushButton
                    ref={popoverCloseButtonRef}
                    emphasis="outlined"
                    role="action"
                    size="sm"
                    onClick={handleConfirmClose}
                    focusGroup={closeConfirmFocusGroup}
                    focusOrder={CLOSE_CONFIRM_CLOSE_ORDER}
                  >
                    {isMultiTab ? "Close All" : "Close"}
                  </TugPushButton>
                </div>
                <TugLabel size="md" align="center">
                  {isMultiTab ? `Close ${cardCount} Tabs?` : "Close Card?"}
                </TugLabel>
              </div>
            </TugPopoverContent>
          </TugPopover>
        )}
      </div>
    </div>
  );
});

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

/**
 * React context: the pane frame element (`HTMLDivElement`, the `.tug-pane`
 * outer frame, parent of the chrome). Pane-modal surfaces (`TugSheet`,
 * future modal-class surfaces) portal into this element so their panel
 * sits inside the pane's stacking context — peer panes z-stacked above
 * paint above the panel without manual z coordination [D19, D20].
 *
 * The frame's `position: absolute` + inline `z-index` makes it its own
 * stacking context. The frame has `overflow: visible` (default) so a
 * panel whose natural height exceeds the chrome's body can extend into
 * the canvas grid below — without escaping the pane's stacking context.
 *
 * Standalone consumers (gallery preview, tests rendered without a
 * `TugPane` ancestor) read `null` and fall back to `document.body` —
 * same shape as `useCanvasOverlay`'s null fallback. Production code
 * always renders pane-modal surfaces inside a `TugPane`.
 */
export const TugPaneFrameContext = createContext<HTMLDivElement | null>(null);

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
  // Frame element exposed via TugPaneFrameContext and bridged through
  // `pane-frame-registry` for consumers (card content) that live
  // outside the pane's React tree. The same DOM node is also tracked
  // through frameRef.current for direct DOM access in drag/resize
  // handlers; the callback ref keeps both in sync. State (not just
  // the ref) is required so React-tree consumers re-render when the
  // frame mounts. [D19]
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const frameRefCallback = useCallback((el: HTMLDivElement | null) => {
    frameRef.current = el;
    setFrameEl(el);
  }, []);
  const contentRef = useRef<HTMLDivElement>(null);
  const manager = useRequiredResponderChain();
  const keyboardTabNavSenderId = useId();

  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const activeCardIdRef = useRef(activeCardId);
  activeCardIdRef.current = activeCardId;

  // Reactive read of the active card's settings-sheet open state for
  // the title bar's `…` button highlight. The store notifies on
  // register / unregister and on every open / close transition; the
  // snapshot selector keys off the current `activeCardId` so a tab
  // switch re-evaluates the highlight against the newly-active card.
  // [L02]
  const settingsOpenForActive = useSyncExternalStore(
    cardSettingsStore.subscribe,
    useCallback(
      () => cardSettingsStore.isOpen(activeCardId ?? null),
      [activeCardId],
    ),
  );

  // Reactive read of whether the active card registered settings, so
  // the title bar's `…` button can paint disabled when it didn't.
  // Same store, same `subscribe` (register / unregister notifies);
  // the selector keys off `activeCardId` so a tab switch to a card
  // without settings disables the button. [L02]
  const settingsEnabledForActive = useSyncExternalStore(
    cardSettingsStore.subscribe,
    useCallback(
      () => cardSettingsStore.hasController(activeCardId ?? null),
      [activeCardId],
    ),
  );

  const performSelectCard = useCallback(
    (newCardId: string) => {
      // Route the intra-pane tab switch through `transferFocusForActivation`
      // Tab row: this is row 1 of the
      // activation trigger taxonomy: tab click within a pane.
      //
      // The helper's five-step body subsumes the previous explicit
      // save + setActiveCardInPane pair: step 1 saves the outgoing
      // bag (skipped for null / same-card / outgoingWillBeDestroyed),
      // step 2 invokes `commitMutation` inside `flushSync` so the
      // incoming card's `display: none` flips to `display: contents`
      // before resolution, steps 3–5 resolve / gate / focus.
      //
      // The `flushSync` sandwich is load-bearing here: tab clicks
      // dispatch through React's synthetic event system, so without
      // it `setActiveCardInPane`'s `notify()` would be batched and
      // step 5's `.focus()` would land on a still-`display:none`
      // element (silent failure). See [AT0001] closure
      // gate.
      transferFocusForActivation({
        outgoingCardId: activeCardIdRef.current ?? null,
        incomingCardId: newCardId,
        store,
        commitMutation: () => store.setActiveCardInPane(stackId, newCardId),
      });
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

  // Bridge the frame element through `pane-frame-registry` so card
  // content rendered via `CardPortal` (which lives outside the pane's
  // React tree) can subscribe and re-provide `TugPaneFrameContext` at
  // the card-host position. Without this bridge, pane-modal surfaces
  // inside card content would fall back to `document.body` and lose
  // per-pane stacking. [D19, D20]
  useLayoutEffect(() => {
    if (!frameEl) return;
    paneFrameRegistry.register(stackId, frameEl);
    return () => {
      paneFrameRegistry.unregister(stackId);
    };
  }, [stackId, frameEl]);

  // Imperative handle on the title bar so the chain-action close path
  // can route through the same confirm popover the X button opens.
  // Wired below into the `TUG_ACTIONS.CLOSE` responder.
  const titleBarRef = useRef<CardTitleBarHandle>(null);

  // Chain-action close (Cmd-W via TUG_ACTIONS.CLOSE). Browser-standard
  // "close the active tab" semantics: multi-tab → remove the active
  // card with no confirm (one of N tabs is recoverable). Single-tab →
  // delegate to the title bar's `requestClose()`, which honours the
  // pane's `confirmClose` policy: opens the popover when the active
  // card opts in, closes immediately otherwise. This keeps Cmd-W and
  // the X button symmetric: a pane that confirms on click also
  // confirms on key, and a pane that doesn't never traps Cmd-W behind
  // a guard.
  const handleChromeClose = useCallback(() => {
    const currentCards = cardsRef.current;
    const currentActiveId = activeCardIdRef.current;
    if (currentCards && currentCards.length > 1 && currentActiveId) {
      store.removeCard(stackId, currentActiveId);
    } else {
      titleBarRef.current?.requestClose();
    }
  }, [store, stackId]);

  // Title-bar X close. Always closes the entire pane. CardTitleBar
  // is responsible for surfacing the confirm popover before calling
  // this — by the time we get here the user has already confirmed,
  // or Option-clicked the X to skip the confirmation outright.
  const handleTitleBarClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // Title-bar `…` button. The active card declares a settings sheet
  // via `useCardSettings`, which registers a stable controller in
  // `cardSettingsStore` keyed by card id. The button calls
  // `controller.toggle()` directly — no chain walk, no intermediate
  // action handler.
  //
  // `CardTitleBar` disables the button whenever the active card has
  // registered no controller (`settingsEnabled` is derived from
  // `cardSettingsStore.hasController`), so this handler only runs
  // when a controller exists. The optional chain on `toggle()` stays
  // as a belt-and-suspenders guard against a same-tick unregister.
  // [L11]
  const handleTitleBarSettingsClick = useCallback(() => {
    const activeId = activeCardIdRef.current;
    if (!activeId) return;
    cardSettingsStore.getController(activeId)?.toggle();
  }, []);

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

  // Per-card title override (cardTitleStore). When a card publishes
  // an override (e.g. the Dev card publishes its bound project path
  // once a session is picked), the title bar composes it as
  // `"<registry> — <override>"`. Subscription is keyed on the
  // active card so a card swap repaints the title without prop drill.
  const activeCardTitleOverride = useSyncExternalStore(
    cardTitleStore.subscribe,
    useCallback(
      () => cardTitleStore.get(activeCardId ?? null),
      [activeCardId],
    ),
  );

  const baseTitle = cardTitle
    ? `${cardTitle} : ${effectiveMeta.title}`
    : effectiveMeta.title;
  const displayTitle = activeCardTitleOverride
    ? `${baseTitle} : ${activeCardTitleOverride}`
    : baseTitle;

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
      // Drag-start focus save. The pane
      // title bar is not focusable, so WebKit's mousedown default
      // would normally blur whatever element inside the active
      // card has focus. Saving the active card's bag in capture
      // phase — before the blur lands — preserves `bag.focus` and
      // `bag.domSelection` so the helper can restore them after
      // the gesture (drop, cancel, or even no-op release).
      // The save is unconditional: cheap, idempotent with the
      // subsequent debounced save.
      const currentActiveCardId = activeCardIdRef.current;
      if (currentActiveCardId) {
        captureFocusForDragStart({
          sourceCardId: currentActiveCardId,
          store,
        });
      }

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
    // onCardMerged, activeCardId, and store are stable or handled via closure capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, onCardMoved, onCardMerged, activeCardId, position.x, position.y, store],
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
      // Pane activation (including the metaKey-held no-activate
      // nuance) is handled by `pane-focus-controller.ts`'s
      // document-level capture-phase pointerdown listener, which
      // fires before this handler. No per-handle activation call
      // is needed.
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
    [id, onCardMoved, position.x, position.y, size.width, size.height],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // When collapsed, the frame height is locked to CARD_TITLE_BAR_HEIGHT + 2px border.
  // The card retains its full width for dragging. The stored `size.height` is preserved
  // and restored when the card expands.
  const COLLAPSED_FRAME_HEIGHT = CARD_TITLE_BAR_HEIGHT + 2;

  // Persisted size can predate the current floor — a card kind
  // raised its policy `min`, or a wider sibling joined the stack, so
  // the stored width/height may sit below `minSize`. Clamp the
  // rendered frame up to the floor: the pane paints at its true
  // minimum immediately, and the next move or resize commits the
  // corrected size back to the store.
  const renderWidth = Math.max(size.width, minSize.width);
  const frameHeight = collapsed
    ? COLLAPSED_FRAME_HEIGHT
    : Math.max(size.height, minSize.height);

  const handleFrameCollapseToggle = useCallback(() => {
    onCardCollapsed?.(id);
  }, [id, onCardCollapsed]);

  const closable = effectiveMeta.closable !== false;

  // Pane-close confirmation policy. Multi-card panes always confirm —
  // closing the pane discards every hosted tab at once, so the guard is
  // unconditional. Single-card panes follow the active card's opt-in
  // (`confirmClose: true` in its registration). Defaults to no
  // confirm for single-card panes whose card type doesn't opt in.
  const paneConfirmClose =
    (cards?.length ?? 1) > 1 || effectiveMeta.confirmClose === true;

  const rootRefCallback = useCallback(
    (el: HTMLDivElement | null) => {
      setCardEl(el);
      responderRef(el);
    },
    [responderRef],
  );

  return (
    <div
      ref={frameRefCallback}
      className="tug-pane"
      data-testid="tug-pane"
      data-pane-id={id}
      data-collapsed={collapsed ? "true" : "false"}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: renderWidth,
        height: frameHeight,
        zIndex,
        boxSizing: "border-box",
        // Expose the pane's minimum width to descendants via CSS custom
        // property. `wide` TugSheets size relative to this floor rather
        // than the pane's (potentially much larger) live width, so a
        // wide sheet stays a predictable size instead of sprawling on a
        // big card. [L06]
        ["--tug-pane-min-width" as string]: `${sizePolicy.min.width}px`,
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

      <TugPaneFrameContext value={frameEl}>
      <TugPanePortalContext value={cardEl}>
        <div
          ref={rootRefCallback}
          className={collapsed ? "tug-pane-chrome tug-pane-chrome--collapsed" : "tug-pane-chrome"}
          data-slot="tug-pane"
          data-pane-id={stackId}
          data-collapsed={collapsed ? "true" : "false"}
        >
          <CardTitleBar
            ref={titleBarRef}
            title={displayTitle}
            icon={effectiveMeta.icon}
            closable={closable}
            collapsed={collapsed}
            cardCount={cards?.length ?? 1}
            confirmClose={paneConfirmClose}
            onCollapse={handleFrameCollapseToggle}
            onClose={handleTitleBarClose}
            onDragStart={handleDragStart}
            onSettingsClick={handleTitleBarSettingsClick}
            settingsEnabled={settingsEnabledForActive}
            settingsActive={settingsOpenForActive}
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

          {/* Pane-owned scrim layer [D18]. Permanent element; visibility
              is driven by `data-scrim` on the chrome (set imperatively
              by `useTugPaneScrim()` consumers via the pane-scrim
              registry). Sized below the title bar so the title bar
              stays interactive while pane-modal surfaces are up. */}
          <div className="tug-pane-scrim" aria-hidden="true" data-testid="tug-pane-scrim" />
        </div>
      </TugPanePortalContext>
      </TugPaneFrameContext>
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
