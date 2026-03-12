/**
 * Tugcard -- composition component for card chrome and responder integration.
 *
 * **Authoritative references:**
 * - design-system-concepts.md Concept 6, [D01] Tugcard composition,
 *   [D03] CardFrame/Tugcard separation, [D05] Dynamic min-size,
 *   [D07] Tugcard responder node
 * - Spec S01 TugcardProps, Spec S07 Tugcard internal layout
 * - Phase 5b: [D01] Tab state is props-driven, [D03] Tab bar uses accessory
 *   slot, [D04] Inactive tabs unmount, [D05] Header follows active tab,
 *   [D07] Selection saved/restored on tab switch, Spec S02 extended props
 *
 * ## Visual Stack (Spec S07)
 *
 * ```
 * CardFrame (absolute positioning, drag handles, resize handles)
 *   └─ Tugcard (flex column)
 *        ├─ CardHeader (title + icon + close button)
 *        ├─ Accessory slot (TugTabBar when tabs.length > 1, else 0px)
 *        └─ Content area (flex-grow, overflow auto)
 *             └─ children (active tab content or single card content)
 * ```
 *
 * ## Responsibilities
 *
 * - Render header chrome (title, optional icon, close button)
 * - When tabs.length > 1: render TugTabBar in the accessory slot; header
 *   title/icon follow the active tab's registration metadata ([D05])
 * - Register as a responder node with `close`, `selectAll`, `previousTab`,
 *   `nextTab`, `minimize`, `toggleMenu`, `find`
 * - Wrap children in `<ResponderScope>` for child responder registration
 * - Wrap children in `<TugcardDataProvider>` (feed subscription wired in Phase 6)
 * - Compute total min-size and report via `onMinSizeChange`
 * - Gate child mounting by feed arrival (feedless cards mount immediately)
 * - Call `onDragStart` from the header on pointer-down
 * - Save/restore selection on tab switch using SelectionGuard ([D07])
 *
 * @module components/tugways/tugcard
 */

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedIdValue } from "../../protocol";
import type { TabItem, TabStateBag } from "../../layout-tree";
import { selectionGuard } from "./selection-guard";
import type { SavedSelection } from "./selection-guard";
import { getRegistration } from "../../card-registry";
import { useResponder } from "./use-responder";
import type { ActionEvent } from "./responder-chain";
import { TugcardDataProvider } from "./hooks/use-tugcard-data";
import { useSelectionBoundary } from "./hooks/use-selection-boundary";
import { useRequiredResponderChain } from "./responder-chain-provider";
import { TugTabBar } from "./tug-tab-bar";
import { TugcardPropertyContext } from "./hooks/use-property-store";
import type { PropertyStore } from "./property-store";
import { useDeckManager } from "../../deck-manager-context";
import { type TugcardPersistenceCallbacks, TugcardPersistenceContext } from "./use-tugcard-persistence";
import { CardHeader } from "./card-header";
import "./tug-card.css";

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
 *
 * **Authoritative reference:** Spec S01 TugcardMeta.
 */
export interface TugcardMeta {
  title: string;
  /** Lucide icon name (reserved for Phase 5+; rendered as text placeholder for now). */
  icon?: string;
  /** Whether the card can be closed. Default: true. */
  closable?: boolean;
}

/**
 * Props for the Tugcard composition component.
 *
 * **Authoritative reference:** Spec S01 TugcardProps, Spec S02 extended tab props.
 */
export interface TugcardProps {
  /** Unique card instance ID. Passed to the responder chain. */
  cardId: string;
  /** Title, optional icon, and closable flag. Overridden by active tab metadata when tabs.length > 1. */
  meta: TugcardMeta;
  /** Feed IDs to subscribe to. Empty array = feedless card (children mount immediately). */
  feedIds: readonly FeedIdValue[];
  /** Custom decode function per feed. Default: JSON parse. Wired in Phase 6. */
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
   */
  collapsed?: boolean;
  /**
   * Called when the user toggles collapse (chevron click or header double-click).
   * Forwarded from CardFrame which calls store.toggleCardCollapse.
   */
  onCollapse?: () => void;
  /** Card-specific content components. */
  children: React.ReactNode;

  // ---- Phase 5b tab props (Spec S02) ----

  /** All tabs on this card. When provided and length > 1, the tab bar appears. */
  tabs?: TabItem[];
  /** The currently active tab id. Required when tabs is provided. */
  activeTabId?: string;
  /** Called when the user clicks a tab to select it. */
  onTabSelect?: (tabId: string) => void;
  /** Called when the user clicks the close (x) button on a tab. */
  onTabClose?: (tabId: string) => void;
  /** Called when the user picks a new card type from the [+] type picker. */
  onTabAdd?: (componentId: string) => void;

  // ---- Phase 5b3 props ----

  /**
   * Card-level title prefix. When non-empty, the header displays
   * `"${cardTitle}: ${effectiveMeta.title}"`. When empty or omitted,
   * the header displays `effectiveMeta.title` alone.
   *
   * **Authoritative reference:** [D04] Card title field, Spec S06.
   */
  cardTitle?: string;
  /**
   * Families of card types to show in the [+] type picker.
   * Forwarded to TugTabBar when the multi-tab accessory is active.
   * Defaults to `["standard"]` when omitted.
   *
   * **Authoritative reference:** [D03] acceptsFamilies field, Spec S05.
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
  onTabSelect,
  onTabClose,
  onTabAdd,
  cardTitle,
  acceptedFamilies,
}: TugcardProps) {
  // Phase 5f: access the DeckManager store for tab state read/write.
  const store = useDeckManager();

  // ---------------------------------------------------------------------------
  // Content area ref (Phase 5a: selection boundary + selectAll action)
  // ---------------------------------------------------------------------------

  // Ref to the content area div. Used by:
  //   - useSelectionBoundary: registers this element with SelectionGuard so
  //     selection is contained within card boundaries ([D02], [D03])
  //   - selectAll action: calls selectAllChildren on this element ([D06])
  //   - Phase 5f: read scrollLeft/scrollTop for tab state capture
  const contentRef = useRef<HTMLDivElement>(null);

  // Make this card the first responder when clicked anywhere on the card.
  const manager = useRequiredResponderChain();
  const handleCardPointerDown = useCallback(() => {
    manager.makeFirstResponder(cardId);
  }, [manager, cardId]);

  // Register the content area as a selection boundary with SelectionGuard.
  // Uses useLayoutEffect (Rule of Tug #3) so the boundary is available when
  // Tugcard's selection-restore useLayoutEffect fires. ([D02], Spec S02)
  useSelectionBoundary(cardId, contentRef);

  // ---------------------------------------------------------------------------
  // Phase 5d4: PropertyStore registration ([D01], [D04])
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
  // Phase 5f: Persistence callbacks (Step 4, Spec S04, [D02])
  // ---------------------------------------------------------------------------

  // Holds the save/restore callbacks registered by card content via
  // useTugcardPersistence (added in Step 6). null when no card content has
  // registered. Read synchronously in saveCurrentTabState (Rule #5 — ref).
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
  // Phase 5b: Tab state refs (for stable responder actions, Rule of Tug #5)
  // ---------------------------------------------------------------------------

  // Responder actions are registered once at mount via useLayoutEffect inside
  // useResponder. The closures must never go stale. Use refs that are updated
  // every render so the closures always read the current values.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const onTabSelectRef = useRef(onTabSelect);
  onTabSelectRef.current = onTabSelect;

  // ---------------------------------------------------------------------------
  // Phase 5f: saveCurrentTabState helper (Steps 4 & 5, [D01], #lifecycle-flow)
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

  // Wrap onTabSelect to save current state before switching tabs.
  const handleTabSelect = useCallback(
    (newTabId: string) => {
      if (!onTabSelect) return;
      // Save full state for the OLD active tab before unmounting it.
      saveCurrentTabStateRef.current?.();
      // Call parent callback to update activeTabId (triggers remount of new content).
      onTabSelect(newTabId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onTabSelect],
  );

  // Phase 5f3: Save callback registration with DeckManager (Step 3, [D01], Spec S01).
  //
  // Register a stable wrapper around saveCurrentTabStateRef.current so DeckManager
  // can call it on visibilitychange and beforeunload. The wrapper dereferences
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

  // Phase 5f4: Pending scroll/selection refs for the onContentReady callback path.
  // Tugcard stores the values to restore here before calling onRestore, then reads
  // them in the onContentReady callback (after child DOM commits). ([D04], Spec S03)
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
  const pendingSelectionRef = useRef<SavedSelection | null>(null);

  // Phase 5f4: Activation restore — deterministic child-driven ready callback.
  //
  // Replaces the double-RAF timing bet from Phase 5f3. ([D78], [D79], Rule 11, Rule 12)
  //
  // Two paths:
  //
  //   PERSIST PATH (card content registered useTugcardPersistence AND bag.content exists):
  //     The child's onRestore calls setState, which triggers a re-render. The child's
  //     own no-deps useLayoutEffect (in useTugcardPersistence) fires after that commit
  //     and calls the onContentReady callback we write here. At that point, the DOM
  //     reflects the restored content and scroll/selection can be applied safely.
  //     visibility:hidden is applied only when bag.scroll exists to suppress the
  //     one-frame wrong-scroll-position flash. Content-only restores skip hiding.
  //     ([D04], Spec S03 persist path)
  //
  //   DIRECT-APPLY FALLBACK (no persistence registered, OR bag.content undefined):
  //     No child re-render is triggered, so the DOM is already stable. Scroll and
  //     selection are applied directly in the effect body without hiding.
  //     ([D04], Spec S03 direct-apply fallback)
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
      // this after the child's DOM commits. ([D01], [D02], Spec S02)
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
      // No visibility hiding needed. ([D04], Spec S03 direct-apply fallback)
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
    onClose?.();
  }, [onClose]);

  // selectAll: scope Cmd+A to this card's content area.
  const handleSelectAll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    window.getSelection()?.selectAllChildren(el);
  }, []);

  // previousTab / nextTab: read from refs so closures never go stale (Rule #5).
  // Phase 5f: call saveCurrentTabState before switching so keyboard-driven tab
  // switches preserve scroll, selection, and card content state ([#lifecycle-flow]).
  const handlePreviousTab = useCallback(() => {
    const currentTabs = tabsRef.current;
    const currentActiveId = activeTabIdRef.current;
    const selectFn = onTabSelectRef.current;
    if (!currentTabs || currentTabs.length <= 1 || !currentActiveId || !selectFn) return;
    const idx = currentTabs.findIndex((t) => t.id === currentActiveId);
    if (idx === -1) return;
    const prevIdx = (idx - 1 + currentTabs.length) % currentTabs.length;
    saveCurrentTabStateRef.current?.();
    selectFn(currentTabs[prevIdx].id);
  }, []);

  const handleNextTab = useCallback(() => {
    const currentTabs = tabsRef.current;
    const currentActiveId = activeTabIdRef.current;
    const selectFn = onTabSelectRef.current;
    if (!currentTabs || currentTabs.length <= 1 || !currentActiveId || !selectFn) return;
    const idx = currentTabs.findIndex((t) => t.id === currentActiveId);
    if (idx === -1) return;
    const nextIdx = (idx + 1) % currentTabs.length;
    saveCurrentTabStateRef.current?.();
    selectFn(currentTabs[nextIdx].id);
  }, []);

  const { ResponderScope } = useResponder({
    id: cardId,
    actions: {
      close: (_event: ActionEvent) => handleClose(),
      selectAll: (_event: ActionEvent) => handleSelectAll(),
      previousTab: (_event: ActionEvent) => handlePreviousTab(),
      nextTab: (_event: ActionEvent) => handleNextTab(),
      // Phase 5 stubs: minimize, toggleMenu, find are no-ops until later phases
      minimize: (_event: ActionEvent) => {},
      toggleMenu: (_event: ActionEvent) => {},
      find: (_event: ActionEvent) => {},
      // Phase 5d4: route incoming setProperty actions to the registered PropertyStore.
      // Payload shape: { path: string, value: unknown, source?: string } (Spec S06).
      // No-op when no PropertyStore is registered (card does not support inspection).
      setProperty: (event: ActionEvent) => {
        const store = propertyStoreRef.current;
        if (!store) return;
        const payload = event.value as { path: string; value: unknown; source?: string } | undefined;
        if (!payload || typeof payload.path !== "string") return;
        store.set(payload.path, payload.value, payload.source ?? "inspector");
      },
    },
  });

  // ---------------------------------------------------------------------------
  // Phase 5b: Resolve header metadata from active tab (D05)
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
  // Phase 5b: Build accessory slot content (D03)
  // ---------------------------------------------------------------------------

  // When tabs.length > 1, render TugTabBar in the accessory slot.
  // When tabs.length <= 1, use the original accessory prop (or null).
  const resolvedAccessory: React.ReactNode | null = hasMultipleTabs && onTabSelect && onTabClose && onTabAdd
    ? (
        <TugTabBar
          cardId={cardId}
          tabs={tabs}
          activeTabId={activeTabId!}
          onTabSelect={handleTabSelect}
          onTabClose={onTabClose}
          onTabAdd={onTabAdd}
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
  // Feed state (Phase 6 stub)
  // ---------------------------------------------------------------------------

  const feedsReady = feedIds.length === 0;
  const emptyFeedData = useRef(new Map<number, unknown>());

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

  return (
    <div
      className={collapsed ? "tugcard tugcard--collapsed" : "tugcard"}
      data-card-id={cardId}
      data-collapsed={collapsed ? "true" : "false"}
      onPointerDown={handleCardPointerDown}
    >
      {/* CardHeader: title bar with 2.5D controls and collapse support */}
      <CardHeader
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
        {/* Accessory slot: TugTabBar when tabs.length > 1, else original accessory or 0px.
            data-card-id is used by TabDragCoordinator to identify single-tab card
            drop targets (tier-2 hit-test cache entry, [D05, Spec S07]). */}
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
          <TugcardDataProvider feedData={emptyFeedData.current}>
            <ResponderScope>
              {/* Phase 5d4: provide PropertyStore registration callback to card content.
                  Card content calls usePropertyStore() which reads this context and
                  calls registerPropertyStore in useLayoutEffect. [D01] */}
              <TugcardPropertyContext value={registerPropertyStore}>
                {/* Phase 5f Step 4: provide persistence registration callback to card content.
                    Card content calls useTugcardPersistence() (Step 6) which reads this
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
            </ResponderScope>
          </TugcardDataProvider>
        </div>
      </div>
    </div>
  );
}
