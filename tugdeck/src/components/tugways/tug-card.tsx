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
import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Ellipsis, X, icons } from "lucide-react";
import type { FeedIdValue } from "../../protocol";
import type { TabItem, TabStateBag } from "../../layout-tree";
import { selectionGuard } from "./selection-guard";
import type { SavedSelection } from "./selection-guard";
import { getRegistration } from "../../card-registry";
import { useResponder } from "./use-responder";
import type { ActionEvent } from "./responder-chain";
import { TUG_ACTIONS } from "./action-vocabulary";
import { TugcardDataProvider } from "./hooks/use-tugcard-data";
import { useSelectionBoundary } from "./hooks/use-selection-boundary";
import { useRequiredResponderChain } from "./responder-chain-provider";
import { TugTabBar } from "./tug-tab-bar";
import { TugcardPropertyContext } from "./hooks/use-property-store";
import type { PropertyStore } from "./property-store";
import { useDeckManager } from "../../deck-manager-context";
import { type TugcardPersistenceCallbacks, TugcardPersistenceContext } from "./use-tugcard-persistence";
import { TugButton } from "./internal/tug-button";
import { FeedStore } from "../../lib/feed-store";
import { getConnection } from "../../lib/connection-singleton";

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
const TugcardDirtyContext = createContext<(() => void) | null>(null);

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
  // PropertyStore registration ([D01], [D04])
  // ---------------------------------------------------------------------------

  // Holds the PropertyStore registered by card content via usePropertyStore.
  // Set via TugcardPropertyContext registration callback; read by setProperty
  // action handler. Null when card content has not called usePropertyStore.
  const propertyStoreRef = useRef<PropertyStore | null>(null);

  // Stable registration callback provided to TugcardPropertyContext. Card
  // content calls this in useLayoutEffect via usePropertyStore() to install
  // the store before any events fire. [D01]
  //
  // useCallback with [] keeps the reference stable across re-renders so
  // TugcardPropertyContext does not unnecessarily re-trigger consumers.
  // The setProperty responder reads propertyStoreRef.current directly,
  // which is always current because propertyStoreRef is a ref (Rule #5).
  const registerPropertyStore = useCallback((ps: PropertyStore) => {
    propertyStoreRef.current = ps;
  }, []);

  // ---------------------------------------------------------------------------
  // Persistence callbacks ([D02])
  // ---------------------------------------------------------------------------

  // Holds the save/restore callbacks registered by card content via
  // useTugcardPersistence. null when no card content has registered.
  // Read synchronously in saveCurrentTabState (Rule #5 — ref).
  const persistenceCallbacksRef = useRef<TugcardPersistenceCallbacks | null>(null);

  // Stable registration callback provided to TugcardPersistenceContext.
  // Card content calls this in useLayoutEffect via useTugcardPersistence.
  // useCallback with [] keeps the reference stable across re-renders.
  const registerPersistenceCallbacks = useCallback(
    (callbacks: TugcardPersistenceCallbacks) => {
      persistenceCallbacksRef.current = callbacks;
    },
    [],
  );

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

  // ---------------------------------------------------------------------------
  // saveCurrentTabState helper ([D01], #lifecycle-flow)
  // ---------------------------------------------------------------------------

  // Stored in a ref so that handleTabSelect, handlePreviousTab, and handleNextTab
  // can all call it from stable closures without going stale (Rule #5).
  //
  // Captures scroll position, selection, and card content state for the current
  // active tab and writes them to the DeckManager tab state cache.
  const saveCurrentTabStateRef = useRef<(() => void) | null>(null);
  saveCurrentTabStateRef.current = () => {
    const tabId = activeTabIdRef.current;
    if (!tabId) return;

    const contentEl = contentRef.current;
    const scroll = contentEl
      ? { x: contentEl.scrollLeft, y: contentEl.scrollTop }
      : undefined;

    const selection = selectionGuard.saveSelection(cardId);

    const content = persistenceCallbacksRef.current?.onSave();

    const bag: TabStateBag = {
      ...(scroll !== undefined ? { scroll } : {}),
      ...(selection !== null ? { selection } : {}),
      ...(content !== undefined ? { content } : {}),
    };

    store.setTabState(tabId, bag);
  };

  // Tab-select side effect: save the OUTGOING tab's state before
  // switching, then commit the new active tab to the store. Called from
  // the `selectTab` chain handler below; also called via dispatch from
  // `previousTab` / `nextTab` handlers, which now route through the chain
  // so this side effect runs in exactly one place ([D01], #lifecycle-flow).
  const performSelectTab = useCallback(
    (newTabId: string) => {
      // Save full state for the OLD active tab before unmounting it.
      saveCurrentTabStateRef.current?.();
      // Commit the new active tab through the store, triggering re-render.
      store.setActiveTab(cardId, newTabId);
    },
    [store, cardId],
  );

  // Register a stable save callback with DeckManager ([D01]).
  //
  // Wraps saveCurrentTabStateRef.current so DeckManager can call it on
  // visibilitychange and beforeunload. The wrapper dereferences
  // saveCurrentTabStateRef.current at call time — NOT at registration time — because
  // saveCurrentTabStateRef.current is reassigned every render (it captures inline
  // closures). Passing saveCurrentTabStateRef.current directly would snapshot the
  // initial render's closure and go stale.
  //
  // useLayoutEffect follows Rule of Tugways #3 (registrations that events depend on).
  // Cleanup calls unregisterSaveCallback so the callback is removed when Tugcard unmounts.
  useLayoutEffect(() => {
    store.registerSaveCallback(cardId, () => saveCurrentTabStateRef.current?.());
    return () => {
      store.unregisterSaveCallback(cardId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, store]);

  // ---------------------------------------------------------------------------
  // Auto-save: debounced tab state persistence on scroll, selection, and
  // content changes. Saves scroll position, selection, and card content state
  // to tugbank via the existing saveCurrentTabState mechanism.
  // ---------------------------------------------------------------------------

  const autoSaveTimerRef = useRef<number | null>(null);

  // Stable markDirty callback: schedule a debounced save. Used by:
  //   - scroll listener (below)
  //   - selectionchange listener (below)
  //   - card content via useTugcardDirty() (contentchange)
  const markDirty = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      saveCurrentTabStateRef.current?.();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, []);

  // Install scroll and selectionchange listeners. Both funnel into markDirty.
  useEffect(() => {
    const contentEl = contentRef.current;

    // Scroll: listen on the content area element.
    const handleScroll = () => markDirty();
    contentEl?.addEventListener("scroll", handleScroll, { passive: true });

    // Selection: listen on document, filter to this card's boundary.
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const anchor = sel.anchorNode;
      if (anchor && contentEl?.contains(anchor)) {
        markDirty();
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      contentEl?.removeEventListener("scroll", handleScroll);
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [markDirty, cardId]);

  // Pending scroll/selection refs for the onContentReady callback path.
  // Tugcard stores the values to restore here before calling onRestore, then reads
  // them in the onContentReady callback (after child DOM commits). ([D04])
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
  const pendingSelectionRef = useRef<SavedSelection | null>(null);

  // Activation restore — deterministic child-driven ready callback. ([D78], [D79])
  //
  // Two paths:
  //
  //   PERSIST PATH (card content registered useTugcardPersistence AND bag.content exists):
  //     The child's onRestore calls setState, which triggers a re-render. The child's
  //     own no-deps useLayoutEffect (in useTugcardPersistence) fires after that commit
  //     and calls the onContentReady callback we write here. At that point, the DOM
  //     reflects the restored content and scroll/selection can be applied safely.
  //     visibility:hidden is applied only when bag.scroll exists to suppress the
  //     one-frame wrong-scroll-position flash. Content-only restores skip hiding. ([D04])
  //
  //   DIRECT-APPLY FALLBACK (no persistence registered, OR bag.content undefined):
  //     No child re-render is triggered, so the DOM is already stable. Scroll and
  //     selection are applied directly in the effect body without hiding. ([D04])
  //
  // Cleanup resets pending refs, clears the restorePendingRef flag (cancels a stale
  // pending callback on rapid tab switch), and restores visibility if hidden. ([D05])
  useLayoutEffect(() => {
    if (!activeTabId) return;
    const bag = store.getTabState(activeTabId);

    // Early return if no bag or nothing to restore.
    if (!bag || (bag.scroll === undefined && bag.selection == null && bag.content === undefined)) return;

    const contentEl = contentRef.current;

    // Determine whether the persist path applies:
    // - callbacks object must be registered (card content called useTugcardPersistence), AND
    // - restorePendingRef must be present (guards against the no-op cleanup re-registration
    //   which writes a callbacks pair without restorePendingRef), AND
    // - bag.content must exist (no content to restore means no child setState to wait for).
    const hasPersistence =
      persistenceCallbacksRef.current !== null &&
      persistenceCallbacksRef.current.restorePendingRef !== undefined &&
      bag.content !== undefined;

    if (hasPersistence) {
      // --- PERSIST PATH ---
      // Store pending scroll and selection for the onContentReady callback.
      pendingScrollRef.current = bag.scroll ?? null;
      pendingSelectionRef.current = bag.selection ?? null;

      // Flash suppression: hide content only when scroll state exists.
      // Content-only restores (no scroll) have no wrong-scroll-position flash.
      let didHide = false;
      if (contentEl && bag.scroll !== undefined) {
        contentEl.style.visibility = "hidden";
        didHide = true;
      }

      // Write the onContentReady callback into the callbacks object.
      // The child's no-deps useLayoutEffect (in useTugcardPersistence) will call
      // this after the child's DOM commits. ([D01], [D02])
      persistenceCallbacksRef.current!.onContentReady = () => {
        // Apply scroll from pending ref (DOM height is now stable after child commit).
        if (contentEl && pendingScrollRef.current !== null) {
          contentEl.scrollLeft = pendingScrollRef.current.x;
          contentEl.scrollTop = pendingScrollRef.current.y;
        }

        // Restore visibility before applying selection — browsers may not render
        // the selection highlight if set while visibility:hidden.
        if (didHide && contentEl) {
          contentEl.style.visibility = "";
        }

        // Apply selection after scroll and unhide.
        if (pendingSelectionRef.current != null) {
          selectionGuard.restoreSelection(cardId, pendingSelectionRef.current);
        }

        // Clear pending refs after applying.
        pendingScrollRef.current = null;
        pendingSelectionRef.current = null;
      };

      // Set the flag so the child's no-deps useLayoutEffect fires the callback.
      // Must be set AFTER writing onContentReady (both are read in one effect).
      persistenceCallbacksRef.current!.restorePendingRef!.current = true;

      // Trigger the child's setState (causes re-render → child useLayoutEffect fires).
      persistenceCallbacksRef.current!.onRestore(bag.content!);

      // Cleanup: cancel pending callback on rapid tab switch. ([D05])
      return () => {
        if (persistenceCallbacksRef.current?.restorePendingRef) {
          persistenceCallbacksRef.current.restorePendingRef.current = false;
        }
        pendingScrollRef.current = null;
        pendingSelectionRef.current = null;
        if (didHide && contentEl) {
          contentEl.style.visibility = "";
        }
      };
    } else {
      // --- DIRECT-APPLY FALLBACK ---
      // No persistence registered, or bag.content is undefined (no child setState).
      // The DOM is already stable — apply scroll and selection directly.
      // No visibility hiding needed. ([D04])
      if (contentEl && bag.scroll !== undefined) {
        contentEl.scrollLeft = bag.scroll.x;
        contentEl.scrollTop = bag.scroll.y;
      }
      if (bag.selection != null) {
        selectionGuard.restoreSelection(cardId, bag.selection);
      }
      // No cleanup needed: nothing was hidden, no pending state set.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, cardId]);

  // ---------------------------------------------------------------------------
  // Responder registration (D07)
  // ---------------------------------------------------------------------------

  const handleClose = useCallback(() => {
    // Multi-tab: close the active tab. Single tab: close the card.
    const currentTabs = tabsRef.current;
    const currentActiveId = activeTabIdRef.current;
    if (currentTabs && currentTabs.length > 1 && currentActiveId) {
      store.removeTab(cardId, currentActiveId);
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
  // and runs `performSelectTab` via the `selectTab` action handler
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
        performSelectTab(event.value);
      },
      [TUG_ACTIONS.CLOSE_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        store.removeTab(cardId, event.value);
      },
      // add-tab [L11, A2.5]: dispatched by TugTabBar's `+` popup menu
      // after the A2.5 tug-popup-button migration. Payload is
      // `value: componentId`. This card's id plus the incoming
      // componentId are the arguments to store.addTab, completing the
      // chain-native tab-add flow. Distinct from the global
      // add-tab-to-active-card action handled by deck-canvas.
      [TUG_ACTIONS.ADD_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "string") return;
        store.addTab(cardId, event.value);
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
      // Route incoming set-property actions to the registered PropertyStore.
      // Payload shape: { path: string, value: unknown, source?: string }.
      // No-op when no PropertyStore is registered (card does not support inspection).
      [TUG_ACTIONS.SET_PROPERTY]: (event: ActionEvent) => {
        const store = propertyStoreRef.current;
        if (!store) return;
        const payload = event.value as { path: string; value: unknown; source?: string } | undefined;
        if (!payload || typeof payload.path !== "string") return;
        store.set(payload.path, payload.value, payload.source ?? "inspector");
      },
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

  // ---------------------------------------------------------------------------
  // Feed state — L02: external WebSocket data via useSyncExternalStore only
  // ---------------------------------------------------------------------------

  // Create FeedStore once on mount (via ref). The store subscribes to each
  // feedId via connection.onFrame() and decodes payloads. Disposed on unmount.
  const feedStoreRef = useRef<FeedStore | null>(null);
  if (feedStoreRef.current === null && feedIds.length > 0) {
    const conn = getConnection();
    if (conn !== null) {
      // Adapt the per-card decode prop (feedId, bytes) => unknown to the
      // FeedStore's simpler (payload) => unknown signature. We need one store
      // per card with consistent feedIds at mount time; the feedIds list is
      // fixed at registration time so this is stable.
      //
      // Because FeedStore.onFrame callbacks are keyed per feedId we use a
      // wrapper that routes each feedId through the prop decoder when provided.
      if (decode) {
        // Per-feedId decoders: create one store per feedId, then merge — but
        // that complicates the map. Instead, create a single store with the
        // default decoder and let the card-level decode prop override. For now,
        // we pass a unified decoder that ignores the per-id routing and uses the
        // prop for the first feedId. This is sufficient for current use cases
        // (single-feed cards like GitCard).
        feedStoreRef.current = new FeedStore(conn, feedIds, (payload) => decode(feedIds[0], payload));
      } else {
        feedStoreRef.current = new FeedStore(conn, feedIds);
      }
    }
  }

  // Stable no-op subscribe and empty snapshot for feedless cards.
  // The empty map must be a stable reference so useSyncExternalStore does not
  // trigger infinite re-renders when getSnapshot returns a new object each call.
  const noopSubscribe = useRef((_listener: () => void) => () => {}).current;
  const emptyMapRef = useRef(new Map<number, unknown>());
  const emptySnapshot = useRef(() => emptyMapRef.current).current;

  // Subscribe to FeedStore via useSyncExternalStore (L02).
  const feedData = useSyncExternalStore(
    feedStoreRef.current?.subscribe ?? noopSubscribe,
    feedStoreRef.current?.getSnapshot ?? emptySnapshot,
  );

  // Dispose FeedStore on unmount.
  useEffect(() => {
    return () => {
      feedStoreRef.current?.dispose();
      feedStoreRef.current = null;
    };
  }, []);

  // Feed readiness: feedless cards are always ready; feed cards wait for first frame.
  const feedsReady = feedIds.length === 0 || feedData.size > 0;

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

          {/* Content area: flex-grow, overflow auto */}
          <div ref={contentRef} className="tugcard-content" data-testid="tugcard-content">
            <TugcardDataProvider feedData={feedData}>
              {/* Provide PropertyStore registration callback to card content.
                  Card content calls usePropertyStore() which reads this context and
                  calls registerPropertyStore in useLayoutEffect. [D01] */}
              <TugcardPropertyContext value={registerPropertyStore}>
                {/* Provide persistence registration callback to card content.
                    Card content calls useTugcardPersistence() which reads this
                    context and registers its save/restore callbacks in useLayoutEffect. [D02] */}
                <TugcardPersistenceContext value={registerPersistenceCallbacks}>
                  <TugcardDirtyContext value={markDirty}>
                    {feedsReady ? children : (
                      <div className="tugcard-loading" data-testid="tugcard-loading">
                        Loading...
                      </div>
                    )}
                  </TugcardDirtyContext>
                </TugcardPersistenceContext>
              </TugcardPropertyContext>
            </TugcardDataProvider>
          </div>
        </ResponderScope>
      </div>
    </div>
    </TugcardPortalContext>
  );
}
