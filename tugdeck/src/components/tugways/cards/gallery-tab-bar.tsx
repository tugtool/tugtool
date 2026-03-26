/**
 * GalleryTabBarContent -- TugTabBar demo wrapped for gallery card tab.
 *
 * **Authoritative reference:** [D01] gallery-tabbar componentId.
 *
 * @module components/tugways/cards/gallery-tab-bar
 */

import React, { useState, useRef } from "react";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import type { TabItem } from "@/layout-tree";

// ---------------------------------------------------------------------------
// TugTabBarDemo
// ---------------------------------------------------------------------------

/**
 * Seed tabs used by the TugTabBar gallery demo.
 *
 * Six initial tabs give enough content to trigger collapse/overflow in a
 * reasonably sized card without requiring the user to add tabs manually.
 * Defined at module scope to avoid recreation on each render.
 */
const DEMO_INITIAL_TABS: readonly TabItem[] = [
  { id: "demo-tab-1", componentId: "hello", title: "Hello",    closable: true },
  { id: "demo-tab-2", componentId: "hello", title: "World",    closable: true },
  { id: "demo-tab-3", componentId: "hello", title: "Tugways",  closable: true },
  { id: "demo-tab-4", componentId: "hello", title: "Overflow",  closable: true },
  { id: "demo-tab-5", componentId: "hello", title: "Demo",     closable: true },
  { id: "demo-tab-6", componentId: "hello", title: "Tab Six",  closable: true },
];

/**
 * TugTabBarDemo -- standalone TugTabBar demo with overflow status display.
 *
 * Renders a TugTabBar with enough initial tabs to demonstrate progressive
 * collapse. An "Add 5 tabs" button adds five tabs at once so overflow
 * is quickly reached. A status line below the bar shows the current overflow
 * stage ("none" | "collapsed" | "overflow") and the count of overflow tabs.
 *
 * The status line is driven by the `onOverflowChange` callback prop, which
 * TugTabBar calls whenever the structural-zone overflow state changes.
 *
 * Tab select, close, and add are wired to local state for full interactivity.
 */
export function TugTabBarDemo() {
  const [tabs, setTabs] = useState<TabItem[]>(() => DEMO_INITIAL_TABS.map((t) => ({ ...t })));
  const [activeTabId, setActiveTabId] = useState<string>(DEMO_INITIAL_TABS[0].id);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [overflowStage, setOverflowStage] = useState<"none" | "collapsed" | "overflow">("none");
  const [overflowCount, setOverflowCount] = useState<number>(0);
  const nextTabIndexRef = useRef(DEMO_INITIAL_TABS.length + 1);

  const handleTabSelect = (tabId: string) => {
    setActiveTabId(tabId);
    setLastSelected(tabId);
  };

  const handleTabClose = (tabId: string) => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      if (remaining.length === 0) return prev;
      if (activeTabId === tabId) {
        const closedIndex = prev.findIndex((t) => t.id === tabId);
        const newIndex = closedIndex > 0 ? closedIndex - 1 : 0;
        setActiveTabId(remaining[newIndex].id);
      }
      return remaining;
    });
  };

  const handleTabAdd = (_componentId: string) => {
    const n = nextTabIndexRef.current++;
    const newTab: TabItem = {
      id: `demo-tab-new-${n}`,
      componentId: "hello",
      title: `Tab ${n}`,
      closable: true,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  /** Add five tabs at once to quickly trigger overflow. */
  const handleAddFive = () => {
    const newTabs: TabItem[] = Array.from({ length: 5 }, () => {
      const n = nextTabIndexRef.current++;
      return {
        id: `demo-tab-new-${n}`,
        componentId: "hello",
        title: `Tab ${n}`,
        closable: true,
      };
    });
    setTabs((prev) => [...prev, ...newTabs]);
    setActiveTabId(newTabs[newTabs.length - 1].id);
  };

  const handleOverflowChange = (
    stage: "none" | "collapsed" | "overflow",
    count: number,
  ) => {
    setOverflowStage(stage);
    setOverflowCount(count);
  };

  return (
    <div className="cg-tab-bar-demo">
      <TugTabBar
        cardId="gallery-demo-card"
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
        onTabAdd={handleTabAdd}
        onOverflowChange={handleOverflowChange}
      />
      <div className="cg-demo-controls">
        <TugPushButton
          size="sm"
          onClick={handleAddFive}
        >
          Add 5 tabs
        </TugPushButton>
      </div>
      <div className="cg-demo-status" data-testid="demo-overflow-status">
        Overflow stage: <code data-testid="demo-overflow-stage">{overflowStage}</code>
        {overflowCount > 0 && (
          <> — <code data-testid="demo-overflow-count">{overflowCount}</code> tab{overflowCount !== 1 ? "s" : ""} in overflow</>
        )}
      </div>
      {lastSelected !== null && (
        <div className="cg-demo-status">
          Last selected: <code>{lastSelected}</code>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryTabBarContent
// ---------------------------------------------------------------------------

/**
 * GalleryTabBarContent -- TugTabBar demo wrapped for gallery card tab.
 *
 * **Authoritative reference:** [D01] gallery-tabbar componentId.
 */
export function GalleryTabBarContent() {
  return (
    <div className="cg-content" data-testid="gallery-tabbar">
      <div className="cg-section">
        <div className="cg-section-title">TugTabBar</div>
        <TugTabBarDemo />
      </div>
    </div>
  );
}
