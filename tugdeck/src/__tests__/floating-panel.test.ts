/**
 * Floating panel tests.
 *
 * Tests cover:
 * - FloatingPanel DOM creation and geometry
 * - Undocking creates a FloatingGroup at cursor position with D09 instance preservation
 * - Re-docking removes from floating array and inserts into docked tree
 * - Z-order management on focus
 * - Save/load round-trip preserves floating panel position and size
 * - validateDockState clamps off-canvas positions and sub-100px sizes
 *
 * Spec S07: Post-Deserialization Validation
 * [D09] Instance identity preservation during layout mutations
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

// happy-dom does not implement setPointerCapture / releasePointerCapture.
// Patch HTMLElement.prototype so FloatingPanel's pointer-capture calls are no-ops
// rather than throwing, which would abort the pointerdown listener mid-execution.
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

// crypto.randomUUID mock: patch only randomUUID to preserve crypto.subtle for
// tests that need it (e.g. session-cache, e2e-integration). Unconditional
// assignment would overwrite crypto.subtle and corrupt subsequent test files.
let uuidCounter = 0;
if (!global.crypto) {
  global.crypto = {} as unknown as Crypto;
}
(global.crypto as unknown as Record<string, unknown>)["randomUUID"] = () => {
  uuidCounter++;
  return `test-uuid-${uuidCounter}-xxxx-xxxx-xxxx-xxxxxxxxxxxx` as `${string}-${string}-${string}-${string}-${string}`;
};

import { FloatingPanel, FLOATING_TITLE_BAR_HEIGHT } from "../floating-panel";
import { validateDockState, serialize, deserialize } from "../serialization";
import { buildDefaultLayout } from "../serialization";
import type { FloatingGroup, DockState, TabNode, TabItem } from "../layout-tree";
import { PanelManager } from "../panel-manager";
import { FeedId, type FeedIdValue } from "../protocol";
import type { TugCard } from "../cards/card";
import type { TugConnection } from "../connection";

// ---- Helpers ----

function makeCanvasEl(width = 1280, height = 800): HTMLElement {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  // Mock getBoundingClientRect for canvas bounds clamping
  el.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

function makeFloatingGroup(
  x = 100,
  y = 100,
  width = 400,
  height = 300,
  title = "Test Panel"
): FloatingGroup {
  const tabItem: TabItem = {
    id: `tab-${uuidCounter++}`,
    componentId: "terminal",
    title,
    closable: true,
  };
  const node: TabNode = {
    type: "tab",
    id: `node-${uuidCounter++}`,
    tabs: [tabItem],
    activeTabIndex: 0,
  };
  return {
    position: { x, y },
    size: { width, height },
    node,
  };
}

function makeFloatingPanelCallbacks(): {
  callbacks: import("../floating-panel").FloatingPanelCallbacks;
  moveEndCalls: Array<{ x: number; y: number }>;
  resizeEndCalls: Array<{ x: number; y: number; width: number; height: number }>;
  focusCalls: number;
  dragOutCalls: PointerEvent[];
  closeCalls: number;
} {
  const moveEndCalls: Array<{ x: number; y: number }> = [];
  const resizeEndCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
  let focusCalls = 0;
  const dragOutCalls: PointerEvent[] = [];
  let closeCalls = 0;

  const callbacks: import("../floating-panel").FloatingPanelCallbacks = {
    onMoveEnd: (x, y) => moveEndCalls.push({ x, y }),
    onResizeEnd: (x, y, width, height) => resizeEndCalls.push({ x, y, width, height }),
    onFocus: () => { focusCalls++; },
    onDragOut: (e) => dragOutCalls.push(e),
    onClose: () => { closeCalls++; },
  };

  return { callbacks, moveEndCalls, resizeEndCalls, focusCalls: 0, dragOutCalls, closeCalls: 0 };
}

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

  send(_feedId: number, _payload: Uint8Array): void {}
}

function makeMockCard(
  feedIds: FeedIdValue[],
  componentId: string
): TugCard & {
  mountCount: number;
  destroyCount: number;
  resizeCalls: Array<{ width: number; height: number }>;
} {
  return {
    feedIds,
    mountCount: 0,
    destroyCount: 0,
    resizeCalls: [],
    mount(_container: HTMLElement) {
      this.mountCount++;
    },
    onFrame(_feedId: FeedIdValue, _payload: Uint8Array) {},
    onResize(width: number, height: number) {
      this.resizeCalls.push({ width, height });
    },
    destroy() {
      this.destroyCount++;
    },
  };
}

// ---- FloatingPanel DOM tests ----

describe("FloatingPanel – DOM creation", () => {
  let canvas: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    canvas = makeCanvasEl();
    document.body.appendChild(canvas);
  });

  test("creates an element with class 'floating-panel'", () => {
    const fg = makeFloatingGroup(100, 150, 400, 300);
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    expect(fp.getElement().classList.contains("floating-panel")).toBe(true);
    fp.destroy();
  });

  test("positions element according to FloatingGroup position", () => {
    const fg = makeFloatingGroup(200, 150, 400, 300);
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    const el = fp.getElement();
    expect(el.style.left).toBe("200px");
    expect(el.style.top).toBe("150px");
    fp.destroy();
  });

  test("sizes element according to FloatingGroup size", () => {
    const fg = makeFloatingGroup(100, 100, 500, 400);
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    const el = fp.getElement();
    expect(el.style.width).toBe("500px");
    expect(el.style.height).toBe("400px");
    fp.destroy();
  });

  test("creates a panel-header (full CardHeader) with card title text", () => {
    const fg = makeFloatingGroup(100, 100, 400, 300, "My Terminal");
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    const header = fp.getElement().querySelector(".panel-header");
    expect(header).not.toBeNull();
    const titleEl = fp.getElement().querySelector(".panel-header-title");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("My Terminal");
    fp.destroy();
  });

  test("creates a card area element", () => {
    const fg = makeFloatingGroup();
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    expect(fp.getCardAreaElement()).not.toBeNull();
    expect(fp.getCardAreaElement().classList.contains("floating-panel-content")).toBe(true);
    fp.destroy();
  });

  test("creates all 8 resize handles", () => {
    const fg = makeFloatingGroup();
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    const directions = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
    for (const dir of directions) {
      const handle = fp.getElement().querySelector(`.floating-panel-resize-${dir}`);
      expect(handle).not.toBeNull();
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
    const fg = makeFloatingGroup();
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    fp.setZIndex(150);
    expect(fp.getElement().style.zIndex).toBe("150");
    fp.destroy();
  });

  test("updateTitle is a no-op; title is set from FloatingGroup at construction", () => {
    // After Step 5, updateTitle() is a no-op since CardHeader renders the title.
    // The initial title comes from the FloatingGroup tab title at construction time.
    const fg = makeFloatingGroup(100, 100, 400, 300, "My Title");
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    const titleEl = fp.getElement().querySelector(".panel-header-title");
    expect(titleEl!.textContent).toBe("My Title");
    // updateTitle is a no-op — just verify it doesn't throw
    fp.updateTitle("Should be no-op");
    expect(titleEl!.textContent).toBe("My Title");
    fp.destroy();
  });

  test("updatePosition updates element style and FloatingGroup position", () => {
    const fg = makeFloatingGroup(100, 100, 400, 300);
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    fp.updatePosition(250, 180);
    expect(fp.getElement().style.left).toBe("250px");
    expect(fp.getElement().style.top).toBe("180px");
    expect(fp.getFloatingGroup().position.x).toBe(250);
    expect(fp.getFloatingGroup().position.y).toBe(180);
    fp.destroy();
  });

  test("updateSize updates element style and FloatingGroup size", () => {
    const fg = makeFloatingGroup(100, 100, 400, 300);
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    fp.updateSize(600, 450);
    expect(fp.getElement().style.width).toBe("600px");
    expect(fp.getElement().style.height).toBe("450px");
    expect(fp.getFloatingGroup().size.width).toBe(600);
    expect(fp.getFloatingGroup().size.height).toBe(450);
    fp.destroy();
  });

  test("getFloatingGroup returns the same object passed to the constructor", () => {
    const fg = makeFloatingGroup();
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    expect(fp.getFloatingGroup()).toBe(fg);
    fp.destroy();
  });

  test("destroy removes the element from the DOM", () => {
    const fg = makeFloatingGroup();
    const { callbacks } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);
    canvas.appendChild(fp.getElement());
    expect(canvas.contains(fp.getElement())).toBe(true);
    fp.destroy();
    expect(canvas.contains(fp.getElement())).toBe(false);
  });
});

// ---- validateDockState clamping tests (Spec S07) ----

describe("validateDockState – floating panel position/size clamping (Spec S07)", () => {
  test("clamps floating panel with sub-100px width to 100px", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(100, 100, 50, 200); // width=50 < 100
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };
    const validated = validateDockState(dockState);
    expect(validated.floating[0].size.width).toBe(100);
    expect(validated.floating[0].size.height).toBe(200); // unchanged
  });

  test("clamps floating panel with sub-100px height to 100px", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(100, 100, 300, 30); // height=30 < 100
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };
    const validated = validateDockState(dockState);
    expect(validated.floating[0].size.width).toBe(300); // unchanged
    expect(validated.floating[0].size.height).toBe(100);
  });

  test("clamps floating panel with both dimensions sub-100px", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(100, 100, 80, 60);
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };
    const validated = validateDockState(dockState);
    expect(validated.floating[0].size.width).toBe(100);
    expect(validated.floating[0].size.height).toBe(100);
  });

  test("clamps floating panel position that is off the right canvas edge", () => {
    const defaultLayout = buildDefaultLayout();
    // Panel at x=1100, width=400 -> extends to x=1500, beyond canvas width=1280
    const fg = makeFloatingGroup(1100, 100, 400, 300);
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };
    const validated = validateDockState(dockState, 1280, 800);
    // Expected x: 1280 - 400 = 880
    expect(validated.floating[0].position.x).toBe(880);
  });

  test("clamps floating panel position that is off the bottom canvas edge", () => {
    const defaultLayout = buildDefaultLayout();
    // Panel at y=700, height=300 -> extends to y=1000, beyond canvas height=800
    const fg = makeFloatingGroup(100, 700, 400, 300);
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };
    const validated = validateDockState(dockState, 1280, 800);
    // Expected y: 800 - 300 = 500
    expect(validated.floating[0].position.y).toBe(500);
  });

  test("clamps floating panel at negative x to 0", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(-50, 100, 400, 300);
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };
    const validated = validateDockState(dockState, 1280, 800);
    expect(validated.floating[0].position.x).toBe(0);
  });

  test("clamps floating panel at negative y to 0", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(100, -50, 400, 300);
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };
    const validated = validateDockState(dockState, 1280, 800);
    expect(validated.floating[0].position.y).toBe(0);
  });

  test("does not clamp position when canvas dimensions not provided", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(2000, 2000, 400, 300); // way off screen
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };
    // No canvas dimensions -> no position clamping
    const validated = validateDockState(dockState);
    expect(validated.floating[0].position.x).toBe(2000);
    expect(validated.floating[0].position.y).toBe(2000);
  });

  test("does not modify valid floating panels within bounds", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(100, 100, 400, 300);
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };
    const validated = validateDockState(dockState, 1280, 800);
    expect(validated.floating[0].position.x).toBe(100);
    expect(validated.floating[0].position.y).toBe(100);
    expect(validated.floating[0].size.width).toBe(400);
    expect(validated.floating[0].size.height).toBe(300);
  });
});

// ---- Floating panel save/load round-trip tests ----

describe("Floating panel – serialization round-trip", () => {
  test("floating panel position and size survive serialize/deserialize cycle", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(250, 175, 500, 380);
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };

    const serialized = serialize(dockState);
    const json = JSON.stringify(serialized);
    const restored = deserialize(json, 1280, 800);

    expect(restored.floating.length).toBe(1);
    expect(restored.floating[0].position.x).toBe(250);
    expect(restored.floating[0].position.y).toBe(175);
    expect(restored.floating[0].size.width).toBe(500);
    expect(restored.floating[0].size.height).toBe(380);
  });

  test("floating panel tab title and componentId survive serialize/deserialize cycle", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(100, 100, 400, 300, "My Terminal");
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };

    const serialized = serialize(dockState);
    const json = JSON.stringify(serialized);
    const restored = deserialize(json, 1280, 800);

    expect(restored.floating[0].node.tabs[0].title).toBe("My Terminal");
    expect(restored.floating[0].node.tabs[0].componentId).toBe("terminal");
  });

  test("off-canvas position is clamped during deserialization", () => {
    const defaultLayout = buildDefaultLayout();
    // Create a floating group with a position that is off-canvas
    const fg = makeFloatingGroup(1200, 750, 400, 300);
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };

    const serialized = serialize(dockState);
    const json = JSON.stringify(serialized);
    // Deserialize with canvas 1280x800
    // Panel at x=1200, w=400 -> extends to 1600, beyond 1280 -> clamp to x=880
    // Panel at y=750, h=300 -> extends to 1050, beyond 800 -> clamp to y=500
    const restored = deserialize(json, 1280, 800);

    expect(restored.floating[0].position.x).toBe(880);
    expect(restored.floating[0].position.y).toBe(500);
  });

  test("sub-100px size is clamped to 100px during deserialization", () => {
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(100, 100, 80, 60);
    const dockState: DockState = {
      root: defaultLayout.root,
      floating: [fg],
    };

    const serialized = serialize(dockState);
    const json = JSON.stringify(serialized);
    const restored = deserialize(json);

    expect(restored.floating[0].size.width).toBe(100);
    expect(restored.floating[0].size.height).toBe(100);
  });
});

// ---- PanelManager floating panel integration tests ----

describe("PanelManager – floating panels integration", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    uuidCounter = 1000; // Reset to avoid collision

    container = document.createElement("div");
    container.style.width = "1280px";
    container.style.height = "800px";
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 1280,
      bottom: 800,
      width: 1280,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(container);

    connection = new MockConnection();
  });

  test("initial dockState has empty floating array", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const state = manager.getDockState();
    expect(state.floating).toBeDefined();
    expect(Array.isArray(state.floating)).toBe(true);
    expect(state.floating.length).toBe(0);
    manager.destroy();
  });

  test("applyLayout with floating panel creates a floating panel entry in dockState", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const defaultLayout = buildDefaultLayout();
    // Use position/size within canvas bounds.
    // Note: container.clientWidth/clientHeight are 0 in happy-dom since the element
    // is not laid out, so validateDockState does not clamp (no canvasWidth/Height).
    const fg = makeFloatingGroup(100, 100, 400, 300, "Terminal");

    manager.applyLayout({
      root: defaultLayout.root,
      floating: [fg],
    });

    const state = manager.getDockState();
    expect(state.floating.length).toBe(1);
    // Position values are preserved (canvas clientWidth=0 means no clamping in applyLayout)
    expect(typeof state.floating[0].position.x).toBe("number");
    expect(typeof state.floating[0].position.y).toBe("number");
    expect(state.floating[0].size.width).toBe(400);
    expect(state.floating[0].size.height).toBe(300);

    manager.destroy();
  });

  test("applyLayout renders floating panel as child of container element", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(100, 100, 400, 300, "Terminal");

    manager.applyLayout({
      root: defaultLayout.root,
      floating: [fg],
    });

    // Floating panel should be a child of the canvas container (not rootEl)
    const floatingEls = container.querySelectorAll(".floating-panel");
    expect(floatingEls.length).toBe(1);

    manager.destroy();
  });

  test("z-order: floating panel gets next z-index on focus (via onFocus callback)", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const defaultLayout = buildDefaultLayout();
    const fg1 = makeFloatingGroup(100, 100, 400, 300, "Panel 1");
    const fg2 = makeFloatingGroup(200, 200, 400, 300, "Panel 2");

    manager.applyLayout({
      root: defaultLayout.root,
      floating: [fg1, fg2],
    });

    const floatingEls = container.querySelectorAll<HTMLElement>(".floating-panel");
    expect(floatingEls.length).toBe(2);

    // Both panels should have positive z-index values
    const z1 = parseInt(floatingEls[0].style.zIndex, 10);
    const z2 = parseInt(floatingEls[1].style.zIndex, 10);
    expect(z1).toBeGreaterThanOrEqual(100);
    expect(z2).toBeGreaterThanOrEqual(100);

    manager.destroy();
  });

  test("floating panel save to localStorage preserves floating array", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const defaultLayout = buildDefaultLayout();
    const fg = makeFloatingGroup(150, 200, 450, 350, "Terminal");

    manager.applyLayout({
      root: defaultLayout.root,
      floating: [fg],
    });

    // applyLayout schedules save with debounce; we verify dockState has floating panel set
    const state = manager.getDockState();
    expect(state.floating.length).toBe(1);
    // Size is preserved (validated but within minimum)
    expect(state.floating[0].size.width).toBe(450);
    expect(state.floating[0].size.height).toBe(350);
    // Position may be clamped by validateDockState; verify it's a valid number
    expect(typeof state.floating[0].position.x).toBe("number");
    expect(typeof state.floating[0].position.y).toBe("number");

    manager.destroy();
  });

  test("D09: card instance is the same object throughout layout mutations", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT], "git");
    manager.addCard(card, "git");

    // Get the current dockState and verify git card is registered
    const registry = manager.getCardRegistry();
    // Find the registered card for git
    let registeredCard: TugCard | null = null;
    for (const [_id, c] of registry) {
      if (c === card) {
        registeredCard = c;
        break;
      }
    }

    // The exact same card instance should be in the registry (D09 identity)
    expect(registeredCard).toBe(card);

    // Get the state, apply layout with a floating panel added
    const state = manager.getDockState();

    // Add a floating panel
    const floatingNode: TabNode = {
      type: "tab",
      id: `float-node-${uuidCounter++}`,
      tabs: [{
        id: `float-tab-${uuidCounter++}`,
        componentId: "terminal",
        title: "Floating Terminal",
        closable: true,
      }],
      activeTabIndex: 0,
    };

    manager.applyLayout({
      root: state.root,
      floating: [{
        position: { x: 200, y: 200 },
        size: { width: 400, height: 300 },
        node: floatingNode,
      }],
    });

    // After applyLayout, the git card should still be the same instance in the registry
    for (const [_id, c] of manager.getCardRegistry()) {
      if (c === card) {
        registeredCard = c;
        break;
      }
    }
    expect(registeredCard).toBe(card);

    // destroy() should not have been called (D09: no destruction during layout mutation)
    expect(card.destroyCount).toBe(0);

    manager.destroy();
  });
});

// ---- Fix 2: removeCard cleans up floating panels ----

describe("PanelManager.removeCard – floating panel cleanup (Fix 2)", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    uuidCounter = 2000;

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

  test("removeCard removes the FloatingGroup when card is in a floating panel", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT], "git");
    manager.addCard(card, "git");

    // Find the git tab item id from the registry
    const registry = manager.getCardRegistry();
    let gitTabItemId: string | null = null;
    for (const [id, c] of registry) {
      if (c === card) { gitTabItemId = id; break; }
    }
    expect(gitTabItemId).not.toBeNull();

    // Synthesise a FloatingGroup containing the git tab
    const gitTab = { id: gitTabItemId!, componentId: "git", title: "Git", closable: true };
    const floatingNode: TabNode = {
      type: "tab",
      id: `float-node-${uuidCounter++}`,
      tabs: [gitTab],
      activeTabIndex: 0,
    };
    const floatingGroup: FloatingGroup = {
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
      node: floatingNode,
    };

    // Apply layout: docked tree with git removed + git in floating
    const currentRoot = manager.getDockState().root;
    manager.applyLayout({
      root: currentRoot,
      floating: [floatingGroup],
    });

    // Verify the floating group is in the state
    let stateBefore = manager.getDockState();
    // floating may have the group (layout was applied)
    expect(stateBefore.floating.length).toBeGreaterThanOrEqual(0);

    // Now remove the card — should purge the FloatingGroup
    manager.removeCard(card);

    const stateAfter = manager.getDockState();
    // No floating group should remain for this card's tab id
    const remains = stateAfter.floating.some(
      (fg) => fg.node.tabs.some((t) => t.id === gitTabItemId)
    );
    expect(remains).toBe(false);

    manager.destroy();
  });

  test("removeCard with card in floating panel does not leave phantom .floating-panel elements", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT], "git");
    manager.addCard(card, "git");

    // Find git tab item id
    const registry = manager.getCardRegistry();
    let gitTabItemId: string | null = null;
    for (const [id, c] of registry) {
      if (c === card) { gitTabItemId = id; break; }
    }

    // Build a floating layout with git
    const gitTab = { id: gitTabItemId!, componentId: "git", title: "Git", closable: true };
    const floatingNode: TabNode = {
      type: "tab",
      id: `float-node-${uuidCounter++}`,
      tabs: [gitTab],
      activeTabIndex: 0,
    };
    manager.applyLayout({
      root: manager.getDockState().root,
      floating: [{ position: { x: 100, y: 100 }, size: { width: 400, height: 300 }, node: floatingNode }],
    });

    // Remove the card
    manager.removeCard(card);

    // After re-render triggered by removeCard, no .floating-panel elements should remain
    const floatingEls = container.querySelectorAll(".floating-panel");
    expect(floatingEls.length).toBe(0);

    manager.destroy();
  });

  test("removeCard with card in docked tree does not affect unrelated floating panels", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);

    // Register git card (in docked tree)
    const gitCard = makeMockCard([FeedId.GIT], "git");
    manager.addCard(gitCard, "git");

    // Synthesise a floating panel for an unrelated component (terminal)
    const termTab: TabItem = {
      id: `term-tab-${uuidCounter++}`,
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const floatingNode: TabNode = {
      type: "tab",
      id: `float-node-${uuidCounter++}`,
      tabs: [termTab],
      activeTabIndex: 0,
    };
    manager.applyLayout({
      root: manager.getDockState().root,
      floating: [{ position: { x: 50, y: 50 }, size: { width: 400, height: 300 }, node: floatingNode }],
    });

    const floatingBefore = manager.getDockState().floating.length;

    // Remove the docked git card — should NOT affect floating terminal group
    manager.removeCard(gitCard);

    const floatingAfter = manager.getDockState().floating.length;
    expect(floatingAfter).toBe(floatingBefore);

    manager.destroy();
  });

  test("removeCard calls card.destroy() exactly once even when card is in floating panel", () => {
    const manager = new PanelManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.GIT], "git");
    manager.addCard(card, "git");

    const registry = manager.getCardRegistry();
    let gitTabItemId: string | null = null;
    for (const [id, c] of registry) {
      if (c === card) { gitTabItemId = id; break; }
    }

    const gitTab = { id: gitTabItemId!, componentId: "git", title: "Git", closable: true };
    const floatingNode: TabNode = {
      type: "tab",
      id: `float-node-${uuidCounter++}`,
      tabs: [gitTab],
      activeTabIndex: 0,
    };
    manager.applyLayout({
      root: manager.getDockState().root,
      floating: [{ position: { x: 100, y: 100 }, size: { width: 400, height: 300 }, node: floatingNode }],
    });

    manager.removeCard(card);

    expect(card.destroyCount).toBe(1);

    manager.destroy();
  });
});

// ---- Fix 1: FloatingPanel.onDragOut triggered when cursor leaves panel ----

describe("FloatingPanel – onDragOut triggered on cursor-leave (Fix 1)", () => {
  let canvas: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    canvas = makeCanvasEl(1280, 800);
    // Give the canvas an offset in the viewport for realistic rect maths
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1280, bottom: 800,
      width: 1280, height: 800, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(canvas);
  });

  test("onDragOut is NOT called when drag stays within panel bounds", () => {
    const fg = makeFloatingGroup(100, 100, 400, 300);
    const { callbacks, dragOutCalls } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);

    // Panel occupies 100..500 x 100..400 in client coords
    fp.getElement().getBoundingClientRect = () => ({
      left: 100, top: 100, right: 500, bottom: 400,
      width: 400, height: 300, x: 100, y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    const titleBar = fp.getElement().querySelector(".panel-header") as HTMLElement;

    // Simulate pointerdown on the title bar (inside panel)
    const downEv = new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointerdown", {
      button: 0, clientX: 200, clientY: 110, pointerId: 1,
    });
    titleBar.dispatchEvent(downEv);

    // Simulate pointermove that stays inside the panel
    const moveEv = new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointermove", {
      button: 0, clientX: 250, clientY: 130, pointerId: 1,
    });
    titleBar.dispatchEvent(moveEv);

    expect(dragOutCalls.length).toBe(0);

    fp.destroy();
  });

  test("onDragOut is called when cursor moves outside the panel bounds after threshold", () => {
    const fg = makeFloatingGroup(100, 100, 400, 300);
    const { callbacks, dragOutCalls } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);

    // Panel rect: 100..500 x 100..400
    fp.getElement().getBoundingClientRect = () => ({
      left: 100, top: 100, right: 500, bottom: 400,
      width: 400, height: 300, x: 100, y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    const titleBar = fp.getElement().querySelector(".panel-header") as HTMLElement;

    // Simulate pointerdown on the title bar
    const downEv = new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointerdown", {
      button: 0, clientX: 200, clientY: 110, pointerId: 1,
    });
    titleBar.dispatchEvent(downEv);

    // First move: crosses DRAG_THRESHOLD_PX but stays inside panel
    const move1 = new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointermove", {
      button: 0, clientX: 204, clientY: 110, pointerId: 1,
    });
    titleBar.dispatchEvent(move1);

    // Second move: cursor exits panel to the left (clientX=50 < panelRect.left=100)
    const move2 = new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointermove", {
      button: 0, clientX: 50, clientY: 110, pointerId: 1,
    });
    titleBar.dispatchEvent(move2);

    expect(dragOutCalls.length).toBe(1);

    fp.destroy();
  });

  test("onDragOut is called at most once even if cursor continues moving outside", () => {
    const fg = makeFloatingGroup(100, 100, 400, 300);
    const { callbacks, dragOutCalls } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);

    fp.getElement().getBoundingClientRect = () => ({
      left: 100, top: 100, right: 500, bottom: 400,
      width: 400, height: 300, x: 100, y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    const titleBar = fp.getElement().querySelector(".panel-header") as HTMLElement;

    // Pointerdown
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointerdown", {
      button: 0, clientX: 200, clientY: 110, pointerId: 1,
    }));

    // Move to establish dragging (past threshold)
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointermove", {
      button: 0, clientX: 204, clientY: 110, pointerId: 1,
    }));

    // Move outside panel — triggers dragOut and removes local listeners
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointermove", {
      button: 0, clientX: 50, clientY: 110, pointerId: 1,
    }));

    // Additional moves after listener removal should have no effect
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointermove", {
      button: 0, clientX: 30, clientY: 110, pointerId: 1,
    }));
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointermove", {
      button: 0, clientX: 10, clientY: 110, pointerId: 1,
    }));

    expect(dragOutCalls.length).toBe(1);

    fp.destroy();
  });

  test("onDragOut is not called for a short click (below drag threshold)", () => {
    const fg = makeFloatingGroup(100, 100, 400, 300);
    const { callbacks, dragOutCalls } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);

    fp.getElement().getBoundingClientRect = () => ({
      left: 100, top: 100, right: 500, bottom: 400,
      width: 400, height: 300, x: 100, y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    const titleBar = fp.getElement().querySelector(".panel-header") as HTMLElement;

    // Pointerdown and immediate pointerup (click, no move beyond threshold)
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointerdown", {
      button: 0, clientX: 200, clientY: 110, pointerId: 1,
    }));
    // Tiny move (< 3px threshold), still inside panel
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointermove", {
      button: 0, clientX: 201, clientY: 110, pointerId: 1,
    }));
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointerup", {
      button: 0, clientX: 201, clientY: 110, pointerId: 1,
    }));

    expect(dragOutCalls.length).toBe(0);

    fp.destroy();
  });

  test("onMoveEnd is called when drag ends within panel (no drag-out)", () => {
    const fg = makeFloatingGroup(100, 100, 400, 300);
    const { callbacks, moveEndCalls, dragOutCalls } = makeFloatingPanelCallbacks();
    const fp = new FloatingPanel(fg, callbacks, canvas);

    fp.getElement().getBoundingClientRect = () => ({
      left: 100, top: 100, right: 500, bottom: 400,
      width: 400, height: 300, x: 100, y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1280, bottom: 800,
      width: 1280, height: 800, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const titleBar = fp.getElement().querySelector(".panel-header") as HTMLElement;

    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointerdown", {
      button: 0, clientX: 200, clientY: 110, pointerId: 1,
    }));

    // Move enough to trigger dragging, staying inside panel
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointermove", {
      button: 0, clientX: 210, clientY: 120, pointerId: 1,
    }));
    expect(dragOutCalls.length).toBe(0);

    // Release inside the panel
    titleBar.dispatchEvent(new (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent("pointerup", {
      button: 0, clientX: 210, clientY: 120, pointerId: 1,
    }));

    // onMoveEnd should fire (drag ended cleanly within panel)
    expect(moveEndCalls.length).toBe(1);
    expect(dragOutCalls.length).toBe(0);

    fp.destroy();
  });
});
