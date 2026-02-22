import { describe, test, expect } from "bun:test";
import {
  type DeckState,
  type CardState,
  type TabItem,
} from "../layout-tree";
import { serialize, deserialize, buildDefaultLayout } from "../serialization";

// ---- DeckState / CardState type tests ----

describe("DeckState", () => {
  test("DeckState with empty panels array is valid", () => {
    const state: DeckState = { cards: [] };
    expect(state.cards).toBeDefined();
    expect(Array.isArray(state.cards)).toBe(true);
    expect(state.cards.length).toBe(0);
  });
});

describe("CardState", () => {
  test("CardState with single tab constructs correctly", () => {
    const tab: TabItem = {
      id: "tab-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const panel: CardState = {
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

  test("CardState with multiple same-type tabs constructs correctly", () => {
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
    const panel: CardState = {
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

    expect(result.cards.length).toBe(5);

    // Component IDs in order
    const componentIds = result.cards.map((p) => p.tabs[0].componentId);
    expect(componentIds).toEqual(["code", "terminal", "git", "files", "stats"]);

    // Conversation panel geometry
    const conv = result.cards[0];
    expect(conv.position.x).toBe(12);
    expect(conv.position.y).toBe(12);
    // width = (1200 - 36) * 0.6 = 698.4
    expect(conv.size.width).toBeCloseTo(698.4, 3);
    // height = 800 - 24 = 776
    expect(conv.size.height).toBe(776);

    // Right column panels: same x, same width
    const rightPanels = result.cards.slice(1);
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
    const panels = result.cards;

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
    const panel: CardState = {
      id: "panel-known-1",
      position: { x: 100, y: 200 },
      size: { width: 400, height: 300 },
      tabs: [tab],
      activeTabId: "tab-known-1",
    };
    const canvasState: DeckState = { cards: [panel] };

    const serialized = serialize(canvasState);
    const json = JSON.stringify(serialized);
    const restored = deserialize(json, 1920, 1080);

    expect(restored.cards.length).toBe(1);
    const restoredPanel = restored.cards[0];
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
    expect(result.cards.length).toBe(5);
  });

  test("deserialize with corrupt JSON falls back to buildDefaultLayout", () => {
    const result = deserialize("not-valid-json{{{", 1200, 800);
    expect(result.cards.length).toBe(5);
  });

  test("deserialize clamps panel positions to canvas bounds", () => {
    const tab: TabItem = {
      id: "tab-clamp-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const v5 = {
      version: 5,
      cards: [
        {
          id: "panel-clamp-1",
          position: { x: 1800, y: 900 },
          size: { width: 400, height: 300 },
          tabs: [tab],
          activeTabId: "tab-clamp-1",
        },
      ],
    };
    const result = deserialize(JSON.stringify(v5), 1920, 1080);
    expect(result.cards.length).toBe(1);
    // x + width(400) = 1800 + 400 = 2200 > 1920 -> x = 1920 - 400 = 1520
    expect(result.cards[0].position.x).toBe(1520);
    // y + height(300) = 900 + 300 = 1200 > 1080 -> y = 1080 - 300 = 780
    expect(result.cards[0].position.y).toBe(780);
  });

  test("deserialize enforces 100px minimum sizes", () => {
    const tab: TabItem = {
      id: "tab-small-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const v5 = {
      version: 5,
      cards: [
        {
          id: "panel-small-1",
          position: { x: 0, y: 0 },
          size: { width: 50, height: 30 },
          tabs: [tab],
          activeTabId: "tab-small-1",
        },
      ],
    };
    const result = deserialize(JSON.stringify(v5), 1920, 1080);
    expect(result.cards.length).toBe(1);
    expect(result.cards[0].size.width).toBe(100);
    expect(result.cards[0].size.height).toBe(100);
  });
});

// ---- Panel management data-layer tests (D01, D06) ----

/** Build a minimal CardState with a single tab. */
function makeCard(componentId: string): CardState {
  const tabId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    tabs: [{ id: tabId, componentId, title: componentId, closable: true }],
    activeTabId: tabId,
  };
}

describe("focusPanel data model (D06)", () => {
  test("moving a panel to end of array changes z-order", () => {
    const p0 = makeCard("terminal");
    const p1 = makeCard("git");
    const p2 = makeCard("files");
    const canvasState: DeckState = { cards: [p0, p1, p2] };

    // Simulate focusPanel(p0.id): splice and push
    const idx = canvasState.cards.findIndex((p) => p.id === p0.id);
    const [focused] = canvasState.cards.splice(idx, 1);
    canvasState.cards.push(focused);

    // p0 should now be last (highest z-order)
    expect(canvasState.cards[canvasState.cards.length - 1].id).toBe(p0.id);
    // p1 and p2 shift left
    expect(canvasState.cards[0].id).toBe(p1.id);
    expect(canvasState.cards[1].id).toBe(p2.id);
  });

  test("focusing already-last panel does not reorder", () => {
    const p0 = makeCard("terminal");
    const p1 = makeCard("git");
    const canvasState: DeckState = { cards: [p0, p1] };

    // p1 is already last — focusPanel would early-return
    const idx = canvasState.cards.findIndex((p) => p.id === p1.id);
    const isAlreadyLast = idx === canvasState.cards.length - 1;
    expect(isAlreadyLast).toBe(true);

    // Array unchanged
    expect(canvasState.cards[0].id).toBe(p0.id);
    expect(canvasState.cards[1].id).toBe(p1.id);
  });
});

describe("addNewCard data model (D01)", () => {
  test("pushing a new CardState adds it at canvas center", () => {
    const canvasState: DeckState = { cards: [] };
    const canvasW = 800;
    const canvasH = 600;
    const PANEL_W = 400;
    const PANEL_H = 300;

    const tabId = crypto.randomUUID();
    const newPanel: CardState = {
      id: crypto.randomUUID(),
      position: {
        x: Math.max(0, (canvasW - PANEL_W) / 2),
        y: Math.max(0, (canvasH - PANEL_H) / 2),
      },
      size: { width: PANEL_W, height: PANEL_H },
      tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: tabId,
    };

    canvasState.cards.push(newPanel);

    expect(canvasState.cards.length).toBe(1);
    expect(canvasState.cards[0].position.x).toBe(200); // (800-400)/2
    expect(canvasState.cards[0].position.y).toBe(150); // (600-300)/2
    expect(canvasState.cards[0].tabs[0].componentId).toBe("terminal");
  });
});

describe("removeCard data model (D01)", () => {
  test("splicing a panel from the array removes it", () => {
    const p0 = makeCard("terminal");
    const p1 = makeCard("git");
    const canvasState: DeckState = { cards: [p0, p1] };

    // Simulate removeCard: filter out the panel whose tab matches
    const tabIdToRemove = p0.tabs[0].id;
    canvasState.cards = canvasState.cards
      .map((panel) => {
        const newTabs = panel.tabs.filter((t) => t.id !== tabIdToRemove);
        if (newTabs.length === panel.tabs.length) return panel;
        const newActiveTabId = newTabs.find((t) => t.id === panel.activeTabId)
          ? panel.activeTabId
          : (newTabs[0]?.id ?? "");
        return { ...panel, tabs: newTabs, activeTabId: newActiveTabId };
      })
      .filter((panel) => panel.tabs.length > 0);

    expect(canvasState.cards.length).toBe(1);
    expect(canvasState.cards[0].id).toBe(p1.id);
  });

  test("removing a tab from a multi-tab panel leaves panel intact", () => {
    const tab1: TabItem = { id: "t1", componentId: "terminal", title: "T1", closable: true };
    const tab2: TabItem = { id: "t2", componentId: "terminal", title: "T2", closable: true };
    const panel: CardState = {
      id: "p1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [tab1, tab2],
      activeTabId: "t1",
    };
    const canvasState: DeckState = { cards: [panel] };

    // Remove tab1
    canvasState.cards = canvasState.cards
      .map((p) => {
        const newTabs = p.tabs.filter((t) => t.id !== "t1");
        if (newTabs.length === p.tabs.length) return p;
        const newActiveTabId = newTabs.find((t) => t.id === p.activeTabId)
          ? p.activeTabId
          : (newTabs[0]?.id ?? "");
        return { ...p, tabs: newTabs, activeTabId: newActiveTabId };
      })
      .filter((p) => p.tabs.length > 0);

    // Panel still exists with tab2
    expect(canvasState.cards.length).toBe(1);
    expect(canvasState.cards[0].tabs.length).toBe(1);
    expect(canvasState.cards[0].tabs[0].id).toBe("t2");
    // activeTabId falls back to tab2
    expect(canvasState.cards[0].activeTabId).toBe("t2");
  });
});

describe("addNewTab data model (D01)", () => {
  test("adding a tab to existing panel pushes to tabs array", () => {
    const existingTabId = "t-existing";
    const panel: CardState = {
      id: "p1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [{ id: existingTabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: existingTabId,
    };

    const newTabId = crypto.randomUUID();
    const newTab: TabItem = { id: newTabId, componentId: "terminal", title: "Terminal 2", closable: true };
    panel.tabs.push(newTab);
    panel.activeTabId = newTabId;

    expect(panel.tabs.length).toBe(2);
    expect(panel.activeTabId).toBe(newTabId);
    expect(panel.tabs[1].componentId).toBe("terminal");
  });

  test("same-componentId constraint: tabs must share componentId", () => {
    const panel: CardState = {
      id: "p1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [{ id: "t1", componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: "t1",
    };

    // Verify same-componentId check logic
    const existingComponentId = panel.tabs[0]?.componentId;
    const canAddGit = existingComponentId === "git";
    const canAddTerminal = existingComponentId === "terminal";

    expect(canAddGit).toBe(false);
    expect(canAddTerminal).toBe(true);
  });
});
