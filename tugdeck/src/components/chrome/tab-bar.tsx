/**
 * TabBar — React component for the tab strip in multi-tab panels.
 *
 * Presentation-only: fires callbacks for all state mutations and lets
 * DeckManager own card updates and card lifecycle operations.
 *
 * Supports:
 * - Click-to-switch (fires onTabActivate when pointerdown does not become a drag)
 * - Close button (fires onTabClose, stops propagation)
 * - Drag-reorder with 5px threshold (fires onTabReorder)
 *
 * Implements TabBarHandle via forwardRef + useImperativeHandle for
 * DeckManager compatibility during the transition period (Steps 4-6).
 * Removed in Step 7 when DeckCanvas replaces imperative calls.
 *
 * CSS class names preserved for test selector compatibility:
 *   .card-tab-bar, .card-tab, .card-tab-active, .card-tab-close
 *
 * Spec S04, Spec S04a
 * [D02] React synthetic events for all pointer interactions
 * [D08] useImperativeHandle transition for DeckManager compatibility
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
} from "react";
import type { TabItem, TabNode } from "@/layout-tree";

// ---- Callbacks ----

export interface TabBarCallbacks {
  /** Called when the user clicks a tab (not the close button). */
  onTabActivate: (tabIndex: number) => void;
  /** Called when the user clicks the close button for a tab. */
  onTabClose: (tabId: string) => void;
  /** Called when a drag-reorder finishes within this tab bar. */
  onTabReorder: (fromIndex: number, toIndex: number) => void;
}

/** Pixel threshold before a pointerdown-move is treated as a drag, not a click. */
const DRAG_THRESHOLD_PX = 5;

// ---- Imperative handle ----

/**
 * Imperative handle exposed to DeckManager via forwardRef + useImperativeHandle.
 * Transitional bridge (Steps 4-6); removed in Step 7.
 */
export interface TabBarHandle {
  /** Return the root .card-tab-bar element. */
  getElement(): HTMLElement;
  /**
   * Re-render the tab strip from an updated TabNode.
   * Called by DeckManager after tab activate, reorder, or close.
   */
  update(node: TabNode): void;
  /** Detach from DOM (no-op; React root unmount handles cleanup). */
  destroy(): void;
}

// ---- Props ----

export interface TabBarProps {
  tabs: TabItem[];
  activeTabIndex: number;
  callbacks: TabBarCallbacks;
}

// ---- Tab element with drag-reorder ----

interface TabProps {
  tab: TabItem;
  tabIndex: number;
  isActive: boolean;
  tabRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  callbacks: TabBarCallbacks;
}

function Tab({ tab, tabIndex, isActive, tabRefs, callbacks }: TabProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only handle primary pointer button
      if (e.button !== 0) return;
      // Don't start drag on the close button
      if ((e.target as HTMLElement).classList.contains("card-tab-close")) return;

      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let fromIndex = tabIndex;

      const onMove = (ev: PointerEvent) => {
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        if (!dragging && (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX)) {
          dragging = true;
          target.classList.add("dragging");
        }
        if (!dragging) return;

        // Hit-test via refs to tab elements
        const toIndex = hitTestTabIndex(tabRefs, ev.clientX);
        if (toIndex !== -1 && toIndex !== fromIndex) {
          callbacks.onTabReorder(fromIndex, toIndex);
          fromIndex = toIndex;
        }
      };

      const onUp = (_ev: PointerEvent) => {
        target.releasePointerCapture(e.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        target.classList.remove("dragging");

        if (!dragging) {
          callbacks.onTabActivate(tabIndex);
        }
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [tabIndex, tabRefs, callbacks]
  );

  const handleCloseClick = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      e.stopPropagation();
      callbacks.onTabClose(tab.id);
    },
    [tab.id, callbacks]
  );

  return (
    <div
      ref={(el) => {
        tabRefs.current[tabIndex] = el;
      }}
      className={isActive ? "card-tab card-tab-active" : "card-tab"}
      data-tab-id={tab.id}
      data-tab-index={String(tabIndex)}
      onPointerDown={handlePointerDown}
    >
      <span className="card-tab-label">{tab.title}</span>
      {tab.closable !== false && (
        <span className="card-tab-close" onClick={handleCloseClick}>
          {"×"}
        </span>
      )}
    </div>
  );
}

// ---- Hit-test helper ----

function hitTestTabIndex(
  tabRefs: React.MutableRefObject<(HTMLDivElement | null)[]>,
  clientX: number
): number {
  for (let i = 0; i < tabRefs.current.length; i++) {
    const el = tabRefs.current[i];
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (clientX >= rect.left && clientX < rect.right) {
      return i;
    }
  }
  return -1;
}

// ---- Component ----

export const TabBar = forwardRef<TabBarHandle, TabBarProps>(
  function TabBar({ tabs: initialTabs, activeTabIndex: initialActiveTabIndex, callbacks }, ref) {
    const rootRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<(HTMLDivElement | null)[]>([]);

    // State updated imperatively via update(node) handle
    const [tabs, setTabs] = useState<TabItem[]>(initialTabs);
    const [activeTabIndex, setActiveTabIndex] = useState(initialActiveTabIndex);

    // ---- Imperative handle ----

    useImperativeHandle(
      ref,
      () => ({
        getElement(): HTMLElement {
          return rootRef.current!;
        },
        update(node: TabNode) {
          setTabs([...node.tabs]);
          setActiveTabIndex(node.activeTabIndex);
        },
        destroy() {
          // No-op: React root unmount handles cleanup.
        },
      }),
      []
    );

    // Keep tabRefs array sized to current tab count
    tabRefs.current = tabRefs.current.slice(0, tabs.length);

    return (
      <div ref={rootRef} className="card-tab-bar">
        {tabs.map((tab, i) => (
          <Tab
            key={tab.id}
            tab={tab}
            tabIndex={i}
            isActive={i === activeTabIndex}
            tabRefs={tabRefs}
            callbacks={callbacks}
          />
        ))}
      </div>
    );
  }
);
