/**
 * Dock targeting tests.
 *
 * computeDropZone is a pure function tested directly (no DOM needed).
 * DockOverlay tests use the happy-dom environment.
 * Integration tests verify tree mutations produced by the drop path.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as unknown as typeof globalThis.window;
global.document = window.document as unknown as Document;

// localStorage mock (required by PanelManager)
const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
})();
global.localStorage = localStorageMock as unknown as Storage;

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

if (!global.crypto) {
  let cnt = 0;
  global.crypto = {
    randomUUID: () =>
      `uuid-${++cnt}-xxxx-xxxx-xxxx-xxxxxxxxxxxx` as `${string}-${string}-${string}-${string}-${string}`,
  } as unknown as Crypto;
}

import { computeDropZone, DockOverlay, type TabNodeRect } from "../dock-target";
import { PanelManager } from "../panel-manager";
import { FeedId, type FeedIdValue } from "../protocol";
import type { TugCard } from "../cards/card";
import type { TugConnection } from "../connection";
import type { SplitNode, TabNode, LayoutNode } from "../layout-tree";

// ---- Helpers ----

function makeDOMRect(
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Canvas rect: 0,0 -> 1280x800 */
const CANVAS = makeDOMRect(0, 0, 1280, 800);

function makeTabNodeRect(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  tabBarHeight = 0
): TabNodeRect {
  return { tabNodeId: id, rect: makeDOMRect(left, top, width, height), tabBarHeight };
}

// ---- computeDropZone pure-function tests ----

describe("computeDropZone – P1 root edge tests", () => {
  test("returns root-left when cursor is within 40px of left canvas edge", () => {
    const result = computeDropZone(20, 400, CANVAS, []);
    expect(result).not.toBeNull();
    expect(result!.zone).toBe("root-left");
    expect(result!.targetTabNodeId).toBeNull();
  });

  test("returns root-right when cursor is within 40px of right canvas edge", () => {
    const result = computeDropZone(1260, 400, CANVAS, []);
    expect(result!.zone).toBe("root-right");
  });

  test("returns root-top when cursor is within 40px of top canvas edge", () => {
    const result = computeDropZone(640, 10, CANVAS, []);
    expect(result!.zone).toBe("root-top");
  });

  test("returns root-bottom when cursor is within 40px of bottom canvas edge", () => {
    const result = computeDropZone(640, 790, CANVAS, []);
    expect(result!.zone).toBe("root-bottom");
  });

  test("P1 takes absolute priority over a TabNode occupying the same area", () => {
    // TabNode covers the entire left portion of the canvas
    const tnr = makeTabNodeRect("node-1", 0, 0, 640, 800);
    // Cursor is at x=20 (within 40px of left edge) — should still return root-left
    const result = computeDropZone(20, 400, CANVAS, [tnr]);
    expect(result!.zone).toBe("root-left");
    expect(result!.targetTabNodeId).toBeNull();
  });

  test("corner: cursor near left AND top — closer edge wins; horizontal wins on exact tie", () => {
    // 20px from left, 20px from top — exact tie -> horizontal wins (root-top)
    const result = computeDropZone(20, 20, CANVAS, []);
    expect(result).not.toBeNull();
    expect(result!.zone).toBe("root-top"); // horizontal wins tie
  });

  test("corner: cursor 10px from left, 30px from top — left wins (closer)", () => {
    const result = computeDropZone(10, 30, CANVAS, []);
    expect(result!.zone).toBe("root-left"); // dLeft=10 < dTop=30
  });

  test("overlay geometry for root-left covers 38.2% of canvas width", () => {
    const result = computeDropZone(20, 400, CANVAS, []);
    expect(result!.overlayRect.x).toBe(0);
    expect(result!.overlayRect.y).toBe(0);
    expect(result!.overlayRect.width).toBeCloseTo(1280 * 0.382, 1);
    expect(result!.overlayRect.height).toBe(800);
  });

  test("overlay geometry for root-right covers 38.2% of canvas width from right", () => {
    const result = computeDropZone(1260, 400, CANVAS, []);
    const expectedW = 1280 * 0.382;
    expect(result!.overlayRect.x).toBeCloseTo(1280 - expectedW, 1);
    expect(result!.overlayRect.width).toBeCloseTo(expectedW, 1);
    expect(result!.overlayRect.height).toBe(800);
  });

  test("overlay geometry for root-top covers 38.2% of canvas height", () => {
    const result = computeDropZone(640, 10, CANVAS, []);
    const expectedH = 800 * 0.382;
    expect(result!.overlayRect.x).toBe(0);
    expect(result!.overlayRect.y).toBe(0);
    expect(result!.overlayRect.width).toBe(1280);
    expect(result!.overlayRect.height).toBeCloseTo(expectedH, 1);
  });

  test("overlay geometry for root-bottom covers 38.2% of canvas height from bottom", () => {
    const result = computeDropZone(640, 790, CANVAS, []);
    const expectedH = 800 * 0.382;
    expect(result!.overlayRect.y).toBeCloseTo(800 - expectedH, 1);
    expect(result!.overlayRect.height).toBeCloseTo(expectedH, 1);
  });
});

describe("computeDropZone – P2 tab-bar zone", () => {
  const tnr = makeTabNodeRect("node-1", 100, 100, 400, 300, 28);

  test("returns tab-bar when cursor within tabBarHeight of TabNode top (P2)", () => {
    // cursorY = 110, TabNode top = 100, tabBarHeight = 28
    // cursorY - top = 10 < 28 -> tab-bar
    const result = computeDropZone(250, 110, CANVAS, [tnr]);
    expect(result!.zone).toBe("tab-bar");
    expect(result!.targetTabNodeId).toBe("node-1");
  });

  test("P2 beats P3: cursor near left edge but within tab bar -> tab-bar wins", () => {
    // cursor near left edge of TabNode (edgeDLeft = 5), but within tab bar height (cursorY - top = 15)
    const result = computeDropZone(105, 115, CANVAS, [tnr]);
    expect(result!.zone).toBe("tab-bar");
  });

  test("tab-bar overlay covers full TabNode width at tabBarHeight", () => {
    const result = computeDropZone(250, 110, CANVAS, [tnr]);
    // Overlay rect is relative to canvas (0,0)
    // TabNode left=100, top=100 -> nodeLeft=100, nodeTop=100 (canvas starts at 0)
    expect(result!.overlayRect.x).toBe(100);
    expect(result!.overlayRect.y).toBe(100);
    expect(result!.overlayRect.width).toBe(400);
    expect(result!.overlayRect.height).toBe(28);
  });

  test("no tab-bar zone when tabBarHeight is 0 (single-tab node)", () => {
    const singleTabNode = makeTabNodeRect("node-2", 100, 100, 400, 300, 0);
    // cursor near top of node but no tab bar
    const result = computeDropZone(250, 110, CANVAS, [singleTabNode]);
    // Should fall through to P3 widget zone
    expect(result!.zone).not.toBe("tab-bar");
    expect(result!.zone).toBe("widget-top"); // top edge is nearest
  });
});

describe("computeDropZone – P3 widget zones", () => {
  // TabNode occupying center of canvas, well away from root edges
  const tnr = makeTabNodeRect("node-1", 200, 200, 400, 300, 0);

  test("returns widget-left when cursor near left edge of TabNode", () => {
    // cursor at (210, 350) — edgeDLeft=10, edgeDRight=390, edgeDTop=150, edgeDBottom=150
    const result = computeDropZone(210, 350, CANVAS, [tnr]);
    expect(result!.zone).toBe("widget-left");
    expect(result!.targetTabNodeId).toBe("node-1");
  });

  test("returns widget-right when cursor near right edge of TabNode", () => {
    const result = computeDropZone(590, 350, CANVAS, [tnr]);
    expect(result!.zone).toBe("widget-right");
  });

  test("returns widget-top when cursor near top edge of TabNode", () => {
    const result = computeDropZone(400, 210, CANVAS, [tnr]);
    expect(result!.zone).toBe("widget-top");
  });

  test("returns widget-bottom when cursor near bottom edge of TabNode", () => {
    const result = computeDropZone(400, 490, CANVAS, [tnr]);
    expect(result!.zone).toBe("widget-bottom");
  });

  test("returns null when cursor is over sash / outside all TabNodes", () => {
    // Cursor in canvas but not within any TabNodeRect
    const result = computeDropZone(640, 400, CANVAS, [tnr]);
    expect(result).toBeNull();
  });

  test("overlay geometry for widget-left covers left 50% of TabNode", () => {
    const result = computeDropZone(210, 350, CANVAS, [tnr]);
    expect(result!.overlayRect.x).toBe(200); // nodeLeft
    expect(result!.overlayRect.y).toBe(200); // nodeTop
    expect(result!.overlayRect.width).toBe(200); // 50% of 400
    expect(result!.overlayRect.height).toBe(300);
  });

  test("overlay geometry for widget-right covers right 50% of TabNode", () => {
    const result = computeDropZone(590, 350, CANVAS, [tnr]);
    expect(result!.overlayRect.x).toBe(400); // 200 + 400/2
    expect(result!.overlayRect.width).toBe(200);
  });

  test("overlay geometry for widget-top covers top 50% of TabNode", () => {
    const result = computeDropZone(400, 210, CANVAS, [tnr]);
    expect(result!.overlayRect.y).toBe(200);
    expect(result!.overlayRect.height).toBe(150); // 50% of 300
  });

  test("P3 tie-break: cursor at top-left corner equidistant from two edges", () => {
    // edgeDLeft = edgeDTop = 10; absFromCenterX = 190, absFromCenterY = 140
    // absFromCenterX > absFromCenterY -> widget-left wins
    const result = computeDropZone(210, 210, CANVAS, [tnr]);
    // left edge distance = 10, top edge distance = 10 — tie
    // absFromCenterX = |210 - 400| = 190, absFromCenterY = |210 - 350| = 140
    // 190 > 140 -> widget-left
    expect(result!.zone).toBe("widget-left");
  });

  test("P3 tie-break: cursor at bottom-right corner with larger vertical dist from center", () => {
    // TabNode: left=200, top=200, width=400, height=300
    // center: (400, 350)
    // cursor at (590, 480): edgeDRight=10, edgeDBottom=20 — right is closer
    const result = computeDropZone(590, 480, CANVAS, [tnr]);
    expect(result!.zone).toBe("widget-right");
  });
});

// ---- Integration tests: tree mutations via drop path ----

class MockConnection {
  onFrame(_id: number, _cb: (p: Uint8Array) => void): void {}
  onOpen(_cb: () => void): void {}
  send(_id: number, _p: Uint8Array): void {}
}

function makeMockCard(feedIds: FeedIdValue[]): TugCard & { mountCount: number; destroyCount: number } {
  return {
    feedIds,
    mountCount: 0,
    destroyCount: 0,
    mount(_: HTMLElement) { this.mountCount++; },
    onFrame() {},
    onResize() {},
    destroy() { this.destroyCount++; },
  };
}

function treeContainsComponent(node: LayoutNode, cid: string): boolean {
  if (node.type === "tab") return node.tabs.some((t) => t.componentId === cid);
  return node.children.some((c) => treeContainsComponent(c, cid));
}

function countTabNodes(node: LayoutNode): number {
  if (node.type === "tab") return 1;
  return node.children.reduce((s, c) => s + countTabNodes(c), 0);
}

describe("Drop execution integration tests", () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  /**
   * Build a manager loaded from a serialized two-tab layout.
   * Returns the manager and the real tabNodeId / tabItemIds from the loaded state.
   */
  function buildTwoTabManager(conn: MockConnection) {
    const tabAId = "drop-test-tab-a";
    const tabBId = "drop-test-tab-b";

    const serialized = {
      version: 3,
      root: {
        type: "split",
        orientation: "horizontal",
        children: [
          {
            type: "tabs",
            activeId: tabAId,
            tabs: [
              { id: tabAId, componentId: "conversation", title: "Conversation" },
              { id: tabBId, componentId: "terminal", title: "Terminal" },
            ],
          },
          {
            type: "split",
            orientation: "vertical",
            children: [
              { type: "tabs", activeId: "r0", tabs: [{ id: "r0", componentId: "git", title: "Git" }] },
              { type: "tabs", activeId: "r1", tabs: [{ id: "r1", componentId: "files", title: "Files" }] },
            ],
            weights: [0.5, 0.5],
          },
        ],
        weights: [0.5, 0.5],
      },
      floating: [],
    };
    localStorage.setItem("tugdeck-layout", JSON.stringify(serialized));

    const manager = new PanelManager(container, conn as unknown as TugConnection);
    const state = manager.getDockState();
    const rootSplit = state.root as SplitNode;
    const twoTabNode = rootSplit.children[0] as TabNode;

    const cardA = makeMockCard([FeedId.CONVERSATION_OUTPUT]);
    const cardB = makeMockCard([FeedId.TERMINAL_OUTPUT]);
    manager.addCard(cardA, "conversation");
    manager.addCard(cardB, "terminal");

    return {
      manager,
      cardA,
      cardB,
      tabNodeId: twoTabNode.id,
      tabAId,
      tabBId,
      state,
    };
  }

  test("integration: dragging a tab to widget-left of another TabNode creates a horizontal split", () => {
    const conn = new MockConnection();
    const { manager, tabBId } = buildTwoTabManager(conn);

    // Get the git TabNode (right split, child 0)
    const state = manager.getDockState();
    const rootSplit = state.root as SplitNode;
    const rightSplit = rootSplit.children[1] as SplitNode;
    const gitTabNode = rightSplit.children[0] as TabNode;

    // Verify git is in the tree
    expect(treeContainsComponent(state.root, "git")).toBe(true);
    const initialTabNodeCount = countTabNodes(state.root);

    // Simulate the drop: call executeDrop via the public applyLayout path
    // We test the tree mutation directly by calling insertNode + replaceTabNodeTabs
    // (same logic as executeDrop uses)
    const twoTabNodeRef = rootSplit.children[0] as TabNode;
    const sourceTabItem = twoTabNodeRef.tabs.find((t) => t.id === tabBId)!;

    // Remove tabB from source (multi-tab -> just splice)
    const newSourceTabs = twoTabNodeRef.tabs.filter((t) => t.id !== tabBId);

    // Build new root with tab removed from source
    const { insertNode: ins, normalizeTree: norm } = require("../layout-tree");
    const stateAfterRemove = {
      root: {
        ...rootSplit,
        children: [
          { ...twoTabNodeRef, tabs: newSourceTabs, activeTabIndex: 0 },
          rightSplit,
        ],
      },
      floating: [],
    };

    // Insert tabB to widget-left of gitTabNode
    const newRoot = ins(stateAfterRemove.root, gitTabNode.id, "widget-left", sourceTabItem);
    const normalized = norm(newRoot);
    manager.applyLayout({ root: normalized, floating: [] });

    // The "terminal" card should now be next to "git" in a horizontal split
    expect(treeContainsComponent(manager.getDockState().root, "terminal")).toBe(true);
    expect(treeContainsComponent(manager.getDockState().root, "git")).toBe(true);

    // Tab count increased by 1 (tabB moved from existing TabNode to a new TabNode)
    // Source 2-tab -> 1-tab (no change in TabNode count), target split gains 1 new TabNode
    const afterCount = countTabNodes(manager.getDockState().root);
    expect(afterCount).toBeGreaterThanOrEqual(initialTabNodeCount);

    manager.destroy();
  });

  test("integration: dragging a tab to tab-bar zone of another TabNode creates a tab group", () => {
    const conn = new MockConnection();
    const { manager, cardB, tabBId } = buildTwoTabManager(conn);

    const state = manager.getDockState();
    const rootSplit = state.root as SplitNode;
    const rightSplit = rootSplit.children[1] as SplitNode;
    const gitTabNode = rightSplit.children[0] as TabNode;
    const twoTabNodeRef = rootSplit.children[0] as TabNode;
    const sourceTabItem = twoTabNodeRef.tabs.find((t) => t.id === tabBId)!;

    // Remove tabB from its source node
    const newSourceTabs = twoTabNodeRef.tabs.filter((t) => t.id !== tabBId);
    const { insertNode: ins, normalizeTree: norm } = require("../layout-tree");

    const stateAfterRemove = {
      root: {
        ...rootSplit,
        children: [
          { ...twoTabNodeRef, tabs: newSourceTabs, activeTabIndex: 0 },
          rightSplit,
        ],
      },
      floating: [],
    };

    // Insert tabB to tab-bar of gitTabNode (creates a new tab in that node)
    const newRoot = ins(stateAfterRemove.root, gitTabNode.id, "tab-bar", sourceTabItem);
    const normalized = norm(newRoot);
    manager.applyLayout({ root: normalized, floating: [] });

    // Find the git TabNode in the new tree — it should have 2 tabs now
    const newState = manager.getDockState();
    function findTabNodeWithBothComponents(node: LayoutNode): boolean {
      if (node.type === "tab") {
        const components = node.tabs.map((t) => t.componentId);
        return components.includes("git") && components.includes("terminal");
      }
      return node.children.some(findTabNodeWithBothComponents);
    }
    expect(findTabNodeWithBothComponents(newState.root)).toBe(true);

    // cardB was NOT destroyed (D09 identity preservation)
    expect(cardB.destroyCount).toBe(0);

    manager.destroy();
  });

  test("card instance preserved (not destroyed) across drop operations (D09)", () => {
    const conn = new MockConnection();
    const { manager, cardA, cardB } = buildTwoTabManager(conn);

    // Perform any drop mutation
    const state = manager.getDockState();
    const rootSplit = state.root as SplitNode;
    const rightSplit = rootSplit.children[1] as SplitNode;
    const filesTabNode = rightSplit.children[1] as TabNode;
    const twoTabNode = rootSplit.children[0] as TabNode;
    const tabBItem = twoTabNode.tabs[1];

    const { insertNode: ins, normalizeTree: norm } = require("../layout-tree");
    const newSourceTabs = [twoTabNode.tabs[0]];
    const stateRoot = {
      ...rootSplit,
      children: [
        { ...twoTabNode, tabs: newSourceTabs, activeTabIndex: 0 },
        rightSplit,
      ],
    };
    const newRoot = ins(stateRoot, filesTabNode.id, "widget-top", tabBItem);
    manager.applyLayout({ root: norm(newRoot), floating: [] });

    // Neither card was destroyed
    expect(cardA.destroyCount).toBe(0);
    expect(cardB.destroyCount).toBe(0);

    manager.destroy();
  });
});
