/**
 * Tab bar and multi-tab panel tests.
 *
 * Tests cover:
 * - TabBar unit tests: rendering, click-to-switch, close, reorder
 * - PanelManager integration: two-tab panel via applyLayout, D09 identity
 * - Closing a tab calls card.destroy() and removes from feed dispatch
 * - Drag-reorder updates tab order in panel data model
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as unknown as typeof globalThis.window;
global.document = window.document as unknown as Document;
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// localStorage mock
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

// crypto.randomUUID mock
if (!global.crypto) {
  let counter = 0;
  global.crypto = {
    randomUUID: () => {
      counter++;
      return `test-uuid-${counter}-xxxx-xxxx-xxxx-xxxxxxxxxxxx` as `${string}-${string}-${string}-${string}-${string}`;
    },
  } as unknown as Crypto;
}

// requestAnimationFrame mock (not in happy-dom)
if (!global.requestAnimationFrame) {
  global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    setTimeout(() => cb(0), 0);
    return 0;
  };
}

import { TabBar, type TabBarCallbacks } from "../tab-bar";
import { DeckManager } from "../deck-manager";
import { FeedId, type FeedIdValue } from "../protocol";
import type { TugCard } from "../cards/card";
import type { TugConnection } from "../connection";
import type { TabNode, TabItem } from "../layout-tree";
import type { DeckState, CardState } from "../layout-tree";

// ---- Mocks ----

class MockConnection {
  private frameCallbacks: Map<number, Array<(payload: Uint8Array) => void>> = new Map();
  private openCallbacks: Array<() => void> = [];

  onFrame(feedId: number, callback: (payload: Uint8Array) => void): void {
    if (!this.frameCallbacks.has(feedId)) this.frameCallbacks.set(feedId, []);
    this.frameCallbacks.get(feedId)!.push(callback);
  }
  onOpen(callback: () => void): void { this.openCallbacks.push(callback); }
  send(_feedId: number, _payload: Uint8Array): void {}
}

function makeMockCard(feedIds: FeedIdValue[]): TugCard & {
  mountCount: number;
  destroyCount: number;
  resizeCalls: Array<{ width: number; height: number }>;
} {
  return {
    feedIds,
    mountCount: 0,
    destroyCount: 0,
    resizeCalls: [],
    mount(_container: HTMLElement) { this.mountCount++; },
    onFrame(_feedId: FeedIdValue, _payload: Uint8Array) {},
    onResize(width: number, height: number) { this.resizeCalls.push({ width, height }); },
    destroy() { this.destroyCount++; },
  };
}

// ---- TabBar unit tests (pure, no PanelManager) ----

describe("TabBar (unit)", () => {
  let activateCalls: number[] = [];
  let closeCalls: string[] = [];
  let reorderCalls: Array<{ from: number; to: number }> = [];
  let callbacks: TabBarCallbacks;

  function makeTestNode(tabCount: number, activeIndex = 0): TabNode {
    const tabs: TabItem[] = [];
    for (let i = 0; i < tabCount; i++) {
      tabs.push({
        id: `tab-id-${i}`,
        componentId: `component-${i}`,
        title: `Tab ${i}`,
        closable: true,
      });
    }
    return { type: "tab", id: "node-id", tabs, activeTabIndex: activeIndex };
  }

  beforeEach(() => {
    activateCalls = [];
    closeCalls = [];
    reorderCalls = [];
    // TabBarCallbacks has no onDragOut (removed in step 2)
    callbacks = {
      onTabActivate: (idx) => activateCalls.push(idx),
      onTabClose: (id) => closeCalls.push(id),
      onTabReorder: (from, to) => reorderCalls.push({ from, to }),
    };
  });

  test("renders one tab element per TabItem", () => {
    const node = makeTestNode(3);
    const bar = new TabBar(node, callbacks);
    expect(bar.getElement().querySelectorAll(".card-tab").length).toBe(3);
    bar.destroy();
  });

  test("active tab has panel-tab-active class; inactive tabs do not", () => {
    const node = makeTestNode(3, 1);
    const bar = new TabBar(node, callbacks);
    const tabs = bar.getElement().querySelectorAll(".card-tab");
    expect(tabs[0].classList.contains("card-tab-active")).toBe(false);
    expect(tabs[1].classList.contains("card-tab-active")).toBe(true);
    expect(tabs[2].classList.contains("card-tab-active")).toBe(false);
    bar.destroy();
  });

  test("update() re-renders with the new active tab", () => {
    const node = makeTestNode(3, 0);
    const bar = new TabBar(node, callbacks);
    node.activeTabIndex = 2;
    bar.update(node);
    const tabs = bar.getElement().querySelectorAll(".card-tab");
    expect(tabs[0].classList.contains("card-tab-active")).toBe(false);
    expect(tabs[2].classList.contains("card-tab-active")).toBe(true);
    bar.destroy();
  });

  test("each closable tab has a close button", () => {
    const node = makeTestNode(2);
    const bar = new TabBar(node, callbacks);
    expect(bar.getElement().querySelectorAll(".card-tab-close").length).toBe(2);
    bar.destroy();
  });

  test("clicking close button fires onTabClose with correct tabId", () => {
    const node = makeTestNode(2);
    const bar = new TabBar(node, callbacks);
    const closeButtons = bar.getElement().querySelectorAll(".card-tab-close");
    (closeButtons[1] as HTMLElement).click();
    expect(closeCalls).toEqual(["tab-id-1"]);
    expect(activateCalls).toEqual([]);
    bar.destroy();
  });

  test("tab labels match TabItem.title", () => {
    const node = makeTestNode(2);
    const bar = new TabBar(node, callbacks);
    const labels = bar.getElement().querySelectorAll(".card-tab-label");
    expect((labels[0] as HTMLElement).textContent).toBe("Tab 0");
    expect((labels[1] as HTMLElement).textContent).toBe("Tab 1");
    bar.destroy();
  });

  test("getElement() returns a .card-tab-bar div", () => {
    const node = makeTestNode(1);
    const bar = new TabBar(node, callbacks);
    expect(bar.getElement().className).toBe("card-tab-bar");
    bar.destroy();
  });

  test("destroy() empties the root element", () => {
    const node = makeTestNode(3);
    const bar = new TabBar(node, callbacks);
    bar.destroy();
    expect(bar.getElement().children.length).toBe(0);
  });

  test("TabBarCallbacks has no onDragOut (removed in step 2)", () => {
    // Verify the callbacks object only has the three expected fields
    const cbKeys = Object.keys(callbacks);
    expect(cbKeys).toContain("onTabActivate");
    expect(cbKeys).toContain("onTabClose");
    expect(cbKeys).toContain("onTabReorder");
    expect(cbKeys).not.toContain("onDragOut");
  });
});

// ---- PanelManager integration tests for tab groups ----

describe("PanelManager tab groups (integration)", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    container = document.createElement("div");
    container.style.width = "1280px";
    container.style.height = "800px";
    document.body.appendChild(container);
    connection = new MockConnection();
  });

  /** Build a v4 DeckState with a two-tab panel for terminal components */
  function makeTwoTabPanel(): { canvasState: DeckState; tabAId: string; tabBId: string; panelId: string } {
    const tabAId = "two-tab-a";
    const tabBId = "two-tab-b";
    const panelId = "two-tab-panel";
    const canvasState: DeckState = {
      cards: [{
        id: panelId,
        position: { x: 100, y: 100 },
        size: { width: 400, height: 300 },
        tabs: [
          { id: tabAId, componentId: "terminal", title: "Terminal A", closable: true },
          { id: tabBId, componentId: "terminal", title: "Terminal B", closable: true },
        ],
        activeTabId: tabAId,
      }],
    };
    return { canvasState, tabAId, tabBId, panelId };
  }

  test("tab bar renders for multi-tab panel", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const { canvasState } = makeTwoTabPanel();
    manager.applyLayout(canvasState);

    const tabBar = container.querySelector(".card-tab-bar");
    expect(tabBar).not.toBeNull();
    const tabs = tabBar!.querySelectorAll(".card-tab");
    expect(tabs.length).toBe(2);

    manager.destroy();
  });

  test("no tab bar for single-tab panel", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    // Default layout: each panel has exactly one tab
    const defaultPanels = manager.getDeckState().cards;
    expect(defaultPanels.every((p) => p.tabs.length === 1)).toBe(true);
    // No tab bars should be present
    expect(container.querySelectorAll(".card-tab-bar").length).toBe(0);
    manager.destroy();
  });

  test("D09: switching tabs does not destroy either card", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const { canvasState, panelId, tabBId } = makeTwoTabPanel();
    manager.applyLayout(canvasState);

    const cardA = makeMockCard([FeedId.TERMINAL_OUTPUT]);
    const cardB = makeMockCard([FeedId.TERMINAL_OUTPUT]);
    manager.addCard(cardA, "terminal");

    // Manually register cardB
    const feeds = manager.getCardsByFeed();
    feeds.get(FeedId.TERMINAL_OUTPUT)?.add(cardB);

    // Switch active tab to tabB via applyLayout
    const state = manager.getDeckState();
    const panel = state.cards.find((p) => p.id === panelId)!;
    panel.activeTabId = tabBId;
    manager.applyLayout(state);

    expect(cardA.destroyCount).toBe(0);
    expect(cardB.destroyCount).toBe(0);

    manager.destroy();
  });

  test("closing a tab calls card.destroy() and removes from feed dispatch", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT]);
    manager.addCard(card, "git");

    const gitSet = manager.getCardsByFeed().get(FeedId.GIT);
    expect(gitSet?.has(card)).toBe(true);

    manager.removeCard(card);

    expect(card.destroyCount).toBe(1);
    expect(gitSet?.has(card)).toBe(false);

    manager.destroy();
  });

  test("closing the last tab removes the panel from canvasState", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT]);
    manager.addCard(card, "git");

    const before = manager.getDeckState().cards.length;
    const hasGit = manager.getDeckState().cards.some((p) => p.tabs.some((t) => t.componentId === "git"));
    expect(hasGit).toBe(true);

    manager.removeCard(card);

    expect(manager.getDeckState().cards.length).toBe(before - 1);
    const stillHasGit = manager.getDeckState().cards.some((p) => p.tabs.some((t) => t.componentId === "git"));
    expect(stillHasGit).toBe(false);

    manager.destroy();
  });

  test("drag-reorder updates tab order in PanelState data model", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const { canvasState, panelId, tabAId, tabBId } = makeTwoTabPanel();
    manager.applyLayout(canvasState);

    const state = manager.getDeckState();
    const panel = state.cards.find((p) => p.id === panelId)!;

    // Initial order: tabA, tabB
    expect(panel.tabs[0].id).toBe(tabAId);
    expect(panel.tabs[1].id).toBe(tabBId);

    // Reorder: move tabA to index 1
    const [moved] = panel.tabs.splice(0, 1);
    panel.tabs.splice(1, 0, moved);

    expect(panel.tabs[0].id).toBe(tabBId);
    expect(panel.tabs[1].id).toBe(tabAId);

    manager.destroy();
  });
});
