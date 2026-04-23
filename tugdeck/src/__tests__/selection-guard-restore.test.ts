/**
 * `selectionGuard.restoreCardDomSelection` tests — Step 10.
 *
 * Pins the cold-boot DOM-selection restore path: given a saved
 * `DomSelectionSnapshot`, the guard resolves its paths against the
 * current `cardRoot`, constructs a `Range`, and publishes it via
 * {@link SelectionGuard.updateCardDomSelection}. Paint then buckets
 * the Range via Step 5's `updatePaint` rules.
 *
 * Coverage:
 *   - Happy path: Range materialises in `cardRanges` and round-trips
 *     offsets / endpoints.
 *   - For the non-focused card, the Range paints in the
 *     `inactive-selection` custom highlight (Step 5 paint rule).
 *   - For the focused card, the Range is NOT in the inactive highlight;
 *     the native selection reflects it instead.
 *   - Stale paths (shape diverged from save time) → silent no-op.
 *   - Null / undefined snapshot → silent no-op.
 *   - Out-of-range offsets → silent no-op.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";

import { selectionGuard } from "@/components/tugways/selection-guard";
import { registerDeckStore } from "@/lib/deck-store-registry";
import type { IDeckManagerStore } from "@/deck-manager-store";
import type { DeckState, DomSelectionSnapshot, TugPaneState } from "@/layout-tree";

// ---------------------------------------------------------------------------
// happy-dom setup (mirrors selection-guard-paint.test.ts)
// ---------------------------------------------------------------------------

const happyWindow = new Window({ url: "http://localhost/" });
(global as any).document = happyWindow.document;
(global as any).window = happyWindow;
(global as any).HTMLElement = happyWindow.HTMLElement;
(global as any).Element = happyWindow.Element;
(global as any).Node = happyWindow.Node;
(global as any).Range = happyWindow.Range;

// ---------------------------------------------------------------------------
// Mock CSS Highlight API (copied from selection-guard-paint.test.ts)
// ---------------------------------------------------------------------------

class MockHighlight {
  private ranges: Set<Range> = new Set();
  add(range: Range): this { this.ranges.add(range); return this; }
  delete(range: Range): boolean { return this.ranges.delete(range); }
  clear(): void { this.ranges.clear(); }
  has(range: Range): boolean { return this.ranges.has(range); }
  get size(): number { return this.ranges.size; }
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

// ---------------------------------------------------------------------------
// Minimal deck-store stub
// ---------------------------------------------------------------------------

interface MockDeckStore extends IDeckManagerStore {
  setState(next: DeckState): void;
}

function makeMockDeckStore(initial: DeckState): MockDeckStore {
  let state = initial;
  const subscribers = new Set<() => void>();
  const stub = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "subscribe") {
        return (cb: () => void) => {
          subscribers.add(cb);
          return () => subscribers.delete(cb);
        };
      }
      if (prop === "getSnapshot") return () => state;
      if (prop === "setState") {
        return (next: DeckState) => {
          state = next;
          for (const cb of subscribers) cb();
        };
      }
      return () => {};
    },
  });
  return stub as unknown as MockDeckStore;
}

function makeMockAppLifecycle() {
  return {
    observeApplicationDidResignActive(_cb: () => void): () => void { return () => {}; },
    observeApplicationDidBecomeActive(_cb: () => void): () => void { return () => {}; },
  };
}

function makePane(id: string, cards: string[], activeCardId = cards[0]): TugPaneState {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    cardIds: cards,
    activeCardId,
    title: "",
    acceptsFamilies: ["standard"],
  };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function makeCardRootInDom(cardId: string): HTMLElement {
  const el = happyWindow.document.createElement("div") as unknown as HTMLElement;
  el.setAttribute("data-card-host", "");
  el.setAttribute("data-card-id", cardId);
  (happyWindow.document.body as unknown as Element).appendChild(el as unknown as Node);
  return el;
}

function appendText(parent: HTMLElement, text: string): Text {
  const tn = happyWindow.document.createTextNode(text) as unknown as Text;
  (parent as unknown as Element).appendChild(tn as unknown as Node);
  return tn;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let registry: MockHighlightRegistry;
let store: MockDeckStore;

beforeEach(() => {
  registry = installMockHighlightApi();
  store = makeMockDeckStore({
    cards: [
      { id: "card-a", componentId: "probe", title: "", closable: true },
      { id: "card-b", componentId: "probe", title: "", closable: true },
    ],
    panes: [makePane("pane-1", ["card-a", "card-b"], "card-a")],
    activePaneId: "pane-1",
    hasFocus: true,
  });
  registerDeckStore(store);
  selectionGuard.attach(makeMockAppLifecycle());
});

afterEach(() => {
  selectionGuard.detach();
  selectionGuard.reset();
  registerDeckStore(null);
  removeMockHighlightApi();
  (happyWindow.document.body as unknown as Element).innerHTML = "";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("selectionGuard.restoreCardDomSelection – happy path", () => {
  it("populates cardRanges from a well-formed snapshot; Range reflects saved endpoints", () => {
    const cardRoot = makeCardRootInDom("card-a");
    // Shape: <div> <span>lorem</span> <span>ipsum</span> </div>
    const spanA = happyWindow.document.createElement("span");
    const spanB = happyWindow.document.createElement("span");
    (cardRoot as unknown as Element).appendChild(spanA as unknown as Node);
    (cardRoot as unknown as Element).appendChild(spanB as unknown as Node);
    appendText(spanA as unknown as HTMLElement, "lorem");
    appendText(spanB as unknown as HTMLElement, "ipsum");

    const snapshot: DomSelectionSnapshot = {
      anchorPath: [0, 0], // spanA → text
      anchorOffset: 2,
      focusPath: [1, 0], // spanB → text
      focusOffset: 3,
    };

    selectionGuard.restoreCardDomSelection("card-a", snapshot, cardRoot);

    const range = selectionGuard.getCardRange("card-a");
    expect(range).not.toBeUndefined();
    if (!range) return;
    expect(range.startOffset).toBe(2);
    expect(range.endOffset).toBe(3);
    // Endpoints resolve to the text nodes under the spans.
    expect(range.startContainer.nodeType).toBe(3 /* TEXT_NODE */);
    expect(range.endContainer.nodeType).toBe(3);
    expect((range.startContainer as Text).textContent).toBe("lorem");
    expect((range.endContainer as Text).textContent).toBe("ipsum");
  });

  it("non-focused card's restored Range paints in inactive-selection (Step 5 paint rule)", () => {
    // card-b is NOT the focused card (store says card-a is active).
    const cardRootB = makeCardRootInDom("card-b");
    appendText(cardRootB, "hello");

    // Register the boundary so the guard knows about card-b; without it
    // the guard can still publish a Range, but tests that exercise the
    // full flow should mirror production wiring.
    selectionGuard.registerBoundary("card-b", cardRootB);

    selectionGuard.restoreCardDomSelection(
      "card-b",
      { anchorPath: [0], anchorOffset: 0, focusPath: [0], focusOffset: 5 },
      cardRootB,
    );

    const range = selectionGuard.getCardRange("card-b");
    expect(range).not.toBeUndefined();
    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.has(range as Range)).toBe(true);
  });

  it("focused card's restored Range is NOT in the inactive highlight (native ::selection carries it)", () => {
    const cardRootA = makeCardRootInDom("card-a");
    appendText(cardRootA, "active");
    selectionGuard.registerBoundary("card-a", cardRootA);

    selectionGuard.restoreCardDomSelection(
      "card-a",
      { anchorPath: [0], anchorOffset: 0, focusPath: [0], focusOffset: 6 },
      cardRootA,
    );

    const range = selectionGuard.getCardRange("card-a");
    expect(range).not.toBeUndefined();
    const hl = registry.get("inactive-selection") as MockHighlight;
    // card-a is the focused card → its Range does not paint in inactive.
    expect(hl.has(range as Range)).toBe(false);
  });
});

describe("selectionGuard.restoreCardDomSelection – defensive no-ops", () => {
  it("null snapshot is a no-op (does not clear an existing Range)", () => {
    const cardRoot = makeCardRootInDom("card-a");
    const text = appendText(cardRoot, "preexisting");

    // Seed the guard with a Range via the normal publish API.
    const existing = new (global as any).Range() as Range;
    existing.setStart(text as unknown as Node, 0);
    existing.setEnd(text as unknown as Node, 5);
    selectionGuard.updateCardDomSelection("card-a", existing);

    selectionGuard.restoreCardDomSelection("card-a", null, cardRoot);
    expect(selectionGuard.getCardRange("card-a")).toBe(existing);
  });

  it("undefined snapshot is a no-op", () => {
    const cardRoot = makeCardRootInDom("card-a");
    appendText(cardRoot, "anything");

    selectionGuard.restoreCardDomSelection("card-a", undefined, cardRoot);
    expect(selectionGuard.getCardRange("card-a")).toBeUndefined();
  });

  it("stale anchor path (shape diverged from save) is a silent no-op", () => {
    const cardRoot = makeCardRootInDom("card-a");
    // No children at all under the root.
    const snapshot: DomSelectionSnapshot = {
      anchorPath: [0, 0, 5],
      anchorOffset: 0,
      focusPath: [0],
      focusOffset: 0,
    };
    expect(() => selectionGuard.restoreCardDomSelection("card-a", snapshot, cardRoot)).not.toThrow();
    expect(selectionGuard.getCardRange("card-a")).toBeUndefined();
  });

  it("out-of-range offset is a silent no-op (anchor offset past text length)", () => {
    const cardRoot = makeCardRootInDom("card-a");
    appendText(cardRoot, "abc");
    // Asking for offset 99 on a 3-char text → setStart throws IndexSizeError.
    const snapshot: DomSelectionSnapshot = {
      anchorPath: [0],
      anchorOffset: 99,
      focusPath: [0],
      focusOffset: 99,
    };
    expect(() => selectionGuard.restoreCardDomSelection("card-a", snapshot, cardRoot)).not.toThrow();
    expect(selectionGuard.getCardRange("card-a")).toBeUndefined();
  });
});
