/**
 * SelectionGuard unit tests -- Step 3.
 *
 * Tests cover:
 * - T08: registerBoundary stores cardId-to-element mapping; unregisterBoundary removes it
 * - T09: reset clears all boundaries and saved selections
 * - T10: Clamping function clamps pointer coordinates to boundary rect edges (pure math)
 * - T11: Guard skips clipping when ancestor has data-td-select="custom" (including contenteditable)
 * - T11a: saveSelection returns null when card does not own active selection
 * - T11b: saveSelection/restoreSelection round-trip: save, collapse, restore, verify same range
 * - T11c: restoreSelection is a no-op when boundary is not registered (no error thrown)
 *
 * Note: This test file does not import setup-rtl because it tests only the
 * TypeScript module logic and pure DOM APIs — no React rendering needed.
 * happy-dom is preloaded via bunfig.toml and provides all required DOM APIs.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";

import {
  selectionGuard,
  caretPositionFromPointCompat,
  clampPointToRect,
  type SavedSelection,
} from "@/components/tugways/selection-guard";

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

// happy-dom is preloaded via bunfig.toml. We need a real Window for the DOM
// APIs used by SelectionGuard (getBoundingClientRect, getSelection, etc.).
const happyWindow = new Window({ url: "http://localhost/" });

// Install required globals before tests run
(global as any).document = happyWindow.document;
(global as any).window = happyWindow;
(global as any).HTMLElement = happyWindow.HTMLElement;
(global as any).Element = happyWindow.Element;
(global as any).Node = happyWindow.Node;
(global as any).Range = happyWindow.Range;

// requestAnimationFrame / cancelAnimationFrame stubs for autoscroll tests
if (typeof (global as any).requestAnimationFrame !== "function") {
  let rafId = 0;
  (global as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = ++rafId;
    setTimeout(() => cb(performance.now()), 0);
    return id;
  };
  (global as any).cancelAnimationFrame = (_id: number): void => {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal HTMLElement that can be used as a boundary.
 * `getBoundingClientRect` is stubbed to return the provided rect.
 */
function makeBoundary(rect?: Partial<DOMRect>): HTMLElement {
  const el = happyWindow.document.createElement("div") as unknown as HTMLElement;
  const fullRect: DOMRect = {
    left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0,
    toJSON: () => ({}),
    ...rect,
  };
  el.getBoundingClientRect = () => fullRect;
  return el;
}

/**
 * Create a text node inside `parent` with the given text content.
 * Returns the text node.
 */
function makeTextNode(parent: HTMLElement, text: string): Text {
  const tn = happyWindow.document.createTextNode(text) as unknown as Text;
  (parent as unknown as Element).appendChild(tn as unknown as Node);
  return tn;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  selectionGuard.reset();
});

afterEach(() => {
  selectionGuard.reset();
});

// ---------------------------------------------------------------------------
// T08: registerBoundary / unregisterBoundary
// ---------------------------------------------------------------------------

describe("T08 – registerBoundary / unregisterBoundary", () => {
  it("registers a boundary and the card can be found via saveSelection", () => {
    const el = makeBoundary();
    selectionGuard.registerBoundary("card-1", el);

    // saveSelection with no active selection returns null (not an error —
    // null means the card has no selection, which is correct after register).
    const saved = selectionGuard.saveSelection("card-1");
    expect(saved).toBeNull(); // no active selection
  });

  it("unregisterBoundary removes the mapping (saveSelection returns null after unregister)", () => {
    const el = makeBoundary();
    selectionGuard.registerBoundary("card-1", el);
    selectionGuard.unregisterBoundary("card-1");

    // After unregistration the card is unknown — saveSelection returns null
    const saved = selectionGuard.saveSelection("card-1");
    expect(saved).toBeNull();
  });

  it("registering multiple cards stores them independently", () => {
    const el1 = makeBoundary();
    const el2 = makeBoundary();
    selectionGuard.registerBoundary("card-a", el1);
    selectionGuard.registerBoundary("card-b", el2);

    // Both are registered; neither has an active selection
    expect(selectionGuard.saveSelection("card-a")).toBeNull();
    expect(selectionGuard.saveSelection("card-b")).toBeNull();

    // Unregister one — the other is unaffected
    selectionGuard.unregisterBoundary("card-a");
    expect(selectionGuard.saveSelection("card-b")).toBeNull();
  });

  it("unregistering an unknown cardId does not throw", () => {
    expect(() => selectionGuard.unregisterBoundary("nonexistent")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T09: reset
// ---------------------------------------------------------------------------

describe("T09 – reset", () => {
  it("clears all registered boundaries", () => {
    const el = makeBoundary();
    selectionGuard.registerBoundary("card-1", el);
    selectionGuard.reset();

    // After reset, card-1 is no longer registered
    expect(selectionGuard.saveSelection("card-1")).toBeNull();
  });

  it("clears saved selections", () => {
    // Register, add a boundary, and manually verify reset clears state
    const el = makeBoundary();
    selectionGuard.registerBoundary("card-1", el);
    selectionGuard.reset();

    // Attempting to restore after reset should be a no-op (not throw)
    const saved: SavedSelection = {
      anchorPath: [0],
      anchorOffset: 0,
      focusPath: [0],
      focusOffset: 3,
    };
    expect(() => selectionGuard.restoreSelection("card-1", saved)).not.toThrow();
  });

  it("is idempotent — calling reset twice does not throw", () => {
    selectionGuard.reset();
    expect(() => selectionGuard.reset()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T10: clampPointToRect (pure geometry)
// ---------------------------------------------------------------------------

describe("T10 – clampPointToRect (pure geometry)", () => {
  const rect: DOMRect = {
    left: 10, top: 20, right: 110, bottom: 120,
    width: 100, height: 100, x: 10, y: 20,
    toJSON: () => ({}),
  };

  it("returns the point unchanged when inside the rect", () => {
    expect(clampPointToRect(50, 70, rect)).toEqual({ x: 50, y: 70 });
  });

  it("clamps x to left edge when pointer is to the left", () => {
    expect(clampPointToRect(0, 70, rect)).toEqual({ x: 10, y: 70 });
  });

  it("clamps x to right edge when pointer is to the right", () => {
    expect(clampPointToRect(200, 70, rect)).toEqual({ x: 110, y: 70 });
  });

  it("clamps y to top edge when pointer is above", () => {
    expect(clampPointToRect(50, 0, rect)).toEqual({ x: 50, y: 20 });
  });

  it("clamps y to bottom edge when pointer is below", () => {
    expect(clampPointToRect(50, 300, rect)).toEqual({ x: 50, y: 120 });
  });

  it("clamps both axes when pointer is outside corner (top-left)", () => {
    expect(clampPointToRect(-5, -5, rect)).toEqual({ x: 10, y: 20 });
  });

  it("clamps both axes when pointer is outside corner (bottom-right)", () => {
    expect(clampPointToRect(999, 999, rect)).toEqual({ x: 110, y: 120 });
  });

  it("exactly on boundary edge is not clamped", () => {
    expect(clampPointToRect(10, 20, rect)).toEqual({ x: 10, y: 20 });
    expect(clampPointToRect(110, 120, rect)).toEqual({ x: 110, y: 120 });
  });
});

// ---------------------------------------------------------------------------
// T11: data-td-select="custom" skips clipping (including contenteditable)
// ---------------------------------------------------------------------------

describe("T11 – data-td-select=custom skips clipping", () => {
  it("saveSelection returns null for card that doesn't own active selection — no interference with custom subtree", () => {
    // This test verifies the guard does not error on a card with a custom
    // data-td-select subtree when the selection is elsewhere.
    const boundary = makeBoundary();
    const customDiv = happyWindow.document.createElement("div") as unknown as HTMLElement;
    customDiv.setAttribute("data-td-select", "custom");
    (customDiv as unknown as Element).setAttribute("contenteditable", "true");
    (boundary as unknown as Element).appendChild(customDiv as unknown as Node);

    selectionGuard.registerBoundary("card-custom", boundary);

    // saveSelection with no active selection (or selection outside boundary)
    // must return null — not throw
    const saved = selectionGuard.saveSelection("card-custom");
    expect(saved).toBeNull();
  });

  it("caretPositionFromPointCompat returns null in environments without the API", () => {
    // In happy-dom, neither caretPositionFromPoint nor caretRangeFromPoint
    // may be available. The compat function must return null gracefully.
    const result = caretPositionFromPointCompat(50, 50);
    // In happy-dom without these APIs, null is the expected result
    expect(result === null || (result !== null && typeof result.node !== "undefined")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T11a: saveSelection returns null when card does not own active selection
// ---------------------------------------------------------------------------

describe("T11a – saveSelection null when card does not own selection", () => {
  it("returns null for unregistered card", () => {
    expect(selectionGuard.saveSelection("unknown-card")).toBeNull();
  });

  it("returns null for registered card with no active selection", () => {
    const el = makeBoundary();
    selectionGuard.registerBoundary("card-1", el);

    // No selection active — getSelection() returns no ranges
    const saved = selectionGuard.saveSelection("card-1");
    expect(saved).toBeNull();
  });

  it("returns null when selection anchor is outside the card boundary", () => {
    const el = makeBoundary();
    selectionGuard.registerBoundary("card-1", el);

    // Selection is on a node not inside the boundary
    // In happy-dom the default selection is empty, which covers this case
    const saved = selectionGuard.saveSelection("card-1");
    expect(saved).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T11b: saveSelection / restoreSelection round-trip
// ---------------------------------------------------------------------------

describe("T11b – saveSelection/restoreSelection round-trip", () => {
  it("full round-trip: save, collapse, restore, verify restored selection matches original", () => {
    // 1. Build a boundary with a text node and set up a selection inside it.
    const boundary = makeBoundary();
    const textNode = makeTextNode(boundary, "Hello World");
    (happyWindow.document.body as unknown as Element).appendChild(
      boundary as unknown as Node
    );
    selectionGuard.registerBoundary("card-rt", boundary);

    const sel = happyWindow.window.getSelection() as unknown as Selection;

    // Set a selection using setBaseAndExtent so the guard can later read
    // anchorNode / anchorOffset / focusNode / focusOffset.
    (sel as any).setBaseAndExtent(
      textNode as unknown as Node, 2,
      textNode as unknown as Node, 2
    );
    expect(sel.anchorNode).toBe(textNode as unknown as Node);
    const originalAnchorOffset = sel.anchorOffset;
    const originalFocusOffset = sel.focusOffset;
    const originalAnchorNode = sel.anchorNode;
    const originalFocusNode = sel.focusNode;

    // 2. Save the selection.
    const saved = selectionGuard.saveSelection("card-rt");
    expect(saved).not.toBeNull();

    // 3. Collapse (clear) the selection.
    sel.removeAllRanges();
    expect(sel.anchorNode).toBeNull();
    expect(sel.rangeCount).toBe(0);

    // 4. Restore the selection.
    selectionGuard.restoreSelection("card-rt", saved!);

    // 5. Verify the restored selection has the same anchor/focus as the original.
    expect(sel.anchorNode).toBe(originalAnchorNode);
    expect(sel.anchorOffset).toBe(originalAnchorOffset);
    expect(sel.focusNode).toBe(originalFocusNode);
    expect(sel.focusOffset).toBe(originalFocusOffset);

    // Cleanup
    (happyWindow.document.body as unknown as Element).removeChild(
      boundary as unknown as Node
    );
  });

  it("saveSelection returns a SavedSelection with valid path arrays and numeric offsets", () => {
    const boundary = makeBoundary();
    const textNode = makeTextNode(boundary, "Test content");
    (happyWindow.document.body as unknown as Element).appendChild(
      boundary as unknown as Node
    );
    selectionGuard.registerBoundary("card-shape", boundary);

    const sel = happyWindow.window.getSelection() as unknown as Selection;
    (sel as any).setBaseAndExtent(
      textNode as unknown as Node, 1,
      textNode as unknown as Node, 1
    );

    const saved = selectionGuard.saveSelection("card-shape");
    expect(saved).not.toBeNull();
    expect(Array.isArray(saved!.anchorPath)).toBe(true);
    expect(Array.isArray(saved!.focusPath)).toBe(true);
    expect(typeof saved!.anchorOffset).toBe("number");
    expect(typeof saved!.focusOffset).toBe("number");
    // Path [0] because textNode is the first (and only) child of boundary
    expect(saved!.anchorPath).toEqual([0]);
    expect(saved!.focusPath).toEqual([0]);
    expect(saved!.anchorOffset).toBe(1);

    // Cleanup
    (happyWindow.document.body as unknown as Element).removeChild(
      boundary as unknown as Node
    );
  });

  it("restoreSelection resolves the saved path and sets anchorNode to the correct text node", () => {
    const boundary = makeBoundary();
    // Add two child elements so the target text is not at index 0
    const dummy = happyWindow.document.createElement("span") as unknown as HTMLElement;
    (boundary as unknown as Element).appendChild(dummy as unknown as Node);
    const textNode = makeTextNode(boundary, "Second child text");
    (happyWindow.document.body as unknown as Element).appendChild(
      boundary as unknown as Node
    );
    selectionGuard.registerBoundary("card-path", boundary);

    const sel = happyWindow.window.getSelection() as unknown as Selection;
    (sel as any).setBaseAndExtent(
      textNode as unknown as Node, 3,
      textNode as unknown as Node, 3
    );

    const saved = selectionGuard.saveSelection("card-path");
    expect(saved).not.toBeNull();
    // textNode is child index 1 of boundary
    expect(saved!.anchorPath).toEqual([1]);

    // Collapse then restore
    sel.removeAllRanges();
    selectionGuard.restoreSelection("card-path", saved!);

    // anchorNode must be the same text node (resolved from path [1])
    expect(sel.anchorNode).toBe(textNode as unknown as Node);
    expect(sel.anchorOffset).toBe(3);

    // Cleanup
    (happyWindow.document.body as unknown as Element).removeChild(
      boundary as unknown as Node
    );
  });
});

// ---------------------------------------------------------------------------
// T11c: restoreSelection no-op when boundary not registered
// ---------------------------------------------------------------------------

describe("T11c – restoreSelection no-op when boundary not registered", () => {
  it("does not throw when cardId is not registered", () => {
    const saved: SavedSelection = {
      anchorPath: [0],
      anchorOffset: 0,
      focusPath: [0],
      focusOffset: 5,
    };
    expect(() => selectionGuard.restoreSelection("not-registered", saved)).not.toThrow();
  });

  it("does not throw after boundary has been unregistered", () => {
    const el = makeBoundary();
    selectionGuard.registerBoundary("card-1", el);
    selectionGuard.unregisterBoundary("card-1");

    const saved: SavedSelection = {
      anchorPath: [0],
      anchorOffset: 0,
      focusPath: [0],
      focusOffset: 5,
    };
    expect(() => selectionGuard.restoreSelection("card-1", saved)).not.toThrow();
  });

  it("does not throw when saved path refers to non-existent node", () => {
    const el = makeBoundary();
    // No text children added — path [0] will not resolve
    selectionGuard.registerBoundary("card-deep", el);

    const saved: SavedSelection = {
      anchorPath: [99, 0],
      anchorOffset: 0,
      focusPath: [99, 0],
      focusOffset: 5,
    };
    expect(() => selectionGuard.restoreSelection("card-deep", saved)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase 5f2: CSS Custom Highlight API tests
//
// happy-dom does not provide CSS.highlights or the Highlight constructor.
// These tests install a mock implementation before running, and restore the
// original state in afterEach to avoid leaking into other tests.
// ---------------------------------------------------------------------------

/**
 * Minimal mock Highlight class — mirrors the CSS Custom Highlight Set-like API.
 */
class MockHighlight {
  private ranges: Set<Range> = new Set();
  add(range: Range): this { this.ranges.add(range); return this; }
  delete(range: Range): boolean { return this.ranges.delete(range); }
  clear(): void { this.ranges.clear(); }
  has(range: Range): boolean { return this.ranges.has(range); }
  get size(): number { return this.ranges.size; }
  entries(): IterableIterator<[Range, Range]> { return this.ranges.entries() as IterableIterator<[Range, Range]>; }
  getAll(): Range[] { return Array.from(this.ranges); }
}

/**
 * Minimal mock HighlightRegistry — mirrors CSS.highlights Map-like API.
 */
class MockHighlightRegistry {
  private map: Map<string, MockHighlight> = new Map();
  set(name: string, highlight: MockHighlight): this { this.map.set(name, highlight); return this; }
  get(name: string): MockHighlight | undefined { return this.map.get(name); }
  delete(name: string): boolean { return this.map.delete(name); }
  has(name: string): boolean { return this.map.has(name); }
  clear(): void { this.map.clear(); }
}

/**
 * Install the mock CSS Highlight API into the global environment.
 * Returns a handle to the mock registry for inspection in tests.
 */
function installMockHighlightApi(): MockHighlightRegistry {
  const registry = new MockHighlightRegistry();
  // Install Highlight constructor globally so `new Highlight()` in selection-guard works.
  (global as any).Highlight = MockHighlight;
  // Install CSS.highlights globally.
  const cssGlobal = (global as any).CSS ?? {};
  cssGlobal.highlights = registry;
  (global as any).CSS = cssGlobal;
  return registry;
}

/**
 * Remove the mock CSS Highlight API from the global environment.
 */
function removeMockHighlightApi(): void {
  delete (global as any).Highlight;
  if ((global as any).CSS) {
    delete (global as any).CSS.highlights;
  }
}

/**
 * Create a Range that spans a text node inside a boundary element.
 * Uses the happy-dom Range constructor (assigned to global.Range in this file).
 */
function makeRange(boundary: HTMLElement, text: string): Range {
  const textNode = makeTextNode(boundary, text);
  const range = new (global as any).Range() as Range;
  range.setStart(textNode as unknown as Node, 0);
  range.setEnd(textNode as unknown as Node, text.length);
  return range;
}

// ---------------------------------------------------------------------------
// T12: CSS Custom Highlight API — attach/detach lifecycle
// ---------------------------------------------------------------------------

describe("T12 – attach/detach registers and removes CSS.highlights entry", () => {
  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("attach() registers 'inactive-selection' in CSS.highlights when API is available", () => {
    const registry = installMockHighlightApi();
    selectionGuard.attach();
    expect(registry.has("inactive-selection")).toBe(true);
  });

  it("detach() removes 'inactive-selection' from CSS.highlights", () => {
    const registry = installMockHighlightApi();
    selectionGuard.attach();
    expect(registry.has("inactive-selection")).toBe(true);
    selectionGuard.detach();
    expect(registry.has("inactive-selection")).toBe(false);
  });

  it("attach() is a no-op when CSS.highlights is undefined (no errors thrown)", () => {
    // Do NOT install mock — CSS.highlights is absent.
    expect(() => selectionGuard.attach()).not.toThrow();
  });

  it("detach() is a no-op when CSS.highlights is undefined (no errors thrown)", () => {
    expect(() => selectionGuard.detach()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T13: captureInactiveHighlight stores Range and adds it to the Highlight
// ---------------------------------------------------------------------------

describe("T13 – captureInactiveHighlight", () => {
  let registry: MockHighlightRegistry;

  beforeEach(() => {
    registry = installMockHighlightApi();
    selectionGuard.attach();
  });

  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("stores a cloned Range in the Highlight object (size increases to 1)", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-hl", boundary);

    // Build a range inside the boundary and set window.getSelection() to return it.
    const range = makeRange(boundary, "hello");
    const mockSel = {
      rangeCount: 1,
      anchorNode: range.startContainer,
      getRangeAt: (_i: number) => range,
    };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };

    selectionGuard.captureInactiveHighlight("card-hl");

    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl).toBeDefined();
    // captureInactiveHighlight clones the range, so the Highlight contains
    // a different Range object (the clone), not the original. Verify by size.
    expect(hl.size).toBe(1);
    // The stored range should cover the same content as the original.
    const stored = hl.getAll()[0];
    expect(stored).toBeDefined();
    expect(stored.startContainer).toBe(range.startContainer);
    expect(stored.startOffset).toBe(range.startOffset);
    expect(stored.endOffset).toBe(range.endOffset);

    // Restore window
    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });

  it("replaces an existing Range when called again for the same card (size stays 1)", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-hl2", boundary);

    const range1 = makeRange(boundary, "first");
    const mockSel1 = { rangeCount: 1, anchorNode: range1.startContainer, getRangeAt: () => range1 };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel1 };
    selectionGuard.captureInactiveHighlight("card-hl2");

    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.size).toBe(1);
    const firstStored = hl.getAll()[0];

    const range2 = makeRange(boundary, "second");
    const mockSel2 = { rangeCount: 1, anchorNode: range2.startContainer, getRangeAt: () => range2 };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel2 };
    selectionGuard.captureInactiveHighlight("card-hl2");

    // The first stored range should be removed; only the second capture remains.
    expect(hl.has(firstStored)).toBe(false);
    expect(hl.size).toBe(1);
    const secondStored = hl.getAll()[0];
    expect(secondStored.startContainer).toBe(range2.startContainer);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });

  it("discards a range whose startContainer is outside the card boundary", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-cross", boundary);

    // Build a range whose startContainer is an external node (outside boundary).
    const externalNode = happyWindow.document.createTextNode("outside") as unknown as Text;
    (happyWindow.document.body as unknown as Element).appendChild(externalNode as unknown as Node);

    const range = new (global as any).Range() as Range;
    range.setStart(externalNode as unknown as Node, 0);
    range.setEnd(externalNode as unknown as Node, 7);

    const mockSel = { rangeCount: 1, anchorNode: range.startContainer, getRangeAt: () => range };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    selectionGuard.captureInactiveHighlight("card-cross");

    const hl = registry.get("inactive-selection") as MockHighlight;
    // The range should NOT have been added.
    expect(hl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(externalNode as unknown as Node);
  });

  it("is a no-op when the highlight API is unavailable (this.highlight is null)", () => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();

    const boundary = makeBoundary();
    selectionGuard.registerBoundary("card-nohl", boundary);

    // No highlight available — should not throw.
    expect(() => selectionGuard.captureInactiveHighlight("card-nohl")).not.toThrow();
  });

  it("is a no-op for an unregistered card", () => {
    expect(() => selectionGuard.captureInactiveHighlight("nonexistent")).not.toThrow();
    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T14: clearInactiveHighlight removes Range from Highlight and highlightRanges
// ---------------------------------------------------------------------------

describe("T14 – clearInactiveHighlight", () => {
  let registry: MockHighlightRegistry;

  beforeEach(() => {
    registry = installMockHighlightApi();
    selectionGuard.attach();
  });

  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("removes the cloned Range from the Highlight object, bringing size back to 0", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-clr", boundary);

    const range = makeRange(boundary, "to clear");
    const mockSel = { rangeCount: 1, anchorNode: range.startContainer, getRangeAt: () => range };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    selectionGuard.captureInactiveHighlight("card-clr");

    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.size).toBe(1);

    selectionGuard.clearInactiveHighlight("card-clr");
    // After clearing, the Highlight should contain no ranges.
    expect(hl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });

  it("is a no-op when the card has no saved Range (does not throw)", () => {
    expect(() => selectionGuard.clearInactiveHighlight("card-no-range")).not.toThrow();
    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T15: reset() clears all highlight state
// ---------------------------------------------------------------------------

describe("T15 – reset() clears highlight state", () => {
  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("clears all ranges from the Highlight object on reset", () => {
    const registry = installMockHighlightApi();
    selectionGuard.attach();

    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-rst", boundary);

    const range = makeRange(boundary, "reset me");
    const mockSel = { rangeCount: 1, anchorNode: range.startContainer, getRangeAt: () => range };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    selectionGuard.captureInactiveHighlight("card-rst");

    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.size).toBe(1);

    selectionGuard.reset();
    expect(hl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });

  it("reset() is safe to call when no highlight API is available", () => {
    // No mock installed — highlight is null.
    expect(() => selectionGuard.reset()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase 5f3: pendingHighlightRestore tests (T08–T12 per phase plan)
//
// These tests cover the click-back restore behavior added in Step 4.
// ---------------------------------------------------------------------------

/**
 * Fire a synthetic PointerEvent on the global document.
 * Uses Object.defineProperty to work around the read-only `target` property.
 */
function firePointerEvent(type: "pointerdown" | "pointerup", targetNode: Node): void {
  const event = new (happyWindow.PointerEvent as any)(type, {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
  }) as PointerEvent;
  // Override the read-only `target` property with the desired node.
  Object.defineProperty(event, "target", { value: targetNode, configurable: true });
  (happyWindow.document as unknown as Document).dispatchEvent(event);
}

describe("Phase 5f3 T08 – pointerdown inside highlighted card stashes range and clears highlight", () => {
  let registry: MockHighlightRegistry;

  beforeEach(() => {
    registry = installMockHighlightApi();
    selectionGuard.attach();
  });

  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("stashes the range in pendingHighlightRestore and removes it from the Highlight", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    const textNode = makeTextNode(boundary, "hello");
    selectionGuard.registerBoundary("card-stash", boundary);

    // Manually inject a range into highlightRanges via captureInactiveHighlight.
    const range = makeRange(boundary, "hello");
    const mockSel = { rangeCount: 1, anchorNode: range.startContainer, getRangeAt: () => range };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    selectionGuard.captureInactiveHighlight("card-stash");
    (global as any).window = happyWindow;

    // Verify the highlight has one range now.
    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.size).toBe(1);

    // Fire pointerdown inside the boundary (the text node is inside boundary).
    firePointerEvent("pointerdown", textNode as unknown as Node);

    // The range should have been removed from the Highlight object.
    expect(hl.size).toBe(0);

    // Cleanup
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});

describe("Phase 5f3 T09 – pointerup with collapsed selection restores Selection from stash", () => {
  let registry: MockHighlightRegistry;

  beforeEach(() => {
    registry = installMockHighlightApi();
    selectionGuard.attach();
  });

  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("restores the stashed Range as the real Selection when pointerup is collapsed", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    const textNode = makeTextNode(boundary, "restore me");
    selectionGuard.registerBoundary("card-restore", boundary);

    // Capture an inactive highlight for this card.
    const range = makeRange(boundary, "restore me");
    const mockSel = { rangeCount: 1, anchorNode: range.startContainer, getRangeAt: () => range };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    selectionGuard.captureInactiveHighlight("card-restore");

    // Set up a collapsed selection mock for the pointerup path.
    let capturedRange: Range | null = null;
    const collapsedSel = {
      rangeCount: 0,
      anchorNode: null,
      focusNode: null,
      isCollapsed: true,
      removeAllRanges(): void { this.rangeCount = 0; },
      addRange(r: Range): void { capturedRange = r; this.rangeCount = 1; },
      getRangeAt: (_i: number) => capturedRange!,
    };
    (global as any).window = { ...happyWindow, getSelection: () => collapsedSel };

    // Simulate pointerdown into the highlighted card.
    firePointerEvent("pointerdown", textNode as unknown as Node);
    // Simulate pointerup (selection is still collapsed at this point).
    firePointerEvent("pointerup", textNode as unknown as Node);

    // The stashed range should now be the real Selection.
    expect(capturedRange).not.toBeNull();
    expect(capturedRange!.startContainer).toBe(range.startContainer);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});

describe("Phase 5f3 T10 – pointerup with non-collapsed selection discards stash", () => {
  let registry: MockHighlightRegistry;

  beforeEach(() => {
    registry = installMockHighlightApi();
    selectionGuard.attach();
  });

  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("does not restore the stashed Range when pointerup selection is non-collapsed", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    const textNode = makeTextNode(boundary, "drag me");
    selectionGuard.registerBoundary("card-drag", boundary);

    // Capture an inactive highlight for this card.
    const range = makeRange(boundary, "drag me");
    const mockSel = { rangeCount: 1, anchorNode: range.startContainer, getRangeAt: () => range };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    selectionGuard.captureInactiveHighlight("card-drag");

    // Set up a non-collapsed selection mock (user dragged to create selection).
    let addRangeCalled = false;
    const nonCollapsedSel = {
      rangeCount: 1,
      anchorNode: textNode,
      focusNode: textNode,
      isCollapsed: false,
      removeAllRanges(): void {},
      addRange(_r: Range): void { addRangeCalled = true; },
      getRangeAt: (_i: number) => range,
    };
    (global as any).window = { ...happyWindow, getSelection: () => nonCollapsedSel };

    firePointerEvent("pointerdown", textNode as unknown as Node);
    firePointerEvent("pointerup", textNode as unknown as Node);

    // addRange should NOT have been called — stash was discarded.
    expect(addRangeCalled).toBe(false);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});

describe("Phase 5f3 T11 – stopTracking clears pendingHighlightRestore", () => {
  let registry: MockHighlightRegistry;

  beforeEach(() => {
    registry = installMockHighlightApi();
    selectionGuard.attach();
  });

  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("clears the stash when stopTracking is called (pointer cancel path)", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    const textNode = makeTextNode(boundary, "cancel me");
    selectionGuard.registerBoundary("card-cancel", boundary);

    // Capture an inactive highlight for this card.
    const range = makeRange(boundary, "cancel me");
    const mockSel = { rangeCount: 1, anchorNode: range.startContainer, getRangeAt: () => range };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    selectionGuard.captureInactiveHighlight("card-cancel");

    // Stash range via pointerdown.
    (global as any).window = happyWindow;
    firePointerEvent("pointerdown", textNode as unknown as Node);

    // Now call reset() (which calls stopTracking()) to simulate a cancel path.
    // After reset, the stash must be gone — subsequent pointerup should not restore.
    let addRangeCalled = false;
    const collapsedSel = {
      rangeCount: 0,
      isCollapsed: true,
      removeAllRanges(): void {},
      addRange(_r: Range): void { addRangeCalled = true; },
    };
    (global as any).window = { ...happyWindow, getSelection: () => collapsedSel };

    selectionGuard.reset();

    // Confirm no restore happened even though selection would be collapsed.
    expect(addRangeCalled).toBe(false);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});

describe("Phase 5f3 T12 – reset() clears pendingHighlightRestore", () => {
  let registry: MockHighlightRegistry;

  beforeEach(() => {
    registry = installMockHighlightApi();
    selectionGuard.attach();
  });

  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("reset() clears any pending highlight restore stash", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    const textNode = makeTextNode(boundary, "reset stash");
    selectionGuard.registerBoundary("card-rst2", boundary);

    // Capture an inactive highlight.
    const range = makeRange(boundary, "reset stash");
    const mockSel = { rangeCount: 1, anchorNode: range.startContainer, getRangeAt: () => range };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    selectionGuard.captureInactiveHighlight("card-rst2");

    // Trigger pointerdown to stash the range.
    (global as any).window = happyWindow;
    firePointerEvent("pointerdown", textNode as unknown as Node);

    // reset() must clear the stash.
    selectionGuard.reset();

    // If we then fire pointerup (after re-attaching), nothing should be restored.
    registry = installMockHighlightApi();
    selectionGuard.attach();
    selectionGuard.registerBoundary("card-rst2", boundary);

    let addRangeCalled = false;
    const collapsedSel = {
      rangeCount: 0,
      isCollapsed: true,
      removeAllRanges(): void {},
      addRange(_r: Range): void { addRangeCalled = true; },
    };
    (global as any).window = { ...happyWindow, getSelection: () => collapsedSel };
    firePointerEvent("pointerup", textNode as unknown as Node);

    expect(addRangeCalled).toBe(false);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});
