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
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Layers, MoreHorizontal, MoveHorizontal, X, icons } from "lucide-react";
import type { CardState, TugPaneState } from "@/layout-tree";
import type { SlotStackEntry } from "@/deck-store-selectors";
import type { CardMeta, CardSizePolicy } from "@/card-registry";
import { DEFAULT_SIZE_POLICY, getRegistration } from "@/card-registry";
import { computeSnap, computeResizeSnap } from "@/snap";
import type { Rect, GuidePosition, SnapResult } from "@/snap";
import { getTugZoom } from "@/components/tugways/scale-timing";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { useDeckManager } from "@/deck-manager-context";
import { dispatchCommand } from "@/command-dispatch";
import type { MovePaneOptions } from "@/deck-manager-store";
import {
  imposeStyle,
  imposeSidebarStyle,
  sidebarWidthProperty,
  type PinnedFrame,
  type SidebarSide,
  IMPOSITION_GAP_PX,
  IMPOSITION_GAP_BOTTOM_PX,
  type ImposedPlacement,
  CONTENT_WIDTH_PRESETS,
  CONTENT_WIDTH_LABELS,
  type ContentWidth,
} from "@/lib/layout-imposer";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugConfirmPopover } from "@/components/tugways/tug-confirm-popover";
import { cardTitleStore } from "@/lib/card-title-store";
import { composePaneTitleBarText } from "@/lib/pane-title";
import { paneTitleBarMenuStore } from "@/lib/pane-title-bar-menu-store";
import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import {
  getCardCloseGuard,
  type CardCloseDecision,
} from "@/lib/card-close-guard";
import * as paneContentRegistry from "@/components/chrome/pane-content-registry";
import * as paneFrameRegistry from "@/components/chrome/pane-frame-registry";
import * as paneRootRegistry from "@/components/chrome/pane-root-registry";
import {
  captureFocusForDragStart,
  transferFocusForActivation,
} from "@/focus-transfer";
import { paneOcclusionGesture } from "@/components/chrome/pane-occlusion-controller";

// ===========================================================================
// CardTitleBar (window title chrome)
// ===========================================================================

/**
 * Height of the card title bar in pixels. Must match --tug-chrome-height.
 */
export const CARD_TITLE_BAR_HEIGHT = 36;

/**
 * Imperative handle on CardTitleBar — lets the surrounding TugPane
 * route the chain-action close (Cmd-W) through the same confirm popover
 * the X button opens, so a `confirmClose` pane never bypasses the guard.
 */
/**
 * One close gesture's confirm-popover copy and confirm action. Shared by
 * the pane-close (X / single-tab Cmd-W), active-card-close (multi-tab
 * Cmd-W) and close-all flows.
 */
interface CloseIntent {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export interface CardTitleBarHandle {
  /**
   * Run the title-bar close flow as if the X button had been clicked.
   * When `confirmClose` is `true` the popover opens; when `false` the
   * pane closes immediately via `onClose`.
   */
  requestClose: () => void;
  /**
   * General close-with-confirm entry point shared by Cmd-W (active-card
   * close on a multi-tab pane) and the "Close All Card Tabs" command. When
   * `needsConfirm` is `true` the shared confirm popover opens with the
   * supplied copy and `onConfirm` fires only on confirm; when `false`,
   * `onConfirm` runs immediately. Always anchored to the X button.
   */
  requestCloseWith: (intent: {
    needsConfirm: boolean;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
    /**
     * Which cards' close guards this gesture must consult: `"active"`
     * (single-card close — Cmd-W's close-active-tab) or `"pane"` (the
     * whole pane is going away — Close All; every hosted card's guard
     * runs, visiting each dirty card). Defaults to `"active"`.
     */
    guardScope?: "active" | "pane";
  }) => void;
  /**
   * Toggle the stack picker. Opens it as if the badge had been clicked;
   * closes it when it is already open, which is also what the chord's own
   * chain dispatch would do to it. No-op when the pane holds no slot or its
   * slot holds one pane — no badge is rendered, so there is no anchor.
   */
  revealStack: () => void;
}

export interface CardTitleBarProps {
  title: string;
  icon?: string;
  closable?: boolean;
  /**
   * The width preset this pane is currently stamped with, or `null` at a width
   * the user chose by hand. Drives the check in the width popup, and nothing
   * else — a custom width shows no check rather than a false one.
   *
   * Omitted → the pane has no width control (a sidebar-role pane: rails take
   * their width from the allocator, not from a preset).
   */
  widthPreset?: ContentWidth | null;
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
   * Resolve the close decision for a close gesture, if any card demands
   * one. `"active"` consults only the active card's guard (single-card
   * close); `"pane"` composes every hosted card's guard — the pane visits
   * each dirty card before it dies. A resolved decision supersedes the
   * `confirmClose` popover; Option-click still bypasses it. Called live at
   * close time so the guards always reflect current cards.
   */
  resolveCloseGuard?: (scope: "active" | "pane") => CardCloseDecision | null;
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
  /**
   * The pane's active card id. Used only to look up any title-bar menu
   * items the active card has contributed via `paneTitleBarMenuStore`
   * (the generic `…` affordance). Omitted → no `…` menu.
   */
  activeCardId?: string;
  /**
   * Every pane sharing this pane's slot, topmost first, already resolved for
   * display — passed straight through from {@link TugPaneProps.slotStack}.
   * Drives the stack badge (rendered only past depth 1) and the rows of the
   * picker it opens. Empty for a free pane and for the Lens.
   */
  slotStack?: readonly SlotStackEntry[];
  /** Raise the pane a picker row names. Wired in `DeckCanvas`. */
  onRevealPane?: (entry: SlotStackEntry) => void;
  /**
   * Apply a width preset to this pane. Present exactly when
   * {@link widthPreset} is — together they are "this pane has a width
   * control" — and wired to the `set-card-width` command, never to a store
   * method ([L30]).
   */
  onSetWidth?: (preset: ContentWidth) => void;
  onClose?: () => void;
  onDragStart?: (event: React.PointerEvent) => void;
}

export const CardTitleBar = React.forwardRef<CardTitleBarHandle, CardTitleBarProps>(
function CardTitleBar({
  title,
  icon,
  closable = true,
  widthPreset,
  cardCount = 1,
  resolveCloseGuard,
  confirmClose = false,
  activeCardId,
  slotStack = EMPTY_SLOT_STACK,
  onRevealPane,
  onSetWidth,
  onClose,
  onDragStart,
}: CardTitleBarProps, ref) {
  // Generic title-bar `…` menu: the active card may contribute items via
  // `paneTitleBarMenuStore`. The pane renders them without knowing what
  // card published them (the `cardTitleStore` precedent) — no lens import.
  const titleBarMenuItems = useSyncExternalStore(
    paneTitleBarMenuStore.subscribe,
    () => paneTitleBarMenuStore.get(activeCardId ?? null),
  );
  const handleTitleBarPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest(".tug-button")) return;
      onDragStart?.(event);
    },
    [onDragStart],
  );

  // Controlled-mode open state for the close-confirm popover (the shared
  // `TugConfirmPopover` component). The X button and the imperative
  // `requestClose*` handles drive it open; the component's onConfirm /
  // onCancel drive it closed. Anchored to the X button element, captured
  // by a callback ref so the popover re-positions once the button mounts.
  //
  // `closeIntent` carries the popover copy and the confirm action for the
  // *current* close gesture — a pane close (X / Cmd-W on a single-tab
  // pane), an active-card close (Cmd-W on a multi-tab pane), or a
  // close-all (the "Close All Card Tabs" command). It is set on open and
  // retained while the popover animates closed so the copy never flips
  // mid-dismiss.
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeIntent, setCloseIntent] = useState<CloseIntent | null>(null);
  const [closeAnchorEl, setCloseAnchorEl] = useState<HTMLButtonElement | null>(null);

  // Slot-stack picker open state. Local-data [L24], beside `closeOpen`: it is
  // transient UI the title bar owns, and the deck never hears about it.
  const [stackMenuOpen, setStackMenuOpen] = useState(false);

  // The open state must not outlive the badge. `slotStack.length` can drop to
  // 1 while the picker is up — a peer in the slot closes, a drag evicts one, a
  // kind change clamps a slot — and the trigger would then unmount open: the
  // focus trap's `onCloseAutoFocus` never runs (keyboard focus left on a
  // removed node) and the stale `true` would make the badge mount already-open
  // the next time this pane joins a stack. The prop the picker already reads
  // is the signal; nothing has to notify us.
  useEffect(() => {
    if (slotStack.length <= 1) setStackMenuOpen(false);
  }, [slotStack.length]);

  // Drives the popover's copy only — not whether it appears.
  const isMultiTab = cardCount > 1;

  // The pane-close intent (X button / single-tab Cmd-W): closes the whole
  // pane via `onClose`, with multi-tab vs single-tab copy.
  const paneCloseIntent = useCallback(
    (): CloseIntent => ({
      message: isMultiTab ? `Close ${cardCount} Tabs?` : "Close Card?",
      confirmLabel: isMultiTab ? "Close All" : "Close",
      onConfirm: () => onClose?.(),
    }),
    [isMultiTab, cardCount, onClose],
  );

  const openCloseConfirm = useCallback((intent: CloseIntent) => {
    setCloseIntent(intent);
    setCloseOpen(true);
  }, []);

  const handleClosePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  // Single-flight latch so a second close gesture while the guard sheet is
  // already up is swallowed rather than stacking a second sheet.
  const guardRunningRef = useRef(false);

  // Consult the active card's close guard, if one is registered. Returns
  // `true` when a guard exists and has taken ownership
  // of the close decision (it runs `proceed` only on `"close"`); returns
  // `false` when there is no guard, so the caller falls back to its
  // existing `confirmClose`-or-immediate behavior. Every close site routes
  // its proceed action through here, so the guard covers the plain X-click
  // (`!confirmClose` short-circuit) as well as ⌘W and the imperative
  // handle — Option-click bypasses it at the call site.
  const withCloseDecision = useCallback(
    (proceed: () => void, scope: "active" | "pane"): boolean => {
      const decision = resolveCloseGuard?.(scope) ?? null;
      if (!decision) return false;
      if (guardRunningRef.current) return true;
      guardRunningRef.current = true;
      void decision().then((outcome) => {
        guardRunningRef.current = false;
        if (outcome === "close") proceed();
      });
      return true;
    },
    [resolveCloseGuard],
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
      // Popover already showing → this click just dismisses it, exactly
      // like a click on the title bar outside the buttons. Never reopens
      // (which would re-seed and drop the focus ring) or closes the pane.
      if (closeOpen) {
        setCloseOpen(false);
        return;
      }
      // Option-click is the power-user escape hatch: close immediately,
      // bypassing both the guard and the confirm popover.
      if (event.altKey) {
        onClose?.();
        return;
      }
      // A registered close guard supersedes the confirm popover — even on
      // a non-`confirmClose` pane, where a plain X-click would otherwise
      // close immediately. The X kills the whole pane, so every hosted
      // card's guard runs, not just the active one.
      if (withCloseDecision(() => onClose?.(), "pane")) return;
      if (!confirmClose) {
        onClose?.();
      } else {
        openCloseConfirm(paneCloseIntent());
      }
    },
    [closeOpen, onClose, confirmClose, openCloseConfirm, paneCloseIntent, withCloseDecision],
  );

  const handleCloseClick = useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      // Mouse clicks are owned by `handleClosePointerUp` (which already ran
      // on the preceding pointerup). The trailing `click` fires AFTER React
      // re-renders with the new `closeOpen`, so acting on it here would undo
      // what pointerup just did — opening then instantly closing (a blink).
      // A mouse-originated click reports `detail > 0`; skip it. Only keyboard
      // activation (Enter / Space — no pointer event, `detail === 0`) is
      // handled below, with the same toggle/close logic as pointerup.
      if (event && event.detail > 0) return;
      if (closeOpen) {
        setCloseOpen(false);
        return;
      }
      if (event?.altKey) {
        onClose?.();
        return;
      }
      if (withCloseDecision(() => onClose?.(), "pane")) return;
      if (!confirmClose) {
        onClose?.();
        return;
      }
      openCloseConfirm(paneCloseIntent());
    },
    [closeOpen, onClose, confirmClose, openCloseConfirm, paneCloseIntent, withCloseDecision],
  );

  // Confirm / cancel callbacks for the shared `TugConfirmPopover`. Confirm closes
  // the pane; cancel just dismisses the popover. The component owns the focus model
  // (default-button seed, arrow navigation, Escape / Cmd-. cancel) — chrome no
  // longer hand-rolls any of it.
  const handleCloseConfirm = useCallback(() => {
    setCloseOpen(false);
    closeIntent?.onConfirm();
  }, [closeIntent]);

  const handleCloseCancel = useCallback(() => {
    setCloseOpen(false);
  }, []);

  // Imperative bridge for the surrounding TugPane: route Cmd-W and the
  // close-all command through the same popover the X button uses, so a
  // `confirmClose` pane gets the guard on keyboard close too rather than
  // slipping past it.
  React.useImperativeHandle(ref, () => ({
    requestClose: () => {
      const proceed = () => {
        if (confirmClose) openCloseConfirm(paneCloseIntent());
        else onClose?.();
      };
      // ⌘W has no Option-bypass; the guard always gets first say. This
      // handle closes the whole pane, so run every hosted card's guard.
      if (withCloseDecision(proceed, "pane")) return;
      proceed();
    },
    requestCloseWith: ({ needsConfirm, message, confirmLabel, onConfirm, guardScope }) => {
      const proceed = () => {
        if (needsConfirm) openCloseConfirm({ message, confirmLabel, onConfirm });
        else onConfirm();
      };
      // The caller says whose guards this gesture answers to; a multi-tab
      // pane still keeps its "Close N Tabs?" popover after the guards
      // resolve `"close"`.
      if (withCloseDecision(proceed, guardScope ?? "active")) return;
      proceed();
    },
    revealStack: () => {
      // A pane with no stack has no badge, therefore no anchor to open at.
      if (slotStack.length <= 1) return;
      // Toggle, not set. The chord that reaches here travels the responder
      // chain, and `sendToFirstResponder` runs the responder action before it
      // notifies the dispatch observers — so an OPEN menu's observeDispatch
      // subscription sees this same dispatch and closes it. Toggling is the
      // one form that is single-valued in both directions: open → the toggle
      // queues false and the observer queues false again, the menu closes;
      // closed → the subscription is gated on `open` so no observer exists,
      // and the toggle simply opens it. It also reads correctly for the
      // pointer callers, where "again" ought to dismiss.
      setStackMenuOpen((prev) => !prev);
    },
  }), [confirmClose, onClose, openCloseConfirm, paneCloseIntent, withCloseDecision, slotStack.length]);

  const IconComponent =
    icon && icons[icon as keyof typeof icons]
      ? icons[icon as keyof typeof icons]
      : null;

  return (
    <div
      className="tug-pane-title-bar"
      data-slot="tug-pane-title-bar"
      onPointerDown={handleTitleBarPointerDown}
      data-testid="tug-pane-title-bar"
      // The title bar is an ACTIVATION/DRAG gesture surface, never a
      // responder target: clicking it must not steal first responder (or
      // browser focus) from the card's content — the caret keeps blinking
      // in the editor and the card's accelerators keep landing there.
      // Cross-pane activation still restores the newly-active card's first
      // responder through the engine ([P21]); this marker only stops the
      // pointer walk from promoting the coarse pane container. See
      // responder-chain.md § First responder.
      data-tug-fr-preserve=""
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
        {/* The slot's depth at rest, and the way into the panes behind this
            one. The condition is `slotStack.length > 1` and nothing else — no
            "am I on top?" test, which would need a second cross-pane fact the
            title bar does not have. Every pane in the stack renders it,
            because the badge describes the SLOT and a pane the user can see is
            entitled to tell the truth about where it stands; occlusion hides
            it along with everything else on a fully-covered pane, so a
            same-width stack shows exactly one. */}
        {slotStack.length > 1 && (
          <TugPopupMenu
            trigger={
              <TugButton
                subtype="icon-text"
                emphasis="ghost"
                role="action"
                size="sm"
                icon={<Layers />}
                className="tug-pane-title-bar-stack-badge"
                aria-label={`Stack of ${slotStack.length} cards`}
                data-testid="tug-pane-title-bar-stack-badge"
              >
                {slotStack.length}
              </TugButton>
            }
            align="end"
            open={stackMenuOpen}
            onOpenChange={setStackMenuOpen}
            items={slotStack.map((entry) => {
              // Each row is a miniature of the title bar it stands for: the
              // pane's own icon, then the pane's own title, in that order and
              // from the same `CardMeta.icon` the real title bar draws.
              const RowIcon =
                entry.icon !== undefined && entry.icon in icons
                  ? icons[entry.icon as keyof typeof icons]
                  : null;
              return {
                id: entry.paneId,
                label: entry.title,
                ...(RowIcon === null
                  ? {}
                  : { icon: React.createElement(RowIcon) }),
                // Set on every row, not just the front one, so the check
                // column aligns across the menu.
                selected: entry.topmost,
              };
            })}
            onSelect={(paneId) => {
              const entry = slotStack.find((e) => e.paneId === paneId);
              if (entry) onRevealPane?.(entry);
            }}
            data-testid="tug-pane-title-bar-stack-menu"
          />
        )}
        {titleBarMenuItems !== null && titleBarMenuItems.length > 0 && (
          <TugPopupMenu
            trigger={
              <TugButton
                subtype="icon"
                emphasis="ghost"
                role="action"
                size="sm"
                icon={<MoreHorizontal />}
                aria-label="Section menu"
                data-testid="tug-pane-title-bar-menu-button"
              />
            }
            align="end"
            items={titleBarMenuItems.map((item) => ({
              id: item.id,
              label: item.label,
              ...(item.checked !== undefined ? { selected: item.checked } : {}),
            }))}
            onSelect={(id) => {
              const item = titleBarMenuItems.find((i) => i.id === id);
              item?.onSelect();
            }}
          />
        )}
        {/* Card width. A dedicated, persistent trigger rather than a row in
            the `…` overflow above: width is reached often and carries state,
            and a control whose current value is invisible until you open it
            is the wrong shape for both. Composed as `TugPopupMenu` + a ghost
            `TugButton`, matching the stack badge and section menu beside it —
            pane chrome is one of that component's sanctioned composers. */}
        {onSetWidth !== undefined && (
          <TugPopupMenu
            trigger={
              <TugButton
                subtype="icon"
                emphasis="ghost"
                role="action"
                size="sm"
                icon={<MoveHorizontal />}
                aria-label="Card width"
                data-testid="tug-pane-title-bar-width-button"
              />
            }
            align="end"
            items={CONTENT_WIDTH_PRESETS.map((preset) => ({
              id: preset,
              label: CONTENT_WIDTH_LABELS[preset],
              // No check at a custom width: `widthPreset` is null then, and
              // claiming the nearest preset would be a resting lie.
              selected: widthPreset === preset,
            }))}
            onSelect={(id) => onSetWidth(id as ContentWidth)}
            data-testid="tug-pane-title-bar-width-menu"
          />
        )}

        {closable && (
          // Pane-level close confirmation: every pane's X button —
          // single-tab and multi-tab alike — opens a "Close …?" confirm
          // popover (the shared `TugConfirmPopover`), so a pane is never
          // discarded on a single stray click. Option-click on X bypasses
          // the popover and closes immediately (see `handleClosePointerUp`).
          //
          // Controlled mode: the X button and the `requestClose*` handles
          // drive `closeOpen` (with `closeIntent` carrying the copy and
          // confirm action), and the X is the popover's anchor (captured
          // via `setCloseAnchorEl`). The X
          // is a plain button, NOT a `TugPopoverTrigger`, because its
          // pointer-capture open flow on `pointerup` would race Radix's
          // auto-toggle and flash the popover closed. The component owns the
          // focus model — default-button seed, Cancel↔Close arrow nav, and
          // Escape / Cmd-. cancel (it claims first responder on focus so the
          // keyboard cancel keys land on it, not the card behind it).
          <>
            {/* Deliberately NOT wrapped in a `TugActionTooltip`, though ⌘W is
                exactly the sort of chord one would name. This X does not run
                the ordinary click protocol: it captures the pointer on
                `pointerdown` (preventing the default), decides on `pointerup`
                by hit-testing its own rect, and is itself the anchor the
                confirm popover hangs from. Wrapping it in a second
                pointer-handling primitive made Option-click stop closing the
                pane — reproducibly, and with the bubble's open delay pushed
                past the test, so it is the trigger's handler composition and
                not the bubble. at0040 is what catches it. */}
            <TugButton
              ref={setCloseAnchorEl}
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
            <TugConfirmPopover
              open={closeOpen}
              anchorEl={closeAnchorEl}
              onConfirm={handleCloseConfirm}
              onCancel={handleCloseCancel}
              side="bottom"
              // The X sits at the card's trailing edge; anchor the popover's
              // end edge to it so it hangs back into the card interior rather
              // than centering under the X and spilling past the card's right
              // side. The arrow then points up at the X, naming the control
              // that opened it.
              align="end"
              arrow
              sideOffset={6}
              // Pin the popover inside the card it is confirming so it can
              // never overlap a neighboring card — an overlap makes the
              // targeted card ambiguous. Radix shifts/flips within this
              // boundary instead of the viewport. `sticky="always"` drops the
              // attach-to-anchor shift limiter so the popover slides fully
              // inside the card even when the X is dragged toward the edge;
              // the padding keeps it off the card's border.
              collisionBoundary={closeAnchorEl?.closest(".tug-pane-chrome") ?? null}
              sticky="always"
              collisionPadding={8}
              message={
                closeIntent?.message ??
                (isMultiTab ? `Close ${cardCount} Tabs?` : "Close Card?")
              }
              confirmLabel={closeIntent?.confirmLabel ?? (isMultiTab ? "Close All" : "Close")}
              confirmRole="action"
              cancelLabel="Cancel"
            />
          </>
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
 *
 * `getBoundingClientRect` returns visual (post-`body { zoom }`) pixels, but card
 * frames are positioned with `style.left/top` in layout pixels. Dividing by
 * `zoom` yields layout-space rects so they line up with the moving frame's
 * position and size (which come from layout-space `style`/`offsetWidth`). All
 * snap math then runs in one consistent space.
 */
/** Per-edge offset (layout px) from a card frame's measured box to its visible
 *  border. See measureGuideEdgeOffsets. */
interface GuideEdgeOffsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const ZERO_EDGE_OFFSETS: GuideEdgeOffsets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * Measure how far each visible card edge (the `.tug-pane-chrome` border box) sits
 * from the measured `.tug-pane` frame box that snap geometry uses.
 *
 * The chrome is `border-box` with `width/height: 100%` + a 1px border, so its
 * border box normally coincides with the frame box and the offsets are zero.
 * Reading the actual delta (rather than assuming a box model) keeps snap guides
 * landing on the visible border exactly, whatever the border/box-sizing turns
 * out to be. All cards share this geometry, so one measurement per gesture
 * suffices. Returned in layout px (÷ zoom).
 */
function measureGuideEdgeOffsets(frame: HTMLElement, zoom = 1): GuideEdgeOffsets {
  const chrome = frame.querySelector(".tug-pane-chrome");
  if (!chrome) return ZERO_EDGE_OFFSETS;
  const f = frame.getBoundingClientRect();
  const c = chrome.getBoundingClientRect();
  return {
    left: (c.left - f.left) / zoom,
    right: (c.right - f.right) / zoom,
    top: (c.top - f.top) / zoom,
    bottom: (c.bottom - f.bottom) / zoom,
  };
}

function snapshotCardRects(
  canvasBounds: DOMRect | null,
  excludeId?: string,
  zoom = 1,
): { id: string; rect: Rect }[] {
  const results: { id: string; rect: Rect }[] = [];
  // Every pane is a snap candidate — including the pinned Lens. A free pane
  // dragged with Option snaps its edge to the Lens's edge just as it does to
  // any other card, so a card can be abutted to it. The Lens exposes the same
  // `getBoundingClientRect` as any pane, so its rect needs no special case.
  const els = document.querySelectorAll<HTMLElement>(
    ".tug-pane[data-pane-id]",
  );
  els.forEach((el) => {
    const paneId = el.getAttribute("data-pane-id");
    if (!paneId || paneId === excludeId) return;
    const domRect = el.getBoundingClientRect();
    results.push({
      id: paneId,
      rect: {
        x: (domRect.left - (canvasBounds ? canvasBounds.left : 0)) / zoom,
        y: (domRect.top - (canvasBounds ? canvasBounds.top : 0)) / zoom,
        width: domRect.width / zoom,
        height: domRect.height / zoom,
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

/**
 * Width of a snap guide line in layout px. Must match the `border` width on
 * `.snap-guide-line-x` / `.snap-guide-line-y` in chrome.css so a right/bottom-edge
 * guide can be pulled back by exactly one line width to sit on the card's edge.
 */
const SNAP_GUIDE_LINE_PX = 2;

/**
 * Freeze an imposed frame into free pixel geometry at the rect it currently
 * shows, and hand back that rect in canvas coordinates.
 *
 * An imposed frame is positioned by CSS pins (`left`/`right` against the rail
 * inset, `top`/`bottom` against the canvas), which the drag and resize
 * machines' per-frame writes would fight. Both gestures release the pane from
 * its slot at the moment they become a move — not at pointer-down — by
 * converting it here: the DOM keeps showing exactly what the user was looking
 * at, and the commit that follows carries `evictSlot`, so React re-renders in
 * free mode consistent with the DOM.
 *
 * Seeding the gesture from this measurement rather than from `position` matters
 * — an imposed pane's stored position holds stale last-known values, so a
 * gesture seeded from state would teleport the frame on its first move.
 */
function releaseImposedFrame(
  frame: HTMLElement,
  canvas: DOMRect | null,
): { x: number; y: number; width: number; height: number } {
  const zoom = getTugZoom() || 1;
  const rect = frame.getBoundingClientRect();
  const released = {
    x: (rect.left - (canvas ? canvas.left : 0)) / zoom,
    y: (rect.top - (canvas ? canvas.top : 0)) / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
  };
  frame.style.right = "";
  frame.style.bottom = "";
  frame.style.left = `${released.x}px`;
  frame.style.top = `${released.y}px`;
  frame.style.width = `${released.width}px`;
  frame.style.height = `${released.height}px`;
  return released;
}

/**
 * How far the pointer must travel before a press becomes a gesture — on the
 * title bar (drag), on a resize handle, and on the Lens's deck-facing edge.
 *
 * Under this, the press is a click: it focuses the pane and commits nothing.
 * The distinction matters most for a pane whose geometry is derived — a slotted
 * card, or the pinned Lens — because committing a move or a resize is what
 * releases it from the arrangement, and that should take an actual drag.
 */
const DRAG_MOVE_THRESHOLD_PX = 3;

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
  /** Window position, size, id, and width preset from DeckState. */
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
    opts?: MovePaneOptions,
  ) => void;
  /**
   * This pane's place in the imposition chain, when it holds a slot. Resolved
   * by `DeckCanvas`, which is the only vantage point that can see every
   * slotted pane's width at once — a pane cannot work out its own offset down
   * the chain from its own state. Absent for a free pane and for the Lens.
   */
  placement?: ImposedPlacement;
  /**
   * The deck's content-width preset in pixels — the width an ordinary card
   * opens at in this arrangement. Deck state, so `DeckCanvas` resolves it.
   *
   * Only a size-locked pane reads it, and only to size its SLOT: About is 320
   * wide by registration, but the slot it stands in is the one every other
   * card in the arrangement gets, and About is centred inside that. A pane
   * that takes its own width for its slot ignores this entirely.
   */
  contentWidthPx?: number;
  /**
   * Every pane sharing this pane's slot, topmost first — the slot's stack.
   * Resolved by `DeckCanvas` for the same reason `placement` is: a pane cannot
   * see its slot's other occupants from its own state.
   *
   * The entries arrive display-resolved (title and topmost flag already
   * decided), so the title bar renders its stack picker from props alone and
   * never reaches for the deck store. Absent for a free pane and for the Lens,
   * which hold no slot and therefore stand in no stack.
   */
  slotStack?: readonly SlotStackEntry[];
  /**
   * Raise the pane a stack-picker row names. Wired in `DeckCanvas`, which is
   * where the store lives; the pane and its title bar only report the choice.
   */
  onRevealPane?: (entry: SlotStackEntry) => void;
  /**
   * Set only on a pane standing in a rail: the side that rail holds and how
   * many cards stand on it. A rail is imposed as the strip's fixed end rather
   * than a link in its chain, so its panes take a pin instead of a `placement`:
   * resizable only on the deck-facing edge, and excluded from snap and merge.
   * Resolved by `DeckCanvas` — the pane carries no marker of its own ([P04]).
   *
   * Every member takes the SAME geometry — one gap below the canvas top, the
   * deeper gap above its bottom — because a shared rail is a stack, not a
   * split: the cards stand front-to-back and z-order decides which you see.
   * `count` is therefore not geometry; it is what tells the title bar it is
   * standing in a stack worth offering a picker for.
   */
  sidebarStack?: {
    side: SidebarSide;
    count: number;
  };
  /**
   * Set on the pane hosting the Lens card, pinned or not. Separate from
   * {@link sidebarStack}, which says only where a PINNED rail stands: a Lens
   * dragged off its pin is an ordinary free pane for geometry purposes but is
   * still the Lens, and the one thing that stays true either way is that it
   * hosts a singleton card and never accepts a merge.
   */
  isLensPane?: boolean;
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
   * Size policy for this card type. Enforces min as a floor (content-reported
   * min cannot go below this) and max as a ceiling during resize.
   * Falls back to DEFAULT_SIZE_POLICY when omitted.
   */
  sizePolicy?: CardSizePolicy;
}

// ---------------------------------------------------------------------------
// Resize edge descriptors
// ---------------------------------------------------------------------------

// One frozen empty array for every pane that holds no slot, so an absent
// `slotStack` prop does not hand the title bar a fresh identity per render.
const EMPTY_SLOT_STACK: readonly SlotStackEntry[] = [];

type ResizeEdge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

// Gutter reserved on the deck side so the Lens can't be widened to cover
// the whole viewport. The effective max width is `window.innerWidth - this`.
const LENS_MIN_GUTTER_PX = 80;

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
  placement,
  contentWidthPx,
  slotStack = EMPTY_SLOT_STACK,
  onRevealPane,
  sidebarStack,
  isLensPane = false,
}: TugPaneProps) {
  const sidebarSide = sidebarStack?.side;
  const { id, position, size } = stackState;
  // Two derived geometry modes, both placed by `lib/layout-imposer.ts`.
  //
  // Pinned — the Lens, while it is standing at its side. It holds that side
  // at a fixed pin and keeps its own width, so it exposes only its deck-facing
  // resize edge and is excluded from merge. It is DRAGGABLE, and dragging it
  // is exactly how it stops being pinned: the commit releases it, `sidebarSide`
  // arrives undefined on the next render, and it becomes a free pane in the
  // deck like any other.
  //
  // Imposed — a slotted pane. It derives its position from its slot's anchor
  // and its height from the canvas, instead of from `position`. Its width is
  // still its own; the imposer never touches it.
  //
  // The two are mutually exclusive, which the deck-state invariant already
  // guarantees (the Lens pane never carries a slot); the check here keeps the
  // render honest against a hand-built state. A free pane is neither and uses
  // its stored `position`/`size`. Every mode still owns its geometry [L09].
  const pinned = sidebarSide !== undefined;
  const imposed = !pinned && placement !== undefined;
  // Both modes place the frame by CSS pins rather than by stored pixels, so
  // both need the same two things at gesture time: a freeze of the live rect
  // before the first move, and an `evictSlot` on the commit that follows.
  // Read from a ref so the drag and resize machines' `useCallback` identities
  // do not churn with the arrangement.
  const derivedRef = useRef(pinned || imposed);
  derivedRef.current = pinned || imposed;
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

  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const activeCardIdRef = useRef(activeCardId);
  activeCardIdRef.current = activeCardId;

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
      // Multi-tab: Cmd-W removes only the active card. Honour that
      // card's own `confirmClose` policy — pop a single-card confirm
      // before discarding an opt-in card (e.g. the Session card), remove
      // immediately otherwise. (The whole-pane "Close N Tabs?" guard
      // belongs to the X button and the close-all command, not to the
      // single-tab close Cmd-W performs here.)
      const activeCard = currentCards.find((c) => c.id === currentActiveId);
      const reg = activeCard ? getRegistration(activeCard.componentId) : undefined;
      const needsConfirm = reg?.defaultMeta.confirmClose === true;
      titleBarRef.current?.requestCloseWith({
        needsConfirm,
        message: "Close Card?",
        confirmLabel: "Close",
        onConfirm: () => store.removeCard(stackId, currentActiveId),
      });
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

  // Close All Card Tabs (TUG_ACTIONS.CLOSE_ALL — File ▸ Close All Card Tabs,
  // ⌥⌘W). Closes the entire focused pane (every hosted tab). The
  // confirm rule is per-card: pop the "Close N Tabs?" guard only when at
  // least one hosted card opts into `confirmClose`, close immediately
  // otherwise. This differs from the X button, whose multi-tab close
  // always confirms — the menu command is a deliberate gesture, the X a
  // single stray-click target. The Swift menu enables the item only for
  // a multi-card focused pane; the `count > 1` copy guards the rare
  // stray dispatch onto a single-card pane.
  const handleCloseAll = useCallback(() => {
    const currentCards = cardsRef.current;
    const count = currentCards?.length ?? 1;
    const anyConfirms = !!currentCards?.some(
      (c) => getRegistration(c.componentId)?.defaultMeta.confirmClose === true,
    );
    titleBarRef.current?.requestCloseWith({
      needsConfirm: anyConfirms,
      message: count > 1 ? `Close ${count} Tabs?` : "Close Card?",
      confirmLabel: count > 1 ? "Close All" : "Close",
      onConfirm: () => onClose?.(),
      // Every hosted card dies with the pane — visit each dirty one.
      guardScope: "pane",
    });
  }, [onClose]);

  // Single-flight latch for the tab-× close guard, so a double-click on a
  // tab's × doesn't stack two sheets.
  const closeTabGuardRunningRef = useRef(false);

  const { ResponderScope, responderRef } = useResponder({
    id: stackId,
    kind: "card",
    actions: {
      [TUG_ACTIONS.CLOSE]: (_event: ActionEvent) => handleChromeClose(),
      [TUG_ACTIONS.CLOSE_ALL]: (_event: ActionEvent) => handleCloseAll(),
      // The X button, aimed from elsewhere — today the Lens's pane row. It
      // delegates to the same `requestClose()` the chrome close goes through,
      // so a remote close box inherits the X's whole policy rather than a
      // second, weaker one: every hosted card's save guard runs, and a
      // multi-tab pane still asks "Close N Tabs?" before anything dies.
      [TUG_ACTIONS.CLOSE_PANE]: (_event: ActionEvent) => {
        titleBarRef.current?.requestClose();
      },
      // Same shape as CLOSE_PANE: the pane answers the chain by calling an
      // imperative handle on the title bar, which owns the transient UI.
      [TUG_ACTIONS.REVEAL_STACK]: (_event: ActionEvent) => {
        titleBarRef.current?.revealStack();
      },
      // The depth pair: switch within the slot's stack without reading
      // anything. Nothing transient is put on screen, so neither reaches the
      // title bar.
      //
      // NEXT raises the LAST entry: `slotStack` is topmost-first, so that is
      // the pane buried longest, raised through the same `onRevealPane` the
      // picker's rows go through — one raise policy for both. Raising the
      // bottom-most is what makes repeated presses a ring rather than a
      // two-pane ping-pong — every raise sends the outgoing front pane one
      // place back, so a depth-N slot is home again after N presses and the
      // user can count instead of look. It is also what ⌘` does with
      // windows. The raise moves the first responder to the pane that came
      // up, so the *next* press is answered by that pane reading its own
      // freshly-ordered stack.
      [TUG_ACTIONS.NEXT_STACK_CARD]: (_event: ActionEvent) => {
        if (slotStack.length <= 1) return;
        const buried = slotStack[slotStack.length - 1];
        if (buried) onRevealPane?.(buried);
      },
      // PREVIOUS is NEXT's exact inverse: this pane leaves the front by
      // going all the way to the back (`sendPaneBehind` the bottom member),
      // fronting the entry beneath it — a true rotation, where raising the
      // second-from-top instead would ping-pong. Focus rides
      // `transferFocusForActivation` like every other activation path.
      [TUG_ACTIONS.PREVIOUS_STACK_CARD]: (_event: ActionEvent) => {
        if (slotStack.length <= 1) return;
        const next = slotStack[1];
        const bottom = slotStack[slotStack.length - 1];
        if (!next || !bottom) return;
        transferFocusForActivation({
          outgoingCardId: store.getFirstResponderCardId(),
          incomingCardId: next.cardId,
          store,
          commitMutation: () => {
            store.sendPaneBehind(stackId, bottom.paneId);
            store.activateCard(next.cardId);
          },
        });
      },
      [TUG_ACTIONS.SELECT_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        performSelectCard(event.value);
      },
      [TUG_ACTIONS.CLOSE_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        const targetId = event.value;
        // The tab × is a close gesture like the pane X — it must honour the
        // target card's close guard rather than destroy a dirty manual File
        // card silently. A card that opts out (e.g. the Session card's
        // picker-cancel) registers none and closes directly. A dirty
        // background tab is VISITED (activated) before its sheet, so the
        // decision is made looking at the buffer it concerns.
        const guard = getCardCloseGuard(targetId);
        if (!guard) {
          store.removeCard(stackId, targetId);
          return;
        }
        if (closeTabGuardRunningRef.current) return;
        closeTabGuardRunningRef.current = true;
        if (guard.needsDecision() && activeCardIdRef.current !== targetId) {
          performSelectCard(targetId);
        }
        void guard.run().then((decision) => {
          closeTabGuardRunningRef.current = false;
          if (decision === "close") store.removeCard(stackId, targetId);
        });
      },
      [TUG_ACTIONS.ADD_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        store.addCardToPane(stackId, event.value);
      },
      // No FIND handler here on purpose. A registered no-op would make
      // the native Edit ▸ Find item validate as enabled (the menu pulls
      // `chain.validateAction(FIND)`) while doing nothing — a live
      // shortcut to a stub. Find enables only where a surface really
      // implements it (e.g. the code view's search session); everywhere
      // else it stays disabled until a real find lands.
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

  // Per-card title override (cardTitleStore) — the name a card takes once its
  // identity resolves: a Text card's filename, the Session card's bound
  // project path. It REPLACES the registry title rather than prefixing it
  // (`lib/pane-title.ts` owns that rule), so a card with a name of its own is
  // called by it and nothing else. Subscription is keyed on the active card so
  // a card swap repaints the title without prop drill.
  const activeCardTitleOverride = useSyncExternalStore(
    cardTitleStore.subscribe,
    useCallback(
      () => cardTitleStore.get(activeCardId ?? null),
      [activeCardId],
    ),
  );

  // Resolve the close decision for a close gesture, live at close time;
  // the refs keep it correct between renders as cards and activation
  // change. `"active"` consults only the active card (single-card close);
  // `"pane"` composes every hosted card's guard — background tabs stay
  // mounted (`display: none`), so their stores are live and their guards
  // registered. The composite VISITS each card that needs a decision
  // (activates it before prompting) so the user chooses looking at the
  // buffer in question; any `"cancel"` aborts the whole close.
  const resolveCloseGuard = useCallback(
    (scope: "active" | "pane"): CardCloseDecision | null => {
      const activeId = activeCardIdRef.current;
      if (scope === "active") {
        const guard = activeId ? getCardCloseGuard(activeId) : null;
        return guard ? guard.run : null;
      }
      const ids = [
        ...(activeId ? [activeId] : []),
        ...(cardsRef.current ?? [])
          .map((c) => c.id)
          .filter((id) => id !== activeId),
      ];
      const guarded = ids.filter((id) => getCardCloseGuard(id) !== null);
      if (guarded.length === 0) return null;
      // All guards clean → no decisions to collect; fall through to the
      // normal confirm-popover flow so a multi-tab pane keeps its
      // "Close N Tabs?" stray-click protection. When any card IS dirty,
      // the visit sequence collects an explicit per-card decision and
      // supersedes the popover — asking again after would double-prompt.
      if (!guarded.some((id) => getCardCloseGuard(id)?.needsDecision() === true)) {
        return null;
      }
      return async () => {
        for (const id of guarded) {
          // Re-resolve at visit time: an earlier decision (e.g. Save) may
          // have replaced or released this card's guard.
          const guard = getCardCloseGuard(id);
          if (!guard) continue;
          if (guard.needsDecision() && activeCardIdRef.current !== id) {
            performSelectCard(id);
          }
          if ((await guard.run()) === "cancel") return "cancel";
        }
        return "close";
      };
    },
    [performSelectCard],
  );

  // The composition rule itself lives in `lib/pane-title.ts`, because this is
  // not the only surface that names a pane — the slot-stack picker and the
  // Window menu's pane list name the same panes, and a second copy of this
  // arithmetic is how they came to disagree with the title bar.
  const displayTitle = composePaneTitleBarText({
    metaTitle: effectiveMeta.title,
    paneTitle: cardTitle,
    titleOverride: activeCardTitleOverride,
  });

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
  // Whether the pointer has travelled far enough to make this a move rather
  // than a click. Until it has, the gesture commits nothing.
  const dragMoved = useRef(false);
  // Whether the press that opened this gesture held the command key. Read only
  // in the no-travel branch of `onPointerUp`, where a Cmd-click resolves as
  // "reveal this pane's stack" — a Cmd-drag latches `dragMoved` and never
  // reaches it.
  const dragStartedWithMeta = useRef(false);
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
    edgeOffsets: GuideEdgeOffsets,
  ): void {
    // Guide positions are in layout space (snapshotCardRects divides the visual
    // measurements by zoom). They reference the measured `.tug-pane` frame edge;
    // `edgeOffsets` carries the measured delta to the visible `.tug-pane-chrome`
    // border so the line lands on the edge the user actually sees. The visible
    // border occupies a 1px band: at a left/top edge it runs forward from the
    // border-box origin, so the line (a 1px border that paints forward) sits at
    // the origin; at a right/bottom edge the band ends at the exclusive border-box
    // edge, so the line is pulled back one line-width to cover the band.
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
        const left = guide.cardEdge === "right"
          ? guide.position + edgeOffsets.right - SNAP_GUIDE_LINE_PX
          : guide.position + edgeOffsets.left;
        el.style.left = `${left}px`;
        el.style.top = "";
      } else {
        el.classList.add("snap-guide-line-y");
        const top = guide.cardEdge === "bottom"
          ? guide.position + edgeOffsets.bottom - SNAP_GUIDE_LINE_PX
          : guide.position + edgeOffsets.top;
        el.style.top = `${top}px`;
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

      // A derived pane (pinned Lens, imposed card) is released from whatever
      // was deriving its geometry by MOVING it, not by being touched: the
      // release waits for the pointer to travel (see `releaseImposedFrame`,
      // called from the first frame past the threshold). Until then the pane
      // still belongs to the arrangement, so a click on the Lens's title bar —
      // to focus it, or to start a gesture and think better of it — leaves it
      // pinned where it was.
      dragMoved.current = false;
      // Whether the press that started this gesture was meta-modified. A
      // Cmd-drag on a title bar is meaningful today and must survive: for a
      // free pane it is the Mac convention of moving a background window
      // without raising it, and for an imposed pane the drag is how it is
      // evicted from its slot. So Cmd does not decide anything on the way
      // down — the decision waits for the gesture's ending, and the no-travel
      // branch in `onPointerUp` below IS that ending, already written.
      dragStartedWithMeta.current = event.metaKey;
      dragStartPosition.current = { x: position.x, y: position.y };
      latestDragPointer.current = { x: event.clientX, y: event.clientY };

      // Build tab bar cache for merge hit-testing. [D45]
      // Snapshot all .tug-tab-bar[data-pane-id] elements (excluding this pane).
      dragTabBarCache.current = [];
      const barEls = document.querySelectorAll<HTMLElement>(".tug-tab-bar[data-pane-id]");
      barEls.forEach((el) => {
        const paneId = el.getAttribute("data-pane-id");
        if (!paneId || paneId === id) return;
        // The Lens never accepts a merge — skip its tab bar as a drop
        // target.
        if (el.closest(".tug-pane[data-lens-pane]")) return;
        dragTabBarCache.current.push({ paneId, rect: el.getBoundingClientRect(), el });
      });

      // Snapshot other card rects at drag-start for snap computation. [D04]
      // Convert to canvas-relative coordinates by subtracting canvas bounds offset.
      // All snap geometry runs in layout space; `body { zoom }` requires dividing
      // the visual measurements by the zoom factor. Read once per gesture.
      const dragZoom = getTugZoom() || 1;
      const dragGuideEdgeOffsets = measureGuideEdgeOffsets(frame, dragZoom);
      const canvasBounds = dragCanvasBounds.current;
      dragOtherRects.current = snapshotCardRects(canvasBounds, id, dragZoom);

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

        // Below the threshold this is still a click, and a click moves nothing.
        if (!dragMoved.current) {
          const start = dragStartPointer.current;
          const travelled = Math.hypot(
            latestDragPointer.current.x - start.x,
            latestDragPointer.current.y - start.y,
          );
          if (travelled < DRAG_MOVE_THRESHOLD_PX) return;
          dragMoved.current = true;
          // The move is about to expose whatever this frame was covering,
          // without a store commit; reveal every occluded pane before the
          // first moved paint and hold hides until the gesture ends.
          paneOcclusionGesture.begin();
          // Now it is a move. A derived pane converts to free pixel geometry
          // here, at the moment the gesture becomes one.
          if (derivedRef.current) {
            const released = releaseImposedFrame(frame, dragCanvasBounds.current);
            dragStartPosition.current = { x: released.x, y: released.y };
          }
        }

        // Always solo card clamping.
        const pos = clampedPosition(
          latestDragPointer.current,
          dragStartPointer.current,
          dragStartPosition.current,
          dragCanvasBounds.current,
          { width: frame.offsetWidth, height: frame.offsetHeight },
          dragZoom,
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
            -IMPOSITION_GAP_PX,
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
            syncGuideElements(dragGuideEls, snapResult.guides, container, dragGuideEdgeOffsets);
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

        // The pointer never travelled, so this was a click on the title bar.
        // Nothing was moved, nothing merges, and nothing is committed — in
        // particular a derived pane keeps the slot or the pin it started with.
        if (!dragMoved.current) {
          // ...and if it was a Cmd-click, that click means "show me what is
          // behind this pane". The same handle the ⌘R chord calls, so there is
          // one opener with several callers rather than several openers. The
          // gesture interpreter's own meta branch already suppressed
          // activation for this press, which is exactly right: the picker
          // opens without raising the pane it was clicked on.
          if (dragStartedWithMeta.current) {
            titleBarRef.current?.revealStack();
          }
          dragStartedWithMeta.current = false;
          dragOtherRects.current = [];
          latestAltKey.current = false;
          lastSnapResult.current = null;
          return;
        }
        dragStartedWithMeta.current = false;

        // Close the occlusion bracket opened at the move latch; the commit
        // below (or the merge's store mutation) recomputes from final
        // geometry through the controller's store subscription.
        paneOcclusionGesture.end();

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
          dragZoom,
        );

        // Apply snapped position if snap was active at drop.
        const snapResult = lastSnapResult.current;
        const finalPos = {
          x: snapResult && snapResult.x !== null ? snapResult.x : clampedPos.x,
          y: snapResult && snapResult.y !== null ? snapResult.y : clampedPos.y,
        };

        frame.style.left = `${finalPos.x}px`;
        frame.style.top = `${finalPos.y}px`;

        // A dragged pane leaves its slot: the explicit gesture wins, and the
        // dropped rect becomes its free geometry. Resize never passes this.
        onCardMoved(
          id,
          finalPos,
          { width: frame.offsetWidth, height: frame.offsetHeight },
          derivedRef.current ? { evictSlot: true } : undefined,
        );

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

      // Snapshot canvas bounds and other card rects for resize snapping. [D04]
      // Snap geometry runs in layout space; divide visual measurements by zoom.
      const resizeZoom = getTugZoom() || 1;
      const resizeGuideEdgeOffsets = measureGuideEdgeOffsets(frame, resizeZoom);
      const resizeCanvasBounds = frame.parentElement?.getBoundingClientRect() ?? null;

      // Resizing releases an imposed pane from its slot, exactly as dragging
      // does — and on the same terms: only once the pointer has travelled far
      // enough for the gesture to be a resize rather than a click. Until the
      // latch below sets, nothing here has written to the frame, so the
      // release's measurement at latch time sees the same rect it would have
      // seen at pointer-down.
      let resizeMoved = false;
      let released: { x: number; y: number; width: number; height: number } | null = null;
      let startLeft = position.x;
      let startTop = position.y;
      let startW = size.width;
      let startH = size.height;
      const resizeOtherCardRects = snapshotCardRects(resizeCanvasBounds, id, resizeZoom);
      const resizeOtherRects = resizeOtherCardRects.map((r) => r.rect);

      const latestResizePointer = { x: startX, y: startY };
      let latestResizeModifier = event.nativeEvent.altKey;
      let resizeRafId: number | null = null;
      let resizeActive = true;

      /**
       * Answer whether the gesture has become a resize, latching it the first
       * time the pointer travels past the threshold. A derived pane converts to
       * free pixel geometry at that moment, and the machine re-seeds from the
       * measurement rather than from stale stored geometry.
       */
      function latchResizeMove(pointer: { x: number; y: number }): boolean {
        if (resizeMoved) return true;
        const travelled = Math.hypot(pointer.x - startX, pointer.y - startY);
        if (travelled < DRAG_MOVE_THRESHOLD_PX) return false;
        resizeMoved = true;
        // A shrinking edge exposes what this frame was covering, without a
        // store commit; reveal occluded panes now and hold hides until the
        // gesture ends.
        paneOcclusionGesture.begin();
        if (derivedRef.current) {
          const frozen = releaseImposedFrame(frame, resizeCanvasBounds);
          released = frozen;
          startLeft = frozen.x;
          startTop = frozen.y;
          startW = frozen.width;
          startH = frozen.height;
        }
        return true;
      }

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
          resizeZoom,
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
          const snapResult = computeResizeSnap(resizingEdges, resizeOtherRects, -IMPOSITION_GAP_PX);

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
            syncGuideElements(resizeGuideEls, snapResult.guides, container, resizeGuideEdgeOffsets);
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
        if (!latchResizeMove(latestResizePointer)) return;
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

        // The pointer never travelled, so this was a click on a resize handle.
        // Nothing was resized and nothing is committed — in particular a
        // derived pane keeps the slot or the pin it started with. The handles
        // overhang the frame into the imposition gap, so a stray click on the
        // seam between two imposed cards is easy to make; committing here
        // would evict a card from its slot at a pixel-identical rect, and the
        // arrangement would only visibly break at the next canvas change.
        if (!latchResizeMove({ x: e.clientX, y: e.clientY })) {
          clearGuideElements(resizeGuideEls);
          return;
        }

        // Close the occlusion bracket opened at the move latch.
        paneOcclusionGesture.end();

        // Compute final resize with snap applied first, THEN clear guides. [D03]
        const r = computeAndApplyResize({ x: e.clientX, y: e.clientY }, e.altKey);
        clearGuideElements(resizeGuideEls);
        frame.style.left = `${r.left}px`;
        frame.style.top = `${r.top}px`;
        frame.style.width = `${r.width}px`;
        frame.style.height = `${r.height}px`;

        // A resized pane leaves its slot, on the same footing as a dragged one:
        // any manual geometry gesture releases the pane, and there is no
        // control that does it any other way.
        onCardMoved(
          id,
          { x: r.left, y: r.top },
          { width: r.width, height: r.height },
          released !== null ? { evictSlot: true } : undefined,
        );
      }

      frame.addEventListener("pointermove", onPointerMove);
      frame.addEventListener("pointerup", onPointerUp);
    },
    // minSizeRef.current is always current; position/size are start values read at resize-start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, onCardMoved, position.x, position.y, size.width, size.height],
  );

  // Deck-facing-edge resize for the pinned Lens. It stays pinned to its
  // side, so only its width changes. For a right-side Lens the exposed edge
  // is the west one (dragging left grows it); for a left-side Lens it is the
  // east edge (dragging right grows it). Width-only keeps the derived pin
  // intact (the generic handler would set left/top, fighting it). The commit
  // writes `size.width` to the pane; the reopen-width mirror to `lensStore`
  // lives in the deck manager's card-moved handler, keeping this pane
  // lens-agnostic.
  //
  // The width is written as `LENS_WIDTH_PROPERTY` on the frames' container
  // rather than onto this frame, because the width is not this frame's alone:
  // a right-side Lens is pinned by an expression that SUBTRACTS its width from
  // the canvas, and the band the cards ride is inset by it. Writing the frame's
  // own `width` moves only the dragged edge's box and leaves those two
  // expressions on the width the last render baked in — the Lens's pinned edge
  // walks off the deck edge it is supposed to hold, and the cards do not learn
  // the rail moved until pointer-up. One property write feeds all three, and
  // the browser resolves them together: the pinned edge holds and the
  // arrangement re-imposes under the moving edge, live ([L06]).
  //
  // The exposed edge snaps with Option held, exactly like any other pane
  // edge: the Lens is the moving side and every other pane is a snap target.
  // Those targets are re-measured per frame rather than snapshotted at gesture
  // start — under live re-imposition a card's edge moves as the Lens grows, and
  // a guide drawn from a start-of-gesture rect would mark an alignment that is
  // no longer there. [D01, D03, D04]
  const handleSidebarResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!frameRef.current) return;
      if (sidebarSide === undefined) return;
      const frame: HTMLDivElement = frameRef.current;
      const container = frame.parentElement;
      if (!container) return;

      const widthProperty = sidebarWidthProperty(sidebarSide);
      const zoom = getTugZoom() || 1;
      const startClientX = event.clientX;
      const startWidth = size.width;
      const minWidth = sizePolicy.min.width;
      const maxWidth = Math.max(
        minWidth,
        window.innerWidth - LENS_MIN_GUTTER_PX,
      );
      // A left rail's deck edge faces right (east): rightward motion
      // grows it. A right rail's deck edge faces left (west): leftward
      // motion grows it.
      const growSign = sidebarSide === "left" ? 1 : -1;

      // The pinned edge is measured rather than derived from `position`, which
      // the pinned Lens does not use. It is a fixed number for the gesture:
      // the deck edge the Lens holds is the one thing this drag may not move.
      const canvasBounds = container.getBoundingClientRect();
      const guideEdgeOffsets = measureGuideEdgeOffsets(frame, zoom);
      const frameRect = frame.getBoundingClientRect();
      const canvasLeft = canvasBounds.left;
      const pinnedEdge =
        sidebarSide === "left"
          ? (frameRect.left - canvasLeft) / zoom
          : (frameRect.right - canvasLeft) / zoom;

      frame.setPointerCapture(event.pointerId);
      frame.setAttribute("data-gesture", "resize");

      let width = startWidth;
      let latestX = startClientX;
      let latestAlt = event.altKey;
      let rafId: number | null = null;
      let lensResizeMoved = false;

      // The deck-facing edge is a handle like any other: under the move
      // threshold the press is a click, which states no width and commits
      // nothing.
      const latchSidebarResizeMove = (clientX: number): boolean => {
        if (lensResizeMoved) return true;
        if (Math.abs(clientX - startClientX) < DRAG_MOVE_THRESHOLD_PX) return false;
        lensResizeMoved = true;
        // The Lens is a coverer like any other pane; a shrinking rail
        // exposes what it hid, without a store commit until pointer-up.
        paneOcclusionGesture.begin();
        return true;
      };

      const computeWidth = (): number => {
        // Convert the visual pointer delta to layout space via zoom, then
        // apply the deck-facing grow direction.
        const deltaLayout = (latestX - startClientX) / zoom;
        let next = Math.min(
          maxWidth,
          Math.max(minWidth, startWidth + growSign * deltaLayout),
        );

        if (!latestAlt) {
          clearGuideElements(resizeGuideEls);
          return next;
        }

        // The exposed edge is the only one being resized; the pinned edge
        // never moves, so width follows directly from the snapped edge.
        const exposedEdge = pinnedEdge + growSign * next;
        const snapResult = computeResizeSnap(
          sidebarSide === "left" ? { right: exposedEdge } : { left: exposedEdge },
          snapshotCardRects(canvasBounds, id, zoom).map((r) => r.rect),
          -IMPOSITION_GAP_PX,
        );
        const snapped = sidebarSide === "left" ? snapResult.right : snapResult.left;
        if (snapped !== undefined) {
          next = Math.min(
            maxWidth,
            Math.max(minWidth, growSign * (snapped - pinnedEdge)),
          );
        }

        syncGuideElements(resizeGuideEls, snapResult.guides, container, guideEdgeOffsets);
        return next;
      };

      const apply = (): void => {
        rafId = null;
        if (!latchSidebarResizeMove(latestX)) return;
        width = computeWidth();
        container.style.setProperty(widthProperty, `${width}px`);
      };

      const onPointerMove = (e: PointerEvent): void => {
        latestX = e.clientX;
        latestAlt = e.altKey;
        if (rafId === null) rafId = requestAnimationFrame(apply);
      };

      const onPointerUp = (e: PointerEvent): void => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        frame.removeEventListener("pointermove", onPointerMove);
        frame.removeEventListener("pointerup", onPointerUp);
        frame.releasePointerCapture(e.pointerId);
        frame.removeAttribute("data-gesture");
        latestX = e.clientX;
        latestAlt = e.altKey;
        if (!latchSidebarResizeMove(latestX)) {
          clearGuideElements(resizeGuideEls);
          return;
        }
        // Close the occlusion bracket opened at the move latch.
        paneOcclusionGesture.end();
        // Final width with snap applied, THEN clear the guides. [D03]
        width = computeWidth();
        clearGuideElements(resizeGuideEls);
        // The property stays as the gesture left it. The commit re-renders the
        // Lens at this width and `DeckCanvas` writes the same number back, so
        // there is no frame where the deck reads the pre-gesture width.
        container.style.setProperty(widthProperty, `${width}px`);
        onCardMoved(id, position, { width, height: size.height });
      };

      frame.addEventListener("pointermove", onPointerMove);
      frame.addEventListener("pointerup", onPointerUp);
    },
    [
      id,
      onCardMoved,
      position,
      size.width,
      size.height,
      sizePolicy.min.width,
      sidebarSide,
    ],
  );


  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Persisted size can predate the current floor — a card kind
  // raised its policy `min`, or a wider sibling joined the stack, so
  // the stored width/height may sit below `minSize`. Clamp the
  // rendered frame up to the floor: the pane paints at its true
  // minimum immediately, and the next move or resize commits the
  // corrected size back to the store.
  const renderWidth = Math.max(size.width, minSize.width);
  const frameHeight = Math.max(size.height, minSize.height);

  // A card whose policy pins an axis — `min === max`, which is how a
  // registration says "exactly one correct size" — is PLACED by the imposition
  // rather than sized by it: no resize handle offers to change that dimension,
  // so the imposer must not change it either. The declaration is already in the
  // registry, so nothing new has to be declared to opt in. A policy with no
  // `max` is unbounded above and therefore never pinned.
  //
  // The pinned axes travel together into `imposeStyle`, which needs both to
  // separate the slot from the frame: the slot is an ordinary content card's
  // box, and the pinned card is centred inside it (see `PinnedFrame`).
  const widthPinned = sizePolicy.max?.width === sizePolicy.min.width;
  const heightPinned = sizePolicy.max?.height === sizePolicy.min.height;
  const pinnedFrame: PinnedFrame | undefined =
    widthPinned || heightPinned
      ? {
          ...(widthPinned ? { width: renderWidth } : {}),
          ...(heightPinned ? { height: frameHeight } : {}),
        }
      : undefined;
  // A width-pinned card's slot is the deck's content width, not its own — but
  // never narrower than the card, or the slot would sit inside the frame.
  const slotWidth =
    widthPinned && contentWidthPx !== undefined
      ? Math.max(contentWidthPx, renderWidth)
      : renderWidth;

  // The width control, on content-role panes only: a rail takes its width from
  // the allocator, so a preset there would be overwritten by the next solve.
  // Dispatched as a command rather than called on the store ([L30]).
  const handleSetWidth = useCallback(
    (preset: ContentWidth) => {
      dispatchCommand(TUG_ACTIONS.SET_CARD_WIDTH, { paneId: id, preset });
    },
    [id],
  );

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
      {...(isLensPane ? { "data-lens-pane": "" } : {})}
      {...(sidebarSide !== undefined ? { "data-lens": sidebarSide } : {})}
      {...(imposed && placement !== undefined
        ? { "data-imposed": String(placement.slot) }
        : {})}
      data-stack-depth={String(slotStack.length)}
      style={{
        position: "absolute",
        // Three geometry modes. A pinned sidebar holds one side of the canvas
        // a gap in, runs the canvas height less a gap top and the deeper gap
        // at the bottom, and takes only its width from the store. An imposed
        // pane pins to its place in the imposition chain over the same
        // vertical run, also taking only its width from the store — unless it
        // is size-locked, in which case the slot is an ordinary content card's
        // box and the pane is centred inside it. A free pane uses its stored
        // left/top/width/height. [L06]/[L09]
        ...(sidebarSide !== undefined
          ? imposeSidebarStyle(sidebarSide, renderWidth)
          : imposed && placement !== undefined
            ? imposeStyle(placement, slotWidth, pinnedFrame)
            : {
                left: position.x,
                top: position.y,
                width: renderWidth,
                height: frameHeight,
              }),
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
      {/* Resize handles. A pinned sidebar exposes only its deck-facing edge
          (west for a right-side rail, east for a left-side one).
          Everything else exposes all eight, imposed or not: resizing an imposed
          pane releases it from its slot, so there is no edge it needs to be
          protected from. */}
      {sidebarSide !== undefined ? (
        <>
          <div
            className={`tug-pane-resize tug-pane-resize-${sidebarSide === "left" ? "e" : "w"}`}
            onPointerDown={handleSidebarResizeStart}
          />
        </>
      ) : (
        RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className={`tug-pane-resize tug-pane-resize-${edge}`}
            onPointerDown={(e) => handleResizeStart(edge, e)}
          />
        ))
      )}

      <TugPaneFrameContext value={frameEl}>
      <TugPanePortalContext value={cardEl}>
        <div
          ref={rootRefCallback}
          className="tug-pane-chrome"
          data-slot="tug-pane"
          data-pane-id={stackId}
        >
          <CardTitleBar
            ref={titleBarRef}
            title={displayTitle}
            icon={effectiveMeta.icon}
            closable={closable}
            {...(sidebarSide === undefined
              ? {
                  widthPreset: stackState.widthPreset ?? null,
                  onSetWidth: handleSetWidth,
                }
              : {})}
            cardCount={cards?.length ?? 1}
            resolveCloseGuard={resolveCloseGuard}
            confirmClose={paneConfirmClose}
            activeCardId={activeCardId}
            slotStack={slotStack}
            onRevealPane={onRevealPane}
            onClose={handleTitleBarClose}
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
  zoom = 1,
): { x: number; y: number } {
  // startPosition/frameSize are layout pixels; pointer is visual (client) pixels.
  // Convert the pointer delta to layout space so the card tracks the cursor 1:1
  // at any zoom, and clamp against layout-space canvas extents.
  let x = startPosition.x + (pointer.x - startPointer.x) / zoom;
  let y = startPosition.y + (pointer.y - startPointer.y) / zoom;

  if (canvasBounds) {
    const canvasWidth = canvasBounds.width / zoom;
    const canvasHeight = canvasBounds.height / zoom;
    // Left/right: card can hang off either side, but TITLE_BAR_VISIBLE_MIN_X must stay visible.
    x = Math.max(-(frameSize.width - TITLE_BAR_VISIBLE_MIN_X),
                 Math.min(x, canvasWidth - TITLE_BAR_VISIBLE_MIN_X));
    // Top: title bar stays at or below CANVAS_PADDING (matches resize top constraint).
    // Bottom: at least TITLE_BAR_VISIBLE_MIN_Y of title bar stays visible.
    y = Math.max(CANVAS_PADDING, Math.min(y, canvasHeight - TITLE_BAR_VISIBLE_MIN_Y));
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
  zoom = 1,
): { left: number; top: number; width: number; height: number } {
  // start*/sizes are layout pixels; pointer is visual (client) pixels. Convert
  // the pointer delta to layout so the edge tracks the cursor 1:1 at any zoom.
  const dx = (pointer.x - startPointer.x) / zoom;
  const dy = (pointer.y - startPointer.y) / zoom;

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
    const maxRight = canvasBounds.width / zoom - CANVAS_PADDING;
    const maxBottom = canvasBounds.height / zoom - CANVAS_PADDING;

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
