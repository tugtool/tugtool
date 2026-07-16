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
import { ChevronDown, ChevronUp, MoreHorizontal, X, icons } from "lucide-react";
import type { CardState, TugPaneState } from "@/layout-tree";
import type { CardMeta, CardSizePolicy } from "@/card-registry";
import { DEFAULT_SIZE_POLICY, getRegistration } from "@/card-registry";
import { computeSnap, computeResizeSnap } from "@/snap";
import type { Rect, GuidePosition, SnapResult } from "@/snap";
import { getTugZoom } from "@/components/tugways/scale-timing";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { useRequiredResponderChain } from "@/components/tugways/responder-chain-provider";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { useDeckManager } from "@/deck-manager-context";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugConfirmPopover } from "@/components/tugways/tug-confirm-popover";
import { CardPathMenu } from "@/components/chrome/card-path-menu";
import { cardTitleStore } from "@/lib/card-title-store";
import { paneTitleBarMenuStore } from "@/lib/pane-title-bar-menu-store";
import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import {
  getCardCloseGuard,
  type CardCloseDecision,
} from "@/lib/card-close-guard";
import {
  resolveCardResourcePath,
  type CardResourcePath,
} from "@/lib/card-resource-path";
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
}

export interface CardTitleBarProps {
  title: string;
  icon?: string;
  closable?: boolean;
  collapsed: boolean;
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
   * Resolve the filesystem resource the active card is bound to, for
   * the Cmd-click title path menu. Returns null when the card has no
   * resource (the menu then doesn't open). Called live at click time so
   * a re-bound path is always current.
   */
  resolveResourcePath?: () => CardResourcePath | null;
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
  resolveResourcePath,
  resolveCloseGuard,
  confirmClose = false,
  activeCardId,
  onCollapse,
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
      // Cmd-click opens the path menu (handled on the title group's
      // click); never arm a drag for it. Pane activation already ignores
      // metaKey (pane-focus-controller), so this leaves the gesture free.
      if (event.metaKey) return;
      onDragStart?.(event);
    },
    [onDragStart],
  );

  // Cmd-click title path menu (Finder-style). Anchored to the title
  // group via a virtual ref, controlled open. The resource is captured
  // at click time so a re-bound path is always current.
  const [pathMenuOpen, setPathMenuOpen] = useState(false);
  const [pathResource, setPathResource] = useState<CardResourcePath | null>(null);
  const titleGroupRef = useRef<HTMLSpanElement | null>(null);

  const handleTitleClick = useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      if (!event.metaKey) return;
      const resource = resolveResourcePath?.() ?? null;
      if (resource === null) return;
      event.preventDefault();
      event.stopPropagation();
      setPathResource(resource);
      setPathMenuOpen(true);
    },
    [resolveResourcePath],
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
  }), [confirmClose, onClose, openCloseConfirm, paneCloseIntent, withCloseDecision]);

  const handleCollapsePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );

  const handleCollapseClick = useCallback(() => {
    // While the close-confirm popover is showing, the chevron just dismisses
    // it (same as a title-bar click) rather than collapsing the card.
    if (closeOpen) {
      setCloseOpen(false);
      return;
    }
    onCollapse();
  }, [closeOpen, onCollapse]);

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
      {/* Icon + title as one Cmd-click target for the path menu. Plain
          click falls through to drag/activation as before. */}
      <span
        ref={titleGroupRef}
        className="tug-pane-title-group"
        onClick={handleTitleClick}
      >
        {IconComponent && (
          <span className="tug-pane-icon" data-testid="tug-pane-icon">
            {React.createElement(IconComponent)}
          </span>
        )}

        <span className="tug-pane-title" data-testid="tug-pane-title">
          {title}
        </span>
      </span>

      <CardPathMenu
        open={pathMenuOpen}
        anchorRef={titleGroupRef}
        resource={pathResource}
        onOpenChange={setPathMenuOpen}
      />

      <div className="tug-pane-title-bar-controls" data-testid="tug-pane-title-bar-controls">
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
  // Anchored rails are excluded from snap targets — a free pane must
  // never snap its edge to the Lens.
  const els = document.querySelectorAll<HTMLElement>(
    ".tug-pane[data-pane-id]:not([data-anchored])",
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

// ---------------------------------------------------------------------------
// Snap gap configuration
//
// Gap in pixels between adjacent card edges when snapping. Positive values
// keep cards visually separated. Set to 0 for flush edges.
// ---------------------------------------------------------------------------

const SNAP_GAP_PX = 5;

/**
 * Width of a snap guide line in layout px. Must match the `border` width on
 * `.snap-guide-line-x` / `.snap-guide-line-y` in chrome.css so a right/bottom-edge
 * guide can be pulled back by exactly one line width to sit on the card's edge.
 */
const SNAP_GUIDE_LINE_PX = 2;

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

// Gutter reserved on the deck side so an anchored rail can't be widened
// to cover the whole viewport. The effective max width is
// `window.innerWidth - this`.
const ANCHORED_MIN_GUTTER_PX = 80;

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
  // An anchored pane derives its geometry from the anchor edge (a
  // left- or right-edge rail) instead of a free position: it is
  // non-draggable, resizable only on its exposed (deck-facing) edge, and
  // excluded from snap and merge. The pane still owns geometry per [L09];
  // it merely computes it from `anchor` rather than `position`.
  const anchorSide =
    stackState.anchor === "left" || stackState.anchor === "right"
      ? stackState.anchor
      : null;
  const anchored = anchorSide !== null;
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
      // before discarding an opt-in card (e.g. the Dev card), remove
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

  // When the deck is deselected (a canvas-background click cleared the active
  // card), a previous/next-card command lands on this pane's TugPane if its
  // card is still the stale chain first responder. There is nothing to
  // navigate to — so re-activate the pane's card instead, restoring its
  // active state. Returns true when it acted. A no-op when a card is already
  // active (the normal navigation runs).
  const reactivateIfDeselected = useCallback((): boolean => {
    if (store.getSnapshot().activePaneId !== undefined) return false;
    const activeId = activeCardIdRef.current;
    if (!activeId) return false;
    transferFocusForActivation({
      outgoingCardId: null,
      incomingCardId: activeId,
      store,
      commitMutation: () => store.activateCard(activeId),
    });
    return true;
  }, [store]);

  const handlePreviousTab = useCallback(() => {
    if (reactivateIfDeselected()) return;
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
  }, [manager, keyboardTabNavSenderId, reactivateIfDeselected]);

  const handleNextTab = useCallback(() => {
    if (reactivateIfDeselected()) return;
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
  }, [manager, keyboardTabNavSenderId, reactivateIfDeselected]);

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

  // Single-flight latch for the tab-× close guard, so a double-click on a
  // tab's × doesn't stack two sheets.
  const closeTabGuardRunningRef = useRef(false);

  const { ResponderScope, responderRef } = useResponder({
    id: stackId,
    kind: "card",
    actions: {
      [TUG_ACTIONS.CLOSE]: (_event: ActionEvent) => handleChromeClose(),
      [TUG_ACTIONS.CLOSE_ALL]: (_event: ActionEvent) => handleCloseAll(),
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
        const targetId = event.value;
        // The tab × is a close gesture like the pane X — it must honour the
        // target card's close guard rather than destroy a dirty manual File
        // card silently. A card that opts out (e.g. the Dev card's
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

  // Per-card title override (cardTitleStore). When a card publishes an
  // override (e.g. the Dev card publishes its bound project path once a
  // session is picked), the title bar composes it as
  // `"<base> : <override>"`. A card with no static base title (e.g. the
  // About card, whose title *is* its dynamic identity) declares an
  // empty registry title, and the override then stands alone as the
  // whole title. Subscription is keyed on the active card so a card
  // swap repaints the title without prop drill.
  const activeCardTitleOverride = useSyncExternalStore(
    cardTitleStore.subscribe,
    useCallback(
      () => cardTitleStore.get(activeCardId ?? null),
      [activeCardId],
    ),
  );

  // Resolve the active card's bound resource for the Cmd-click title
  // path menu. Read live at click time (paths re-bind), keyed on the
  // active card id — Dev card → project dir, Text card → edited file.
  const resolveResourcePath = useCallback(
    () => resolveCardResourcePath(activeCardId ?? null),
    [activeCardId],
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

  const baseTitle = cardTitle
    ? `${cardTitle} : ${effectiveMeta.title}`
    : effectiveMeta.title;
  const displayTitle = activeCardTitleOverride
    ? baseTitle
      ? `${baseTitle} : ${activeCardTitleOverride}`
      : activeCardTitleOverride
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
      dragStartPosition.current = { x: position.x, y: position.y };
      latestDragPointer.current = { x: event.clientX, y: event.clientY };

      // Build tab bar cache for merge hit-testing. [D45]
      // Snapshot all .tug-tab-bar[data-pane-id] elements (excluding this pane).
      dragTabBarCache.current = [];
      const barEls = document.querySelectorAll<HTMLElement>(".tug-tab-bar[data-pane-id]");
      barEls.forEach((el) => {
        const paneId = el.getAttribute("data-pane-id");
        if (!paneId || paneId === id) return;
        // Anchored rails never accept a merge — skip their tab bar as a
        // drop target.
        if (el.closest(".tug-pane[data-anchored]")) return;
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

        // While collapsed, the frame's live height is the window-shade height
        // (CARD_TITLE_BAR_HEIGHT + border), not the card's real height. Committing
        // `frame.offsetHeight` here would overwrite the stored expanded height with
        // the collapsed stub, so the card could never be restored. Preserve the
        // stored `size.height` for a collapsed drag; only the position changes.
        const committedHeight = collapsed ? size.height : frame.offsetHeight;
        onCardMoved(id, finalPos, { width: frame.offsetWidth, height: committedHeight });

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
    // `collapsed`/`size.height` are read at commit to preserve the stored height
    // across a collapsed-card drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, onCardMoved, onCardMerged, activeCardId, position.x, position.y, store, collapsed, size.height],
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
      // Snap geometry runs in layout space; divide visual measurements by zoom.
      const resizeZoom = getTugZoom() || 1;
      const resizeGuideEdgeOffsets = measureGuideEdgeOffsets(frame, resizeZoom);
      const resizeCanvasBounds = frame.parentElement?.getBoundingClientRect() ?? null;
      const resizeOtherCardRects = snapshotCardRects(resizeCanvasBounds, id, resizeZoom);
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

  // Deck-facing-edge resize for an anchored rail. The rail stays pinned
  // to its viewport edge, so only its width changes. For a right-anchored
  // rail the exposed edge is the west one (dragging left grows it); for a
  // left-anchored rail it is the east edge (dragging right grows it).
  // Width-only keeps the derived edge anchoring intact (the generic
  // handler would set left/top, fighting the anchor). The commit writes
  // `size.width` to the pane; the anchored reopen-width mirror to
  // `lensStore` lives in the deck manager's card-moved handler, keeping
  // this pane lens-agnostic.
  const handleAnchoredResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!frameRef.current) return;
      const frame: HTMLDivElement = frameRef.current;

      const zoom = getTugZoom() || 1;
      const startClientX = event.clientX;
      const startWidth = size.width;
      const minWidth = sizePolicy.min.width;
      const maxWidth = Math.max(
        minWidth,
        window.innerWidth - ANCHORED_MIN_GUTTER_PX,
      );
      // A left rail's deck edge faces right (east): rightward motion
      // grows it. A right rail's deck edge faces left (west): leftward
      // motion grows it.
      const growSign = anchorSide === "left" ? 1 : -1;

      frame.setPointerCapture(event.pointerId);
      frame.setAttribute("data-gesture", "resize");

      let width = startWidth;
      let latestX = startClientX;
      let rafId: number | null = null;

      const apply = (): void => {
        rafId = null;
        // Convert the visual pointer delta to layout space via zoom, then
        // apply the deck-facing grow direction.
        const deltaLayout = (latestX - startClientX) / zoom;
        const next = Math.min(
          maxWidth,
          Math.max(minWidth, startWidth + growSign * deltaLayout),
        );
        width = next;
        frame.style.width = `${next}px`;
      };

      const onPointerMove = (e: PointerEvent): void => {
        latestX = e.clientX;
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
        apply();
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
      anchorSide,
    ],
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
      {...(anchorSide ? { "data-anchored": anchorSide } : {})}
      {...(effectiveMeta.squareCorners ? { "data-square-corners": "true" } : {})}
      style={{
        position: "absolute",
        // An anchored rail pins to its viewport edge (left or right),
        // spans the full height, and takes only its width from the store.
        // A free pane uses its stored left/top/width/height. [L06]/[L09]
        ...(anchored
          ? {
              ...(anchorSide === "left" ? { left: 0 } : { right: 0 }),
              top: 0,
              bottom: 0,
              width: renderWidth,
            }
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
      {/* Resize handles -- hidden when collapsed; drag remains active [D07].
          An anchored rail exposes only its deck-facing edge (west for a
          right rail, east for a left rail); a free pane exposes all eight. */}
      {!collapsed &&
        (anchored ? (
          <div
            className={`tug-pane-resize tug-pane-resize-${anchorSide === "left" ? "e" : "w"}`}
            onPointerDown={handleAnchoredResizeStart}
          />
        ) : (
          RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className={`tug-pane-resize tug-pane-resize-${edge}`}
              onPointerDown={(e) => handleResizeStart(edge, e)}
            />
          ))
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
            resolveResourcePath={resolveResourcePath}
            resolveCloseGuard={resolveCloseGuard}
            confirmClose={paneConfirmClose}
            activeCardId={activeCardId}
            onCollapse={handleFrameCollapseToggle}
            onClose={handleTitleBarClose}
            onDragStart={anchored ? undefined : handleDragStart}
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
