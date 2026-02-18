import { describe, test, expect } from "bun:test";
import {
  type CanvasState,
  type PanelState,
  type TabItem,
} from "../layout-tree";

// ---- CanvasState / PanelState type tests ----

describe("CanvasState", () => {
  test("CanvasState with empty panels array is valid", () => {
    const state: CanvasState = { panels: [] };
    expect(state.panels).toBeDefined();
    expect(Array.isArray(state.panels)).toBe(true);
    expect(state.panels.length).toBe(0);
  });
});

describe("PanelState", () => {
  test("PanelState with single tab constructs correctly", () => {
    const tab: TabItem = {
      id: "tab-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const panel: PanelState = {
      id: "panel-1",
      position: { x: 0, y: 0 },
      size: { width: 800, height: 600 },
      tabs: [tab],
      activeTabId: "tab-1",
    };

    expect(panel.id).toBe("panel-1");
    expect(panel.position.x).toBe(0);
    expect(panel.position.y).toBe(0);
    expect(panel.size.width).toBe(800);
    expect(panel.size.height).toBe(600);
    expect(panel.tabs.length).toBe(1);
    expect(panel.tabs[0].componentId).toBe("terminal");
    expect(panel.activeTabId).toBe("tab-1");
  });

  test("PanelState with multiple same-type tabs constructs correctly", () => {
    const tab1: TabItem = {
      id: "tab-a",
      componentId: "terminal",
      title: "Terminal 1",
      closable: true,
    };
    const tab2: TabItem = {
      id: "tab-b",
      componentId: "terminal",
      title: "Terminal 2",
      closable: true,
    };
    const tab3: TabItem = {
      id: "tab-c",
      componentId: "terminal",
      title: "Terminal 3",
      closable: false,
    };
    const panel: PanelState = {
      id: "panel-2",
      position: { x: 100, y: 200 },
      size: { width: 400, height: 300 },
      tabs: [tab1, tab2, tab3],
      activeTabId: "tab-b",
    };

    expect(panel.tabs.length).toBe(3);
    expect(panel.tabs[0].id).toBe("tab-a");
    expect(panel.tabs[1].id).toBe("tab-b");
    expect(panel.tabs[2].id).toBe("tab-c");
    expect(panel.tabs[2].closable).toBe(false);
    expect(panel.activeTabId).toBe("tab-b");
    // All tabs have the same componentId
    panel.tabs.forEach((tab) => {
      expect(tab.componentId).toBe("terminal");
    });
  });
});
