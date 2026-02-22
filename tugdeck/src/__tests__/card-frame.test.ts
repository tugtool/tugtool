/**
 * CardFrame tests.
 *
 * Tests cover:
 * - CardFrame DOM creation and geometry from CardState
 * - Z-order management on focus
 * - serialize/deserialize round-trip preserves panel positions (v4 format)
 * - DeckManager integration: card frames in canvasState
 *
 * [D03] CardFrame accepts CardState directly
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

import { CardFrame, CARD_TITLE_BAR_HEIGHT } from "../card-frame";
import { serialize, deserialize, buildDefaultLayout } from "../serialization";
import type { CardState, TabItem } from "../layout-tree";
import { DeckManager } from "../deck-manager";
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

function makeCardState(
  x = 100,
  y = 100,
  width = 400,
  height = 300,
  title = "Test Panel"
): CardState {
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
  callbacks: import("../card-frame").CardFrameCallbacks;
  moveEndCalls: Array<{ x: number; y: number }>;
  resizeEndCalls: Array<{ x: number; y: number; width: number; height: number }>;
  focusCalls: number[];
  closeCalls: number[];
} {
  const moveEndCalls: Array<{ x: number; y: number }> = [];
  const resizeEndCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
  const focusCalls: number[] = [];
  const closeCalls: number[] = [];

  const callbacks: import("../card-frame").CardFrameCallbacks = {
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

// ---- CardFrame DOM tests ----

describe("CardFrame – DOM creation from CardState", () => {
  let canvas: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    canvas = makeCanvasEl();
    document.body.appendChild(canvas);
  });

  test("creates an element with class 'card-frame'", () => {
    const ps = makeCardState(100, 150, 400, 300);
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    expect(fp.getElement().classList.contains("card-frame")).toBe(true);
    fp.destroy();
  });

  test("positions element according to CardState position", () => {
    const ps = makeCardState(200, 150, 400, 300);
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    expect(fp.getElement().style.left).toBe("200px");
    expect(fp.getElement().style.top).toBe("150px");
    fp.destroy();
  });

  test("sizes element according to CardState size", () => {
    const ps = makeCardState(100, 100, 500, 400);
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    expect(fp.getElement().style.width).toBe("500px");
    expect(fp.getElement().style.height).toBe("400px");
    fp.destroy();
  });

  test("creates a card-header with title from active tab", () => {
    const ps = makeCardState(100, 100, 400, 300, "My Terminal");
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    const header = fp.getElement().querySelector(".card-header");
    expect(header).not.toBeNull();
    const titleEl = fp.getElement().querySelector(".card-header-title");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("My Terminal");
    fp.destroy();
  });

  test("creates a card area element with class card-frame-content", () => {
    const ps = makeCardState();
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    expect(fp.getCardAreaElement().classList.contains("card-frame-content")).toBe(true);
    fp.destroy();
  });

  test("creates all 8 resize handles", () => {
    const ps = makeCardState();
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    for (const dir of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
      expect(fp.getElement().querySelector(`.card-frame-resize-${dir}`)).not.toBeNull();
    }
    fp.destroy();
  });

  test("CARD_TITLE_BAR_HEIGHT is 28", () => {
    expect(CARD_TITLE_BAR_HEIGHT).toBe(28);
  });
});

// ---- CardFrame API tests ----

describe("CardFrame – API", () => {
  let canvas: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    canvas = makeCanvasEl();
    document.body.appendChild(canvas);
  });

  test("setZIndex updates element z-index", () => {
    const ps = makeCardState();
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    fp.setZIndex(150);
    expect(fp.getElement().style.zIndex).toBe("150");
    fp.destroy();
  });

  test("getCardState returns the same object passed to constructor", () => {
    const ps = makeCardState();
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    expect(fp.getCardState()).toBe(ps);
    fp.destroy();
  });

  test("updatePosition updates element style and CardState position", () => {
    const ps = makeCardState(100, 100, 400, 300);
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    fp.updatePosition(250, 180);
    expect(fp.getElement().style.left).toBe("250px");
    expect(fp.getElement().style.top).toBe("180px");
    expect(fp.getCardState().position.x).toBe(250);
    expect(fp.getCardState().position.y).toBe(180);
    fp.destroy();
  });

  test("updateSize updates element style and CardState size", () => {
    const ps = makeCardState(100, 100, 400, 300);
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    fp.updateSize(600, 450);
    expect(fp.getElement().style.width).toBe("600px");
    expect(fp.getElement().style.height).toBe("450px");
    expect(fp.getCardState().size.width).toBe(600);
    expect(fp.getCardState().size.height).toBe(450);
    fp.destroy();
  });

  test("destroy removes the element from the DOM", () => {
    const ps = makeCardState();
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    canvas.appendChild(fp.getElement());
    expect(canvas.contains(fp.getElement())).toBe(true);
    fp.destroy();
    expect(canvas.contains(fp.getElement())).toBe(false);
  });

  test("updateTitle is a no-op; title comes from CardState at construction", () => {
    const ps = makeCardState(100, 100, 400, 300, "My Title");
    const { callbacks } = makeCallbacks();
    const fp = new CardFrame(ps, callbacks, canvas);
    const titleEl = fp.getElement().querySelector(".card-header-title");
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
    const panel: CardState = {
      id: "rt-panel-1",
      position: { x: 250, y: 175 },
      size: { width: 500, height: 380 },
      tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: tabId,
    };
    const serialized = serialize({ cards: [panel] });
    const restored = deserialize(JSON.stringify(serialized), 1280, 800);
    expect(restored.cards.length).toBe(1);
    expect(restored.cards[0].position.x).toBe(250);
    expect(restored.cards[0].position.y).toBe(175);
    expect(restored.cards[0].size.width).toBe(500);
    expect(restored.cards[0].size.height).toBe(380);
  });

  test("tab title and componentId survive round-trip", () => {
    const tabId = "rt-tab-2";
    const panel: CardState = {
      id: "rt-panel-2",
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
      tabs: [{ id: tabId, componentId: "git", title: "My Git", closable: true }],
      activeTabId: tabId,
    };
    const restored = deserialize(JSON.stringify(serialize({ cards: [panel] })), 1280, 800);
    expect(restored.cards[0].tabs[0].title).toBe("My Git");
    expect(restored.cards[0].tabs[0].componentId).toBe("git");
  });

  test("off-canvas position is clamped during deserialization", () => {
    const tabId = "rt-tab-3";
    const panel: CardState = {
      id: "rt-panel-3",
      position: { x: 1200, y: 750 },
      size: { width: 400, height: 300 },
      tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: tabId,
    };
    const restored = deserialize(JSON.stringify(serialize({ cards: [panel] })), 1280, 800);
    // x(1200) + width(400) = 1600 > 1280 -> x = 1280 - 400 = 880
    expect(restored.cards[0].position.x).toBe(880);
    // y(750) + height(300) = 1050 > 800 -> y = 800 - 300 = 500
    expect(restored.cards[0].position.y).toBe(500);
  });

  test("sub-100px size is clamped during deserialization", () => {
    const tabId = "rt-tab-4";
    const panel: CardState = {
      id: "rt-panel-4",
      position: { x: 100, y: 100 },
      size: { width: 80, height: 60 },
      tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: tabId,
    };
    const restored = deserialize(JSON.stringify(serialize({ cards: [panel] })), 1920, 1080);
    expect(restored.cards[0].size.width).toBe(100);
    expect(restored.cards[0].size.height).toBe(100);
  });
});

// ---- DeckManager card frame integration tests ----

describe("DeckManager – canvas card integration", () => {
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
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const state = manager.getDeckState();
    expect(state.cards).toBeDefined();
    expect(Array.isArray(state.cards)).toBe(true);
    expect(state.cards.length).toBe(5);
    manager.destroy();
  });

  test("render creates one .card-frame per card in canvasState", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const floatingEls = container.querySelectorAll(".card-frame");
    expect(floatingEls.length).toBe(5);
    manager.destroy();
  });

  test("applyLayout with 1 panel creates 1 .card-frame element", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const tabId = "apply-tab-1";
    manager.applyLayout({
      cards: [{
        id: "apply-panel-1",
        position: { x: 100, y: 100 },
        size: { width: 400, height: 300 },
        tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
        activeTabId: tabId,
      }],
    });
    expect(container.querySelectorAll(".card-frame").length).toBe(1);
    manager.destroy();
  });

  test("z-order: panels get z-index 100+i in array order", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const tab1 = "z-tab-1"; const tab2 = "z-tab-2";
    manager.applyLayout({
      cards: [
        { id: "z-p1", position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab1, componentId: "terminal", title: "T1", closable: true }], activeTabId: tab1 },
        { id: "z-p2", position: { x: 50, y: 50 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab2, componentId: "git", title: "G1", closable: true }], activeTabId: tab2 },
      ],
    });
    const panels = Array.from(container.querySelectorAll<HTMLElement>(".card-frame"));
    expect(panels.length).toBe(2);
    expect(parseInt(panels[0].style.zIndex, 10)).toBe(100);
    expect(parseInt(panels[1].style.zIndex, 10)).toBe(101);
    manager.destroy();
  });

  test("key-capable panel (terminal) gets .card-header-key on its header", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const tab1 = "f-tab-1"; const tab2 = "f-tab-2";
    manager.applyLayout({
      cards: [
        { id: "f-p1", position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab1, componentId: "stats", title: "Stats", closable: true }], activeTabId: tab1 },
        { id: "f-p2", position: { x: 50, y: 50 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab2, componentId: "terminal", title: "Terminal", closable: true }], activeTabId: tab2 },
      ],
    });
    const headers = Array.from(container.querySelectorAll<HTMLElement>(".card-header"));
    // terminal panel header should have key class
    expect(headers[1].classList.contains("card-header-key")).toBe(true);
    // stats panel header should not
    expect(headers[0].classList.contains("card-header-key")).toBe(false);
    manager.destroy();
  });

  test("clicking stats panel makes it key (all standard panels accept key)", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const tab1 = "k-tab-1"; const tab2 = "k-tab-2";
    manager.applyLayout({
      cards: [
        { id: "k-p1", position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab1, componentId: "code", title: "Conv", closable: true }], activeTabId: tab1 },
        { id: "k-p2", position: { x: 50, y: 50 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab2, componentId: "stats", title: "Stats", closable: true }], activeTabId: tab2 },
      ],
    });
    // stats is initially key (last key-capable panel in array)
    let headers = Array.from(container.querySelectorAll<HTMLElement>(".card-header"));
    expect(headers[1].classList.contains("card-header-key")).toBe(true);
    expect(headers[0].classList.contains("card-header-key")).toBe(false);

    // Focus the code panel — it becomes key
    manager.focusPanel("k-p1");

    headers = Array.from(container.querySelectorAll<HTMLElement>(".card-header"));
    expect(headers[0].classList.contains("card-header-key")).toBe(true);
    expect(headers[1].classList.contains("card-header-key")).toBe(false);
    manager.destroy();
  });

  test("clicking key-capable panel (terminal) makes it key", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const tab1 = "m-tab-1"; const tab2 = "m-tab-2"; const tab3 = "m-tab-3";
    manager.applyLayout({
      cards: [
        { id: "m-p1", position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab1, componentId: "code", title: "Conv", closable: true }], activeTabId: tab1 },
        { id: "m-p2", position: { x: 50, y: 50 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab2, componentId: "stats", title: "Stats", closable: true }], activeTabId: tab2 },
        { id: "m-p3", position: { x: 100, y: 100 }, size: { width: 400, height: 300 },
          tabs: [{ id: tab3, componentId: "terminal", title: "Terminal", closable: true }], activeTabId: tab3 },
      ],
    });
    // terminal is initially key (last key-capable in array)
    // DOM order matches creation order: conv(0), stats(1), terminal(2)
    let headers = Array.from(container.querySelectorAll<HTMLElement>(".card-header"));
    expect(headers[2].classList.contains("card-header-key")).toBe(true);
    expect(headers[0].classList.contains("card-header-key")).toBe(false);

    // Focus code (key-capable) — it becomes key
    manager.focusPanel("m-p1");

    // DOM order is unchanged (focusPanel only updates z-index, not DOM order)
    headers = Array.from(container.querySelectorAll<HTMLElement>(".card-header"));
    // code header (index 0) should now be key
    expect(headers[0].classList.contains("card-header-key")).toBe(true);
    // terminal header (index 2) should no longer be key
    expect(headers[2].classList.contains("card-header-key")).toBe(false);
    manager.destroy();
  });

  test("D09: card instance identity preserved across applyLayout calls", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT]);
    manager.addCard(card, "git");

    const registry = manager.getCardRegistry();
    let found: TugCard | null = null;
    for (const [, c] of registry) { if (c === card) { found = c; break; } }
    expect(found).toBe(card);

    // Re-apply layout — card should remain the same instance
    const state = manager.getDeckState();
    manager.applyLayout(state);

    found = null;
    for (const [, c] of manager.getCardRegistry()) { if (c === card) { found = c; break; } }
    expect(found).toBe(card);
    expect(card.destroyCount).toBe(0);

    manager.destroy();
  });

  test("removeCard removes panel from canvasState when panel has single tab", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT]);
    manager.addCard(card, "git");

    const beforeCount = manager.getDeckState().cards.length;
    manager.removeCard(card);
    const afterCount = manager.getDeckState().cards.length;
    expect(afterCount).toBe(beforeCount - 1);
    expect(card.destroyCount).toBe(1);
    manager.destroy();
  });
});

// ---- CardFrame – live callbacks (onMoving / onResizing) ----

/**
 * Helper: create a PointerEvent using happy-dom's native PointerEvent constructor.
 * `PointerEvent` is not available globally in bun/node, but happy-dom's Window
 * provides it. Using happy-dom's own constructor ensures that `e.target` is set
 * correctly when the event is dispatched on a happy-dom element.
 */
const HappyDomPointerEvent = (window as unknown as Record<string, unknown>)["PointerEvent"] as typeof PointerEvent;

function makePointerEvent(
  type: string,
  opts: { clientX: number; clientY: number; pointerId?: number }
): PointerEvent {
  return new HappyDomPointerEvent(type, {
    bubbles: true,
    clientX: opts.clientX,
    clientY: opts.clientY,
    pointerId: opts.pointerId ?? 1,
  } as PointerEventInit) as unknown as PointerEvent;
}

describe("CardFrame – live callbacks (onMoving / onResizing)", () => {
  let canvas: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    canvas = makeCanvasEl(1280, 800);
    document.body.appendChild(canvas);
  });

  // Test a: onMoving is called on every pointermove during header drag.
  test("calls onMoving on every pointermove during header drag", () => {
    const ps = makeCardState(100, 100, 400, 300);
    const movingCalls: Array<{ x: number; y: number }> = [];
    const { callbacks, moveEndCalls } = makeCallbacks();
    callbacks.onMoving = (x, y) => {
      movingCalls.push({ x, y });
      return { x, y }; // pass through unchanged
    };

    const fp = new CardFrame(ps, callbacks, canvas);
    canvas.appendChild(fp.getElement());

    const headerEl = fp.getElement().querySelector<HTMLElement>(".card-header")!;
    expect(headerEl).not.toBeNull();

    // pointerdown to start drag capture
    headerEl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 200, clientY: 100 }));

    // pointermove with delta > DRAG_THRESHOLD_PX (3), so dragging = true
    headerEl.dispatchEvent(makePointerEvent("pointermove", { clientX: 210, clientY: 110 }));
    headerEl.dispatchEvent(makePointerEvent("pointermove", { clientX: 220, clientY: 120 }));

    // pointerup to end drag
    headerEl.dispatchEvent(makePointerEvent("pointerup", { clientX: 220, clientY: 120 }));

    // onMoving should have been called once per move after threshold crossed
    expect(movingCalls.length).toBeGreaterThanOrEqual(1);
    // onMoveEnd should also have been called
    expect(moveEndCalls.length).toBe(1);

    fp.destroy();
  });

  // Test b: onMoving return value overrides the panel position (snap override).
  test("uses returned position from onMoving (snap override)", () => {
    const ps = makeCardState(100, 100, 400, 300);
    const { callbacks, moveEndCalls } = makeCallbacks();
    // Always snap to (500, 500)
    callbacks.onMoving = (_x, _y) => ({ x: 500, y: 500 });

    const fp = new CardFrame(ps, callbacks, canvas);
    canvas.appendChild(fp.getElement());

    const headerEl = fp.getElement().querySelector<HTMLElement>(".card-header")!;

    // Simulate drag: pointerdown, pointermove with delta > 3, pointerup
    headerEl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 200, clientY: 100 }));
    headerEl.dispatchEvent(makePointerEvent("pointermove", { clientX: 210, clientY: 110 }));
    headerEl.dispatchEvent(makePointerEvent("pointerup", { clientX: 210, clientY: 110 }));

    // Panel position should be the snapped position, not the computed drag position
    expect(fp.getCardState().position.x).toBe(500);
    expect(fp.getCardState().position.y).toBe(500);

    // onMoveEnd should report the snapped position
    expect(moveEndCalls.length).toBe(1);
    expect(moveEndCalls[0].x).toBe(500);
    expect(moveEndCalls[0].y).toBe(500);

    fp.destroy();
  });

  // Test c: onResizing is called on every pointermove during resize drag.
  test("calls onResizing on every pointermove during resize drag", () => {
    const ps = makeCardState(100, 100, 400, 300);
    const resizingCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
    const { callbacks } = makeCallbacks();
    callbacks.onResizing = (x, y, width, height) => {
      resizingCalls.push({ x, y, width, height });
      return { x, y, width, height }; // pass through unchanged
    };

    const fp = new CardFrame(ps, callbacks, canvas);
    canvas.appendChild(fp.getElement());

    // East resize handle grows width
    const eastHandle = fp.getElement().querySelector<HTMLElement>(".card-frame-resize-e")!;
    expect(eastHandle).not.toBeNull();

    // pointerdown on the resize handle
    eastHandle.dispatchEvent(makePointerEvent("pointerdown", { clientX: 500, clientY: 200 }));

    // pointermove with dx = 50 (growing right edge by 50px)
    eastHandle.dispatchEvent(makePointerEvent("pointermove", { clientX: 550, clientY: 200 }));

    // pointerup to end resize
    eastHandle.dispatchEvent(makePointerEvent("pointerup", { clientX: 550, clientY: 200 }));

    // onResizing should have been called once per move
    expect(resizingCalls.length).toBeGreaterThanOrEqual(1);
    // The geometry passed should reflect the growing width
    const call = resizingCalls[0];
    expect(call.width).toBeGreaterThan(400); // grew from 400
    expect(call.x).toBe(100); // east resize doesn't change x
    expect(call.y).toBe(100); // y unchanged

    fp.destroy();
  });

  // Test d: onMoveEnd and onResizeEnd still fire on pointerup with correct (snapped) values.
  test("onMoveEnd fires with snapped position after onMoving override", () => {
    const ps = makeCardState(100, 100, 400, 300);
    const { callbacks, moveEndCalls } = makeCallbacks();
    // Snap to a fixed position
    callbacks.onMoving = (_x, _y) => ({ x: 300, y: 250 });

    const fp = new CardFrame(ps, callbacks, canvas);
    canvas.appendChild(fp.getElement());

    const headerEl = fp.getElement().querySelector<HTMLElement>(".card-header")!;

    headerEl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 200, clientY: 100 }));
    headerEl.dispatchEvent(makePointerEvent("pointermove", { clientX: 215, clientY: 115 }));
    headerEl.dispatchEvent(makePointerEvent("pointerup", { clientX: 215, clientY: 115 }));

    // onMoveEnd should be called with the snapped (300, 250) position
    expect(moveEndCalls.length).toBe(1);
    expect(moveEndCalls[0].x).toBe(300);
    expect(moveEndCalls[0].y).toBe(250);

    fp.destroy();
  });

  // Extra: onResizeEnd fires with snapped geometry when onResizing override is provided.
  test("onResizeEnd fires with snapped geometry after onResizing override", () => {
    const ps = makeCardState(100, 100, 400, 300);
    const { callbacks, resizeEndCalls } = makeCallbacks();
    // Snap width to exactly 500
    callbacks.onResizing = (x, y, _width, height) => ({ x, y, width: 500, height });

    const fp = new CardFrame(ps, callbacks, canvas);
    canvas.appendChild(fp.getElement());

    const eastHandle = fp.getElement().querySelector<HTMLElement>(".card-frame-resize-e")!;

    eastHandle.dispatchEvent(makePointerEvent("pointerdown", { clientX: 500, clientY: 200 }));
    eastHandle.dispatchEvent(makePointerEvent("pointermove", { clientX: 530, clientY: 200 }));
    eastHandle.dispatchEvent(makePointerEvent("pointerup", { clientX: 530, clientY: 200 }));

    // onResizeEnd should report the snapped width (500), not computed (430)
    expect(resizeEndCalls.length).toBe(1);
    expect(resizeEndCalls[0].width).toBe(500);
    expect(resizeEndCalls[0].x).toBe(100);
    expect(resizeEndCalls[0].y).toBe(100);

    fp.destroy();
  });
});
