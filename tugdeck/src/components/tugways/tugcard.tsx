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
 *        ├─ CardHeader (28px, title + icon + close button)
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

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedIdValue } from "../../protocol";
import { icons } from "lucide-react";
import type { TabItem } from "../../layout-tree";
import type { SavedSelection } from "./selection-guard";
import { selectionGuard } from "./selection-guard";
import { getRegistration } from "../../card-registry";
import { useResponder } from "./use-responder";
import { TugcardDataProvider } from "./hooks/use-tugcard-data";
import { useSelectionBoundary } from "./hooks/use-selection-boundary";
import { useRequiredResponderChain } from "./responder-chain-provider";
import { TugTabBar } from "./tug-tab-bar";
import "./tugcard.css";

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
  children,
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabAdd,
  cardTitle,
  acceptedFamilies,
}: TugcardProps) {
  // ---------------------------------------------------------------------------
  // Content area ref (Phase 5a: selection boundary + selectAll action)
  // ---------------------------------------------------------------------------

  // Ref to the content area div. Used by:
  //   - useSelectionBoundary: registers this element with SelectionGuard so
  //     selection is contained within card boundaries ([D02], [D03])
  //   - selectAll action: calls selectAllChildren on this element ([D06])
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
  // Phase 5b: Per-tab selection persistence (D07)
  // ---------------------------------------------------------------------------

  // savedSelectionsRef maps tabId → SavedSelection. Lives entirely in Tugcard
  // local state -- not in SelectionGuard.savedSelections (which is unused infra).
  const savedSelectionsRef = useRef<Map<string, SavedSelection>>(new Map());

  // Wrap onTabSelect to save current selection before switching tabs (D07, step 1).
  const handleTabSelect = useCallback(
    (newTabId: string) => {
      if (!onTabSelect) return;
      // Step 1: save selection for the OLD active tab before unmounting it.
      const oldTabId = activeTabIdRef.current;
      if (oldTabId && oldTabId !== newTabId) {
        const saved = selectionGuard.saveSelection(cardId);
        if (saved) {
          savedSelectionsRef.current.set(oldTabId, saved);
        }
      }
      // Step 2: call parent callback to update activeTabId (triggers remount of new content).
      onTabSelect(newTabId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId, onTabSelect],
  );

  // Step 3: after the new tab's content mounts and its useSelectionBoundary
  // useLayoutEffect runs (children before parents), restore the saved selection.
  // This useLayoutEffect has [activeTabId] as its dependency so it fires
  // whenever the active tab changes.
  useLayoutEffect(() => {
    if (!activeTabId) return;
    const saved = savedSelectionsRef.current.get(activeTabId);
    if (saved) {
      selectionGuard.restoreSelection(cardId, saved);
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
  const handlePreviousTab = useCallback(() => {
    const currentTabs = tabsRef.current;
    const currentActiveId = activeTabIdRef.current;
    const selectFn = onTabSelectRef.current;
    if (!currentTabs || currentTabs.length <= 1 || !currentActiveId || !selectFn) return;
    const idx = currentTabs.findIndex((t) => t.id === currentActiveId);
    if (idx === -1) return;
    const prevIdx = (idx - 1 + currentTabs.length) % currentTabs.length;
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
    selectFn(currentTabs[nextIdx].id);
  }, []);

  const { ResponderScope } = useResponder({
    id: cardId,
    actions: {
      close: handleClose,
      selectAll: handleSelectAll,
      previousTab: handlePreviousTab,
      nextTab: handleNextTab,
      // Phase 5 stubs: minimize, toggleMenu, find are no-ops until later phases
      minimize: () => {},
      toggleMenu: () => {},
      find: () => {},
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
  // Header drag handler
  // ---------------------------------------------------------------------------

  const handleHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      onDragStart?.(event);
    },
    [onDragStart],
  );

  // ---------------------------------------------------------------------------
  // Close button
  // ---------------------------------------------------------------------------

  const handleCloseClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onClose?.();
    },
    [onClose],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const closable = effectiveMeta.closable !== false; // default true

  return (
    <div className="tugcard" data-card-id={cardId} onPointerDown={handleCardPointerDown}>
      {/* CardHeader: 28px, title + icon + close button */}
      <div
        className="tugcard-header"
        onPointerDown={handleHeaderPointerDown}
        data-testid="tugcard-header"
      >
        {effectiveMeta.icon && icons[effectiveMeta.icon as keyof typeof icons] && (
          <span className="tugcard-icon" data-testid="tugcard-icon">
            {React.createElement(icons[effectiveMeta.icon as keyof typeof icons], { size: 14 })}
          </span>
        )}
        <span className="tugcard-title" data-testid="tugcard-title">
          {displayTitle}
        </span>
        {closable && (
          <button
            type="button"
            className="tugcard-close-btn"
            onClick={handleCloseClick}
            aria-label="Close card"
            data-testid="tugcard-close-btn"
          >
            ×
          </button>
        )}
      </div>

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
            {feedsReady ? children : (
              <div className="tugcard-loading" data-testid="tugcard-loading">
                Loading...
              </div>
            )}
          </ResponderScope>
        </TugcardDataProvider>
      </div>
    </div>
  );
}
