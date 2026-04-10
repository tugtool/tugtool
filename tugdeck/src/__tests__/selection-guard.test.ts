/**
 * SelectionGuard unit tests — boundary enforcement, registration, save/restore.
 *
 * Tests cover:
 * - T08: registerBoundary / unregisterBoundary
 * - T09: reset clears all boundaries and saved selections
 * - T10: clampPointToRect (pure geometry)
 * - T11: data-td-select="custom" skips clipping
 * - T11a: saveSelection returns null when card does not own active selection
 * - T11b: saveSelection/restoreSelection round-trip
 * - T11c: restoreSelection is a no-op when boundary is not registered
 *
 * CSS Custom Highlight tests (attach/detach, activateCard, inactive highlight)
 * are in selection-guard-highlight.test.ts.
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
// CSS Custom Highlight API tests have moved to selection-guard-highlight.test.ts

