/**
 * PanelManager unit and integration tests.
 *
 * Tests cover:
 * - Default layout renders 5 floating panels
 * - Manager-level fan-out frame dispatch (D10)
 * - IDragState.isDragging reflects drag state
 * - removeCard removes card from feed dispatch sets (no orphaned callbacks)
 * - addNewCard adds a panel to canvasState
 * - resetLayout rebuilds default 5 panels
 * - getCanvasState reflects current state
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

// requestAnimationFrame mock (not in happy-dom)
if (!global.requestAnimationFrame) {
  global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    setTimeout(() => cb(0), 0);
    return 0;
  };
}

import { PanelManager } from "../panel-manager";
import { FeedId, type FeedIdValue } from "../protocol";
import type { TugCard } from "../cards/card";
import type { TugConnection } from "../connection";

// ---- Mock TugConnection ----

class MockConnection {
  private frameCallbacks: Map<number, Array<(payload: Uint8Array) => void>> = new Map();
  private openCallbacks: Array<() => void> = [];

  onFrame(feedId: number, callback: (payload: Uint8Array) => void): void {
    if (!this.frameCallbacks.has(feedId)) this.frameCallbacks.set(feedId, []);
    this.frameCallbacks.get(feedId)!.push(callback);
  }
  onOpen(callback: () => void): void { this.openCallbacks.push(callback); }
  deliverFrame(feedId: number, payload: Uint8Array): void {
    const cbs = this.frameCallbacks.get(feedId) ?? [];
    for (const cb of cbs) cb(payload);
  }
  triggerOpen(): void { for (const cb of this.openCallbacks) cb(); }
  callbackCount(feedId: number): number { return this.frameCallbacks.get(feedId)?.length ?? 0; }
  send(_feedId: number, _payload: Uint8Array): void {}
}

// ---- Mock TugCard ----

function makeMockCard(
  feedIds: FeedIdValue[],
  _componentId: string
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
    mount(_container: HTMLElement) { this.mountCount++; },
    onFrame(feedId: FeedIdValue, payload: Uint8Array) { this.framesReceived.push({ feedId, payload }); },
    onResize(width: number, height: number) { this.resizeCalls.push({ width, height }); },
    destroy() { this.destroyCount++; },
  };
}

// ---- Helper: make container ----

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "1280px";
  el.style.height = "800px";
  document.body.appendChild(el);
  return el;
}

// ---- Tests ----

describe("PanelManager", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    container = makeContainer();
    connection = new MockConnection();
  });

  // ---- Default layout rendering ----

  test("renders default layout with 5 .floating-panel elements", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const panels = container.querySelectorAll(".floating-panel");
    expect(panels.length).toBe(5);
    manager.destroy();
  });

  test("getCanvasState returns 5 panels after construction", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const state = manager.getCanvasState();
    expect(state.panels.length).toBe(5);
    const componentIds = state.panels.map((p) => p.tabs[0].componentId);
    expect(componentIds).toContain("conversation");
    expect(componentIds).toContain("terminal");
    expect(componentIds).toContain("git");
    expect(componentIds).toContain("files");
    expect(componentIds).toContain("stats");
    manager.destroy();
  });

  test("panel-root element exists inside container", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    expect(container.querySelector(".panel-root")).not.toBeNull();
    manager.destroy();
  });

  test("addCard registers the card and mounts it", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT], "git");
    manager.addCard(card, "git");
    expect(manager.getCardRegistry().has !== undefined).toBe(true);
    let found = false;
    for (const [, c] of manager.getCardRegistry()) { if (c === card) { found = true; break; } }
    expect(found).toBe(true);
    manager.destroy();
  });

  // ---- D10: Fan-out frame dispatch ----

  test("D10: each output feedId has exactly one registered connection callback", () => {
    new PanelManager(container, connection as unknown as TugConnection);
    // PanelManager registers exactly one callback per output feedId
    expect(connection.callbackCount(FeedId.TERMINAL_OUTPUT)).toBe(1);
    expect(connection.callbackCount(FeedId.FILESYSTEM)).toBe(1);
    expect(connection.callbackCount(FeedId.GIT)).toBe(1);
    expect(connection.callbackCount(FeedId.STATS)).toBe(1);
    expect(connection.callbackCount(FeedId.CONVERSATION_OUTPUT)).toBe(1);
  });

  test("D10: frame delivered to all cards subscribed to that feedId", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card1 = makeMockCard([FeedId.GIT], "git");
    const card2 = makeMockCard([FeedId.GIT], "git");
    manager.addCard(card1, "git");

    // Manually register card2 to git feed (since git slot is taken, add via cardsByFeed)
    const feeds = manager.getCardsByFeed();
    feeds.get(FeedId.GIT)?.add(card2);

    const payload = new Uint8Array([1, 2, 3]);
    connection.deliverFrame(FeedId.GIT, payload);

    expect(card1.framesReceived.length).toBe(1);
    expect(card2.framesReceived.length).toBe(1);
    manager.destroy();
  });

  // ---- IDragState ----

  test("isDragging is false initially", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    expect(manager.isDragging).toBe(false);
    manager.destroy();
  });

  // ---- removeCard ----

  test("removeCard removes card from feed dispatch set", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT], "git");
    manager.addCard(card, "git");

    const gitSet = manager.getCardsByFeed().get(FeedId.GIT)!;
    expect(gitSet.has(card)).toBe(true);

    manager.removeCard(card);
    expect(gitSet.has(card)).toBe(false);
    expect(card.destroyCount).toBe(1);
    manager.destroy();
  });

  test("removeCard removes panel from canvasState when it has only one tab", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT], "git");
    manager.addCard(card, "git");

    const beforeCount = manager.getCanvasState().panels.length;
    manager.removeCard(card);
    expect(manager.getCanvasState().panels.length).toBe(beforeCount - 1);
    manager.destroy();
  });

  test("after removeCard, frame is no longer delivered to removed card", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT], "git");
    manager.addCard(card, "git");
    manager.removeCard(card);

    connection.deliverFrame(FeedId.GIT, new Uint8Array([42]));
    expect(card.framesReceived.length).toBe(0);
    manager.destroy();
  });

  // ---- addNewCard ----

  test("addNewCard increases panels count by 1", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("terminal", () => makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"));

    const before = manager.getCanvasState().panels.length;
    manager.addNewCard("terminal");
    expect(manager.getCanvasState().panels.length).toBe(before + 1);
    manager.destroy();
  });

  test("addNewCard adds a .floating-panel element to the container", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));

    const before = container.querySelectorAll(".floating-panel").length;
    manager.addNewCard("git");
    expect(container.querySelectorAll(".floating-panel").length).toBe(before + 1);
    manager.destroy();
  });

  test("addNewCard with unknown componentId logs warning and does not change state", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const before = manager.getCanvasState().panels.length;
    manager.addNewCard("unknown-component");
    expect(manager.getCanvasState().panels.length).toBe(before);
    manager.destroy();
  });

  // ---- resetLayout ----

  test("resetLayout re-renders 5 floating panels", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("conversation", () => makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"));
    manager.registerCardFactory("terminal", () => makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"));
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));
    manager.registerCardFactory("files", () => makeMockCard([FeedId.FILESYSTEM], "files"));
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    // Add extra card then reset
    manager.addNewCard("git");
    manager.resetLayout();

    expect(manager.getCanvasState().panels.length).toBe(5);
    manager.destroy();
  });

  // ---- applyLayout ----

  test("applyLayout replaces canvasState and re-renders", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const tabId = "al-tab-1";
    manager.applyLayout({
      panels: [{
        id: "al-panel-1",
        position: { x: 0, y: 0 },
        size: { width: 400, height: 300 },
        tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
        activeTabId: tabId,
      }],
    });
    expect(manager.getCanvasState().panels.length).toBe(1);
    expect(container.querySelectorAll(".floating-panel").length).toBe(1);
    manager.destroy();
  });

  // ---- Layout persistence ----

  test("serialize/deserialize round-trip via applyLayout and getCanvasState", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const tabId = "persist-tab-1";
    const testPanel = {
      id: "persist-panel-1",
      position: { x: 50, y: 75 },
      size: { width: 350, height: 250 },
      tabs: [{ id: tabId, componentId: "git", title: "Git", closable: true }],
      activeTabId: tabId,
    };
    manager.applyLayout({ panels: [testPanel] });

    const state = manager.getCanvasState();
    expect(state.panels[0].position.x).toBe(50);
    expect(state.panels[0].position.y).toBe(75);
    expect(state.panels[0].size.width).toBe(350);
    expect(state.panels[0].size.height).toBe(250);
    manager.destroy();
  });
});
