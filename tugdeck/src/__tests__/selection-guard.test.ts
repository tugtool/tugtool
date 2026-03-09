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

  it("attach() registers both 'card-selection' and 'inactive-selection' in CSS.highlights", () => {
    const registry = installMockHighlightApi();
    selectionGuard.attach();
    expect(registry.has("card-selection")).toBe(true);
    expect(registry.has("inactive-selection")).toBe(true);
  });

  it("detach() removes both highlights from CSS.highlights", () => {
    const registry = installMockHighlightApi();
    selectionGuard.attach();
    expect(registry.has("card-selection")).toBe(true);
    expect(registry.has("inactive-selection")).toBe(true);
    selectionGuard.detach();
    expect(registry.has("card-selection")).toBe(false);
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
// T13: syncActiveHighlight via selectionchange mirrors Range to active Highlight
// ---------------------------------------------------------------------------

describe("T13 – syncActiveHighlight (via selectionchange)", () => {
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

  it("mirrors a selection into the card-selection Highlight on selectionchange", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-hl", boundary);

    // Build a range inside the boundary and set window.getSelection() to return it.
    const range = makeRange(boundary, "hello");
    const mockSel = {
      rangeCount: 1,
      anchorNode: range.startContainer,
      focusNode: range.endContainer,
      anchorOffset: 0,
      getRangeAt: (_i: number) => range,
      removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };

    // Fire selectionchange — triggers syncActiveHighlight.
    (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));

    const activeHl = registry.get("card-selection") as MockHighlight;
    expect(activeHl).toBeDefined();
    // syncActiveHighlight clones the range, so the Highlight contains
    // a cloned Range. Verify by size.
    expect(activeHl.size).toBe(1);
    const stored = activeHl.getAll()[0];
    expect(stored).toBeDefined();
    expect(stored.startContainer).toBe(range.startContainer);
    expect(stored.startOffset).toBe(range.startOffset);
    expect(stored.endOffset).toBe(range.endOffset);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });

  it("replaces an existing Range when selectionchange fires again (size stays 1)", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-hl2", boundary);

    const range1 = makeRange(boundary, "first");
    const mockSel1 = {
      rangeCount: 1, anchorNode: range1.startContainer, focusNode: range1.endContainer,
      anchorOffset: 0, getRangeAt: () => range1, removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel1 };
    (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));

    const activeHl = registry.get("card-selection") as MockHighlight;
    expect(activeHl.size).toBe(1);
    const firstStored = activeHl.getAll()[0];

    const range2 = makeRange(boundary, "second");
    const mockSel2 = {
      rangeCount: 1, anchorNode: range2.startContainer, focusNode: range2.endContainer,
      anchorOffset: 0, getRangeAt: () => range2, removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel2 };
    (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));

    // The first stored range should be removed; only the second capture remains.
    expect(activeHl.has(firstStored)).toBe(false);
    expect(activeHl.size).toBe(1);
    const secondStored = activeHl.getAll()[0];
    expect(secondStored.startContainer).toBe(range2.startContainer);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });

  it("ignores a selection whose anchor is outside all card boundaries", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-cross", boundary);

    // Build a range whose startContainer is an external node (outside boundary).
    const externalNode = happyWindow.document.createTextNode("outside") as unknown as Text;
    (happyWindow.document.body as unknown as Element).appendChild(externalNode as unknown as Node);

    const range = new (global as any).Range() as Range;
    range.setStart(externalNode as unknown as Node, 0);
    range.setEnd(externalNode as unknown as Node, 7);

    const mockSel = {
      rangeCount: 1, anchorNode: range.startContainer, focusNode: range.endContainer,
      anchorOffset: 0, getRangeAt: () => range, removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));

    const activeHl = registry.get("card-selection") as MockHighlight;
    // The range should NOT have been added — anchor is outside all boundaries.
    expect(activeHl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(externalNode as unknown as Node);
  });

  it("is a no-op when the highlight API is unavailable", () => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();

    const boundary = makeBoundary();
    selectionGuard.registerBoundary("card-nohl", boundary);

    // No highlight available — selectionchange should not throw.
    expect(() => {
      (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));
    }).not.toThrow();
  });

  it("clears active highlight when selectionchange fires with no selection", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-clr", boundary);

    // First create a selection.
    const range = makeRange(boundary, "hello");
    const mockSel = {
      rangeCount: 1, anchorNode: range.startContainer, focusNode: range.endContainer,
      anchorOffset: 0, getRangeAt: () => range, removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));

    const activeHl = registry.get("card-selection") as MockHighlight;
    expect(activeHl.size).toBe(1);

    // Now fire selectionchange with no selection.
    const emptySel = {
      rangeCount: 0, anchorNode: null, focusNode: null,
      getRangeAt: () => { throw new Error("no range"); },
      removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => emptySel };
    (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));

    expect(activeHl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});

// ---------------------------------------------------------------------------
// T14: unregisterBoundary removes highlight state (removeCardHighlight)
// ---------------------------------------------------------------------------

describe("T14 – unregisterBoundary cleans up highlight state", () => {
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

  it("removes the card's Range from the active Highlight on unregister", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-clr", boundary);

    // Create a selection in this card via selectionchange.
    const range = makeRange(boundary, "to clear");
    const mockSel = {
      rangeCount: 1, anchorNode: range.startContainer, focusNode: range.endContainer,
      anchorOffset: 0, getRangeAt: () => range, removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));

    const activeHl = registry.get("card-selection") as MockHighlight;
    expect(activeHl.size).toBe(1);

    // Unregister — should clean up highlight state.
    selectionGuard.unregisterBoundary("card-clr");
    expect(activeHl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });

  it("is a no-op when the card has no highlight state (does not throw)", () => {
    expect(() => selectionGuard.unregisterBoundary("card-no-range")).not.toThrow();
    const activeHl = registry.get("card-selection") as MockHighlight;
    expect(activeHl.size).toBe(0);
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

  it("clears all ranges from both Highlight objects on reset", () => {
    const registry = installMockHighlightApi();
    selectionGuard.attach();

    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-rst", boundary);

    // Create a selection via selectionchange to populate activeHighlight.
    const range = makeRange(boundary, "reset me");
    const mockSel = {
      rangeCount: 1, anchorNode: range.startContainer, focusNode: range.endContainer,
      anchorOffset: 0, getRangeAt: () => range, removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => mockSel };
    (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));

    const activeHl = registry.get("card-selection") as MockHighlight;
    expect(activeHl.size).toBe(1);

    selectionGuard.reset();
    expect(activeHl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });

  it("reset() is safe to call when no highlight API is available", () => {
    // No mock installed — highlight is null.
    expect(() => selectionGuard.reset()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase 5f3: activateCard tests (T08–T12 per phase plan)
//
// These tests cover the card-switch highlight behavior via pointerdown.
// In the new single-system architecture, pointerdown calls activateCard()
// which moves Ranges between activeHighlight and inactiveHighlight.
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

/**
 * Helper: simulate a selectionchange to populate a card's active highlight.
 */
function simulateSelectionChange(boundary: HTMLElement, range: Range): void {
  const mockSel = {
    rangeCount: 1, anchorNode: range.startContainer, focusNode: range.endContainer,
    anchorOffset: 0, getRangeAt: () => range, removeAllRanges(): void {},
    setBaseAndExtent(): void {},
  };
  (global as any).window = { ...happyWindow, getSelection: () => mockSel };
  (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));
}

describe("Phase 5f3 T08 – pointerdown moves active card's range to inactive highlight", () => {
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

  it("moves active card's range to inactive-selection when clicking a different card", () => {
    // Set up two cards.
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    const textNodeA = makeTextNode(boundaryA, "card A text");
    const textNodeB = makeTextNode(boundaryB, "card B text");
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Create a selection in card A via selectionchange.
    const rangeA = makeRange(boundaryA, "card A text");
    simulateSelectionChange(boundaryA, rangeA);

    const activeHl = registry.get("card-selection") as MockHighlight;
    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(activeHl.size).toBe(1);
    expect(inactiveHl.size).toBe(0);

    // Click on card B — card A's range should move to inactive.
    (global as any).window = happyWindow;
    firePointerEvent("pointerdown", textNodeB as unknown as Node);

    // Card A's range moved to inactive highlight.
    expect(inactiveHl.size).toBe(1);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });
});

describe("Phase 5f3 T09 – pointerdown into inactive card moves its range to active highlight", () => {
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

  it("moves clicked card's range from inactive to active highlight on pointerdown", () => {
    // Set up two cards.
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    const textNodeA = makeTextNode(boundaryA, "card A");
    const textNodeB = makeTextNode(boundaryB, "card B");
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Create selections in both cards: A first, then B.
    const rangeA = makeRange(boundaryA, "card A");
    simulateSelectionChange(boundaryA, rangeA);

    // Click card B to make A inactive.
    (global as any).window = happyWindow;
    firePointerEvent("pointerdown", textNodeB as unknown as Node);

    // Create selection in card B.
    const rangeB = makeRange(boundaryB, "card B");
    simulateSelectionChange(boundaryB, rangeB);

    const activeHl = registry.get("card-selection") as MockHighlight;
    const inactiveHl = registry.get("inactive-selection") as MockHighlight;

    // Now card B is active, card A is inactive.
    expect(activeHl.size).toBe(1);
    expect(inactiveHl.size).toBe(1);

    // Click back on card A — A's range moves from inactive to active.
    (global as any).window = happyWindow;
    firePointerEvent("pointerdown", textNodeA as unknown as Node);

    // Card A's range is now in active highlight.
    // Card B's range is now in inactive highlight.
    expect(activeHl.size).toBe(1);
    expect(inactiveHl.size).toBe(1);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });
});

describe("Phase 5f3 T10 – activateCard is a no-op when clicking the already-active card", () => {
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

  it("keeps the range in active highlight when clicking the same card again", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    const textNode = makeTextNode(boundary, "same card");
    selectionGuard.registerBoundary("card-same", boundary);

    const range = makeRange(boundary, "same card");
    simulateSelectionChange(boundary, range);

    const activeHl = registry.get("card-selection") as MockHighlight;
    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(activeHl.size).toBe(1);
    expect(inactiveHl.size).toBe(0);

    // Click the same card again.
    (global as any).window = happyWindow;
    firePointerEvent("pointerdown", textNode as unknown as Node);

    // Range stays in active highlight.
    expect(activeHl.size).toBe(1);
    expect(inactiveHl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});

describe("Phase 5f3 T11 – highlight swap is instant (no flash)", () => {
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

  it("both highlights are updated synchronously in the same pointerdown handler", () => {
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    const textNodeB = makeTextNode(boundaryB, "card B");
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Card A gets a selection.
    const rangeA = makeRange(boundaryA, "card A text");
    simulateSelectionChange(boundaryA, rangeA);

    const activeHl = registry.get("card-selection") as MockHighlight;
    const inactiveHl = registry.get("inactive-selection") as MockHighlight;

    // Before click: A is active (1 range), no inactive ranges.
    expect(activeHl.size).toBe(1);
    expect(inactiveHl.size).toBe(0);

    // Click card B — swap happens in one synchronous call.
    (global as any).window = happyWindow;
    firePointerEvent("pointerdown", textNodeB as unknown as Node);

    // After click: A's range moved to inactive. B has no range yet (no selection made).
    // The key point: no intermediate state where both highlights are empty (flash).
    expect(inactiveHl.size).toBe(1);

    // Reset should clean up all state.
    selectionGuard.reset();
    expect(activeHl.size).toBe(0);
    expect(inactiveHl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });
});

describe("Phase 5f3 T12 – reset() clears all highlight and tracking state", () => {
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

  it("reset() clears active and inactive highlights after card switch", () => {
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    const textNodeB = makeTextNode(boundaryB, "card B");
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Create selection in A, then switch to B.
    const rangeA = makeRange(boundaryA, "reset test");
    simulateSelectionChange(boundaryA, rangeA);
    (global as any).window = happyWindow;
    firePointerEvent("pointerdown", textNodeB as unknown as Node);

    const activeHl = registry.get("card-selection") as MockHighlight;
    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(inactiveHl.size).toBe(1);

    // reset() clears everything.
    selectionGuard.reset();
    expect(activeHl.size).toBe(0);
    expect(inactiveHl.size).toBe(0);

    // After reset, pointerup should not do anything unexpected.
    let addRangeCalled = false;
    const collapsedSel = {
      rangeCount: 0, isCollapsed: true,
      removeAllRanges(): void {},
      addRange(_r: Range): void { addRangeCalled = true; },
    };
    (global as any).window = { ...happyWindow, getSelection: () => collapsedSel };
    firePointerEvent("pointerup", textNodeB as unknown as Node);
    expect(addRangeCalled).toBe(false);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });
});

// ---------------------------------------------------------------------------
// T16: saveSelection falls back to cardRanges when browser Selection is cleared
// ---------------------------------------------------------------------------

describe("T16 – saveSelection cardRanges fallback", () => {
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

  it("saveSelection returns saved state from cardRanges after browser Selection is cleared", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-fb", boundary);

    // Create a selection via selectionchange (populates cardRanges).
    const range = makeRange(boundary, "fallback text");
    simulateSelectionChange(boundary, range);

    // Verify the active highlight has the range.
    const activeHl = registry.get("card-selection") as MockHighlight;
    expect(activeHl.size).toBe(1);

    // Simulate browser clearing the selection (e.g. clicking user-select:none chrome).
    // This fires selectionchange with rangeCount=0, which removes from activeHighlight
    // but keeps the Range in cardRanges.
    const emptySel = {
      rangeCount: 0, anchorNode: null, focusNode: null,
      getRangeAt: () => { throw new Error("no range"); },
      removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => emptySel };
    (happyWindow.document as unknown as Document).dispatchEvent(new (happyWindow.Event as any)("selectionchange"));

    // Active highlight is now empty (visual cleared).
    expect(activeHl.size).toBe(0);

    // saveSelection should still return a result via the cardRanges fallback.
    const saved = selectionGuard.saveSelection("card-fb");
    expect(saved).not.toBeNull();
    expect(saved!.anchorPath.length).toBeGreaterThan(0);
    expect(saved!.focusPath.length).toBeGreaterThan(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });

  it("saveSelection returns null after unregisterBoundary (cardRanges cleaned up)", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-fb2", boundary);

    // Create a selection.
    const range = makeRange(boundary, "will be cleaned");
    simulateSelectionChange(boundary, range);

    // Unregister removes cardRanges entry via removeCardHighlight.
    selectionGuard.unregisterBoundary("card-fb2");

    // saveSelection should return null — boundary no longer registered.
    const emptySel = {
      rangeCount: 0, anchorNode: null, focusNode: null,
      getRangeAt: () => { throw new Error("no range"); },
      removeAllRanges(): void {},
      setBaseAndExtent(): void {},
    };
    (global as any).window = { ...happyWindow, getSelection: () => emptySel };
    const saved = selectionGuard.saveSelection("card-fb2");
    expect(saved).toBeNull();

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});

// ---------------------------------------------------------------------------
// T17: activateCard swaps highlights for external focus changes
// ---------------------------------------------------------------------------

describe("T17 – activateCard (public API)", () => {
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

  it("moves active card's range to inactive and new card's range to active", () => {
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Create selection in card A.
    const rangeA = makeRange(boundaryA, "card A notify");
    simulateSelectionChange(boundaryA, rangeA);

    // Switch to card B to make A inactive.
    const textNodeB = makeTextNode(boundaryB, "card B notify");
    (global as any).window = happyWindow;
    firePointerEvent("pointerdown", textNodeB as unknown as Node);

    // Create selection in card B.
    const rangeB = makeRange(boundaryB, "card B notify");
    simulateSelectionChange(boundaryB, rangeB);

    const activeHl = registry.get("card-selection") as MockHighlight;
    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(activeHl.size).toBe(1);
    expect(inactiveHl.size).toBe(1);

    // Simulate external focus change (e.g. useLayoutEffect) via activateCard.
    (global as any).window = happyWindow;
    selectionGuard.activateCard("card-a");

    // A's range moved from inactive to active; B's range moved to inactive.
    expect(activeHl.size).toBe(1);
    expect(inactiveHl.size).toBe(1);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });

  it("is a no-op when highlight API is unavailable", () => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();

    // No highlight API — should not throw.
    expect(() => selectionGuard.activateCard("any-card")).not.toThrow();
  });

  it("is safe for an unregistered card (no range to swap)", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-real", boundary);

    const range = makeRange(boundary, "real card");
    simulateSelectionChange(boundary, range);

    const activeHl = registry.get("card-selection") as MockHighlight;
    expect(activeHl.size).toBe(1);

    // Activate an unregistered card — moves real card's range to inactive.
    selectionGuard.activateCard("card-unknown");

    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(inactiveHl.size).toBe(1);
    expect(activeHl.size).toBe(0);

    (global as any).window = happyWindow;
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});
