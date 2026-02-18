/**
 * Floating panel tests.
 *
 * Tests cover:
 * - FloatingPanel DOM creation and geometry from PanelState
 * - Z-order management on focus
 * - serialize/deserialize round-trip preserves panel positions (v4 format)
 * - PanelManager integration: floating panels in canvasState
 *
 * [D03] FloatingPanel accepts PanelState directly
 * [D06] Focus model with CSS class
 * [D09] Instance identity preservation
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

// Patch HTMLElement.prototype for setPointerCapture (not in happy-dom)
const htmlElementProto = Object.getPrototypeOf(document.createElement("div")) as Record<string, unknown>;
if (!htmlElementProto["setPointerCapture"]) {
  htmlElementProto["setPointerCapture"] = function () {};
}
if (!htmlElementProto["releasePointerCapture"]) {
  htmlElementProto["releasePointerCapture"] = function () {};
}

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
let uuidCounter = 0;
if (!global.crypto) {
  global.crypto = {} as unknown as Crypto;
}
(global.crypto as unknown as Record<string, unknown>)["randomUUID"] = () => {
  uuidCounter++;
  return `test-uuid-${uuidCounter}-xxxx-xxxx-xxxx-xxxxxxxxxxxx` as `${string}-${string}-${string}-${string}-${string}`;
};

// requestAnimationFrame mock (not in happy-dom)
if (!global.requestAnimationFrame) {
  global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    setTimeout(() => cb(0), 0);
    return 0;
  };
}

import { FloatingPanel, FLOATING_TITLE_BAR_HEIGHT } from "../floating-panel";
import { serialize, deserialize, buildDefaultLayout } from "../serialization";
import type { PanelState, TabItem } from "../layout-tree";
import { PanelManager } from "../panel-manager";
import { FeedId, type FeedIdValue } from "../protocol";
import type { TugCard } from "../cards/card";
import type { TugConnection } from "../connection";

// ---- Helpers ----

function makeCanvasEl(width = 1280, height = 800): HTMLElement {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.getBoundingClientRect = () => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

function makePanelState(
  x = 100,
  y = 100,
  width = 400,
  height = 300,
  title = "Test Panel"
): PanelState {
  const tabId = `tab-${++uuidCounter}`;
  return {
    id: `panel-${++uuidCounter}`,
    position: { x, y },
    size: { width, height },
    tabs: [{ id: tabId, componentId: "terminal", title, closable: true }],
    activeTabId: tabId,
  };
}

function makeCallbacks(): {
  callbacks: import("../floating-panel").FloatingPanelCallbacks;
  moveEndCalls: Array<{ x: number; y: number }>;
  resizeEndCalls: Array<{ x: number; y: number; width: number; height: number }>;
  focusCalls: number[];
  closeCalls: number[];
} {
  const moveEndCalls: Array<{ x: number; y: number }> = [];
  const resizeEndCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
  const focusCalls: number[] = [];
  const closeCalls: number[] = [];

  const callbacks: import("../floating-panel").FloatingPanelCallbacks = {
    onMoveEnd: (x, y) => moveEndCalls.push({ x, y }),
    onResizeEnd: (x, y, width, height) => resizeEndCalls.push({ x, y, width, height }),
    onFocus: () => focusCalls.push(1),
    onClose: () => closeCalls.push(1),
  };

  return { callbacks, moveEndCalls, resizeEndCalls, focusCalls, closeCalls };
}

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

function makeMockCard(feedIds: FeedIdValue[]): TugCard & { destroyCount: number } {
  return {
    feedIds,
    destroyCount: 0,
    mount(_el: HTMLElement) {},
    onFrame(_feedId: FeedIdValue, _payload: Uint8Array) {},
    onResize(_w: number, _h: number) {},
    destroy() { this.destroyCount++; },
  };
}

// ---- FloatingPanel DOM tests ----

describe("FloatingPanel – DOM creation from PanelState", () => {
  let canvas: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    canvas = makeCanvasEl();
    document.body.appendChild(canvas);
  });

  test("creates an element with class 'floating-panel'", () => {
    const ps = makePanelState(100, 150, 400, 300);
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    expect(fp.getElement().classList.contains("floating-panel")).toBe(true);
    fp.destroy();
  });

  test("positions element according to PanelState position", () => {
    const ps = makePanelState(200, 150, 400, 300);
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    expect(fp.getElement().style.left).toBe("200px");
    expect(fp.getElement().style.top).toBe("150px");
    fp.destroy();
  });

  test("sizes element according to PanelState size", () => {
    const ps = makePanelState(100, 100, 500, 400);
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    expect(fp.getElement().style.width).toBe("500px");
    expect(fp.getElement().style.height).toBe("400px");
    fp.destroy();
  });

  test("creates a panel-header with title from active tab", () => {
    const ps = makePanelState(100, 100, 400, 300, "My Terminal");
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    const header = fp.getElement().querySelector(".panel-header");
    expect(header).not.toBeNull();
    const titleEl = fp.getElement().querySelector(".panel-header-title");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("My Terminal");
    fp.destroy();
  });

  test("creates a card area element with class floating-panel-content", () => {
    const ps = makePanelState();
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    expect(fp.getCardAreaElement().classList.contains("floating-panel-content")).toBe(true);
    fp.destroy();
  });

  test("creates all 8 resize handles", () => {
    const ps = makePanelState();
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    for (const dir of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
      expect(fp.getElement().querySelector(`.floating-panel-resize-${dir}`)).not.toBeNull();
    }
    fp.destroy();
  });

  test("FLOATING_TITLE_BAR_HEIGHT is 28", () => {
    expect(FLOATING_TITLE_BAR_HEIGHT).toBe(28);
  });
});

// ---- FloatingPanel API tests ----

describe("FloatingPanel – API", () => {
  let canvas: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    canvas = makeCanvasEl();
    document.body.appendChild(canvas);
  });

  test("setZIndex updates element z-index", () => {
    const ps = makePanelState();
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    fp.setZIndex(150);
    expect(fp.getElement().style.zIndex).toBe("150");
    fp.destroy();
  });

  test("getPanelState returns the same object passed to constructor", () => {
    const ps = makePanelState();
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    expect(fp.getPanelState()).toBe(ps);
    fp.destroy();
  });

  test("updatePosition updates element style and PanelState position", () => {
    const ps = makePanelState(100, 100, 400, 300);
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    fp.updatePosition(250, 180);
    expect(fp.getElement().style.left).toBe("250px");
    expect(fp.getElement().style.top).toBe("180px");
    expect(fp.getPanelState().position.x).toBe(250);
    expect(fp.getPanelState().position.y).toBe(180);
    fp.destroy();
  });

  test("updateSize updates element style and PanelState size", () => {
    const ps = makePanelState(100, 100, 400, 300);
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    fp.updateSize(600, 450);
    expect(fp.getElement().style.width).toBe("600px");
    expect(fp.getElement().style.height).toBe("450px");
    expect(fp.getPanelState().size.width).toBe(600);
    expect(fp.getPanelState().size.height).toBe(450);
    fp.destroy();
  });

  test("destroy removes the element from the DOM", () => {
    const ps = makePanelState();
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    canvas.appendChild(fp.getElement());
    expect(canvas.contains(fp.getElement())).toBe(true);
    fp.destroy();
    expect(canvas.contains(fp.getElement())).toBe(false);
  });

  test("updateTitle is a no-op; title comes from PanelState at construction", () => {
    const ps = makePanelState(100, 100, 400, 300, "My Title");
    const { callbacks } = makeCallbacks();
    const fp = new FloatingPanel(ps, callbacks, canvas);
    const titleEl = fp.getElement().querySelector(".panel-header-title");
    expect(titleEl!.textContent).toBe("My Title");
    fp.updateTitle("Should be no-op");
    expect(titleEl!.textContent).toBe("My Title");
    fp.destroy();
  });
});

// ---- v4 serialization round-trip tests ----

describe("v4 serialization round-trip", () => {
  test("panel position and size survive serialize/deserialize", () => {
    const tabId = "rt-tab-1";
    const panel: PanelState = {
      id: "rt-panel-1",
      position: { x: 250, y: 175 },
      size: { width: 500, height: 380 },
      tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: tabId,
    };
    const serialized = serialize({ panels: [panel] });
    const restored = deserialize(JSON.stringify(serialized), 1280, 800);
    expect(restored.panels.length).toBe(1);
    expect(restored.panels[0].position.x).toBe(250);
    expect(restored.panels[0].position.y).toBe(175);
    expect(restored.panels[0].size.width).toBe(500);
    expect(restored.panels[0].size.height).toBe(380);
  });

  test("tab title and componentId survive round-trip", () => {
    const tabId = "rt-tab-2";
    const panel: PanelState = {
      id: "rt-panel-2",
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
      tabs: [{ id: tabId, componentId: "git", title: "My Git", closable: true }],
      activeTabId: tabId,
    };
    const restored = deserialize(JSON.stringify(serialize({ panels: [panel] })), 1280, 800);
    expect(restored.panels[0].tabs[0].title).toBe("My Git");
    expect(restored.panels[0].tabs[0].componentId).toBe("git");
  });

  test("off-canvas position is clamped during deserialization", () => {
    const tabId = "rt-tab-3";
    const panel: PanelState = {
      id: "rt-panel-3",
      position: { x: 1200, y: 750 },
      size: { width: 400, height: 300 },
      tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: tabId,
    };
    const restored = deserialize(JSON.stringify(serialize({ panels: [panel] })), 1280, 800);
    // x(1200) + width(400) = 1600 > 1280 -> x = 1280 - 400 = 880
    expect(restored.panels[0].position.x).toBe(880);
    // y(750) + height(300) = 1050 > 800 -> y = 800 - 300 = 500
    expect(restored.panels[0].position.y).toBe(500);
  });

  test("sub-100px size is clamped during deserialization", () => {
    const tabId = "rt-tab-4";
    const panel: PanelState = {
      id: "rt-panel-4",
      position: { x: 100, y: 100 },
      size: { width: 80, height: 60 },
      tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: tabId,
    };
    const restored = deserialize(JSON.stringify(serialize({ panels: [panel] })), 1920, 1080);
    expect(restored.panels[0].size.width).toBe(100);
    expect(restored.panels[0].size.height).toBe(100);
  });
});

// ---- PanelManager floating panel integration tests ----

describe("PanelManager – canvas panel integration", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    uuidCounter = 1000;
    container = document.createElement("div");
    container.style.width = "1280px";
    container.style.height = "800px";
    container.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1280, bottom: 800,
      width: 1280, height: 800, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(container);
    connection = new MockConnection();
  });

  test("initial canvasState has 5 panels from buildDefaultLayout", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const state = manager.getCanvasState();
    expect(state.panels).toBeDefined();
    expect(Array.isArray(state.panels)).toBe(true);
    expect(state.panels.length).toBe(5);
    manager.destroy();
  });

  test("render creates one .floating-panel per panel in canvasState", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const floatingEls = container.querySelectorAll(".floating-panel");
    expect(floatingEls.length).toBe(5);
    manager.destroy();
  });

  test("applyLayout with 1 panel creates 1 .floating-panel element", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const tabId = "apply-tab-1";
    manager.applyLayout({
      panels: [{
        id: "apply-panel-1",
        position: { x: 100, y: 100 },
        size: { width: 400, height: 300 },
        tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
        activeTabId: tabId,
      }],
    });
    expect(container.querySelectorAll(".floating-panel").length).toBe(1);
    manager.destroy();
  });

  test("z-order: panels get z-index 100+i in array order", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const tab1 = "z-tab-1"; const tab2 = "z-tab-2";
    manager.applyLayout({
      panels: [
        { id: "z-p1", position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab1, componentId: "terminal", title: "T1", closable: true }], activeTabId: tab1 },
        { id: "z-p2", position: { x: 50, y: 50 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab2, componentId: "git", title: "G1", closable: true }], activeTabId: tab2 },
      ],
    });
    const panels = Array.from(container.querySelectorAll<HTMLElement>(".floating-panel"));
    expect(panels.length).toBe(2);
    expect(parseInt(panels[0].style.zIndex, 10)).toBe(100);
    expect(parseInt(panels[1].style.zIndex, 10)).toBe(101);
    manager.destroy();
  });

  test("key-capable panel (terminal) gets .panel-header-key on its header", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const tab1 = "f-tab-1"; const tab2 = "f-tab-2";
    manager.applyLayout({
      panels: [
        { id: "f-p1", position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab1, componentId: "stats", title: "Stats", closable: true }], activeTabId: tab1 },
        { id: "f-p2", position: { x: 50, y: 50 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab2, componentId: "terminal", title: "Terminal", closable: true }], activeTabId: tab2 },
      ],
    });
    const headers = Array.from(container.querySelectorAll<HTMLElement>(".panel-header"));
    // terminal panel header should have key class
    expect(headers[1].classList.contains("panel-header-key")).toBe(true);
    // stats panel header should not
    expect(headers[0].classList.contains("panel-header-key")).toBe(false);
    manager.destroy();
  });

  test("clicking non-key panel (stats) does not change key panel", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const tab1 = "k-tab-1"; const tab2 = "k-tab-2";
    manager.applyLayout({
      panels: [
        { id: "k-p1", position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab1, componentId: "conversation", title: "Conv", closable: true }], activeTabId: tab1 },
        { id: "k-p2", position: { x: 50, y: 50 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab2, componentId: "stats", title: "Stats", closable: true }], activeTabId: tab2 },
      ],
    });
    // conversation is initially key (last key-capable panel)
    let headers = Array.from(container.querySelectorAll<HTMLElement>(".panel-header"));
    expect(headers[0].classList.contains("panel-header-key")).toBe(true);

    // Focus the stats panel (bring to front)
    manager.focusPanel("k-p2");

    // conversation should still be key
    headers = Array.from(container.querySelectorAll<HTMLElement>(".panel-header"));
    expect(headers[0].classList.contains("panel-header-key")).toBe(true);
    expect(headers[1].classList.contains("panel-header-key")).toBe(false);
    manager.destroy();
  });

  test("clicking key-capable panel (terminal) makes it key", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const tab1 = "m-tab-1"; const tab2 = "m-tab-2"; const tab3 = "m-tab-3";
    manager.applyLayout({
      panels: [
        { id: "m-p1", position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab1, componentId: "conversation", title: "Conv", closable: true }], activeTabId: tab1 },
        { id: "m-p2", position: { x: 50, y: 50 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab2, componentId: "stats", title: "Stats", closable: true }], activeTabId: tab2 },
        { id: "m-p3", position: { x: 100, y: 100 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab3, componentId: "terminal", title: "Terminal", closable: true }], activeTabId: tab3 },
      ],
    });
    // terminal is initially key (last key-capable in array)
    // DOM order matches creation order: conv(0), stats(1), terminal(2)
    let headers = Array.from(container.querySelectorAll<HTMLElement>(".panel-header"));
    expect(headers[2].classList.contains("panel-header-key")).toBe(true);
    expect(headers[0].classList.contains("panel-header-key")).toBe(false);

    // Focus conversation (key-capable) — it becomes key
    manager.focusPanel("m-p1");

    // DOM order is unchanged (focusPanel only updates z-index, not DOM order)
    headers = Array.from(container.querySelectorAll<HTMLElement>(".panel-header"));
    // conversation header (index 0) should now be key
    expect(headers[0].classList.contains("panel-header-key")).toBe(true);
    // terminal header (index 2) should no longer be key
    expect(headers[2].classList.contains("panel-header-key")).toBe(false);
    manager.destroy();
  });

  test("D09: card instance identity preserved across applyLayout calls", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT]);
    manager.addCard(card, "git");

    const registry = manager.getCardRegistry();
    let found: TugCard | null = null;
    for (const [, c] of registry) { if (c === card) { found = c; break; } }
    expect(found).toBe(card);

    // Re-apply layout — card should remain the same instance
    const state = manager.getCanvasState();
    manager.applyLayout(state);

    found = null;
    for (const [, c] of manager.getCardRegistry()) { if (c === card) { found = c; break; } }
    expect(found).toBe(card);
    expect(card.destroyCount).toBe(0);

    manager.destroy();
  });

  test("removeCard removes panel from canvasState when panel has single tab", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT]);
    manager.addCard(card, "git");

    const beforeCount = manager.getCanvasState().panels.length;
    manager.removeCard(card);
    const afterCount = manager.getCanvasState().panels.length;
    expect(afterCount).toBe(beforeCount - 1);
    expect(card.destroyCount).toBe(1);
    manager.destroy();
  });
});
