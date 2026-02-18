import { describe, test, expect } from "bun:test";
import {
  type CanvasState,
  type PanelState,
  type TabItem,
} from "../layout-tree";
import { serialize, deserialize, buildDefaultLayout } from "../serialization";

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

// ---- buildDefaultLayout tests ----

describe("buildDefaultLayout", () => {
  test("buildDefaultLayout(1200, 800) returns 5 panels with correct positions and 12px gaps", () => {
    const result = buildDefaultLayout(1200, 800);

    expect(result.panels.length).toBe(5);

    // Component IDs in order
    const componentIds = result.panels.map((p) => p.tabs[0].componentId);
    expect(componentIds).toEqual(["conversation", "terminal", "git", "files", "stats"]);

    // Conversation panel geometry
    const conv = result.panels[0];
    expect(conv.position.x).toBe(12);
    expect(conv.position.y).toBe(12);
    // width = (1200 - 36) * 0.6 = 698.4
    expect(conv.size.width).toBeCloseTo(698.4, 3);
    // height = 800 - 24 = 776
    expect(conv.size.height).toBe(776);

    // Right column panels: same x, same width
    const rightPanels = result.panels.slice(1);
    const firstRight = rightPanels[0];
    rightPanels.forEach((p) => {
      expect(p.position.x).toBeCloseTo(firstRight.position.x, 3);
      expect(p.size.width).toBeCloseTo(firstRight.size.width, 3);
    });

    // 12px gaps between right panels
    for (let i = 0; i < rightPanels.length - 1; i++) {
      const gap = rightPanels[i + 1].position.y - rightPanels[i].position.y - rightPanels[i].size.height;
      expect(gap).toBeCloseTo(12, 3);
    }
  });

  test("buildDefaultLayout panels have non-overlapping bounding boxes", () => {
    const result = buildDefaultLayout(1200, 800);
    const panels = result.panels;

    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i];
        const b = panels[j];
        const noOverlap =
          a.position.x + a.size.width <= b.position.x ||
          b.position.x + b.size.width <= a.position.x ||
          a.position.y + a.size.height <= b.position.y ||
          b.position.y + b.size.height <= a.position.y;
        expect(noOverlap).toBe(true);
      }
    }
  });
});

// ---- serialize / deserialize tests ----

describe("serialize and deserialize", () => {
  test("serialize -> deserialize round-trip preserves all panel data", () => {
    const tab: TabItem = {
      id: "tab-known-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const panel: PanelState = {
      id: "panel-known-1",
      position: { x: 100, y: 200 },
      size: { width: 400, height: 300 },
      tabs: [tab],
      activeTabId: "tab-known-1",
    };
    const canvasState: CanvasState = { panels: [panel] };

    const serialized = serialize(canvasState);
    const json = JSON.stringify(serialized);
    const restored = deserialize(json, 1920, 1080);

    expect(restored.panels.length).toBe(1);
    const restoredPanel = restored.panels[0];
    expect(restoredPanel.id).toBe("panel-known-1");
    expect(restoredPanel.position.x).toBe(100);
    expect(restoredPanel.position.y).toBe(200);
    expect(restoredPanel.size.width).toBe(400);
    expect(restoredPanel.size.height).toBe(300);
    expect(restoredPanel.tabs.length).toBe(1);
    expect(restoredPanel.tabs[0].id).toBe("tab-known-1");
    expect(restoredPanel.tabs[0].componentId).toBe("terminal");
    expect(restoredPanel.activeTabId).toBe("tab-known-1");
  });

  test("deserialize with version:3 data falls back to buildDefaultLayout", () => {
    const json = JSON.stringify({ version: 3, root: {}, floating: [] });
    const result = deserialize(json, 1200, 800);
    expect(result.panels.length).toBe(5);
  });

  test("deserialize with corrupt JSON falls back to buildDefaultLayout", () => {
    const result = deserialize("not-valid-json{{{", 1200, 800);
    expect(result.panels.length).toBe(5);
  });

  test("deserialize clamps panel positions to canvas bounds", () => {
    const tab: TabItem = {
      id: "tab-clamp-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const v4 = {
      version: 4,
      panels: [
        {
          id: "panel-clamp-1",
          position: { x: 1800, y: 900 },
          size: { width: 400, height: 300 },
          tabs: [tab],
          activeTabId: "tab-clamp-1",
        },
      ],
    };
    const result = deserialize(JSON.stringify(v4), 1920, 1080);
    expect(result.panels.length).toBe(1);
    // x + width(400) = 1800 + 400 = 2200 > 1920 -> x = 1920 - 400 = 1520
    expect(result.panels[0].position.x).toBe(1520);
    // y + height(300) = 900 + 300 = 1200 > 1080 -> y = 1080 - 300 = 780
    expect(result.panels[0].position.y).toBe(780);
  });

  test("deserialize enforces 100px minimum sizes", () => {
    const tab: TabItem = {
      id: "tab-small-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const v4 = {
      version: 4,
      panels: [
        {
          id: "panel-small-1",
          position: { x: 0, y: 0 },
          size: { width: 50, height: 30 },
          tabs: [tab],
          activeTabId: "tab-small-1",
        },
      ],
    };
    const result = deserialize(JSON.stringify(v4), 1920, 1080);
    expect(result.panels.length).toBe(1);
    expect(result.panels[0].size.width).toBe(100);
    expect(result.panels[0].size.height).toBe(100);
  });
});
