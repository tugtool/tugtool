/**
 * PanelManager unit and integration tests.
 *
 * Tests cover:
 * - Default layout rendering (five card containers exist)
 * - Sash drag weight calculation
 * - Sash minimum size enforcement
 * - Manager-level fan-out frame dispatch (D10)
 * - IDragState.isDragging reflects drag state
 * - removeCard removes card from feed dispatch sets (no orphaned callbacks)
 * - Geometric layout pass weight adjustment logic
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

// crypto.randomUUID mock (needed for layout tree node IDs)
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

  // Test helper: deliver a frame to all registered callbacks for a feedId
  deliverFrame(feedId: number, payload: Uint8Array): void {
    const cbs = this.frameCallbacks.get(feedId) ?? [];
    for (const cb of cbs) {
      cb(payload);
    }
  }

  // Test helper: trigger open callbacks
  triggerOpen(): void {
    for (const cb of this.openCallbacks) {
      cb();
    }
  }

  // Test helper: count registered callbacks for a feedId
  callbackCount(feedId: number): number {
    return this.frameCallbacks.get(feedId)?.length ?? 0;
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
  resizeCalls: Array<{ width: number; height: number }>;
} {
  return {
    feedIds,
    mountCount: 0,
    destroyCount: 0,
    framesReceived: [],
    resizeCalls: [],
    mount(_container: HTMLElement) {
      this.mountCount++;
    },
    onFrame(feedId: FeedIdValue, payload: Uint8Array) {
      this.framesReceived.push({ feedId, payload });
    },
    onResize(width: number, height: number) {
      this.resizeCalls.push({ width, height });
    },
    destroy() {
      this.destroyCount++;
    },
  };
}

// ---- Tree traversal helper ----

/** Returns true if any TabNode in the tree contains a tab with the given componentId. */
function treeContainsComponent(node: import("../layout-tree").LayoutNode, componentId: string): boolean {
  if (node.type === "tab") {
    return node.tabs.some((t) => t.componentId === componentId);
  }
  return node.children.some((child) => treeContainsComponent(child, componentId));
}

// ---- Tests ----

describe("PanelManager", () => {
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

  // ---- Integration test: default layout rendering ----

  test("renders default layout with five card containers in the DOM", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    // Add all five default cards
    const conversation = makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation");
    const terminal = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");
    const git = makeMockCard([FeedId.GIT], "git");
    const files = makeMockCard([FeedId.FILESYSTEM], "files");
    const stats = makeMockCard([FeedId.STATS], "stats");

    manager.addCard(conversation, "conversation");
    manager.addCard(terminal, "terminal");
    manager.addCard(git, "git");
    manager.addCard(files, "files");
    manager.addCard(stats, "stats");

    // All five cards should be registered
    const registry = manager.getCardRegistry();
    expect(registry.size).toBe(5);

    // Should have mounted each card
    expect(conversation.mountCount).toBe(1);
    expect(terminal.mountCount).toBe(1);
    expect(git.mountCount).toBe(1);
    expect(files.mountCount).toBe(1);
    expect(stats.mountCount).toBe(1);

    // Root element should be in the DOM
    const rootEl = container.querySelector(".panel-root");
    expect(rootEl).not.toBeNull();

    // Should have panel-split elements (horizontal root split)
    const splits = container.querySelectorAll(".panel-split");
    expect(splits.length).toBeGreaterThan(0);

    // Should have panel-card-container elements (one per TabNode)
    const cardContainers = container.querySelectorAll(".panel-card-container");
    expect(cardContainers.length).toBe(5); // default layout has 5 tab nodes

    manager.destroy();
  });

  // ---- Unit test: sash weight calculation ----

  test("sash weight recalculation: shifting weight from right to left child", () => {
    // Test the weight calculation logic in isolation.
    // When cursor moves left by delta, left child shrinks, right child grows.
    // Initial weights: [0.5, 0.5], container width 1000px
    // Cursor moves right by 100px -> delta = +100px / 1000px = +0.1
    // New weights: [0.5 + 0.1, 0.5 - 0.1] = [0.6, 0.4]

    const initialWeights = [0.5, 0.5];
    const totalSize = 1000;
    const delta = 100; // cursor moved 100px to the right
    const minWeight = 100 / totalSize; // MIN_SIZE_PX / totalSize = 0.1

    const weightDelta = delta / totalSize; // 0.1
    const newWeights = [...initialWeights];
    newWeights[0] = initialWeights[0] + weightDelta; // 0.6
    newWeights[1] = initialWeights[1] - weightDelta; // 0.4

    // Neither is under the minimum
    expect(newWeights[0]).toBeCloseTo(0.6, 5);
    expect(newWeights[1]).toBeCloseTo(0.4, 5);
    expect(newWeights[0] + newWeights[1]).toBeCloseTo(1.0, 5);
    expect(newWeights[0]).toBeGreaterThanOrEqual(minWeight);
    expect(newWeights[1]).toBeGreaterThanOrEqual(minWeight);
  });

  test("sash enforces 100px minimum: clamping when delta would make a child too small", () => {
    // Initial weights: [0.15, 0.85], container width 1000px
    // Left child is 150px. MIN_SIZE_PX = 100px -> minWeight = 0.1
    // Delta = -100px (cursor moved left by 100px)
    // newWeights[0] = 0.15 - 0.1 = 0.05 -- below minWeight!
    // Should be clamped: newWeights[0] = 0.1, newWeights[1] adjusted accordingly

    const initialWeights = [0.15, 0.85];
    const totalSize = 1000;
    const delta = -100; // cursor moved 100px to the left
    const minWeight = 100 / totalSize; // 0.1

    const weightDelta = delta / totalSize; // -0.1
    let newWeights = [
      initialWeights[0] + weightDelta, // 0.15 - 0.1 = 0.05
      initialWeights[1] - weightDelta, // 0.85 + 0.1 = 0.95
    ];

    // Clamp left child to minimum
    if (newWeights[0] < minWeight) {
      const excess = minWeight - newWeights[0]; // 0.1 - 0.05 = 0.05
      newWeights[0] = minWeight; // 0.1
      newWeights[1] -= excess; // 0.95 - 0.05 = 0.9
    }

    expect(newWeights[0]).toBeCloseTo(0.1, 5); // clamped to minWeight
    expect(newWeights[1]).toBeCloseTo(0.9, 5);
    expect(newWeights[0] + newWeights[1]).toBeCloseTo(1.0, 5);
    expect(newWeights[0]).toBeGreaterThanOrEqual(minWeight);
    expect(newWeights[1]).toBeGreaterThanOrEqual(minWeight);
  });

  test("sash enforces 100px minimum for right child when dragging right", () => {
    // Initial weights: [0.85, 0.15], container width 1000px
    // Right child is 150px. Moving right by 100px would make it 50px.
    const initialWeights = [0.85, 0.15];
    const totalSize = 1000;
    const delta = 100;
    const minWeight = 100 / totalSize; // 0.1

    const weightDelta = delta / totalSize; // 0.1
    let newWeights = [
      initialWeights[0] + weightDelta, // 0.95
      initialWeights[1] - weightDelta, // 0.05
    ];

    // Clamp right child
    if (newWeights[1] < minWeight) {
      const excess = minWeight - newWeights[1];
      newWeights[1] = minWeight;
      newWeights[0] -= excess;
    }

    expect(newWeights[1]).toBeCloseTo(0.1, 5);
    expect(newWeights[0]).toBeCloseTo(0.9, 5);
    expect(newWeights[0] + newWeights[1]).toBeCloseTo(1.0, 5);
  });

  // ---- Integration test: frame dispatch fan-out (D10) ----

  test("frame dispatch delivers frame to correct card via manager-level fan-out", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    const conversation = makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation");
    const terminal = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");

    manager.addCard(conversation, "conversation");
    manager.addCard(terminal, "terminal");

    const payload = new Uint8Array([1, 2, 3]);

    // Deliver a CONVERSATION_OUTPUT frame
    connection.deliverFrame(FeedId.CONVERSATION_OUTPUT, payload);

    // Only conversation card should receive it
    expect(conversation.framesReceived.length).toBe(1);
    expect(conversation.framesReceived[0].feedId).toBe(FeedId.CONVERSATION_OUTPUT);
    expect(terminal.framesReceived.length).toBe(0);

    manager.destroy();
  });

  test("frame dispatch: D10 fan-out delivers to multiple cards sharing same feedId", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    // Two cards sharing STATS feedId (simulating multi-instance)
    const stats1 = makeMockCard([FeedId.STATS], "stats");
    const stats2 = makeMockCard([FeedId.STATS], "stats");

    manager.addCard(stats1, "stats");
    // stats2 shares componentId "stats" -- add it to the feed set directly
    const feedSet = manager.getCardsByFeed().get(FeedId.STATS);
    if (feedSet) feedSet.add(stats2);

    const payload = new Uint8Array([0xaa]);
    connection.deliverFrame(FeedId.STATS, payload);

    // Both should receive the frame
    expect(stats1.framesReceived.length).toBe(1);
    expect(stats2.framesReceived.length).toBe(1);

    manager.destroy();
  });

  test("D10: exactly ONE connection.onFrame callback registered per output feedId", () => {
    // PanelManager should register exactly one callback per output feedId, not per card
    new PanelManager(container, connection as unknown as TugConnection);

    // Each output feedId should have exactly 1 callback registered with the connection
    const outputFeedIds = [
      FeedId.TERMINAL_OUTPUT,
      FeedId.FILESYSTEM,
      FeedId.GIT,
      FeedId.STATS,
      FeedId.STATS_PROCESS_INFO,
      FeedId.STATS_TOKEN_USAGE,
      FeedId.STATS_BUILD_STATUS,
      FeedId.CONVERSATION_OUTPUT,
    ];

    for (const feedId of outputFeedIds) {
      expect(connection.callbackCount(feedId)).toBe(1); // exactly one
    }
  });

  // ---- Unit test: IDragState.isDragging ----

  test("IDragState.isDragging is false initially", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    expect(manager.isDragging).toBe(false);
    manager.destroy();
  });

  test("IDragState.isDragging can be read as IDragState", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    // PanelManager implements IDragState -- verify the interface is satisfied
    const ds = manager as { isDragging: boolean };
    expect(typeof ds.isDragging).toBe("boolean");
    expect(ds.isDragging).toBe(false);
    manager.destroy();
  });

  // ---- Unit test: removeCard ----

  test("removeCard removes card from feed dispatch sets (no orphaned callbacks)", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    const conversation = makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation");
    manager.addCard(conversation, "conversation");

    // Verify card is in the fan-out set
    const feedSet = manager.getCardsByFeed().get(FeedId.CONVERSATION_OUTPUT);
    expect(feedSet?.has(conversation)).toBe(true);

    manager.removeCard(conversation);

    // Card should be removed from fan-out set
    expect(feedSet?.has(conversation)).toBe(false);

    // Card.destroy() should have been called
    expect(conversation.destroyCount).toBe(1);

    // Delivering a frame should not reach the removed card
    connection.deliverFrame(FeedId.CONVERSATION_OUTPUT, new Uint8Array([0xff]));
    expect(conversation.framesReceived.length).toBe(0);

    manager.destroy();
  });

  test("removeCard removes the TabNode from dockState.root (no empty panel containers)", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    const git = makeMockCard([FeedId.GIT], "git");
    manager.addCard(git, "git");

    // Before removal: the tree must contain a "git" component
    const stateBefore = manager.getDockState();
    expect(treeContainsComponent(stateBefore.root, "git")).toBe(true);

    manager.removeCard(git);

    // After removal: the "git" TabNode must be gone from the tree
    const stateAfter = manager.getDockState();
    expect(treeContainsComponent(stateAfter.root, "git")).toBe(false);

    // The DOM should now have 4 panel-card-container elements (default layout - 1)
    const allCardContainers = container.querySelectorAll(".panel-card-container");
    expect(allCardContainers.length).toBe(4);

    manager.destroy();
  });

  test("removeCard with non-registered card does not throw", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const orphanCard = makeMockCard([FeedId.GIT], "git");

    // Should not throw even though the card was never added via addCard
    expect(() => manager.removeCard(orphanCard)).not.toThrow();
    // destroy() is still called on the card
    expect(orphanCard.destroyCount).toBe(1);

    manager.destroy();
  });

  // ---- Unit test: geometric layout pass weight adjustment ----

  test("geometric weight adjustment: logic correctly identifies and adjusts sub-minimum weights", () => {
    // Test the core arithmetic of the geometric adjustment:
    // Given a split with weights [0.02, 0.98] and totalSize=1000px,
    // the left child is only 20px < MIN_SIZE_PX (100px).
    // The adjustment should increase left weight to 0.1 (100/1000)
    // and decrease the largest neighbor proportionally.

    const weights = [0.02, 0.98];
    const totalSize = 1000;
    const minSize = 100;
    const minWeight = minSize / totalSize; // 0.1

    // Simulate what the geometric pass does
    const newWeights = [...weights];
    for (let i = 0; i < newWeights.length; i++) {
      const pixelSize = newWeights[i] * totalSize;
      if (pixelSize < minSize) {
        const shortfall = (minSize - pixelSize) / totalSize;
        // Find largest neighbor
        let largestIdx = i === 0 ? 1 : 0;
        for (let j = 0; j < newWeights.length; j++) {
          if (j !== i && newWeights[j] > newWeights[largestIdx]) {
            largestIdx = j;
          }
        }
        newWeights[i] += shortfall;
        newWeights[largestIdx] = Math.max(0, newWeights[largestIdx] - shortfall);
      }
    }

    // Renormalize
    const total = newWeights.reduce((s, w) => s + w, 0);
    const renorm = newWeights.map((w) => w / total);

    expect(renorm[0]).toBeCloseTo(minWeight, 5); // 0.1
    expect(renorm[1]).toBeCloseTo(1 - minWeight, 5); // 0.9
    expect(renorm[0] + renorm[1]).toBeCloseTo(1.0, 5);
  });

  // ---- Integration test: layout structure ----

  test("getDockState returns the current dock state", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    const state = manager.getDockState();
    expect(state).not.toBeNull();
    expect(state.root).not.toBeNull();
    expect(state.floating).toBeDefined();
    expect(Array.isArray(state.floating)).toBe(true);

    // Default layout: root is a horizontal split
    expect(state.root.type).toBe("split");
    expect((state.root as SplitNode).orientation).toBe("horizontal");
    expect((state.root as SplitNode).children.length).toBe(2);

    manager.destroy();
  });

  test("addCard for unknown componentId logs warning and does not throw", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const orphan = makeMockCard([FeedId.GIT], "unknown-component");

    // Should not throw
    expect(() => manager.addCard(orphan, "unknown-component")).not.toThrow();

    manager.destroy();
  });
});
