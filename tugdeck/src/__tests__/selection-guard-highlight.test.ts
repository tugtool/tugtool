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

  it("removes the card's inactive Range on unregister", () => {
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Make card A active with a selection, then switch to card B
    // so card A's selection goes to inactive. Keep mock active for deactivation.
    const rangeA = makeRange(boundaryA, "will be cleaned");
    mockSelection(boundaryA, rangeA);
    selectionGuard.activateCard("card-a");
    selectionGuard.activateCard("card-b");
    restoreWindow();

    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(inactiveHl.size).toBe(1);

    // Unregister card A — its inactive range should be removed.
    selectionGuard.unregisterBoundary("card-a");
    expect(inactiveHl.size).toBe(0);

    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });

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

  it("clears all ranges from inactive highlight on reset", () => {
    const registry = installMockHighlightApi();
    selectionGuard.attach();

    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Create selection in A, switch to B so A goes to inactive.
    // Keep mock active for deactivation.
    const rangeA = makeRange(boundaryA, "reset me");
    mockSelection(boundaryA, rangeA);
    selectionGuard.activateCard("card-a");
    selectionGuard.activateCard("card-b");
    restoreWindow();

    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(inactiveHl.size).toBe(1);

    selectionGuard.reset();
    expect(inactiveHl.size).toBe(0);

    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });

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

  it("deactivating a card clones its selection into inactive-selection", () => {
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Activate card A with a selection.
    const rangeA = makeRange(boundaryA, "card A text");
    mockSelection(boundaryA, rangeA);
    selectionGuard.activateCard("card-a");

    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(inactiveHl.size).toBe(0);

    // Switch to card B — card A's selection goes to inactive.
    // Keep the mock selection active so activateCard can read it
    // when deactivating card A.
    selectionGuard.activateCard("card-b");
    expect(inactiveHl.size).toBe(1);

    restoreWindow();
    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });

  it("activating a card with a saved inactive range restores it and removes from inactive", () => {
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Card A gets a selection, then we switch to B (keep mock active for deactivation).
    const rangeA = makeRange(boundaryA, "card A restore");
    mockSelection(boundaryA, rangeA);
    selectionGuard.activateCard("card-a");
    selectionGuard.activateCard("card-b");

    const inactiveHl = registry.get("inactive-selection") as MockHighlight;
    expect(inactiveHl.size).toBe(1);

    // Switch back to A — its range should be removed from inactive.
    restoreWindow();
    selectionGuard.activateCard("card-a");
    expect(inactiveHl.size).toBe(0);

    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });

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

// ---------------------------------------------------------------------------
// T23: saveSelection falls back to inactiveRanges
// ---------------------------------------------------------------------------

describe("T23 – saveSelection inactiveRanges fallback", () => {
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

  it("saveSelection returns saved state from inactiveRanges when browser Selection is empty", () => {
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Card A gets a selection, then we switch to B (A goes inactive).
    // Keep mock active for deactivation.
    const rangeA = makeRange(boundaryA, "fallback text");
    mockSelection(boundaryA, rangeA);
    selectionGuard.activateCard("card-a");
    selectionGuard.activateCard("card-b");

    // Now card A has no browser Selection but has an inactiveRange.
    mockEmptySelection();
    const saved = selectionGuard.saveSelection("card-a");
    expect(saved).not.toBeNull();
    expect(saved!.anchorPath.length).toBeGreaterThan(0);
    expect(saved!.focusPath.length).toBeGreaterThan(0);

    restoreWindow();
    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });

  it("saveSelection returns null after unregisterBoundary (inactiveRanges cleaned up)", () => {
    const boundaryA = makeBoundary();
    const boundaryB = makeBoundary();
    (happyWindow.document.body as unknown as Element).appendChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).appendChild(boundaryB as unknown as Node);
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Card A gets a selection, switch to B, then unregister A.
    // Keep mock active for deactivation.
    const rangeA = makeRange(boundaryA, "will be cleaned");
    mockSelection(boundaryA, rangeA);
    selectionGuard.activateCard("card-a");
    selectionGuard.activateCard("card-b");
    restoreWindow();
    selectionGuard.unregisterBoundary("card-a");

    mockEmptySelection();
    const saved = selectionGuard.saveSelection("card-a");
    expect(saved).toBeNull();

    restoreWindow();
    (happyWindow.document.body as unknown as Element).removeChild(boundaryA as unknown as Node);
    (happyWindow.document.body as unknown as Element).removeChild(boundaryB as unknown as Node);
  });
});
