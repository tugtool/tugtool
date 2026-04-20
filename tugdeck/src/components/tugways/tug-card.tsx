/**
 * Tugcard — composition root for card chrome and responder integration.
 *
 * Visual stack:
 * ```
 * CardFrame (absolute positioning, drag handles, resize handles)
 *   └─ Tugcard (flex column)
 *        ├─ CardTitleBar (title + icon + close button)
 *        ├─ Accessory slot (TugTabBar when tabs.length > 1, else 0px)
 *        └─ Content area (flex-grow, overflow auto)
 *             └─ children (active tab content or single card content)
 * ```
 *
 * Renders header chrome (title, icon, controls), tab management when
 * multi-tab, responder node registration, selection boundary, and
 * persistence (scroll/selection/content state save/restore on tab switch).
 *
 * Laws: [L06] appearance via CSS/DOM, [L09] card composition, [L19] component authoring guide
 * Decisions: [D01] Tugcard composition, [D03] CardFrame/Tugcard separation, [D07] responder node
 *
 * @module components/tugways/tug-card
 */

import "./tug-card.css";
import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Ellipsis, X, icons } from "lucide-react";
import type { FeedIdValue } from "../../protocol";
import type { TabItem } from "../../layout-tree";
import { getRegistration } from "../../card-registry";
import { useResponder } from "./use-responder";
import type { ActionEvent } from "./responder-chain";
import { TUG_ACTIONS } from "./action-vocabulary";
import { useSelectionBoundary } from "./hooks/use-selection-boundary";
import { useRequiredResponderChain } from "./responder-chain-provider";
import { TugTabBar } from "./tug-tab-bar";
import { useDeckManager } from "../../deck-manager-context";
import { TugButton } from "./internal/tug-button";
import * as cardContentRegistry from "../chrome/card-content-registry";
import * as stackRootRegistry from "../chrome/stack-root-registry";

// ===========================================================================
// CardTitleBar
// ===========================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Height of the card title bar in pixels. Must match --tug-chrome-height.
 * Used for collapsed-height calculation in CardFrame.
 */
export const CARD_TITLE_BAR_HEIGHT = 36;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for the CardTitleBar component.
 */
export interface CardTitleBarProps {
  /** Display title for the card title bar. */
  title: string;
  /** Lucide icon name. Renders the icon via lucide-react lookup when provided. */
  icon?: string;
  /**
   * Whether to show the close button.
   * @default true
   */
  closable?: boolean;
  /**
   * Whether the card is currently collapsed.
   * @selector [aria-expanded]
   */
  collapsed: boolean;
  /** Called when the collapse/expand button is clicked or title bar is double-clicked. */
  onCollapse: () => void;
  /** Called when the close button fires (pointer-up-inside or keyboard Enter/Space). */
  onClose?: () => void;
  /** Called on title bar pointer-down to initiate card drag. */
  onDragStart?: (event: React.PointerEvent) => void;
}

// ---------------------------------------------------------------------------
// CardTitleBar
// ---------------------------------------------------------------------------

/**
 * CardTitleBar -- title bar with collapse, close, and menu controls.
 */
export function CardTitleBar({
  title,
  icon,
  closable = true,
  collapsed,
  onCollapse,
  onClose,
  onDragStart,
}: CardTitleBarProps) {
  // ---------------------------------------------------------------------------
  // Title bar drag handler (forwarded from CardFrame via Tugcard)
  // ---------------------------------------------------------------------------

  const handleTitleBarPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Do not initiate drag when clicking a control button.
      const target = event.target as HTMLElement;
      if (target.closest(".tug-button")) return;
      onDragStart?.(event);
    },
    [onDragStart],
  );

  // ---------------------------------------------------------------------------
  // Double-click to toggle collapse
  // ---------------------------------------------------------------------------

  const handleTitleBarDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      // Ignore double-clicks on control buttons.
      if (target.closest(".tug-button")) return;
      onCollapse();
    },
    [onCollapse],
  );

  // ---------------------------------------------------------------------------
  // Close button -- pointer-capture pattern
  //
  // pointerdown: capture the pointer to suppress browser focus/selection side
  // effects (Mac-like close button behavior). stopPropagation prevents
  // bring-to-front; preventDefault prevents focus/selection shift.
  //
  // pointerup: hit-test against the button bounds; fire onClose only on
  // confirmed pointer-up-inside.
  //
  // click: keyboard fallback (Enter/Space).
  //
  // Note: pointer capture may conflict with Radix Popover's focus management
  // if this button is ever wrapped in a confirm popover. Verify that pointer
  // capture is released before the popover opens, or switch to a standard
  // click handler.
  // ---------------------------------------------------------------------------

  const handleClosePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation(); // prevent bring-to-front
      event.preventDefault(); // prevent focus/selection shift
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

  const handleCloseClick = useCallback(
    () => {
      onClose?.();
    },
    [onClose],
  );

  // ---------------------------------------------------------------------------
  // Collapse button
  // ---------------------------------------------------------------------------

  const handleCollapsePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation(); // prevent drag start
    },
    [],
  );

  const handleCollapseClick = useCallback(
    () => {
      onCollapse();
    },
    [onCollapse],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Resolve lucide icon component for card title icon (dynamic, varies by card type).
  const IconComponent =
    icon && icons[icon as keyof typeof icons]
      ? icons[icon as keyof typeof icons]
      : null;

  return (
    <div
      className="tugcard-title-bar"
      data-slot="tug-card-title-bar"
      onPointerDown={handleTitleBarPointerDown}
      onDoubleClick={handleTitleBarDoubleClick}
      data-testid="tugcard-title-bar"
    >
      {/* Icon — size controlled by .tugcard-icon CSS */}
      {IconComponent && (
        <span className="tugcard-icon" data-testid="tugcard-icon">
          {React.createElement(IconComponent)}
        </span>
      )}

      {/* Title */}
      <span className="tugcard-title" data-testid="tugcard-title">
        {title}
      </span>

      {/* Control buttons — ghost icon buttons */}
      <div className="card-title-bar-controls" data-testid="card-title-bar-controls">
        {/* Menu button (leftmost) */}
        <TugButton
          subtype="icon"
          emphasis="ghost"
          role="action"
          size="sm"
          icon={<Ellipsis />}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          aria-label="Card menu"
          data-testid="card-title-bar-menu-button"
        />

        {/* Collapse/expand chevron (middle) */}
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
          data-testid="card-title-bar-collapse-button"
        />

        {/* Close button (rightmost) */}
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
            data-testid="tugcard-close-button"
          />
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Tugcard
// ===========================================================================

// ===========================================================================
// TugcardPortalContext
// ===========================================================================

/**
 * Provides the Tugcard root DOM element to descendants that need to portal
 * into the card element (e.g., TugSheetContent).
 *
 * The context value is set via a ref callback on the root div — it becomes
 * non-null after mount. Children inside the card div read this context to
 * obtain the portal target (a sibling of .tugcard-body, not a child of it).
 *
 * null before mount or when rendered outside a Tugcard.
 */
export const TugcardPortalContext = createContext<HTMLDivElement | null>(null);

// ===========================================================================
// TugcardDirtyContext — contentchange mechanism
// ===========================================================================

// ---------------------------------------------------------------------------
// TugcardDirtyContext — contentchange mechanism
// ---------------------------------------------------------------------------

/**
 * Context provided by Tugcard to card content components.
 *
 * Card content calls `markDirty()` when its internal state changes in a way
 * worth persisting (e.g. form values, tree expand state, sort order). Tugcard
 * debounces the signal and saves the current tab state to tugbank.
 *
 * null when rendered outside a Tugcard.
 */
export const TugcardDirtyContext = createContext<(() => void) | null>(null);

/**
 * Hook for card content to signal a state change worth persisting.
 *
 * Returns a stable `markDirty` function. Calling it triggers a debounced
 * save of scroll, selection, and card content state to tugbank. No-op
 * outside a Tugcard.
 */
export function useTugcardDirty(): () => void {
  const markDirty = useContext(TugcardDirtyContext);
  return markDirty ?? noop;
}

function noop(): void {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Card metadata controlling default appearance and behavior.
 */
export interface TugcardMeta {
  title: string;
  /** Lucide icon name. Rendered via lucide-react lookup when provided. */
  icon?: string;
  /** Whether the card can be closed. Default: true. */
  closable?: boolean;
}

/**
 * Props for the Tugcard composition component.
 */
export interface TugcardProps {
  /** Unique card instance ID. Passed to the responder chain. */
  cardId: string;
  /** Title, optional icon, and closable flag. Overridden by active tab metadata when tabs.length > 1. */
  meta: TugcardMeta;
  /** Feed IDs to subscribe to. Empty array = feedless card (children mount immediately). */
  feedIds: readonly FeedIdValue[];
  /** Custom decode function per feed. Default: JSON parse. */
  decode?: (feedId: FeedIdValue, bytes: Uint8Array) => unknown;
  /**
   * Minimum content area size.
   * Total min-size = 28 (header) + accessory height + minContentSize.
   * Default: `{ width: 100, height: 60 }`.
   */
  minContentSize?: { width: number; height: number };
  /** Top accessory slot. Collapses to 0 when null or undefined. Ignored when tabs.length > 1. */
  accessory?: React.ReactNode | null;
  /** Called by Tugcard when its computed min-size changes. Forwarded from CardFrame. */
  onMinSizeChange?: (size: { width: number; height: number }) => void;
  /** Called by Tugcard header on pointer-down to initiate drag. Forwarded from CardFrame. */
  onDragStart?: (event: React.PointerEvent) => void;
  /** Called when the close action fires. Forwarded from CardFrame via registry factory. */
  onClose?: () => void;
  /**
   * Whether the card is collapsed (title bar only, content hidden).
   * Forwarded from CardState.collapsed via CardFrame.
   * @selector .tugcard--collapsed
   * @default false
   */
  collapsed?: boolean;
  /**
   * Called when the user toggles collapse (chevron click or header double-click).
   * Forwarded from CardFrame which calls store.toggleCardCollapse.
   */
  onCollapse?: () => void;
  /** Card-specific content components. */
  children: React.ReactNode;

  // ---- Tab props ----

  /** All tabs on this card. When provided and length > 1, the tab bar appears. */
  tabs?: TabItem[];
  /** The currently active tab id. Required when tabs is provided. */
  activeTabId?: string;

  /**
   * Card-level title prefix. When non-empty, the header displays
   * `"${cardTitle}: ${effectiveMeta.title}"`. When empty or omitted,
   * the header displays `effectiveMeta.title` alone. [D04]
   */
  cardTitle?: string;
  /**
   * Families of card types to show in the [+] type picker.
   * Forwarded to TugTabBar when the multi-tab accessory is active.
   * Defaults to `["standard"]` when omitted. [D03]
   */
  acceptedFamilies?: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEADER_HEIGHT_PX = 28;
const DEFAULT_MIN_CONTENT: { width: number; height: number } = { width: 100, height: 60 };
const AUTO_SAVE_DEBOUNCE_MS = 1000;

// ---------------------------------------------------------------------------
// Tugcard
// ---------------------------------------------------------------------------

/**
 * Tugcard composition component.
 *
 * Card authors compose card-specific content as children:
 * ```tsx
 * <Tugcard cardId="abc" meta={{ title: "Hello" }} feedIds={[]}>
 *   <HelloContent />
 * </Tugcard>
 * ```
 */
export function Tugcard({
  cardId,
  meta,
  feedIds,
  decode,
  minContentSize = DEFAULT_MIN_CONTENT,
  accessory = null,
  onMinSizeChange,
  onDragStart,
  onClose,
  collapsed = false,
  onCollapse,
  children,
  tabs,
  activeTabId,
  cardTitle,
  acceptedFamilies,
}: TugcardProps) {
  // Access the DeckManager store for tab state read/write.
  const store = useDeckManager();

  // ---------------------------------------------------------------------------
  // Card root element — provided via TugcardPortalContext for portal targets
  // (e.g., TugSheetContent). The ref callback fires after mount and causes
  // one extra render, which is fine — the sheet isn't open on first mount.
  // ---------------------------------------------------------------------------

  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);

  // ---------------------------------------------------------------------------
  // Content area ref (selection boundary)
  // ---------------------------------------------------------------------------

  // Ref to the content area div. Used by:
  //   - useSelectionBoundary: registers this element with SelectionGuard so
  //     selection is contained within card boundaries ([D02], [D03])
  //   - read scrollLeft/scrollTop for tab state capture
  const contentRef = useRef<HTMLDivElement>(null);

  // First-responder promotion is handled centrally by
  // ResponderChainProvider's document-level pointerdown listener,
  // which walks the DOM from the event target looking for
  // data-responder-id. No per-component pointerdown handler is
  // needed — nested responders (e.g. an editor inside this card)
  // naturally win over the card because their data-responder-id is
  // deeper in the DOM tree.
  const manager = useRequiredResponderChain();

  // Gensym'd sender id for keyboard-driven tab switches (previousTab /
  // nextTab handlers below). These handlers dispatch `selectTab` through
  // the chain so keyboard-driven switches are observable in the dispatch
  // log and to `observeDispatch` subscribers — matching the mouse-click
  // and overflow-popup paths. Using a separate sender id (distinct from
  // the tab bar's own) lets observers tell keyboard-driven switches
  // apart from click-driven ones. [L11, Punch #1]
  const keyboardTabNavSenderId = useId();

  // Register the content area as a selection boundary with SelectionGuard.
  // Uses useLayoutEffect (Rule of Tug #3) so the boundary is available when
  // Tugcard's selection-restore useLayoutEffect fires. ([D02])
  useSelectionBoundary(cardId, contentRef);

  // ---------------------------------------------------------------------------
  // Tab state refs (for stable responder actions, Rule of Tug #5)
  // ---------------------------------------------------------------------------

  // Responder actions are registered once at mount via useLayoutEffect inside
  // useResponder. The closures must never go stale. Use refs that are updated
  // every render so the closures always read the current values.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Tab-select side effect: save the OUTGOING tab's state before
  // switching, then commit the new active tab to the store. The outgoing
  // tab's save is triggered via `store.invokeSaveCallback(outgoingTabId)`;
  // each TabContentHost registers its save under its own tabId so the
  // right per-tab bag is captured even when multiple tabs coexist on a
  // card (Piece 1.iii). Called from the `selectTab` chain handler below;
  // also called via dispatch from `previousTab` / `nextTab` handlers, which
  // route through the chain so this side effect runs in exactly one place
  // ([D01], #lifecycle-flow).
  const performSelectCard = useCallback(
    (newTabId: string) => {
      const outgoingTabId = activeTabIdRef.current;
      if (outgoingTabId) {
        store.invokeSaveCallback(outgoingTabId);
      }
      store.setActiveCardInStack(cardId, newTabId);
    },
    [store, cardId],
  );

  // Register this card's content element with the card-content-registry so
  // CardPortal consumers can route their DOM output into it. Used by the
  // portal-based tab-content hosting path (Step 11.6.1a Piece 1). The
  // content area is empty in the React tree after Piece 1.ii — `children`
  // is a `TabContentHost` whose context providers wrap the content factory.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    cardContentRegistry.register(cardId, el);
    return () => {
      cardContentRegistry.unregister(cardId);
    };
  }, [cardId]);

  // Register the card's root element with tab-card-root-registry so
  // TabContentHost (which lives at the deck level in the React tree and
  // therefore cannot see TugcardPortalContext directly) can re-provide
  // that context with the correct element. Re-registered whenever cardEl
  // changes (rootRefCallback's state-setter causes one extra render with
  // the element populated).
  useLayoutEffect(() => {
    if (!cardEl) return;
    stackRootRegistry.register(cardId, cardEl);
    return () => {
      stackRootRegistry.unregister(cardId);
    };
  }, [cardId, cardEl]);

  // ---------------------------------------------------------------------------
  // Responder registration (D07)
  // ---------------------------------------------------------------------------

  const handleClose = useCallback(() => {
    // Multi-tab: close the active tab. Single tab: close the card.
    const currentTabs = tabsRef.current;
    const currentActiveId = activeTabIdRef.current;
    if (currentTabs && currentTabs.length > 1 && currentActiveId) {
      store.removeCard(cardId, currentActiveId);
    } else {
      onClose?.();
    }
  }, [onClose, store, cardId]);

  // selectAll is NOT handled at the card level. Content components
  // (tug-input, tug-textarea, tug-prompt-input, tug-markdown-view)
  // handle selectAll in their own responder registrations, scoping
  // the selection to the focused component. If no content component
  // handles it, the action bubbles past the card — which is correct:
  // there is no "select everything in the card" behavior.

  // previousTab / nextTab: read tabs/active id from refs (closures never
  // go stale, Rule #5), compute the target tab id, and dispatch
  // `selectTab` through the responder chain. The dispatch walks to this
  // same Tugcard responder (single handler invocation, no infinite loop)
  // and runs `performSelectCard` via the `selectTab` action handler
  // below — so the save-state side effect still happens exactly once,
  // AND keyboard-driven switches become observable in the dispatch log
  // and to `observeDispatch` subscribers, matching click-driven and
  // overflow-popup paths. [L11, Punch #1, #lifecycle-flow]
  //
  // Both handlers no-op when there's nothing to switch to.
  const handlePreviousTab = useCallback(() => {
    const currentTabs = tabsRef.current;
    const currentActiveId = activeTabIdRef.current;
    if (!currentTabs || currentTabs.length <= 1 || !currentActiveId) return;
    const idx = currentTabs.findIndex((t) => t.id === currentActiveId);
    if (idx === -1) return;
    const prevIdx = (idx - 1 + currentTabs.length) % currentTabs.length;
    manager.sendToFirstResponder({
      action: TUG_ACTIONS.SELECT_TAB,
      value: currentTabs[prevIdx].id,
      sender: keyboardTabNavSenderId,
      phase: "discrete",
    });
  }, [manager, keyboardTabNavSenderId]);

  const handleNextTab = useCallback(() => {
    const currentTabs = tabsRef.current;
    const currentActiveId = activeTabIdRef.current;
    if (!currentTabs || currentTabs.length <= 1 || !currentActiveId) return;
    const idx = currentTabs.findIndex((t) => t.id === currentActiveId);
    if (idx === -1) return;
    const nextIdx = (idx + 1) % currentTabs.length;
    manager.sendToFirstResponder({
      action: TUG_ACTIONS.SELECT_TAB,
      value: currentTabs[nextIdx].id,
      sender: keyboardTabNavSenderId,
      phase: "discrete",
    });
  }, [manager, keyboardTabNavSenderId]);

  // jumpToTab: ⌘1..⌘9 lookup by 1-based index. The keybinding map
  // carries the index on `KeyBinding.value`, which the capture-phase
  // pipeline copies onto the dispatched ActionEvent. Out-of-range
  // indices (larger than tab count, or a card with no tabs) are a
  // silent no-op — same pattern as previousTab / nextTab. Like the
  // other tab-nav handlers, this re-dispatches `selectTab` through
  // the chain so the save-state side effect in the `selectTab`
  // action handler runs in exactly one place. [A3 / R4, #lifecycle-flow]
  const handleJumpToTab = useCallback(
    (oneBasedIndex: number) => {
      const currentTabs = tabsRef.current;
      if (!currentTabs || currentTabs.length === 0) return;
      if (oneBasedIndex < 1 || oneBasedIndex > currentTabs.length) return;
      const targetTab = currentTabs[oneBasedIndex - 1];
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.SELECT_TAB,
        value: targetTab.id,
        sender: keyboardTabNavSenderId,
        phase: "discrete",
      });
    },
    [manager, keyboardTabNavSenderId],
  );

  const { ResponderScope, responderRef } = useResponder({
    id: cardId,
    kind: "card",
    actions: {
      [TUG_ACTIONS.CLOSE]: (_event: ActionEvent) => handleClose(),
      [TUG_ACTIONS.PREVIOUS_TAB]: (_event: ActionEvent) => handlePreviousTab(),
      [TUG_ACTIONS.NEXT_TAB]: (_event: ActionEvent) => handleNextTab(),
      // jump-to-tab [L11, A3 / R4]: payload is `value: number` (1-based
      // tab index). Narrow defensively since event.value is typed
      // unknown — an out-of-shape dispatch is a silent no-op.
      [TUG_ACTIONS.JUMP_TO_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "number") return;
        handleJumpToTab(event.value);
      },
      // select-tab / close-tab [L11, A2.3]: dispatched by TugTabBar in
      // our accessory slot. Payload is `value: tabId`. The responder
      // owns the store-mutation; deck-canvas no longer wires inline
      // arrows for these. select-tab also runs the
      // save-current-tab-state side effect.
      [TUG_ACTIONS.SELECT_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        performSelectCard(event.value);
      },
      [TUG_ACTIONS.CLOSE_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        store.removeCard(cardId, event.value);
      },
      // add-tab [L11, A2.5]: dispatched by TugTabBar's `+` popup menu
      // after the A2.5 tug-popup-button migration. Payload is
      // `value: componentId`. This card's id plus the incoming
      // componentId are the arguments to store.addTab, completing the
      // chain-native tab-add flow. Distinct from the global
      // add-tab-to-active-card action handled by deck-canvas.
      [TUG_ACTIONS.ADD_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        store.addCardToStack(cardId, event.value);
      },
      // Stubs: minimize, toggle-menu, find are no-ops until implemented.
      // `find` logs because ⌘F is bound in keybinding-map.ts and a user
      // pressing the shortcut would otherwise see nothing — the stub log
      // makes the no-op visible in the dev console until the real handler
      // grows. minimize and toggle-menu have no keybinding so they stay
      // silent. [A3 / R4 polish]
      [TUG_ACTIONS.MINIMIZE]: (_event: ActionEvent) => {},
      [TUG_ACTIONS.TOGGLE_MENU]: (_event: ActionEvent) => {},
      [TUG_ACTIONS.FIND]: (_event: ActionEvent) => {
        console.info("find: stub — no find UI implemented yet");
      },
      // setProperty is handled by the per-card responder inside
      // CardContentHost (registered with id=cardId). Tugcard no longer
      // participates — the registry indirection was retired in Piece 1.iii
      // when CardContentHost got its own responder scope.
    },
  });

  // ---------------------------------------------------------------------------
  // Resolve header metadata from active tab ([D05])
  // ---------------------------------------------------------------------------

  // When multiple tabs are present, the header title/icon follow the active tab.
  const hasMultipleTabs = tabs !== undefined && tabs.length > 1;
  const activeTab = hasMultipleTabs && activeTabId
    ? tabs.find((t) => t.id === activeTabId)
    : undefined;
  const activeTabRegistration = activeTab
    ? getRegistration(activeTab.componentId)
    : undefined;

  // Effective metadata for the header: active tab registration wins, else meta prop.
  const effectiveMeta: TugcardMeta = activeTabRegistration
    ? activeTabRegistration.defaultMeta
    : meta;

  // Compose the header display title: when cardTitle is non-empty, prefix it.
  // "Component Gallery: Hello" vs "Hello"
  const displayTitle = cardTitle
    ? `${cardTitle}: ${effectiveMeta.title}`
    : effectiveMeta.title;

  // ---------------------------------------------------------------------------
  // Build accessory slot content ([D03])
  // ---------------------------------------------------------------------------

  // When tabs.length > 1, render TugTabBar in the accessory slot.
  // When tabs.length <= 1, use the original accessory prop (or null).
  // All tab interactions — select, close, add — flow through this
  // card's responder via the chain. No callback prop forwarding.
  const resolvedAccessory: React.ReactNode | null = hasMultipleTabs
    ? (
        <TugTabBar
          cardId={cardId}
          tabs={tabs}
          activeTabId={activeTabId!}
          acceptedFamilies={acceptedFamilies}
        />
      )
    : accessory;

  // ---------------------------------------------------------------------------
  // Accessory height measurement (D05)
  // ---------------------------------------------------------------------------

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
  // Min-size reporting (D05)
  // ---------------------------------------------------------------------------

  const totalMinWidth = minContentSize.width;
  const totalMinHeight = HEADER_HEIGHT_PX + accessoryHeight + minContentSize.height;

  useEffect(() => {
    onMinSizeChange?.({ width: totalMinWidth, height: totalMinHeight });
  }, [onMinSizeChange, totalMinWidth, totalMinHeight]);

  // Feed subscriptions, property store, persistence, and dirty tracking
  // are owned by the active tab's TabContentHost (passed in as `children`).
  // Tugcard itself holds only card-level chrome and responder actions;
  // per-tab-content concerns live inside the host component rendered into
  // the content area below. See `components/chrome/tab-content-host.tsx`.

  // ---------------------------------------------------------------------------
  // Collapse callback (forwarded from CardFrame via onCollapse prop)
  // ---------------------------------------------------------------------------

  const handleCollapse = useCallback(() => {
    onCollapse?.();
  }, [onCollapse]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const closable = effectiveMeta.closable !== false; // default true

  // Compose the existing cardEl state-setter ref with the responderRef
  // so one DOM element receives both: setCardEl captures the element
  // for the portal context, and responderRef writes data-responder-id
  // for the chain's first-responder resolution.
  const rootRefCallback = useCallback((el: HTMLDivElement | null) => {
    setCardEl(el);
    responderRef(el);
  }, [responderRef]);

  return (
    <TugcardPortalContext value={cardEl}>
    <div
      ref={rootRefCallback}
      className={collapsed ? "tugcard tugcard--collapsed" : "tugcard"}
      data-slot="tug-card"
      data-card-id={cardId}
      data-collapsed={collapsed ? "true" : "false"}
    >
      {/* CardTitleBar: title bar with controls and collapse support */}
      <CardTitleBar
        title={displayTitle}
        icon={effectiveMeta.icon}
        closable={closable}
        collapsed={collapsed}
        onCollapse={handleCollapse}
        onClose={onClose}
        onDragStart={onDragStart}
      />

      {/*
       * Accessory slot and content stay MOUNTED when collapsed [D07].
       * Terminal sessions, scroll positions, and form values are preserved.
       * Visibility is controlled via CSS: .tugcard--collapsed wraps these in
       * a container with overflow:hidden and height:0 so they are invisible
       * but their React subtrees remain alive.
       *
       * Rule 4 of Rules of Tugways: appearance changes go through CSS and DOM,
       * never React state.
       */}
      <div
        className="tugcard-body"
        data-testid="tugcard-body"
      >
        <ResponderScope>
          {/* Accessory slot: TugTabBar when tabs.length > 1, else original accessory or 0px.
              data-card-id is used by TabDragCoordinator to identify single-tab card
              drop targets (tier-2 hit-test cache entry, [D05]).
              Inside ResponderScope so TugTabBar's targeted dispatch reaches
              this card's selectTab/closeTab/addTab handlers. */}
          <div
            ref={accessoryRef}
            className="tugcard-accessory"
            data-testid="tugcard-accessory"
            data-card-id={cardId}
            style={resolvedAccessory == null ? { height: 0, overflow: "hidden" } : undefined}
          >
            {resolvedAccessory}
          </div>

          {/* Content area: flex-grow, overflow auto. Per-tab-content context
              providers (feed data, property store, persistence, dirty-mark)
              are provided by the TabContentHost passed as `children` from
              DeckCanvas. This div remains the registered portal target for
              card-content-registry (see the useLayoutEffect above). */}
          <div ref={contentRef} className="tugcard-content" data-testid="tugcard-content">
            {children}
          </div>
        </ResponderScope>
      </div>
    </div>
    </TugcardPortalContext>
  );
}
