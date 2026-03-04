/**
 * TabDragCoordinator unit tests -- Step 3.
 *
 * Tests cover:
 * - T14: startDrag guards against single-tab cards (tabCount <= 1)
 * - T15: computeReorderIndex returns correct insertion index for pointer
 *         positions between tabs (unit test with mock rects)
 * - T16: Coordinator correctly transitions between reorder/detach/merge modes
 *         based on pointer position relative to cached rects
 *
 * These tests drive the coordinator's pure logic directly, without a full
 * DOM environment or React tree. The coordinator is accessed via its exported
 * singleton but its internal state is inspected via side-effects on mock DOM
 * elements.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { tabDragCoordinator, exceedsDragThreshold, GHOST_TAB_ZINDEX } from "@/tab-drag-coordinator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock IDeckManagerStore with jest-style spy tracking.
 */
function makeMockStore() {
  const calls: Record<string, unknown[][]> = {
    reorderTab: [],
    detachTab: [],
    mergeTab: [],
  };
  return {
    subscribe: () => () => {},
    getSnapshot: () => ({ cards: [] }),
    getVersion: () => 0,
    handleCardMoved: () => {},
    handleCardClosed: () => {},
    handleCardFocused: () => {},
    addCard: () => null,
    addTab: () => null,
    removeTab: () => {},
    setActiveTab: () => {},
    reorderTab: (cardId: string, fromIndex: number, toIndex: number) => {
      calls.reorderTab.push([cardId, fromIndex, toIndex]);
    },
    detachTab: (cardId: string, tabId: string, position: { x: number; y: number }) => {
      calls.detachTab.push([cardId, tabId, position]);
      return "new-card-id";
    },
    mergeTab: (
      sourceCardId: string,
      tabId: string,
      targetCardId: string,
      insertAtIndex: number,
    ) => {
      calls.mergeTab.push([sourceCardId, tabId, targetCardId, insertAtIndex]);
    },
    _calls: calls,
  };
}

/**
 * Create a mock tab element with given getBoundingClientRect dimensions.
 */
function makeMockTabElement(left: number, width: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "tug-tab";
  el.setAttribute("data-testid", "mock-tab");

  // Override getBoundingClientRect.
  el.getBoundingClientRect = () => ({
    left,
    right: left + width,
    top: 0,
    bottom: 28,
    width,
    height: 28,
    x: left,
    y: 0,
    toJSON: () => {},
  } as DOMRect);

  // Provide offsetWidth/offsetHeight for ghost sizing.
  Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => width });
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 28 });

  // Stub setPointerCapture / releasePointerCapture (no-op in tests).
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};

  return el;
}

/**
 * Create a mock tab bar element containing N mock tab elements at given widths.
 * Each tab is 80px wide, starting at barLeft.
 */
function makeMockTabBar(barLeft: number, tabCount: number, tabWidth = 80): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "tug-tab-bar";

  bar.getBoundingClientRect = () => ({
    left: barLeft,
    right: barLeft + tabCount * tabWidth,
    top: 0,
    bottom: 28,
    width: tabCount * tabWidth,
    height: 28,
    x: barLeft,
    y: 0,
    toJSON: () => {},
  } as DOMRect);

  for (let i = 0; i < tabCount; i++) {
    const tab = makeMockTabElement(barLeft + i * tabWidth, tabWidth);
    bar.appendChild(tab);
  }

  return bar;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Ensure any leftover drag state is cleared.
  tabDragCoordinator.cleanup();

  // Set up a minimal DOM: a deck-container and a body.
  const container = document.createElement("div");
  container.id = "deck-container";
  container.getBoundingClientRect = () => ({
    left: 0,
    right: 1280,
    top: 0,
    bottom: 800,
    width: 1280,
    height: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  } as DOMRect);
  document.body.appendChild(container);
});

afterEach(() => {
  tabDragCoordinator.cleanup();
  // Remove any deck-container added during the test.
  const container = document.getElementById("deck-container");
  if (container) container.remove();
  // Remove all test-created elements to prevent DOM leakage between tests.
  document.body.querySelectorAll(".tug-tab-bar").forEach((el) => el.remove());
  document.body.querySelectorAll(".card-frame").forEach((el) => el.remove());
  document.body.querySelectorAll(".tug-tab").forEach((el) => el.remove());
});

// ---------------------------------------------------------------------------
// T14: startDrag guards against single-tab cards
// ---------------------------------------------------------------------------

describe("TabDragCoordinator.startDrag – single-tab guard (T14)", () => {
  it("T14: does not start drag when tabCount is 1", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const tabEl = makeMockTabElement(0, 80);
    document.body.appendChild(tabEl);

    const fakeEvent = {
      pointerId: 1,
      clientX: 40,
      clientY: 14,
    } as PointerEvent;

    // tabCount = 1: should NOT initiate drag.
    tabDragCoordinator.startDrag(fakeEvent, tabEl, "card-1", "tab-1", 1);

    // Verify drag did not start: source tab should not have data-dragging.
    expect(tabEl.getAttribute("data-dragging")).toBeNull();

    tabEl.remove();
  });

  it("T14: does not start drag when tabCount is 0", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const tabEl = makeMockTabElement(0, 80);
    document.body.appendChild(tabEl);

    const fakeEvent = {
      pointerId: 1,
      clientX: 40,
      clientY: 14,
    } as PointerEvent;

    tabDragCoordinator.startDrag(fakeEvent, tabEl, "card-1", "tab-1", 0);
    expect(tabEl.getAttribute("data-dragging")).toBeNull();

    tabEl.remove();
  });

  it("T14: starts drag when tabCount > 1 (sets data-dragging on source tab)", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const tabEl = makeMockTabElement(0, 80);
    document.body.appendChild(tabEl);

    const fakeEvent = {
      pointerId: 1,
      clientX: 40,
      clientY: 14,
    } as PointerEvent;

    // tabCount = 2: should initiate drag.
    tabDragCoordinator.startDrag(fakeEvent, tabEl, "card-1", "tab-1", 2);

    expect(tabEl.getAttribute("data-dragging")).toBe("true");

    // Cleanup to avoid leaking state.
    tabDragCoordinator.cleanup();
    tabEl.remove();
  });
});

// ---------------------------------------------------------------------------
// T15: computeReorderIndex returns correct insertion index
// ---------------------------------------------------------------------------

describe("TabDragCoordinator.computeReorderIndex – hit-testing (T15)", () => {
  it("T15: returns 0 when pointer is left of first tab midpoint", () => {
    // Tab bar: 3 tabs at x=[0,80,160], each 80px wide.
    // Tab midpoints: 40, 120, 200.
    // Pointer at x=10: left of first midpoint (40) → insertIndex 0.
    const bar = makeMockTabBar(0, 3, 80);
    document.body.appendChild(bar);

    const index = tabDragCoordinator.computeReorderIndex(bar, 10);
    expect(index).toBe(0);

    bar.remove();
  });

  it("T15: returns 1 when pointer is between first and second tab midpoints", () => {
    // Tab bar: 3 tabs at x=[0,80,160], each 80px wide.
    // Tab midpoints: 40, 120, 200.
    // Pointer at x=80: between first midpoint (40) and second midpoint (120) → insertIndex 1.
    const bar = makeMockTabBar(0, 3, 80);
    document.body.appendChild(bar);

    const index = tabDragCoordinator.computeReorderIndex(bar, 80);
    expect(index).toBe(1);

    bar.remove();
  });

  it("T15: returns 2 when pointer is between second and third tab midpoints", () => {
    // Tab bar: 3 tabs at x=[0,80,160], each 80px wide.
    // Tab midpoints: 40, 120, 200.
    // Pointer at x=150: between second midpoint (120) and third midpoint (200) → insertIndex 2.
    const bar = makeMockTabBar(0, 3, 80);
    document.body.appendChild(bar);

    const index = tabDragCoordinator.computeReorderIndex(bar, 150);
    expect(index).toBe(2);

    bar.remove();
  });

  it("T15: returns tabCount when pointer is right of all tab midpoints (append)", () => {
    // Tab bar: 3 tabs, midpoints at 40, 120, 200.
    // Pointer at x=250: right of all midpoints → insertIndex 3 (= tabCount).
    const bar = makeMockTabBar(0, 3, 80);
    document.body.appendChild(bar);

    const index = tabDragCoordinator.computeReorderIndex(bar, 250);
    expect(index).toBe(3);

    bar.remove();
  });

  it("T15: returns 0 for an empty tab bar", () => {
    const bar = makeMockTabBar(0, 0, 80);
    document.body.appendChild(bar);

    const index = tabDragCoordinator.computeReorderIndex(bar, 50);
    expect(index).toBe(0);

    bar.remove();
  });

  it("T15: accounts for non-zero bar left offset", () => {
    // Tab bar starts at x=400; 3 tabs each 80px wide.
    // Tab absolute positions: [400,480,560]; midpoints: 440, 520, 600.
    // Pointer at x=450: between 440 and 520 → insertIndex 1.
    const bar = makeMockTabBar(400, 3, 80);
    document.body.appendChild(bar);

    const index = tabDragCoordinator.computeReorderIndex(bar, 450);
    expect(index).toBe(1);

    bar.remove();
  });
});

// ---------------------------------------------------------------------------
// T16: Mode transitions based on pointer position relative to cached rects
// ---------------------------------------------------------------------------

/**
 * Helper: build a DOM structure that gives the coordinator a source tab bar
 * (with data-card-id for cache lookup), plus optional additional bars and
 * card frames for multi/single-tab targets. Returns references needed for
 * hit-testing assertions.
 *
 * Layout used by T16 tests:
 *   Source bar:  x=[0..160], y=[0..28]   (card "src", 2 tabs × 80px)
 *   Target bar:  x=[400..560], y=[0..28] (card "tgt", 2 tabs × 80px)
 *   Single card: x=[700..900], y=[0..200] (card "single", no tab bar)
 *
 * Pointer coordinates used to trigger each mode:
 *   Reorder:  cx=80,  cy=14  (inside source bar)
 *   Detach:   cx=250, cy=14  (outside all bars/frames)
 *   Merge multi: cx=450, cy=14 (inside target bar)
 *   Merge single: cx=800, cy=100 (inside single-tab card frame)
 */
function setupDragScenario(): {
  srcTabEl: HTMLElement;
  srcBar: HTMLElement;
  tgtBar: HTMLElement;
  singleFrame: HTMLElement;
  singleAccessory: HTMLElement;
} {
  // Source bar (card "src") -- 2 tabs, x=[0..160], y=[0..28]
  const srcBar = document.createElement("div");
  srcBar.className = "tug-tab-bar";
  srcBar.setAttribute("data-card-id", "src");
  srcBar.getBoundingClientRect = () =>
    ({ left: 0, right: 160, top: 0, bottom: 28, width: 160, height: 28, x: 0, y: 0, toJSON: () => {} } as DOMRect);
  const srcTab1 = makeMockTabElement(0, 80);
  const srcTab2 = makeMockTabElement(80, 80);
  srcBar.appendChild(srcTab1);
  srcBar.appendChild(srcTab2);
  document.body.appendChild(srcBar);

  // Target bar (card "tgt") -- 2 tabs, x=[400..560], y=[0..28]
  const tgtBar = document.createElement("div");
  tgtBar.className = "tug-tab-bar";
  tgtBar.setAttribute("data-card-id", "tgt");
  tgtBar.getBoundingClientRect = () =>
    ({ left: 400, right: 560, top: 0, bottom: 28, width: 160, height: 28, x: 400, y: 0, toJSON: () => {} } as DOMRect);
  const tgtTab1 = makeMockTabElement(400, 80);
  const tgtTab2 = makeMockTabElement(480, 80);
  tgtBar.appendChild(tgtTab1);
  tgtBar.appendChild(tgtTab2);
  document.body.appendChild(tgtBar);

  // Single-tab card frame (card "single") -- x=[700..900], y=[0..200]
  const singleFrame = document.createElement("div");
  singleFrame.className = "card-frame";
  singleFrame.setAttribute("data-card-id", "single");
  singleFrame.getBoundingClientRect = () =>
    ({ left: 700, right: 900, top: 0, bottom: 200, width: 200, height: 200, x: 700, y: 0, toJSON: () => {} } as DOMRect);

  const singleAccessory = document.createElement("div");
  singleAccessory.className = "tugcard-accessory";
  singleAccessory.setAttribute("data-card-id", "single");
  singleFrame.appendChild(singleAccessory);
  document.body.appendChild(singleFrame);

  // The source tab element used in startDrag -- must be inside srcBar.
  const srcTabEl = srcTab1;

  return { srcTabEl, srcBar, tgtBar, singleFrame, singleAccessory };
}

describe("TabDragCoordinator – mode transitions (T16)", () => {
  it("T16: starts in reorder mode when pointer is inside the source bar", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const { srcTabEl } = setupDragScenario();

    // Start drag with pointer inside source bar (cx=40, cy=14).
    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, srcTabEl, "src", "tab-src-1", 2);

    // Initial mode should be reorder (pointer is inside source bar).
    expect(tabDragCoordinator._testOnly_getCurrentMode()).toBe("reorder");

    tabDragCoordinator.cleanup();
  });

  it("T16: transitions to detach mode when pointer moves outside all bars and frames", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const { srcTabEl } = setupDragScenario();

    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, srcTabEl, "src", "tab-src-1", 2);

    // Move pointer to cx=250, cy=14 -- outside source bar [0..160] and
    // outside target bar [400..560] and outside single frame [700..900].
    tabDragCoordinator._testOnly_applyDragFrame(250, 14);

    expect(tabDragCoordinator._testOnly_getCurrentMode()).toBe("detach");
    expect(tabDragCoordinator._testOnly_getCurrentMergeTarget()).toBeNull();

    tabDragCoordinator.cleanup();
  });

  it("T16: transitions to merge mode over a multi-tab target bar", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const { srcTabEl, tgtBar } = setupDragScenario();

    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, srcTabEl, "src", "tab-src-1", 2);

    // Move into target bar: cx=450, cy=14 (inside tgtBar x=[400..560]).
    tabDragCoordinator._testOnly_applyDragFrame(450, 14);

    expect(tabDragCoordinator._testOnly_getCurrentMode()).toBe("merge");
    const mergeTarget = tabDragCoordinator._testOnly_getCurrentMergeTarget();
    expect(mergeTarget).not.toBeNull();
    expect(mergeTarget!.cardId).toBe("tgt");

    // data-drop-target should be set on the target bar element.
    expect(tgtBar.getAttribute("data-drop-target")).toBe("true");

    tabDragCoordinator.cleanup();
  });

  it("T16: transitions to merge mode over a single-tab card frame", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const { srcTabEl, singleAccessory } = setupDragScenario();

    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, srcTabEl, "src", "tab-src-1", 2);

    // Move into single-tab card frame: cx=800, cy=100 (inside frame x=[700..900], y=[0..200]).
    tabDragCoordinator._testOnly_applyDragFrame(800, 100);

    expect(tabDragCoordinator._testOnly_getCurrentMode()).toBe("merge");
    const mergeTarget = tabDragCoordinator._testOnly_getCurrentMergeTarget();
    expect(mergeTarget).not.toBeNull();
    expect(mergeTarget!.cardId).toBe("single");

    // data-drop-target should be set on the accessory element (not the frame).
    expect(singleAccessory.getAttribute("data-drop-target")).toBe("true");

    tabDragCoordinator.cleanup();
  });

  it("T16: transitions back to reorder when pointer re-enters source bar after detach", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const { srcTabEl } = setupDragScenario();

    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, srcTabEl, "src", "tab-src-1", 2);

    // Move out to detach zone.
    tabDragCoordinator._testOnly_applyDragFrame(250, 14);
    expect(tabDragCoordinator._testOnly_getCurrentMode()).toBe("detach");

    // Move back inside source bar.
    tabDragCoordinator._testOnly_applyDragFrame(80, 14);
    expect(tabDragCoordinator._testOnly_getCurrentMode()).toBe("reorder");

    tabDragCoordinator.cleanup();
  });

  it("T16: drop-target attribute is cleared when pointer leaves a merge target", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const { srcTabEl, tgtBar } = setupDragScenario();

    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, srcTabEl, "src", "tab-src-1", 2);

    // Move into target bar.
    tabDragCoordinator._testOnly_applyDragFrame(450, 14);
    expect(tgtBar.getAttribute("data-drop-target")).toBe("true");

    // Move to detach zone -- drop-target should be cleared.
    tabDragCoordinator._testOnly_applyDragFrame(250, 14);
    expect(tgtBar.getAttribute("data-drop-target")).toBeNull();

    tabDragCoordinator.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Cleanup side-effect tests (formerly mislabeled T16)
// ---------------------------------------------------------------------------

describe("TabDragCoordinator – cleanup side effects", () => {
  it("cleanup removes data-dragging from source tab", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const tabEl = makeMockTabElement(0, 80);
    document.body.appendChild(tabEl);

    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, tabEl, "card-1", "tab-1", 2);
    expect(tabEl.getAttribute("data-dragging")).toBe("true");

    tabDragCoordinator.cleanup();
    expect(tabEl.getAttribute("data-dragging")).toBeNull();

    tabEl.remove();
  });

  it("cleanup removes the ghost element from the deck-container", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const tabEl = makeMockTabElement(0, 80);
    document.body.appendChild(tabEl);

    const container = document.getElementById("deck-container")!;

    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, tabEl, "card-1", "tab-1", 2);

    expect(container.querySelector(".tug-tab-ghost")).not.toBeNull();

    tabDragCoordinator.cleanup();

    expect(container.querySelector(".tug-tab-ghost")).toBeNull();

    tabEl.remove();
  });

  it("GHOST_TAB_ZINDEX constant equals 5000", () => {
    expect(GHOST_TAB_ZINDEX).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// pointercancel -- silent cancel without DeckManager commit
// ---------------------------------------------------------------------------

describe("TabDragCoordinator – pointercancel does not commit (Issue 1 fix)", () => {
  it("pointercancel cleans up visuals without calling any DeckManager method", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const { srcTabEl } = setupDragScenario();

    // Start drag with 2 tabs so drag initiates.
    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, srcTabEl, "src", "tab-src-1", 2);

    // Move into detach zone so mode = "detach".
    tabDragCoordinator._testOnly_applyDragFrame(250, 14);
    expect(tabDragCoordinator._testOnly_getCurrentMode()).toBe("detach");

    // Synthesize a pointercancel event on the tab element.
    const cancelEvent = new Event("pointercancel");
    srcTabEl.dispatchEvent(cancelEvent);

    // DeckManager must NOT have been called.
    expect(store._calls.detachTab.length).toBe(0);
    expect(store._calls.mergeTab.length).toBe(0);
    expect(store._calls.reorderTab.length).toBe(0);

    // Visual cleanup: data-dragging should be removed.
    expect(srcTabEl.getAttribute("data-dragging")).toBeNull();

    // Ghost should be gone.
    const container = document.getElementById("deck-container")!;
    expect(container.querySelector(".tug-tab-ghost")).toBeNull();
  });

  it("pointercancel during merge mode does not call mergeTab", () => {
    const store = makeMockStore();
    tabDragCoordinator.init(store);

    const { srcTabEl } = setupDragScenario();

    const fakeEvent = { pointerId: 1, clientX: 40, clientY: 14 } as PointerEvent;
    tabDragCoordinator.startDrag(fakeEvent, srcTabEl, "src", "tab-src-1", 2);

    // Move into target bar so mode = "merge".
    tabDragCoordinator._testOnly_applyDragFrame(450, 14);
    expect(tabDragCoordinator._testOnly_getCurrentMode()).toBe("merge");

    const cancelEvent = new Event("pointercancel");
    srcTabEl.dispatchEvent(cancelEvent);

    expect(store._calls.mergeTab.length).toBe(0);
    expect(srcTabEl.getAttribute("data-dragging")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// exceedsDragThreshold helper tests
// ---------------------------------------------------------------------------

describe("exceedsDragThreshold", () => {
  it("returns false for zero movement", () => {
    expect(exceedsDragThreshold(100, 100, 100, 100)).toBe(false);
  });

  it("returns false for sub-threshold movement (4px diagonal)", () => {
    // sqrt(4^2 + 2^2) = sqrt(20) ≈ 4.47, but let's use exactly 3px horizontal.
    expect(exceedsDragThreshold(100, 100, 103, 100)).toBe(false);
  });

  it("returns true for exactly 5px horizontal movement", () => {
    expect(exceedsDragThreshold(100, 100, 105, 100)).toBe(true);
  });

  it("returns true for diagonal movement exceeding threshold", () => {
    // sqrt(4^2 + 4^2) = sqrt(32) ≈ 5.66 > 5
    expect(exceedsDragThreshold(100, 100, 104, 104)).toBe(true);
  });

  it("returns true for negative direction movement", () => {
    expect(exceedsDragThreshold(100, 100, 95, 100)).toBe(true);
  });
});
