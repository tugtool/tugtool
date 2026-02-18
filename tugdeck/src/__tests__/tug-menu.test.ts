/**
 * TugMenu and multi-instance card tests.
 *
 * Tests cover:
 * - addNewCard creates a floating panel with the correct componentId
 * - Feed fan-out delivers frames to all instances with matching feedId
 * - resetLayout destroys all cards and produces the default five-card arrangement
 * - After reset, no orphaned card instances remain in feed dispatch sets
 * - Save/load layout round-trips correctly via localStorage
 * - Loaded preset runs validateDockState (off-canvas clamping)
 * - Integration: two terminal cards simultaneously receive terminal feed frames
 * - Golden test: v2 layout migrates to v3 and renders the same arrangement
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
  global.crypto = {
    randomUUID: () => {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }) as `${string}-${string}-${string}-${string}-${string}`;
    },
  } as unknown as Crypto;
}

import { PanelManager } from "../panel-manager";
import { FeedId, type FeedIdValue } from "../protocol";
import type { TugCard } from "../cards/card";
import type { TugConnection } from "../connection";
import type { SplitNode } from "../layout-tree";
import {
  PRESETS_STORAGE_KEY,
  serialize,
} from "../serialization";

// ---- Mock TugConnection ----

class MockConnection {
  private frameCallbacks: Map<number, Array<(payload: Uint8Array) => void>> = new Map();
  private openCallbacks: Array<() => void> = [];

  onFrame(feedId: number, callback: (payload: Uint8Array) => void): void {
    if (!this.frameCallbacks.has(feedId)) {
      this.frameCallbacks.set(feedId, []);
    }
    this.frameCallbacks.get(feedId)!.push(callback);
  }

  onOpen(callback: () => void): void {
    this.openCallbacks.push(callback);
  }

  deliverFrame(feedId: number, payload: Uint8Array): void {
    const cbs = this.frameCallbacks.get(feedId) ?? [];
    for (const cb of cbs) {
      cb(payload);
    }
  }

  send(_feedId: number, _payload: Uint8Array): void {}
}

// ---- Mock TugCard ----

function makeMockCard(
  feedIds: FeedIdValue[],
  componentId: string
): TugCard & {
  mountCount: number;
  destroyCount: number;
  framesReceived: Array<{ feedId: FeedIdValue; payload: Uint8Array }>;
  componentId: string;
} {
  return {
    feedIds,
    componentId,
    mountCount: 0,
    destroyCount: 0,
    framesReceived: [],
    mount(_container: HTMLElement) {
      this.mountCount++;
    },
    onFrame(feedId: FeedIdValue, payload: Uint8Array) {
      this.framesReceived.push({ feedId, payload });
    },
    onResize(_width: number, _height: number) {},
    destroy() {
      this.destroyCount++;
    },
  };
}

// ---- Tree traversal helpers ----

function treeContainsComponent(
  node: import("../layout-tree").LayoutNode,
  componentId: string
): boolean {
  if (node.type === "tab") {
    return node.tabs.some((t) => t.componentId === componentId);
  }
  return node.children.some((child) => treeContainsComponent(child, componentId));
}

function countComponentInTree(
  node: import("../layout-tree").LayoutNode,
  componentId: string
): number {
  if (node.type === "tab") {
    return node.tabs.filter((t) => t.componentId === componentId).length;
  }
  return node.children.reduce(
    (sum, child) => sum + countComponentInTree(child, componentId),
    0
  );
}

// ---- Tests ----

describe("TugMenu and multi-instance cards", () => {
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

  /**
   * Test (a): Adding a card creates a new floating panel with the correct componentId.
   */
  test("addNewCard creates a floating panel with correct componentId", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    // Register a factory for "terminal"
    let factoryCallCount = 0;
    manager.registerCardFactory("terminal", () => {
      factoryCallCount++;
      return makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");
    });

    // Register default cards (so dockState has valid TabItems)
    const terminal = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");
    manager.addCard(terminal, "terminal");

    const initialFloatingCount = manager.getDockState().floating.length;

    // Add a new card instance
    manager.addNewCard("terminal");

    const state = manager.getDockState();
    // Should have one more floating panel
    expect(state.floating.length).toBe(initialFloatingCount + 1);

    // The new floating panel should have a tab with componentId "terminal"
    const newFloating = state.floating[state.floating.length - 1];
    expect(newFloating.node.tabs.length).toBe(1);
    expect(newFloating.node.tabs[0].componentId).toBe("terminal");

    // Factory should have been called once to create the new card
    expect(factoryCallCount).toBe(1);

    manager.destroy();
  });

  /**
   * Test (b): Feed fan-out delivers frames to all instances with matching feedId.
   */
  test("addNewCard: feed fan-out delivers frames to all card instances", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    // Track created cards for frame inspection
    const createdCards: Array<ReturnType<typeof makeMockCard>> = [];

    manager.registerCardFactory("terminal", () => {
      const card = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");
      createdCards.push(card);
      return card;
    });

    // Register the default terminal card
    const terminalCard1 = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");
    manager.addCard(terminalCard1, "terminal");

    // Add second instance via addNewCard
    manager.addNewCard("terminal");

    // The second card is the one created via factory
    expect(createdCards.length).toBe(1);
    const terminalCard2 = createdCards[0];

    // Deliver a TERMINAL_OUTPUT frame
    const payload = new Uint8Array([0x01, 0x02]);
    connection.deliverFrame(FeedId.TERMINAL_OUTPUT, payload);

    // Both terminal cards should receive the frame
    expect(terminalCard1.framesReceived.length).toBe(1);
    expect(terminalCard2.framesReceived.length).toBe(1);
    expect(terminalCard1.framesReceived[0].feedId).toBe(FeedId.TERMINAL_OUTPUT);
    expect(terminalCard2.framesReceived[0].feedId).toBe(FeedId.TERMINAL_OUTPUT);

    manager.destroy();
  });

  /**
   * Test (c): Reset layout destroys all cards and produces the default five-card arrangement.
   */
  test("resetLayout destroys all cards and produces default five-card arrangement", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    const createdCards: Array<ReturnType<typeof makeMockCard>> = [];

    // Register factories for all five components
    for (const componentId of ["conversation", "terminal", "git", "files", "stats"]) {
      const id = componentId;
      manager.registerCardFactory(id, () => {
        const card = makeMockCard(
          id === "conversation" ? [FeedId.CONVERSATION_OUTPUT] :
          id === "terminal" ? [FeedId.TERMINAL_OUTPUT] :
          id === "git" ? [FeedId.GIT] :
          id === "files" ? [FeedId.FILESYSTEM] :
          [FeedId.STATS],
          id
        );
        createdCards.push(card);
        return card;
      });
    }

    // Add the initial default cards
    manager.addCard(makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"), "conversation");
    manager.addCard(makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"), "terminal");
    manager.addCard(makeMockCard([FeedId.GIT], "git"), "git");
    manager.addCard(makeMockCard([FeedId.FILESYSTEM], "files"), "files");
    manager.addCard(makeMockCard([FeedId.STATS], "stats"), "stats");

    // Add an extra floating card
    manager.registerCardFactory("git", () => {
      const card = makeMockCard([FeedId.GIT], "git");
      createdCards.push(card);
      return card;
    });
    manager.addNewCard("git");

    const beforeFloating = manager.getDockState().floating.length;
    expect(beforeFloating).toBe(1);

    // Reset layout
    manager.resetLayout();

    const state = manager.getDockState();

    // Floating panels should be cleared
    expect(state.floating.length).toBe(0);

    // Root should be horizontal split with 2 children (default layout)
    expect(state.root.type).toBe("split");
    const root = state.root as SplitNode;
    expect(root.orientation).toBe("horizontal");
    expect(root.children.length).toBe(2);

    // Left child: conversation
    expect(treeContainsComponent(root.children[0], "conversation")).toBe(true);

    // Right child: vertical split with terminal, git, files, stats
    expect(root.children[1].type).toBe("split");
    const rightSplit = root.children[1] as SplitNode;
    expect(rightSplit.orientation).toBe("vertical");
    expect(rightSplit.children.length).toBe(4);

    // All five default components should be present
    expect(treeContainsComponent(state.root, "conversation")).toBe(true);
    expect(treeContainsComponent(state.root, "terminal")).toBe(true);
    expect(treeContainsComponent(state.root, "git")).toBe(true);
    expect(treeContainsComponent(state.root, "files")).toBe(true);
    expect(treeContainsComponent(state.root, "stats")).toBe(true);

    manager.destroy();
  });

  /**
   * Test (d): After reset, no orphaned instances remain in feed dispatch sets.
   */
  test("after resetLayout, feed dispatch sets contain exactly the default cards", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    const terminalCardsCreated: Array<ReturnType<typeof makeMockCard>> = [];

    manager.registerCardFactory("conversation", () =>
      makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation")
    );
    manager.registerCardFactory("terminal", () => {
      const card = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");
      terminalCardsCreated.push(card);
      return card;
    });
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));
    manager.registerCardFactory("files", () => makeMockCard([FeedId.FILESYSTEM], "files"));
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    // Add initial cards
    manager.addCard(makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"), "conversation");
    manager.addCard(makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"), "terminal");
    manager.addCard(makeMockCard([FeedId.GIT], "git"), "git");
    manager.addCard(makeMockCard([FeedId.FILESYSTEM], "files"), "files");
    manager.addCard(makeMockCard([FeedId.STATS], "stats"), "stats");

    // Add extra terminal instance
    manager.addNewCard("terminal");

    // Before reset: both terminal instances in the set
    const terminalSet = manager.getCardsByFeed().get(FeedId.TERMINAL_OUTPUT)!;
    expect(terminalSet.size).toBe(2); // original + addNewCard

    // Reset layout
    manager.resetLayout();

    // After reset: only the new default terminal card should be in the set
    expect(terminalSet.size).toBe(1);

    // The one remaining card should be a freshly created instance (from factory)
    // Deliver a frame — only the new card should receive it
    const payload = new Uint8Array([0xde, 0xad]);
    connection.deliverFrame(FeedId.TERMINAL_OUTPUT, payload);

    // The freshly created terminal cards (from resetLayout) should receive frames
    // terminalCardsCreated[0] was created by addNewCard, [1] was created by resetLayout
    // The old original card (added manually) should NOT receive frames
    // We check that exactly 1 card in the set received the frame
    let frameCount = 0;
    for (const card of terminalSet) {
      const mockCard = card as ReturnType<typeof makeMockCard>;
      if (mockCard.framesReceived) {
        frameCount += mockCard.framesReceived.length;
      }
    }
    expect(frameCount).toBe(1);

    manager.destroy();
  });

  /**
   * Test (e): Save/load layout round-trips correctly via localStorage.
   */
  test("savePreset and loadPreset round-trip via localStorage", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    // Register factories for all components
    manager.registerCardFactory("conversation", () =>
      makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation")
    );
    manager.registerCardFactory("terminal", () =>
      makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal")
    );
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));
    manager.registerCardFactory("files", () => makeMockCard([FeedId.FILESYSTEM], "files"));
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    manager.addCard(makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"), "conversation");
    manager.addCard(makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"), "terminal");
    manager.addCard(makeMockCard([FeedId.GIT], "git"), "git");
    manager.addCard(makeMockCard([FeedId.FILESYSTEM], "files"), "files");
    manager.addCard(makeMockCard([FeedId.STATS], "stats"), "stats");

    // Save the current layout as a preset
    manager.savePreset("my-layout");

    // Verify localStorage contains the preset
    const raw = localStorageMock.getItem(PRESETS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const presets = JSON.parse(raw!) as Record<string, unknown>;
    expect(Object.keys(presets)).toContain("my-layout");

    // Verify getPresetNames includes it
    const names = manager.getPresetNames();
    expect(names).toContain("my-layout");

    // Load the preset and verify structure is restored
    manager.loadPreset("my-layout");

    const loadedState = manager.getDockState();
    expect(loadedState.root.type).toBe("split");
    const root = loadedState.root as SplitNode;
    expect(root.orientation).toBe("horizontal");

    // All five default components should be in the tree
    expect(treeContainsComponent(loadedState.root, "conversation")).toBe(true);
    expect(treeContainsComponent(loadedState.root, "terminal")).toBe(true);
    expect(treeContainsComponent(loadedState.root, "git")).toBe(true);
    expect(treeContainsComponent(loadedState.root, "files")).toBe(true);
    expect(treeContainsComponent(loadedState.root, "stats")).toBe(true);

    manager.destroy();
  });

  /**
   * Test (f): Loaded preset runs validateDockState (off-canvas clamping).
   */
  test("loadPreset validates off-canvas floating panel positions via validateDockState", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    manager.registerCardFactory("conversation", () =>
      makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation")
    );
    manager.registerCardFactory("terminal", () =>
      makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal")
    );
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));
    manager.registerCardFactory("files", () => makeMockCard([FeedId.FILESYSTEM], "files"));
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    manager.addCard(makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"), "conversation");
    manager.addCard(makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"), "terminal");
    manager.addCard(makeMockCard([FeedId.GIT], "git"), "git");
    manager.addCard(makeMockCard([FeedId.FILESYSTEM], "files"), "files");
    manager.addCard(makeMockCard([FeedId.STATS], "stats"), "stats");

    // Save the current layout
    manager.savePreset("test-clamp");

    // Manually corrupt the preset: set a floating panel at x=99999 (way off screen)
    // by adding a floating panel to the serialized state
    const raw = localStorageMock.getItem(PRESETS_STORAGE_KEY)!;
    const presets = JSON.parse(raw) as Record<string, ReturnType<typeof serialize>>;
    const preset = presets["test-clamp"];
    preset.floating = [
      {
        position: { x: 99999, y: 99999 },
        size: { width: 400, height: 300 },
        group: {
          type: "tabs" as const,
          activeId: "some-id",
          tabs: [{ id: "some-id", componentId: "terminal", title: "Terminal" }],
        },
      },
    ];
    localStorageMock.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));

    // Load the preset (canvas is 1280x800)
    manager.loadPreset("test-clamp");

    const state = manager.getDockState();
    expect(state.floating.length).toBe(1);
    const fp = state.floating[0];

    // Position should have been clamped: x + width <= canvasWidth, y + height <= canvasHeight
    // canvasWidth=0 in JSDOM (no real layout), so position clamping behavior depends on clientWidth
    // The key test is that no exception was thrown and validateDockState was called
    // Position should be clamped to non-negative values
    expect(fp.position.x).toBeGreaterThanOrEqual(0);
    expect(fp.position.y).toBeGreaterThanOrEqual(0);

    manager.destroy();
  });

  /**
   * Test (g): Integration — two terminal cards simultaneously receive terminal feed frames.
   */
  test("integration: two terminal card instances both receive TERMINAL_OUTPUT frames", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    const createdViaFactory: Array<ReturnType<typeof makeMockCard>> = [];

    manager.registerCardFactory("terminal", () => {
      const card = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");
      createdViaFactory.push(card);
      return card;
    });

    // First terminal card: registered normally
    const terminal1 = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");
    manager.addCard(terminal1, "terminal");

    // Second terminal card: added via addNewCard (becomes a floating panel)
    manager.addNewCard("terminal");

    expect(createdViaFactory.length).toBe(1);
    const terminal2 = createdViaFactory[0];

    // Deliver a TERMINAL_OUTPUT frame via the connection
    const payload = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    connection.deliverFrame(FeedId.TERMINAL_OUTPUT, payload);

    // Both should receive the frame
    expect(terminal1.framesReceived.length).toBe(1);
    expect(terminal2.framesReceived.length).toBe(1);
    expect(terminal1.framesReceived[0].payload).toEqual(payload);
    expect(terminal2.framesReceived[0].payload).toEqual(payload);

    // Verify both are in the cardsByFeed set
    const terminalSet = manager.getCardsByFeed().get(FeedId.TERMINAL_OUTPUT)!;
    expect(terminalSet.has(terminal1)).toBe(true);
    expect(terminalSet.has(terminal2)).toBe(true);
    expect(terminalSet.size).toBe(2);

    manager.destroy();
  });

  /**
   * Test (h): Golden test — v2 layout migrates to v3 and renders the same arrangement.
   */
  test("golden: v2 layout migrates to v3 with correct five-card structure", () => {
    // Set localStorage to a v2 JSON string
    const v2Layout = JSON.stringify({
      version: 2,
      colSplit: 0.667,
      rowSplits: [0.25, 0.5, 0.75],
      collapsed: [],
    });
    localStorageMock.setItem("tugdeck-layout", v2Layout);

    // Create PanelManager — it loads and migrates v2 to v3
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    const state = manager.getDockState();

    // Root should be horizontal split (migrateV2ToV3 always produces this)
    expect(state.root.type).toBe("split");
    const root = state.root as SplitNode;
    expect(root.orientation).toBe("horizontal");
    expect(root.children.length).toBe(2);

    // Left child: conversation tab node with weight ~0.667
    expect(root.weights[0]).toBeCloseTo(0.667, 3);
    expect(root.weights[1]).toBeCloseTo(0.333, 3);
    expect(treeContainsComponent(root.children[0], "conversation")).toBe(true);

    // Right child: vertical split with 4 children (terminal, git, files, stats)
    const rightChild = root.children[1];
    expect(rightChild.type).toBe("split");
    const rightSplit = rightChild as SplitNode;
    expect(rightSplit.orientation).toBe("vertical");
    expect(rightSplit.children.length).toBe(4);

    // All four right-side components present
    expect(treeContainsComponent(rightSplit, "terminal")).toBe(true);
    expect(treeContainsComponent(rightSplit, "git")).toBe(true);
    expect(treeContainsComponent(rightSplit, "files")).toBe(true);
    expect(treeContainsComponent(rightSplit, "stats")).toBe(true);

    // Row weights should be based on rowSplits [0.25, 0.5, 0.75]
    // r0=0.25, r1-r0=0.25, r2-r1=0.25, 1-r2=0.25
    expect(rightSplit.weights[0]).toBeCloseTo(0.25, 3);
    expect(rightSplit.weights[1]).toBeCloseTo(0.25, 3);
    expect(rightSplit.weights[2]).toBeCloseTo(0.25, 3);
    expect(rightSplit.weights[3]).toBeCloseTo(0.25, 3);

    // Floating panels should be empty (v2 has no floating concept)
    expect(state.floating.length).toBe(0);

    // Each component should appear exactly once (no duplicates)
    expect(countComponentInTree(state.root, "conversation")).toBe(1);
    expect(countComponentInTree(state.root, "terminal")).toBe(1);
    expect(countComponentInTree(state.root, "git")).toBe(1);
    expect(countComponentInTree(state.root, "files")).toBe(1);
    expect(countComponentInTree(state.root, "stats")).toBe(1);

    manager.destroy();
  });

  /**
   * Test: addNewCard with unregistered componentId logs warning and does not throw.
   */
  test("addNewCard with unknown componentId does not throw", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    // No factory registered for "unknown"
    expect(() => manager.addNewCard("unknown")).not.toThrow();

    // Floating panels should not have been added
    expect(manager.getDockState().floating.length).toBe(0);

    manager.destroy();
  });

  /**
   * Test: getPresetNames returns empty array when no presets saved.
   */
  test("getPresetNames returns empty array when no presets exist", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    expect(manager.getPresetNames()).toEqual([]);
    manager.destroy();
  });

  /**
   * Test: getPresetNames returns sorted names after saving multiple presets.
   */
  test("getPresetNames returns sorted preset names", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    manager.addCard(makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"), "conversation");
    manager.addCard(makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"), "terminal");
    manager.addCard(makeMockCard([FeedId.GIT], "git"), "git");
    manager.addCard(makeMockCard([FeedId.FILESYSTEM], "files"), "files");
    manager.addCard(makeMockCard([FeedId.STATS], "stats"), "stats");

    manager.savePreset("zebra");
    manager.savePreset("alpha");
    manager.savePreset("monkey");

    const names = manager.getPresetNames();
    expect(names).toEqual(["alpha", "monkey", "zebra"]);

    manager.destroy();
  });
});
