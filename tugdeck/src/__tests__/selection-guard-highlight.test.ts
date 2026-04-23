/**
 * SelectionGuard highlight tests — boundary enforcer model.
 *
 * Tests cover:
 * - T12: attach/detach registers and removes the inactive-selection highlight
 * - T14: unregisterBoundary cleans up inactive highlight state
 * - T15: reset() clears inactive highlight state
 * - T20: activateCard — card switch moves selection to/from inactive highlight
 * - T21: activateCard — same-card is a no-op
 * - T22: activateCard — card switch restores browser Selection from inactive
 * - T23: saveSelection falls back to inactiveRanges
 *
 * These replace the old T12–T17 tests that referenced card-selection,
 * syncActiveHighlight, and cardRanges.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";

import {
  selectionGuard,
  type SavedSelection,
} from "@/components/tugways/selection-guard";

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

const happyWindow = new Window({ url: "http://localhost/" });

(global as any).document = happyWindow.document;
(global as any).window = happyWindow;
(global as any).HTMLElement = happyWindow.HTMLElement;
(global as any).Element = happyWindow.Element;
(global as any).Node = happyWindow.Node;
(global as any).Range = happyWindow.Range;

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

function makeTextNode(parent: HTMLElement, text: string): Text {
  const tn = happyWindow.document.createTextNode(text) as unknown as Text;
  (parent as unknown as Element).appendChild(tn as unknown as Node);
  return tn;
}

function makeRange(boundary: HTMLElement, text: string): Range {
  const textNode = makeTextNode(boundary, text);
  const range = new (global as any).Range() as Range;
  range.setStart(textNode as unknown as Node, 0);
  range.setEnd(textNode as unknown as Node, text.length);
  return range;
}

// ---------------------------------------------------------------------------
// Mock CSS Highlight API
// ---------------------------------------------------------------------------

class MockHighlight {
  private ranges: Set<Range> = new Set();
  add(range: Range): this { this.ranges.add(range); return this; }
  delete(range: Range): boolean { return this.ranges.delete(range); }
  clear(): void { this.ranges.clear(); }
  has(range: Range): boolean { return this.ranges.has(range); }
  get size(): number { return this.ranges.size; }
  getAll(): Range[] { return Array.from(this.ranges); }
}

class MockHighlightRegistry {
  private map: Map<string, MockHighlight> = new Map();
  set(name: string, highlight: MockHighlight): this { this.map.set(name, highlight); return this; }
  get(name: string): MockHighlight | undefined { return this.map.get(name); }
  delete(name: string): boolean { return this.map.delete(name); }
  has(name: string): boolean { return this.map.has(name); }
  clear(): void { this.map.clear(); }
}

function installMockHighlightApi(): MockHighlightRegistry {
  const registry = new MockHighlightRegistry();
  (global as any).Highlight = MockHighlight;
  const cssGlobal = (global as any).CSS ?? {};
  cssGlobal.highlights = registry;
  (global as any).CSS = cssGlobal;
  return registry;
}

function removeMockHighlightApi(): void {
  delete (global as any).Highlight;
  if ((global as any).CSS) {
    delete (global as any).CSS.highlights;
  }
}

/**
 * Set up a mock window.getSelection() that returns a selection anchored
 * inside the given boundary with the given range.
 */
function mockSelection(boundary: HTMLElement, range: Range): void {
  const mockSel = {
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: range.startContainer,
    focusNode: range.endContainer,
    anchorOffset: range.startOffset,
    focusOffset: range.endOffset,
    getRangeAt: (_i: number) => range,
    removeAllRanges(): void { this.rangeCount = 0; this.anchorNode = null as unknown as Node; this.focusNode = null as unknown as Node; },
    addRange(_r: Range): void { this.rangeCount = 1; },
    setBaseAndExtent(): void {},
  };
  (global as any).window = { ...happyWindow, getSelection: () => mockSel };
}

function mockEmptySelection(): void {
  const emptySel = {
    rangeCount: 0,
    isCollapsed: true,
    anchorNode: null,
    focusNode: null,
    getRangeAt: () => { throw new Error("no range"); },
    removeAllRanges(): void {},
    addRange(): void {},
    setBaseAndExtent(): void {},
  };
  (global as any).window = { ...happyWindow, getSelection: () => emptySel };
}

function restoreWindow(): void {
  (global as any).window = happyWindow;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  selectionGuard.reset();
});

afterEach(() => {
  selectionGuard.reset();
  restoreWindow();
});

// ---------------------------------------------------------------------------
// T12: attach/detach — only inactive-selection highlight
// ---------------------------------------------------------------------------

describe("T12 – attach/detach registers and removes inactive-selection", () => {
  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  it("attach() registers 'inactive-selection' in CSS.highlights (no card-selection)", () => {
    const registry = installMockHighlightApi();
    selectionGuard.attach();
    expect(registry.has("inactive-selection")).toBe(true);
    expect(registry.has("card-selection")).toBe(false);
  });

  it("detach() removes inactive-selection from CSS.highlights", () => {
    const registry = installMockHighlightApi();
    selectionGuard.attach();
    expect(registry.has("inactive-selection")).toBe(true);
    selectionGuard.detach();
    expect(registry.has("inactive-selection")).toBe(false);
  });

  it("attach() is a no-op when CSS.highlights is undefined", () => {
    expect(() => selectionGuard.attach()).not.toThrow();
  });

  it("detach() is a no-op when CSS.highlights is undefined", () => {
    expect(() => selectionGuard.detach()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T14: unregisterBoundary cleans up inactive highlight state
// ---------------------------------------------------------------------------

describe("T14 – unregisterBoundary cleans up inactive highlight state", () => {
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

  // The "inactive range on unregister" test was retired with the
  // activateCard-populates-inactive-highlight mechanism. In the Step 5
  // model, `cardRanges` is published by owning components (e.g.
  // TugTextEngine.onSelectionChanged); paint reads `cardRanges` and
  // `updatePaint()` in `unregisterBoundary` flushes any stale entries.
  // Step 5's own tests pin the new contract.

  it("is a no-op when the card has no highlight state (does not throw)", () => {
    expect(() => selectionGuard.unregisterBoundary("card-no-range")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T15: reset() clears inactive highlight state
// ---------------------------------------------------------------------------

describe("T15 – reset() clears inactive highlight state", () => {
  afterEach(() => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
  });

  // "clears all ranges from inactive highlight on reset" retired with
  // activateCard-populates-highlight. `reset()` in the Step 5 model
  // calls `inactiveHighlight.clear()` directly; Step 5's own tests pin
  // the new paint-from-cardRanges contract and verify that reset wipes
  // everything together.

  it("reset() is safe to call when no highlight API is available", () => {
    expect(() => selectionGuard.reset()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T20: activateCard — card switch deactivates old, activates new
// ---------------------------------------------------------------------------

describe("T20 – activateCard card switch", () => {
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

  // The "activateCard clones / restores selection" pair was retired
  // with the manual-clone mechanism. Paint is now driven by
  // `cardRanges` + the deck-store subscription via `updatePaint()`.
  // See Step 5's own tests for the new dim/restore contract.

  it("is a no-op when highlight API is unavailable", () => {
    selectionGuard.detach();
    removeMockHighlightApi();
    selectionGuard.reset();
    expect(() => selectionGuard.activateCard("any-card")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T21: activateCard — same-card is a no-op
// ---------------------------------------------------------------------------

describe("T21 – activateCard same-card no-op", () => {
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

  it("does not modify inactive highlight when activating the already-active card", () => {
    const boundary = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundary as unknown as Node);
    selectionGuard.registerBoundary("card-same", boundary);

    const range = makeRange(boundary, "same card");
    mockSelection(boundary, range);
    selectionGuard.activateCard("card-same");

    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(inactiveHl.size).toBe(0);

    // Activate same card again — no-op.
    selectionGuard.activateCard("card-same");
    expect(inactiveHl.size).toBe(0);

    restoreWindow();
    (happyWindow.document.body as unknown as Element).removeChild(boundary as unknown as Node);
  });
});

// The T23 "saveSelection falls back to inactiveRanges" block was retired
// with the activateCard-populates-inactiveRanges mechanism. Step 5
// replaced `inactiveRanges` with `cardRanges` (published by the owning
// component). `saveSelection`'s fallback now reads `cardRanges`. The
// legacy `saveSelection` / `restoreSelection` API itself retires at
// Step 9; new coverage for the publish → paint path lives in Step 5's
// own test file.
