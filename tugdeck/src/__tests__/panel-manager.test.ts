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

// ---- Snap wiring integration tests ----

/**
 * Helper: create a PointerEvent using happy-dom's native PointerEvent constructor.
 * happy-dom's Window provides PointerEvent; using it ensures e.target is set correctly
 * when the event is dispatched on a happy-dom element.
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

/** Build a minimal single-tab PanelState for layout setup. */
function makePanelState(
  id: string,
  x: number, y: number,
  width: number, height: number,
  componentId = "terminal"
) {
  const tabId = `${id}-tab`;
  return {
    id,
    position: { x, y },
    size: { width, height },
    tabs: [{ id: tabId, componentId, title: componentId, closable: true }],
    activeTabId: tabId,
  };
}

/** Build a container with getBoundingClientRect mocked to a known size. */
function makeSnapContainer(width = 1280, height = 800): HTMLElement {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.getBoundingClientRect = () => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  document.body.appendChild(el);
  return el;
}

describe("PanelManager – snap wiring", () => {
  let connection: MockConnection;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    connection = new MockConnection();
  });

  // Test a: moving a panel near another panel's edge results in snapped final position.
  // Panel A at (100, 100, 200, 200): right edge = 300.
  // Panel B at (310, 100, 200, 200): left edge = 310.
  // Gap = 10px (beyond threshold initially).
  // Drag A rightward by dx=5: A.right moves to 305, gap to B.left = 5px (within 8px).
  // onMoving fires with x=105, computeSnap snaps A so A.right aligns with B.left=310 → A.x=110.
  test("moving a panel near another panel's edge snaps to alignment", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 100, 100, 200, 200),
        makePanelState("panel-b", 310, 100, 200, 200),
      ],
    });

    // Get panel A's floating panel header element
    const floatingPanels = snapContainer.querySelectorAll<HTMLElement>(".floating-panel");
    expect(floatingPanels.length).toBe(2);
    const panelAEl = floatingPanels[0]; // Panel A is first (index 0)
    const headerA = panelAEl.querySelector<HTMLElement>(".panel-header")!;
    expect(headerA).not.toBeNull();

    // Simulate drag: start at (200, 150), move right by 5px (so new x~=105)
    headerA.dispatchEvent(makePointerEvent("pointerdown", { clientX: 200, clientY: 150 }));
    // Move 5px right — exceeds DRAG_THRESHOLD_PX (3) and is within SNAP_THRESHOLD_PX (8)
    // from B.left when added to panel's right edge (300+5=305, B.left=310, dist=5)
    headerA.dispatchEvent(makePointerEvent("pointermove", { clientX: 205, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointerup", { clientX: 205, clientY: 150 }));

    // After snap: panel A's right edge (A.x + 200) should be snapped to B.left (310)
    // So A.x = 310 - 200 = 110
    // Note: onFocus fires on pointerdown and may reorder panels; find by id.
    const panelA = manager.getCanvasState().panels.find((p) => p.id === "panel-a")!;
    expect(panelA).toBeDefined();
    expect(panelA.position.x).toBe(110);
    expect(panelA.position.y).toBe(100); // y unchanged

    manager.destroy();
  });

  // Test b: resizing a panel's right edge near another panel's left edge snaps to alignment.
  // Panel A at (100, 100, 200, 200): right edge = 300.
  // Panel B at (310, 100, 200, 200): left edge = 310.
  // Resize A's east handle by dx=7: new A.right = 307, gap to B.left = 3px (within 8px).
  // onResizing fires: snap.right = 310, so newW = 310 - 100 = 210.
  test("resizing a panel's right edge near another panel's left edge snaps to alignment", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 100, 100, 200, 200),
        makePanelState("panel-b", 310, 100, 200, 200),
      ],
    });

    const floatingPanels = snapContainer.querySelectorAll<HTMLElement>(".floating-panel");
    const panelAEl = floatingPanels[0];
    const eastHandle = panelAEl.querySelector<HTMLElement>(".floating-panel-resize-e")!;
    expect(eastHandle).not.toBeNull();

    // Panel A's right edge is at x=300. Resize east handle by dx=7 → new right=307.
    // Distance to B.left (310) = 3px → within threshold → snap to 310.
    // Starting clientX: any value; the dx is what matters
    eastHandle.dispatchEvent(makePointerEvent("pointerdown", { clientX: 300, clientY: 200 }));
    eastHandle.dispatchEvent(makePointerEvent("pointermove", { clientX: 307, clientY: 200 }));
    eastHandle.dispatchEvent(makePointerEvent("pointerup", { clientX: 307, clientY: 200 }));

    // Width should have snapped so right edge = 310: width = 310 - 100 = 210
    // Find by id in case panel order changed
    const finalPanel = manager.getCanvasState().panels.find((p) => p.id === "panel-a")!;
    expect(finalPanel).toBeDefined();
    expect(finalPanel.size.width).toBe(210);
    expect(finalPanel.position.x).toBe(100); // x unchanged for east resize

    manager.destroy();
  });

  // Test c: panels far apart do not snap — no position change beyond the raw drag delta.
  // Panel A at (0, 0, 200, 200), Panel B at (500, 0, 200, 200). Gap = 300px.
  // Drag A right by 50px: A.x becomes 50, A.right = 250. Gap to B.left = 250px >> 8px.
  // No snap should occur; final position should be the unsnapped computed position.
  test("panels far apart do not snap", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 0, 200, 200),
        makePanelState("panel-b", 500, 0, 200, 200),
      ],
    });

    const floatingPanels = snapContainer.querySelectorAll<HTMLElement>(".floating-panel");
    const panelAEl = floatingPanels[0];
    const headerA = panelAEl.querySelector<HTMLElement>(".panel-header")!;

    // Start drag at (100, 20), move 50px right
    headerA.dispatchEvent(makePointerEvent("pointerdown", { clientX: 100, clientY: 20 }));
    headerA.dispatchEvent(makePointerEvent("pointermove", { clientX: 150, clientY: 20 }));
    headerA.dispatchEvent(makePointerEvent("pointerup", { clientX: 150, clientY: 20 }));

    // With no snap, A.x should be 0 + 50 = 50
    // Note: onFocus fires on pointerdown and may reorder panels; find by id.
    const panelA = manager.getCanvasState().panels.find((p) => p.id === "panel-a")!;
    expect(panelA).toBeDefined();
    expect(panelA.position.x).toBe(50);
    expect(panelA.position.y).toBe(0);

    manager.destroy();
  });
});

// ---- Guide line tests ----

describe("PanelManager – guide lines", () => {
  let connection: MockConnection;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    connection = new MockConnection();
  });

  // Test a: 4 .snap-guide-line elements are created in the container; all initially hidden.
  test("creates 4 guide line elements in the container, all initially hidden", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    const guides = snapContainer.querySelectorAll<HTMLElement>(".snap-guide-line");
    expect(guides.length).toBe(4);

    // All should be hidden initially. showGuides/hideGuides set inline style.display.
    // Before any drag the inline style is not yet set, so display should not be "block".
    for (const guide of Array.from(guides)) {
      expect(guide.style.display).not.toBe("block");
    }

    manager.destroy();
  });

  // Test b: during a snap-triggering drag, at least one guide becomes visible.
  // Test c: after drag end, all guides are hidden again.
  // Combined into a single end-to-end integration test.
  test("guide lines appear during snap drag and hide on drag end", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    // Panel A at (100, 100, 200, 200): right edge = 300.
    // Panel B at (310, 100, 200, 200): left edge = 310. Gap = 10px.
    // Drag A right by 5px → right edge = 305, gap to B.left = 5px (within 8px threshold).
    // computeSnap returns guides: [{ axis: "x", position: 310 }].
    // showGuides positions guideElements[0] at left:310px and sets display:block.
    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 100, 100, 200, 200),
        makePanelState("panel-b", 310, 100, 200, 200),
      ],
    });

    const guides = Array.from(snapContainer.querySelectorAll<HTMLElement>(".snap-guide-line"));
    expect(guides.length).toBe(4);

    const floatingPanels = snapContainer.querySelectorAll<HTMLElement>(".floating-panel");
    const panelAEl = floatingPanels[0];
    const headerA = panelAEl.querySelector<HTMLElement>(".panel-header")!;

    // Start drag
    headerA.dispatchEvent(makePointerEvent("pointerdown", { clientX: 200, clientY: 150 }));

    // Move 5px right — triggers snap (dist=5 < threshold=8), calls showGuides
    headerA.dispatchEvent(makePointerEvent("pointermove", { clientX: 205, clientY: 150 }));

    // During drag: the x-axis guide should be visible at position 310
    const xGuides = guides.filter((g) => g.classList.contains("snap-guide-line-x"));
    const visibleXGuide = xGuides.find((g) => g.style.display === "block");
    expect(visibleXGuide).toBeDefined();
    expect(visibleXGuide!.style.left).toBe("310px");

    // Drag end — triggers hideGuides
    headerA.dispatchEvent(makePointerEvent("pointerup", { clientX: 205, clientY: 150 }));

    // After drag: all guides should be hidden
    for (const guide of guides) {
      expect(guide.style.display).toBe("none");
    }

    manager.destroy();
  });
});

// ---- Set computation integration tests ----

describe("PanelManager – set computation", () => {
  let connection: MockConnection;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    connection = new MockConnection();
  });

  // Test a: two panels placed edge-to-edge are in the same set after move-end.
  // Panel A at (0,100,200,200): right edge = 200.
  // Panel B at (200,100,200,200): left edge = 200. Gap = 0, shared vertical edge.
  // Drag A minimally (dx=4 > DRAG_THRESHOLD=3): onMoving fires, snap keeps A at x=0
  // (A.right=204, B.left=200, dist=4 < 8, snaps A back to x=0).
  // onMoveEnd fires → recomputeSets() → 1 set with panel-a and panel-b.
  test("two panels placed edge-to-edge are in the same set after move-end", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
      ],
    });

    // Sets are computed in render — panels are already edge-to-edge.
    expect(manager.getSets().length).toBe(1);

    // Get panel A's header
    const floatingPanels = snapContainer.querySelectorAll<HTMLElement>(".floating-panel");
    const panelAEl = floatingPanels[0];
    const headerA = panelAEl.querySelector<HTMLElement>(".panel-header")!;

    // Minimal drag: dx=4 (above DRAG_THRESHOLD=3, within SNAP_THRESHOLD=8 of B.left)
    headerA.dispatchEvent(makePointerEvent("pointerdown", { clientX: 100, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointermove", { clientX: 104, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointerup", { clientX: 104, clientY: 150 }));

    // After move-end: recomputeSets fires. A.right=200, B.left=200 → shared edge.
    const sets = manager.getSets();
    expect(sets.length).toBe(1);
    const setIds = sets[0].panelIds.sort();
    expect(setIds).toContain("panel-a");
    expect(setIds).toContain("panel-b");

    manager.destroy();
  });

  // Test b: moving a panel away from its partner removes it from the set.
  // Build on test a: panels start edge-to-edge. Drag B far right (dx=500).
  // After moveEnd + recomputeSets: A.right=200, B far away. No shared edge. getSets=[].
  test("moving a panel away removes it from the set", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
      ],
    });

    // Sets computed in render — both panels already edge-to-edge.
    expect(manager.getSets().length).toBe(1);

    // Drag B far right (dx=500). B ends up at ~x=700, far from A.right=200.
    // Find panel B's floating element by its current left style = "200px".
    const allPanels = Array.from(snapContainer.querySelectorAll<HTMLElement>(".floating-panel"));
    let panelBEl: HTMLElement | undefined;
    for (const el of allPanels) {
      if (el.style.left === "200px") {
        panelBEl = el;
        break;
      }
    }
    expect(panelBEl).toBeDefined();
    const headerB = panelBEl!.querySelector<HTMLElement>(".panel-header")!;

    // Drag B 500px to the right
    headerB.dispatchEvent(makePointerEvent("pointerdown", { clientX: 300, clientY: 150 }));
    headerB.dispatchEvent(makePointerEvent("pointermove", { clientX: 800, clientY: 150 }));
    headerB.dispatchEvent(makePointerEvent("pointerup", { clientX: 800, clientY: 150 }));

    // After move-end: B is far away, no shared edges. getSets should be empty.
    const sets = manager.getSets();
    expect(sets.length).toBe(0);

    manager.destroy();
  });

  // Test c: closing a panel recomputes sets correctly.
  // 3 panels: A(0,100,200,200), B(200,100,200,200), C(400,100,200,200).
  // A-B share edge, B-C share edge → 1 set with all 3 panels after minimal drag.
  // Remove B → recomputeSets. A.right=200, C.left=400, gap=200 >> 8. getSets=[].
  test("closing a panel recomputes sets correctly", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
        makePanelState("panel-c", 400, 100, 200, 200),
      ],
    });

    // Sets computed in render — all 3 panels form a chain.
    expect(manager.getSets().length).toBe(1);
    expect(manager.getSets()[0].panelIds.length).toBe(3);

    // Register a mock card for panel-b so removeCard can find it in the registry
    const panelBTabId = "panel-b-tab";
    const mockCard = makeMockCard([FeedId.GIT], "git");
    manager.getCardRegistry().set(panelBTabId, mockCard);

    // Remove panel-b's card → removeCard calls recomputeSets
    manager.removeCard(mockCard);

    // After remove: only A and C remain, gap = 200px >> 8. No shared edges.
    const sets = manager.getSets();
    expect(sets.length).toBe(0);

    manager.destroy();
  });
});

// ---- Virtual sash integration tests ----

/** Helper: trigger recomputeSets by doing a minimal drag (dx=4 > DRAG_THRESHOLD=3). */
function triggerRecompute(headerEl: HTMLElement): void {
  headerEl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 100, clientY: 150 }));
  headerEl.dispatchEvent(makePointerEvent("pointermove", { clientX: 104, clientY: 150 }));
  headerEl.dispatchEvent(makePointerEvent("pointerup", { clientX: 104, clientY: 150 }));
}

describe("PanelManager – virtual sashes", () => {
  let connection: MockConnection;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    connection = new MockConnection();
  });

  // Test a: two edge-adjacent panels produce a virtual sash element in the DOM.
  test("two edge-adjacent panels produce a virtual sash in the DOM", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    // Panel A at (0,100,200,200): right=200. Panel B at (200,100,200,200): left=200.
    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
      ],
    });

    // Sets and sashes computed in render — shared edge detected immediately
    const sashes = snapContainer.querySelectorAll<HTMLElement>(".virtual-sash");
    expect(sashes.length).toBeGreaterThanOrEqual(1);

    // The sash should be vertical (A.right ~ B.left)
    const vertSash = Array.from(sashes).find((s) => s.classList.contains("virtual-sash-vertical"));
    expect(vertSash).toBeDefined();

    // The sash should be centered near x=200 (boundary), so left ≈ 196 (200 - 4)
    expect(vertSash!.style.left).toBe("196px");

    manager.destroy();
  });

  // Test b: dragging the sash resizes both panels (one grows, other shrinks).
  // Start: A(0,100,200,200), B(200,100,200,200). Drag sash right by dx=50.
  // After drag: A.width=250, B.x=250, B.width=150.
  test("dragging the sash resizes both panels", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
      ],
    });

    // Sash created in render (sets computed automatically)
    const sash = snapContainer.querySelector<HTMLElement>(".virtual-sash-vertical")!;
    expect(sash).not.toBeNull();

    // Drag sash right by 50px
    sash.dispatchEvent(makePointerEvent("pointerdown", { clientX: 200, clientY: 200 }));
    sash.dispatchEvent(makePointerEvent("pointermove", { clientX: 250, clientY: 200 }));
    sash.dispatchEvent(makePointerEvent("pointerup", { clientX: 250, clientY: 200 }));

    // After drag: A grew by 50, B shrank by 50 and moved right
    const panelA = manager.getCanvasState().panels.find((p) => p.id === "panel-a")!;
    const panelB = manager.getCanvasState().panels.find((p) => p.id === "panel-b")!;

    expect(panelA.size.width).toBe(250);
    expect(panelB.size.width).toBe(150);
    expect(panelB.position.x).toBe(250);

    // Total width unchanged: 250 + 150 = 400 = 200 + 200
    expect(panelA.size.width + panelB.size.width).toBe(400);

    manager.destroy();
  });

  // Test c: dragging the sash does not let either panel go below MIN_SIZE_PX (100).
  // A(0,100,150,200), B(150,100,150,200). Drag sash right by dx=100.
  // Would make B 50px wide — below MIN_SIZE. Should clamp B to 100, A to 200.
  test("sash drag clamps both panels to MIN_SIZE_PX", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 150, 200),
        makePanelState("panel-b", 150, 100, 150, 200),
      ],
    });

    // Sash created in render (sets computed automatically)
    const sash = snapContainer.querySelector<HTMLElement>(".virtual-sash-vertical")!;
    expect(sash).not.toBeNull();

    // Drag sash right by 100px — would make B.width = 50, below MIN_SIZE (100)
    sash.dispatchEvent(makePointerEvent("pointerdown", { clientX: 150, clientY: 200 }));
    sash.dispatchEvent(makePointerEvent("pointermove", { clientX: 250, clientY: 200 }));
    sash.dispatchEvent(makePointerEvent("pointerup", { clientX: 250, clientY: 200 }));

    const panelA = manager.getCanvasState().panels.find((p) => p.id === "panel-a")!;
    const panelB = manager.getCanvasState().panels.find((p) => p.id === "panel-b")!;

    // B should be clamped to MIN_SIZE=100; A gets 150 + (150-100) = 200
    expect(panelB.size.width).toBe(100);
    expect(panelA.size.width).toBe(200);
    // Total unchanged: 200 + 100 = 300 = 150 + 150
    expect(panelA.size.width + panelB.size.width).toBe(300);

    manager.destroy();
  });

  // Test d: after sash drag, sets are recomputed and sash is recreated at new boundary.
  // After test b scenario: boundary moved from 200 to 250. New sash should be at left=246.
  test("sash is recreated at new boundary after drag and sets still contain both panels", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
      ],
    });

    // Sash created in render (sets computed automatically)
    const sash = snapContainer.querySelector<HTMLElement>(".virtual-sash-vertical")!;
    expect(sash).not.toBeNull();

    // Drag sash right by 50px: A→250, B→150 at x=250. New boundary = 250.
    sash.dispatchEvent(makePointerEvent("pointerdown", { clientX: 200, clientY: 200 }));
    sash.dispatchEvent(makePointerEvent("pointermove", { clientX: 250, clientY: 200 }));
    sash.dispatchEvent(makePointerEvent("pointerup", { clientX: 250, clientY: 200 }));

    // After drag: recomputeSets fires, destroySashes + createSashes runs.
    // New sash should exist at the new boundary position (250 - 4 = 246).
    const newSashes = snapContainer.querySelectorAll<HTMLElement>(".virtual-sash-vertical");
    expect(newSashes.length).toBeGreaterThanOrEqual(1);
    // Find the sash at the new boundary
    const newSash = Array.from(newSashes).find((s) => s.style.left === "246px");
    expect(newSash).toBeDefined();

    // Sets should still contain both panels (they are still adjacent after resize)
    const sets = manager.getSets();
    expect(sets.length).toBe(1);
    expect(sets[0].panelIds).toContain("panel-a");
    expect(sets[0].panelIds).toContain("panel-b");

    manager.destroy();
  });
});

// ---- Set dragging integration tests ----

describe("PanelManager – set dragging", () => {
  let connection: MockConnection;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    connection = new MockConnection();
  });

  /**
   * Helper: establish a set between two panels via a minimal drag on the first panel,
   * then return the manager with the set active.
   * After the drag, the dragged panel (index 0 initially) is moved to the end by onFocus,
   * so it becomes top-most (index 1). The originally second panel becomes index 0.
   */
  function setupTwoPanelSet(snapContainer: HTMLElement): {
    manager: PanelManager;
    panelAEl: HTMLElement;
    panelBEl: HTMLElement;
  } {
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);
    // panel-a at (0,100,200,200), panel-b at (200,100,200,200) — shared vertical edge.
    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
      ],
    });

    // Sets computed in render — panels already edge-to-edge.
    expect(manager.getSets().length).toBe(1);

    // Find elements by position: panel-a at x=0, panel-b at x=200.
    const allPanels = Array.from(snapContainer.querySelectorAll<HTMLElement>(".floating-panel"));
    const panelAEl = allPanels.find((el) => el.style.left === "0px")!;
    const panelBEl = allPanels.find((el) => el.style.left === "200px")!;

    return { manager, panelAEl, panelBEl };
  }

  // Test a: dragging the top-most panel of a set moves all set members by the same delta.
  // Layout: panel-a(0,100,200,200), panel-b(200,100,200,200) sharing vertical edge.
  // After setup: panel-a is top-most (index 1), panel-b is index 0.
  // Drag panel-a right by 50px: set-move → panel-b also moves 50px right.
  // Assertions: panel-a.position.x = 50, panel-b.position.x = 250.
  test("dragging the top-most panel of a set moves all members by the same delta", () => {
    const snapContainer = makeSnapContainer();
    const { manager, panelAEl } = setupTwoPanelSet(snapContainer);

    // panel-a is top-most (focusPanel moved it to index 1 during setup drag).
    const headerA = panelAEl.querySelector<HTMLElement>(".panel-header")!;

    // Drag panel-a right by 50px (clientX 100 → 150, dx=50).
    headerA.dispatchEvent(makePointerEvent("pointerdown", { clientX: 100, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointermove", { clientX: 150, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointerup", { clientX: 150, clientY: 150 }));

    // Both panels should have moved right by 50px.
    const panelA = manager.getCanvasState().panels.find((p) => p.id === "panel-a")!;
    const panelB = manager.getCanvasState().panels.find((p) => p.id === "panel-b")!;
    expect(panelA.position.x).toBe(50);
    expect(panelB.position.x).toBe(250);

    manager.destroy();
  });

  // Test b: dragging a non-top panel of a set moves only that panel (break-out).
  // panel-b is index 0 (not top-most after setup). Drag panel-b right by 200px.
  // Only panel-b moves; panel-a stays at x=0.
  test("dragging a non-top panel of a set moves only that panel (break-out)", () => {
    const snapContainer = makeSnapContainer();
    const { manager, panelBEl } = setupTwoPanelSet(snapContainer);

    // panel-b is NOT top-most (index 0 after setup drag). Drag it far right.
    const headerB = panelBEl.querySelector<HTMLElement>(".panel-header")!;

    // Drag panel-b right by 200px.
    headerB.dispatchEvent(makePointerEvent("pointerdown", { clientX: 300, clientY: 150 }));
    headerB.dispatchEvent(makePointerEvent("pointermove", { clientX: 504, clientY: 150 }));
    headerB.dispatchEvent(makePointerEvent("pointerup", { clientX: 504, clientY: 150 }));

    // panel-a should stay at x=0; panel-b should have moved right.
    const panelA = manager.getCanvasState().panels.find((p) => p.id === "panel-a")!;
    const panelB = manager.getCanvasState().panels.find((p) => p.id === "panel-b")!;
    expect(panelA.position.x).toBe(0);
    // panel-b moved ~200px right (away from panel-a)
    expect(panelB.position.x).toBeGreaterThan(200);

    manager.destroy();
  });

  // Test c: after set-move, sets are recomputed and panels remain in the same set.
  // Both panels moved together, so they are still adjacent. getSets() should show 1 set.
  test("after set-move, sets are recomputed and panels remain in the same set", () => {
    const snapContainer = makeSnapContainer();
    const { manager, panelAEl } = setupTwoPanelSet(snapContainer);

    const headerA = panelAEl.querySelector<HTMLElement>(".panel-header")!;

    // Drag panel-a (top-most) right by 50px — set-move (clientX 100 → 150, dx=50).
    headerA.dispatchEvent(makePointerEvent("pointerdown", { clientX: 100, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointermove", { clientX: 150, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointerup", { clientX: 150, clientY: 150 }));

    // Both moved together → still adjacent → still in the same set.
    const sets = manager.getSets();
    expect(sets.length).toBe(1);
    expect(sets[0].panelIds).toContain("panel-a");
    expect(sets[0].panelIds).toContain("panel-b");

    manager.destroy();
  });

  // Test d: after break-out, remaining panels form correct sets.
  // 3 panels: A(0,100,200,200), B(200,100,200,200), C(400,100,200,200).
  // After recompute: 1 set with all 3 panels. A is the non-top-most (indices 0,1,2 → C is top).
  // Drag A far away → break-out. B and C still adjacent. getSets() = [{B,C}].
  test("after break-out, remaining panels form correct sets", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
        makePanelState("panel-c", 400, 100, 200, 200),
      ],
    });

    // Sets computed in render — all three panels form a chain.
    expect(manager.getSets().length).toBe(1);
    expect(manager.getSets()[0].panelIds.length).toBe(3);

    // Find panel-b (non-leader) at x=200.
    const allPanels = Array.from(snapContainer.querySelectorAll<HTMLElement>(".floating-panel"));
    const panelBEl = allPanels.find((el) => el.style.left === "200px")!;
    expect(panelBEl).toBeDefined();
    const headerB = panelBEl.querySelector<HTMLElement>(".panel-header")!;

    // Drag panel-b far left to separate from the set (dx = -300).
    headerB.dispatchEvent(makePointerEvent("pointerdown", { clientX: 300, clientY: 150 }));
    headerB.dispatchEvent(makePointerEvent("pointermove", { clientX: 4, clientY: 150 }));
    headerB.dispatchEvent(makePointerEvent("pointerup", { clientX: 4, clientY: 150 }));

    // panel-b moved far away. panel-a and panel-c should still be adjacent (if B was between them,
    // they are now separated by the gap where B was).
    // Actually: A.right=200, C.left=400, gap=200 >> 8. So no A-C set either.
    // The remaining set depends on whether A-C are now adjacent.
    // A at x=0 (right=200), C at x=400 (left=400), gap=200px. Not adjacent.
    // getSets() should be 0 sets (all three panels now separated).
    // B moved far left (~x=0 area or snapped back). The key assertion: B is no longer
    // in the set with C.
    const sets = manager.getSets();
    // panel-b broke out; A and C are not adjacent. Sets should be empty or not contain B+C.
    const bcSet = sets.find((s) => s.panelIds.includes("panel-b") && s.panelIds.includes("panel-c"));
    expect(bcSet).toBeUndefined();

    manager.destroy();
  });

  // Test e: snap applies during set-move against non-set panels.
  // Set: A(0,100,200,200)+B(200,100,200,200). Standalone: C(410,100,200,200).
  // Set bbox right edge = 400. C.left = 410, gap = 10px.
  // panel-a is top-most after setup. Drag panel-a right by 5px:
  // set bbox right moves to 405, dist to C.left = 5px (within 8px threshold) → snap.
  // After snap: set bbox right = 410, so A.x = 10, B.x = 210.
  test("snap applies during set-move against non-set panels", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
        makePanelState("panel-c", 410, 100, 200, 200),
      ],
    });

    // Sets computed in render. panel-a and panel-b share edge at x=200.
    // panel-c is standalone (gap to set = 10px).
    expect(manager.getSets().length).toBeGreaterThanOrEqual(1);
    const abSet = manager.getSets().find((s) =>
      s.panelIds.includes("panel-a") && s.panelIds.includes("panel-b")
    );
    expect(abSet).toBeDefined();

    // Find panel-a element (top-most, at left=0px).
    const allPanels = Array.from(snapContainer.querySelectorAll<HTMLElement>(".floating-panel"));
    const panelAEl = allPanels.find((el) => el.style.left === "0px")!;
    expect(panelAEl).toBeDefined();
    const headerA = panelAEl.querySelector<HTMLElement>(".panel-header")!;

    // Drag panel-a (top-most in set) right by 5px.
    // Set bbox right at proposed position = 405, dist to C.left (410) = 5px < 8px → snap.
    // Snap offset = 410 - 405 = 5. Final: A.x = 0+5+5 = 10, B.x = 200+5+5 = 210.
    // Note: the snap fires on pointermove so we need pointerup to commit.
    headerA.dispatchEvent(makePointerEvent("pointerdown", { clientX: 100, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointermove", { clientX: 105, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointerup", { clientX: 105, clientY: 150 }));

    // After snap: set should have shifted so set right edge = 410.
    // panel-a starts at x=0, panel-b at x=200. Set bbox: width=400.
    // Drag dx=5: proposed bbox at x=5, right=405. C.left=410, gap=5 ≤ 8 → snap.
    // snapDX = 5. panel-a.x = 0+5+5=10. panel-b.x = 200+5+5=210.
    // Set right edge = panel-b.x + 200 = 410. ✓
    const panelA = manager.getCanvasState().panels.find((p) => p.id === "panel-a")!;
    const panelB = manager.getCanvasState().panels.find((p) => p.id === "panel-b")!;

    // panel-a moved by dx=5 (drag) + 5 (snap offset) = 10.
    expect(panelA.position.x).toBe(10);
    // panel-b (sibling) also moved by the same total delta: 10.
    expect(panelB.position.x).toBe(210);
    // Set right edge = panel-b.x + panel-b.width = 210 + 200 = 410 (aligns with C.left).
    expect(panelB.position.x + 200).toBe(410);

    manager.destroy();
  });
});

// ---- Close recompute and final polish tests ----

describe("PanelManager – close recompute and final polish", () => {
  let connection: MockConnection;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    connection = new MockConnection();
  });

  // Test: closing a panel that connects two sub-groups splits the set into two.
  // 5-panel horizontal chain: A(0,100,100,200), B(100,100,100,200), C(200,100,100,200),
  //   D(300,100,100,200), E(400,100,100,200). One set {A,B,C,D,E}.
  // Remove C (the bridge): A-B still adjacent, D-E still adjacent, but gap between B and D.
  // After removeCard on C: getSets() = [{A,B}, {D,E}]. Two sets.
  test("closing a panel that connects two sub-groups splits the set into two", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    // Each panel is exactly 100px wide, edge-to-edge.
    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0,   100, 100, 200),
        makePanelState("panel-b", 100, 100, 100, 200),
        makePanelState("panel-c", 200, 100, 100, 200),
        makePanelState("panel-d", 300, 100, 100, 200),
        makePanelState("panel-e", 400, 100, 100, 200),
      ],
    });

    // Sets computed in render — all 5 panels form a chain.
    expect(manager.getSets().length).toBe(1);
    expect(manager.getSets()[0].panelIds.length).toBe(5);

    // Register a mock card for panel-c so we can close it via removeCard.
    const panelCTabId = "panel-c-tab";
    const mockCard = makeMockCard([FeedId.GIT], "git");
    manager.getCardRegistry().set(panelCTabId, mockCard);

    // Remove panel-c: this triggers recomputeSets internally.
    manager.removeCard(mockCard);

    // After removal: A-B adjacent (A.right=100, B.left=100), D-E adjacent (D.right=400, E.left=400).
    // But B.right=200, D.left=300, gap=100>>8 → B and D not adjacent.
    const sets = manager.getSets();

    // Exactly 2 sets: one for {A,B} and one for {D,E}.
    expect(sets.length).toBe(2);

    const abSet = sets.find((s) => s.panelIds.includes("panel-a") && s.panelIds.includes("panel-b"));
    const deSet = sets.find((s) => s.panelIds.includes("panel-d") && s.panelIds.includes("panel-e"));
    expect(abSet).toBeDefined();
    expect(deSet).toBeDefined();

    // panel-a and panel-b not in the same set as panel-d/panel-e.
    expect(abSet!.panelIds).not.toContain("panel-d");
    expect(deSet!.panelIds).not.toContain("panel-a");

    manager.destroy();
  });

  // Test: closing the last panel in a set dissolves the set.
  // 2 panels: A(0,100,200,200), B(200,100,200,200). One set {A,B}.
  // Remove panel-b: A is a singleton. getSets() = [].
  test("closing the last panel in a set dissolves the set", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
      ],
    });

    // Sets computed in render — panels already edge-to-edge.
    expect(manager.getSets().length).toBe(1);

    // Register mock card for panel-b and close it.
    const panelBTabId = "panel-b-tab";
    const mockCard = makeMockCard([FeedId.GIT], "git");
    manager.getCardRegistry().set(panelBTabId, mockCard);
    manager.removeCard(mockCard);

    // panel-b removed; only A remains (singleton). No set with 2+ members.
    expect(manager.getSets().length).toBe(0);

    // Virtual sashes should also be gone (recomputeSets destroys them).
    expect(snapContainer.querySelectorAll(".virtual-sash").length).toBe(0);

    manager.destroy();
  });

  // Test: after resetLayout, sets and sashes are empty.
  test("after resetLayout, sets and sashes are cleared", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 0, 100, 200, 200),
        makePanelState("panel-b", 200, 100, 200, 200),
      ],
    });

    // Sets and sashes computed in render — panels already edge-to-edge.
    expect(manager.getSets().length).toBe(1);
    expect(snapContainer.querySelectorAll(".virtual-sash").length).toBeGreaterThanOrEqual(1);

    // Register card factories for all 5 defaults (resetLayout requires them).
    manager.registerCardFactory("conversation", () => makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"));
    manager.registerCardFactory("terminal", () => makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"));
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));
    manager.registerCardFactory("files", () => makeMockCard([FeedId.FILESYSTEM], "files"));
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    // Reset to default layout.
    manager.resetLayout();

    // Sets and sashes must be cleared immediately after reset (before any drag).
    expect(manager.getSets().length).toBe(0);
    expect(snapContainer.querySelectorAll(".virtual-sash").length).toBe(0);

    manager.destroy();
  });

  // Test: guide lines are hidden after pointercancel during drag.
  // Panel A at (100,100,200,200), Panel B at (310,100,200,200). Gap=10px.
  // Start drag on A, move right by 5px → snap guide appears.
  // Dispatch pointercancel instead of pointerup → guides should be hidden.
  test("guide lines are hidden after pointercancel during drag", () => {
    const snapContainer = makeSnapContainer();
    const manager = new PanelManager(snapContainer, connection as unknown as TugConnection);

    manager.applyLayout({
      panels: [
        makePanelState("panel-a", 100, 100, 200, 200),
        makePanelState("panel-b", 310, 100, 200, 200),
      ],
    });

    const guides = Array.from(snapContainer.querySelectorAll<HTMLElement>(".snap-guide-line"));
    expect(guides.length).toBe(4);

    const floatingPanels = snapContainer.querySelectorAll<HTMLElement>(".floating-panel");
    const panelAEl = floatingPanels[0];
    const headerA = panelAEl.querySelector<HTMLElement>(".panel-header")!;

    // Start drag: pointerdown at (200, 150), then move 5px right.
    // A.right at 305, B.left=310, gap=5 ≤ 8 → snap activates, guide appears.
    headerA.dispatchEvent(makePointerEvent("pointerdown", { clientX: 200, clientY: 150 }));
    headerA.dispatchEvent(makePointerEvent("pointermove", { clientX: 205, clientY: 150 }));

    // Verify at least one guide is visible during drag.
    const xGuides = guides.filter((g) => g.classList.contains("snap-guide-line-x"));
    const visibleDuringDrag = xGuides.some((g) => g.style.display === "block");
    expect(visibleDuringDrag).toBe(true);

    // Cancel drag via pointercancel — this should hide all guides.
    headerA.dispatchEvent(makePointerEvent("pointercancel", { clientX: 205, clientY: 150 }));

    // All guides must be hidden after pointercancel.
    for (const guide of guides) {
      expect(guide.style.display).toBe("none");
    }

    manager.destroy();
  });
});
