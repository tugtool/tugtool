/**
 * TugTabBar — presentational tab strip for multi-tab Tugcards.
 *
 * Renders in the Tugcard accessory slot when a card has more than one tab.
 * Purely presentational: no DeckManager coupling. Per [L11], TugTabBar is a
 * control, not a responder — it dispatches `selectTab` and `closeTab`
 * actions through the chain, where the enclosing Tugcard's responder
 * handles them and updates the store.
 *
 * **Authoritative references:**
 * - [L06] Appearance changes go through CSS and DOM, never React state
 * - [L11] Controls emit actions; responders handle actions
 * - [L16] Every foreground rule declares its rendering surface
 * - [L19] Component authoring guide
 * - [D01] DOM measurement for full widths, fixed constant for icon-only
 * - [D02] Overflow state split across appearance and structural zones
 * - [D03] Tab bar uses the Tugcard accessory slot
 * - [D04] Replace overflow-x: auto with overflow-x: hidden
 */

import "./tug-tab-bar.css";
import React, { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { icons } from "lucide-react";
import type { TabItem } from "@/layout-tree";
import { getAllRegistrations } from "@/card-registry";
import { TugButton } from "./internal/tug-button";
import { TugPopupMenu } from "./internal/tug-popup-menu";
import type { TugPopupMenuItem } from "./internal/tug-popup-menu";
import { useResponderChain } from "./responder-chain-provider";
import { tabDragCoordinator, exceedsDragThreshold } from "@/tab-drag-coordinator";
import {
  computeOverflow,
  ICON_ONLY_TAB_WIDTH,
  OVERFLOW_BUTTON_WIDTH,
  type TabMeasurement,
} from "@/tab-overflow";

// ---- Types ----

/**
 * Props for TugTabBar.
 */
export interface TugTabBarProps extends Omit<React.ComponentPropsWithoutRef<"div">, "role"> {
  /** Unique card instance ID. Stamped as data-card-id on the bar div so the
   *  TabDragCoordinator's hit-test cache can locate this bar at drag-start. */
  cardId: string;
  /** All tabs on this card. */
  tabs: TabItem[];
  /** The currently active tab id. */
  activeTabId: string;
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via `useId()`
   * if omitted. Parent responders disambiguate multi-tab-bar scenarios by
   * matching this id in their `selectTab` / `closeTab` handler bindings. [L11]
   */
  senderId?: string;
  /** Called when the user selects a card type from the [+] type picker.
   *
   *  Note: this remains a callback prop pending A2.5 (`tug-popup-button`
   *  migration), where the `+` button's popup-menu items will dispatch a
   *  new `addTab` action through the chain. Until then, callers wire this
   *  to `store.addTab(cardId, componentId)` directly. */
  onTabAdd: (componentId: string) => void;
  /**
   * Families of card types to show in the [+] type picker.
   * Only registrations whose `family` matches one of these strings appear.
   * Defaults to `["standard"]` when omitted.
   *
   * **Authoritative reference:** [D03] acceptsFamilies field.
   */
  acceptedFamilies?: readonly string[];
  /**
   * Optional callback invoked whenever the overflow state changes.
   * Receives the current overflow stage and the count of overflow tabs.
   * Intended for demo/diagnostic use (e.g., the gallery TugTabBar demo
   * status line). Not required for production tab bar usage.
   */
  onOverflowChange?: (stage: "none" | "collapsed" | "overflow", overflowCount: number) => void;
}

// ---- Helpers ----

/**
 * Fallback icon name used when a registration does not specify an icon.
 * Ensures all tabs render an icon and can collapse to icon-only mode.
 */
const DEFAULT_TAB_ICON = "Diamond";

/** Render a lucide icon by name, or null if the name is absent or unrecognised. */
function renderIcon(iconName: string | undefined): React.ReactNode {
  const name = iconName ?? DEFAULT_TAB_ICON;
  const IconComponent = icons[name as keyof typeof icons] ?? icons[DEFAULT_TAB_ICON as keyof typeof icons];
  if (!IconComponent) return null;
  return React.createElement(IconComponent, { size: 12 });
}

// ---- useTabOverflow hook ----

/**
 * useTabOverflow -- ResizeObserver-driven tab overflow management.
 *
 * Attaches a ResizeObserver to the tab bar container. On each observation:
 * 1. Guards against mutations during an active drag gesture.
 * 2. Measures tab widths via getBoundingClientRect (appearance-zone reads).
 * 3. Calls computeOverflow() to partition tabs into visible/collapsed/overflow.
 * 4. Applies per-tab data-overflow attributes imperatively via requestAnimationFrame
 *    (appearance-zone writes, no React state) [D02].
 * 5. Updates overflowTabs React state only when the set of overflow IDs
 *    changes (structural-zone change: controls overflow button rendering) [D02].
 *
 * The dependency array for the useLayoutEffect covers:
 * - `tabs.length`: tab add/remove triggers re-measurement.
 * - `activeTabId`: active tab change triggers re-measurement.
 * - `titleKey`: serialised tab titles so a title rename triggers re-measurement.
 *
 * The ResizeObserver handles container resize automatically (card resize,
 * window resize) via its observation of the bar element.
 *
 * ResizeObserver loop is mitigated by requestAnimationFrame write deferral. [L06]
 * Measurement timing is mitigated by useLayoutEffect. [L03]
 *
 * @param barRef    Ref to the tab bar container div.
 * @param tabs      Ordered array of tab items.
 * @param activeTabId ID of the currently active tab.
 * @param onOverflowChange Optional callback invoked when overflow stage or count changes.
 * @returns {{ overflowTabs: TabItem[] }} Tabs currently in the overflow dropdown.
 */
function useTabOverflow(
  barRef: React.RefObject<HTMLDivElement | null>,
  tabs: TabItem[],
  activeTabId: string,
  onOverflowChange?: (stage: "none" | "collapsed" | "overflow", overflowCount: number) => void,
): { overflowTabs: TabItem[] } {
  // overflowTabs is structural-zone state: it controls whether the overflow
  // dropdown button is rendered and what items it contains. [D02]
  const [overflowTabs, setOverflowTabs] = useState<TabItem[]>([]);

  // Stable reference to the last overflow tab IDs string, used to avoid
  // unnecessary React state updates when the set hasn't changed.
  const lastOverflowIdsRef = useRef<string>("");

  // Stable reference to the last overflow stage, tracked independently so
  // onOverflowChange fires on stage transitions even when overflowIds stays
  // empty (e.g. "none" → "collapsed": both have overflowIds = []).
  const lastStageRef = useRef<"none" | "collapsed" | "overflow">("none");

  // Stable ref for the onOverflowChange callback so the RAF closure always
  // calls the latest version without needing it in the dependency array.
  const onOverflowChangeRef = useRef(onOverflowChange);
  onOverflowChangeRef.current = onOverflowChange;

  // Stable reference to the pending RAF id, for cancellation on cleanup.
  const rafIdRef = useRef<number | null>(null);

  // Serialised title key for dependency tracking -- triggers re-measurement
  // when any tab title changes.
  const titleKey = tabs.map((t) => t.title).join("|");

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    /**
     * Core measurement and DOM attribute application logic.
     * Called from the ResizeObserver callback (and immediately on first mount).
     *
     * Reads are synchronous; DOM attribute writes are deferred to RAF
     * to avoid ResizeObserver loop warnings.
     */
    function runOverflow() {
      const barEl = barRef.current;
      if (!barEl) return;

      // Skip recalculation during an active drag gesture.
      if (tabDragCoordinator.isDragging) return;

      // --- Measurements (synchronous reads) ---

      const containerWidth = barEl.getBoundingClientRect().width;

      // Measure the [+] add button width.
      const addBtn = barEl.querySelector<HTMLElement>(".tug-tab-add");
      const addButtonWidth = addBtn ? addBtn.getBoundingClientRect().width : 28;

      // Measure the overflow button width (if already rendered), or use
      // the bootstrap constant for the first computation introducing overflow.
      const overflowBtn = barEl.querySelector<HTMLElement>(".tug-tab-overflow-btn");
      const overflowButtonWidth = overflowBtn
        ? overflowBtn.getBoundingClientRect().width
        : OVERFLOW_BUTTON_WIDTH;

      // Build TabMeasurement array from current DOM state.
      // Temporarily clear any data-overflow attributes so all tabs are
      // rendered at their natural (full) widths for accurate measurement.
      // We re-apply after computeOverflow runs.
      const tabEls = barEl.querySelectorAll<HTMLElement>(".tug-tab");
      const savedOverflow: Array<string | null> = [];

      tabEls.forEach((el) => {
        savedOverflow.push(el.getAttribute("data-overflow"));
        el.removeAttribute("data-overflow");
      });

      // Read full widths now that overflow attributes are cleared.
      const measurements: TabMeasurement[] = [];
      tabEls.forEach((el) => {
        const tabId = el.getAttribute("data-testid")?.replace("tug-tab-", "") ?? "";
        const fullWidth = el.getBoundingClientRect().width;
        const hasIcon = el.querySelector(".tug-tab-icon") !== null;
        measurements.push({
          tabId,
          fullWidth,
          iconOnlyWidth: hasIcon ? ICON_ONLY_TAB_WIDTH : fullWidth,
          hasIcon,
        });
      });

      // Restore saved overflow attributes before DOM writes.
      tabEls.forEach((el, i) => {
        const saved = savedOverflow[i];
        if (saved !== null) {
          el.setAttribute("data-overflow", saved);
        }
      });

      // --- Computation (pure, no DOM) ---

      const result = computeOverflow(
        measurements,
        containerWidth,
        activeTabId,
        overflowButtonWidth,
        addButtonWidth,
      );

      // --- DOM writes deferred to RAF ---

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;

        const barEl2 = barRef.current;
        if (!barEl2) return;

        // Apply data-overflow attribute to each tab element (appearance-zone).
        const tabEls2 = barEl2.querySelectorAll<HTMLElement>(".tug-tab");
        tabEls2.forEach((el) => {
          const tabId = el.getAttribute("data-testid")?.replace("tug-tab-", "") ?? "";
          if (result.overflowIds.includes(tabId)) {
            el.setAttribute("data-overflow", "hidden");
          } else if (result.collapsedIds.includes(tabId)) {
            el.setAttribute("data-overflow", "collapsed");
          } else {
            el.removeAttribute("data-overflow");
          }
        });

        // Apply data-overflow-active on the bar itself (appearance-zone).
        if (result.stage !== "none") {
          barEl2.setAttribute("data-overflow-active", "true");
        } else {
          barEl2.removeAttribute("data-overflow-active");
        }

        // --- Structural-zone and callback updates ---
        //
        // Snapshot previous values before any mutations so comparisons
        // against "what changed" are accurate.
        const prevOverflowIdsKey = lastOverflowIdsRef.current;
        const prevStage = lastStageRef.current;

        const newOverflowIdsKey = result.overflowIds.join(",");
        const newOverflowCount = result.overflowIds.length;

        // Update structural-zone state only when overflow tab IDs change.
        // Joining IDs into a string gives cheap reference equality. [D02]
        if (newOverflowIdsKey !== prevOverflowIdsKey) {
          lastOverflowIdsRef.current = newOverflowIdsKey;

          // Map overflow IDs back to TabItem objects, preserving order.
          const overflowTabItems = result.overflowIds
            .map((id) => tabs.find((t) => t.id === id))
            .filter((t): t is TabItem => t !== undefined);

          setOverflowTabs(overflowTabItems);
        }

        // Notify optional observer whenever stage OR overflow count changes.
        //
        // This check is intentionally separate from the overflowIds gate
        // above. The "none" → "collapsed" Stage 1 transition keeps
        // overflowIds = [] in both states, so newOverflowIdsKey stays ""
        // and the gate above never fires for it. Tracking stage in its own
        // ref lets us detect that transition and call onOverflowChange. [D02]
        const prevOverflowCount = prevOverflowIdsKey.split(",").filter(Boolean).length;
        if (result.stage !== prevStage || newOverflowCount !== prevOverflowCount) {
          lastStageRef.current = result.stage;
          onOverflowChangeRef.current?.(result.stage, newOverflowCount);
        }
      });
    }

    // Attach ResizeObserver to the bar element. The observer fires after
    // layout (post-paint), ensuring getBoundingClientRect is accurate.
    // useLayoutEffect guarantees DOM is committed before attach. [L03]
    const observer = new ResizeObserver(() => {
      runOverflow();
    });
    observer.observe(bar);

    // Run immediately for the initial measurement.
    runOverflow();

    return () => {
      observer.disconnect();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, activeTabId, titleKey]);

  return { overflowTabs };
}

// ---- TugTabBar ----

/**
 * TugTabBar -- horizontal tab strip component.
 *
 * Renders each tab as a button with an optional icon and title.
 * The active tab has `data-active="true"` set for CSS targeting.
 * A [+] button at the end opens a TugPopupMenu type picker listing all
 * registered card types; selecting one calls `onTabAdd(componentId)`.
 *
 * Overflow handling is provided by the `useTabOverflow` hook, which attaches
 * a ResizeObserver to the bar container and applies data-overflow attributes
 * imperatively (appearance-zone). The overflow dropdown button is rendered
 * conditionally based on `overflowTabs` React state (structural-zone). [D02]
 *
 * Tab drag initiation uses a 5px threshold pattern: onPointerDown registers
 * document-level listeners to track movement without acquiring pointer capture.
 * Once the threshold is exceeded, document-level listeners are removed and
 * `tabDragCoordinator.startDrag()` is called, which acquires pointer capture
 * and takes over the drag gesture. Sub-threshold pointer moves do not
 * interfere with the click event sequence, so click-to-select still works.
 * [D01]
 *
 * All interactive elements have `user-select: none` (enforced in CSS).
 * All appearance changes go through CSS `data-active` attribute, never React state. [L06]
 */
export const TugTabBar = React.forwardRef<HTMLDivElement, TugTabBarProps>(function TugTabBar(
  {
    cardId,
    tabs,
    activeTabId,
    senderId,
    onTabAdd,
    acceptedFamilies,
    onOverflowChange,
    className,
    ...rest
  }: TugTabBarProps,
  ref,
) {
  // Chain dispatch [L11]: tab select/close actions are dispatched through
  // the responder chain. The enclosing card's responder handles them by
  // matching `event.sender` against this tab bar's senderId. If no
  // ResponderChainProvider is mounted (unit tests, standalone preview)
  // dispatch is a no-op — TugTabBar still renders correctly but the
  // user's clicks have no observable effect, which is the expected
  // standalone-preview behavior.
  const manager = useResponderChain();
  const fallbackSenderId = useId();
  const effectiveSenderId = senderId ?? fallbackSenderId;
  const dispatchSelectTab = useCallback(
    (tabId: string) => {
      if (!manager) return;
      manager.dispatch({
        action: "selectTab",
        value: tabId,
        sender: effectiveSenderId,
        phase: "discrete",
      });
    },
    [manager, effectiveSenderId],
  );
  const dispatchCloseTab = useCallback(
    (tabId: string) => {
      if (!manager) return;
      manager.dispatch({
        action: "closeTab",
        value: tabId,
        sender: effectiveSenderId,
        phase: "discrete",
      });
    },
    [manager, effectiveSenderId],
  );
  // Ref for the tab bar container, used by useTabOverflow. [D02]
  const barRef = useRef<HTMLDivElement>(null);

  // Merge the forwarded ref with the internal barRef.
  const setRefs = (el: HTMLDivElement | null) => {
    (barRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (typeof ref === "function") {
      ref(el);
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    }
  };

  // Overflow hook: attaches ResizeObserver, applies appearance-zone DOM
  // attributes, returns structural-zone overflowTabs for dropdown rendering.
  const { overflowTabs } = useTabOverflow(barRef, tabs, activeTabId, onOverflowChange);

  // Resolve effective families: default to ["standard"] when prop is omitted.
  const effectiveFamilies = acceptedFamilies ?? ["standard"];

  // Build the type-picker dropdown items from registered card types,
  // filtered by family. A registration with no `family` field is treated as
  // "standard" (default family). Only registrations whose family is in
  // effectiveFamilies are shown.
  const typePickerItems: TugPopupMenuItem[] = Array.from(getAllRegistrations().values())
    .filter((reg) => effectiveFamilies.includes(reg.family ?? "standard"))
    .map((reg) => ({
      id: reg.componentId,
      label: reg.defaultMeta.title,
      icon: renderIcon(reg.defaultMeta.icon),
    }));

  // Build overflow dropdown items from overflowTabs (icon + label each). [D07]
  const overflowDropdownItems: TugPopupMenuItem[] = overflowTabs.map((tab) => {
    const iconName = getAllRegistrations().get(tab.componentId)?.defaultMeta.icon;
    return {
      id: tab.id,
      label: tab.title,
      icon: renderIcon(iconName),
    };
  });

  // Stable handler for [+] button type picker selection.
  const handleTypeSelect = useCallback(
    (componentId: string) => {
      onTabAdd(componentId);
    },
    [onTabAdd],
  );

  // Handler for selecting a tab from the overflow dropdown. [D05]
  // Dispatches `selectTab` through the responder chain; the enclosing
  // card's responder updates activeTabId, triggering re-render, and the
  // ResizeObserver recomputes overflow with the new active tab visible.
  const handleOverflowSelect = useCallback(
    (tabId: string) => {
      dispatchSelectTab(tabId);
    },
    [dispatchSelectTab],
  );

  return (
    <div
      ref={setRefs}
      className={cn("tug-tab-bar", className)}
      role="tablist"
      data-slot="tug-tab-bar"
      data-testid="tug-tab-bar"
      data-card-id={cardId}
      {...rest}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        const handleTabClick = () => {
          dispatchSelectTab(tab.id);
        };

        const handleCloseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
          // Stop propagation so the close click does not trigger tab select.
          event.stopPropagation();
          dispatchCloseTab(tab.id);
        };

        const iconName = getAllRegistrations().get(tab.componentId)?.defaultMeta.icon;
        const iconNode = renderIcon(iconName);

        /**
         * Drag initiation with 5px threshold. [D01]
         *
         * On pointerdown: register document-level pointermove/pointerup to
         * track movement without acquiring pointer capture. This preserves the
         * normal click sequence for sub-threshold interactions.
         *
         * On first pointermove exceeding 5px: remove document-level listeners
         * and hand off to tabDragCoordinator.startDrag(), which acquires
         * pointer capture on the tab element.
         *
         * On pointerup before threshold: remove document-level listeners so
         * the normal onClick fires unimpeded.
         */
        const handleTabPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
          // Only primary pointer button (left click / touch).
          if (event.button !== 0) return;

          const nativeEvent = event.nativeEvent;
          const tabElement = event.currentTarget;
          const startX = nativeEvent.clientX;
          const startY = nativeEvent.clientY;

          function onDocumentMove(e: PointerEvent) {
            if (exceedsDragThreshold(startX, startY, e.clientX, e.clientY)) {
              cleanup();
              tabDragCoordinator.startDrag(e, tabElement, cardId, tab.id, tabs.length);
            }
          }

          function onDocumentUp() {
            cleanup();
            // Allow normal onClick to fire -- no intervention needed.
          }

          function cleanup() {
            document.removeEventListener("pointermove", onDocumentMove);
            document.removeEventListener("pointerup", onDocumentUp);
          }

          document.addEventListener("pointermove", onDocumentMove);
          document.addEventListener("pointerup", onDocumentUp);
        };

        return (
          <div
            key={tab.id}
            role="tab"
            className="tug-tab"
            data-active={isActive ? "true" : undefined}
            data-testid={`tug-tab-${tab.id}`}
            aria-selected={isActive}
            tabIndex={0}
            onClick={handleTabClick}
            onPointerDown={handleTabPointerDown}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleTabClick();
            }}
          >
            {iconNode !== null && (
              <span className="tug-tab-icon" aria-hidden="true">
                {iconNode}
              </span>
            )}
            <span className="tug-tab-title">{tab.title}</span>
            {tab.closable && (
              <button
                type="button"
                className="tug-tab-close"
                onClick={handleCloseClick}
                aria-label={`Close ${tab.title} tab`}
                data-testid={`tug-tab-close-${tab.id}`}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {/* Overflow popup menu -- rendered only when tabs overflow [D07, D08].
          Placed between the last visible tab and the [+] button.
          Trigger is a ghost-option TugButton with no chevron. [D07] */}
      {overflowTabs.length > 0 && (
        <TugPopupMenu
          trigger={
            <TugButton
              emphasis="ghost"
              role="option"
              size="sm"
              className="tug-tab-overflow-btn"
              aria-label={`${overflowTabs.length} more tabs`}
              data-testid="tug-tab-overflow-btn"
            >
              <span className="tug-tab-overflow-badge">+{overflowTabs.length}</span>
            </TugButton>
          }
          items={overflowDropdownItems}
          onSelect={handleOverflowSelect}
        />
      )}

      {/* [+] type picker button -- always rightmost [D07, D08].
          Trigger is a ghost-option TugButton with no chevron. [D07] */}
      <TugPopupMenu
        trigger={
          <TugButton
            emphasis="ghost"
            role="option"
            size="sm"
            className="tug-tab-add"
            aria-label="Add tab"
            data-testid="tug-tab-add"
          >
            +
          </TugButton>
        }
        items={typePickerItems}
        onSelect={handleTypeSelect}
      />
    </div>
  );
});
