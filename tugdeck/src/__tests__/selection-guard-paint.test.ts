/**
 * SelectionGuard multi-card paint tests — Step 5.
 *
 * Pins the contract of the `updatePaint` rebuild: every non-focused card's
 * published `Range` paints in the `inactive-selection` CSS Custom
 * Highlight; the focused card's `Range` is mirrored into native
 * `window.getSelection()`; stale `Range`s (endpoints detached from
 * the document) are dropped from `cardRanges` with a dev-warn; and
 * the short-circuit hint skips highlight rebuild when only the
 * focused card's entry changed.
 *
 * Coverage:
 *   - T24: two cards publish Ranges; flipping the focused card moves
 *     which Range paints natively vs. in the inactive highlight.
 *   - T25: `applicationDidResignActive` paints every Range in inactive;
 *     `applicationDidBecomeActive` returns the focused Range to native.
 *   - T26: `updateCardDomSelection(cardId, null)` removes the entry
 *     from paint.
 *   - T27: Stale Range (anchor DOM detached without a re-publish) is
 *     dropped from `cardRanges` and logged with a dev-warn.
 *   - T28: Perf short-circuit — `updatePaint({ changedCardId })` where
 *     `changedCardId` is the focused card skips `inactiveHighlight.clear()`.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Window } from "happy-dom";

import { selectionGuard } from "@/components/tugways/selection-guard";
import { registerDeckStore } from "@/lib/deck-store-registry";
import type { IDeckManagerStore } from "@/deck-manager-store";
import type { DeckState, TugPaneState } from "@/layout-tree";

// ---------------------------------------------------------------------------
// Test environment setup (mirrors selection-guard-highlight.test.ts)
// ---------------------------------------------------------------------------

const happyWindow = new Window({ url: "http://localhost/" });

(global as any).document = happyWindow.document;
(global as any).window = happyWindow;
(global as any).HTMLElement = happyWindow.HTMLElement;
(global as any).Element = happyWindow.Element;
(global as any).Node = happyWindow.Node;
(global as any).Range = happyWindow.Range;

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
// Mock deck store — exposes only the methods `selectionGuard` reads.
// ---------------------------------------------------------------------------

interface MockDeckStore extends IDeckManagerStore {
  /** Test helper: overwrite the snapshot and notify subscribers. */
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
      // Every other method is a no-op stub. selection-guard never calls them.
      return () => {};
    },
  });
  return stub as unknown as MockDeckStore;
}

// ---------------------------------------------------------------------------
// Mock app-lifecycle that records observer callbacks so tests can fire
// them directly.
// ---------------------------------------------------------------------------

function makeMockAppLifecycle() {
  const resign: Array<() => void> = [];
  const become: Array<() => void> = [];
  return {
    observeApplicationDidResignActive(cb: () => void): () => void {
      resign.push(cb);
      return () => { const i = resign.indexOf(cb); if (i >= 0) resign.splice(i, 1); };
    },
    observeApplicationDidBecomeActive(cb: () => void): () => void {
      become.push(cb);
      return () => { const i = become.indexOf(cb); if (i >= 0) become.splice(i, 1); };
    },
    fireResign(): void { for (const cb of resign) cb(); },
    fireBecome(): void { for (const cb of become) cb(); },
  };
}

// ---------------------------------------------------------------------------
// Helpers to build boundary elements and ranges that live in the document.
// ---------------------------------------------------------------------------

function makeBoundaryInDom(): HTMLElement {
  const el = happyWindow.document.createElement("div") as unknown as HTMLElement;
  (happyWindow.document.body as unknown as Element).appendChild(el as unknown as Node);
  return el;
}

function makeRangeInBoundary(boundary: HTMLElement, text: string): Range {
  const textNode = happyWindow.document.createTextNode(text) as unknown as Text;
  (boundary as unknown as Element).appendChild(textNode as unknown as Node);
  const range = new (global as any).Range() as Range;
  range.setStart(textNode as unknown as Node, 0);
  range.setEnd(textNode as unknown as Node, text.length);
  return range;
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
// Setup / teardown
// ---------------------------------------------------------------------------

let registry: MockHighlightRegistry;
let store: MockDeckStore;
let appLifecycle: ReturnType<typeof makeMockAppLifecycle>;

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
  appLifecycle = makeMockAppLifecycle();
  selectionGuard.attach(appLifecycle);
});

afterEach(() => {
  selectionGuard.detach();
  selectionGuard.reset();
  registerDeckStore(null);
  removeMockHighlightApi();
  // Clean up any DOM nodes we appended during the test.
  (happyWindow.document.body as unknown as Element).innerHTML = "";
});

// ---------------------------------------------------------------------------
// T24: multi-card paint — focused vs. non-focused
// ---------------------------------------------------------------------------

describe("T24 – multi-card paint", () => {
  it("non-focused card's Range paints in inactive-selection; focused card's Range does not", () => {
    const boundaryA = makeBoundaryInDom();
    const boundaryB = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    const rangeA = makeRangeInBoundary(boundaryA, "aaa");
    const rangeB = makeRangeInBoundary(boundaryB, "bbb");

    // card-a is the focused card per the store's activePaneId.
    selectionGuard.updateCardDomSelection("card-a", rangeA);
    selectionGuard.updateCardDomSelection("card-b", rangeB);

    const hl = registry.get("inactive-selection") as MockHighlight;
    // card-a is focused → its Range is NOT in inactive; card-b IS.
    expect(hl.has(rangeA)).toBe(false);
    expect(hl.has(rangeB)).toBe(true);
    expect(hl.size).toBe(1);
  });

  it("flipping activeCardId in the store moves which Range paints natively", () => {
    const boundaryA = makeBoundaryInDom();
    const boundaryB = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    const rangeA = makeRangeInBoundary(boundaryA, "aaa");
    const rangeB = makeRangeInBoundary(boundaryB, "bbb");
    selectionGuard.updateCardDomSelection("card-a", rangeA);
    selectionGuard.updateCardDomSelection("card-b", rangeB);

    const hl = registry.get("inactive-selection") as MockHighlight;
    // card-a focused.
    expect(hl.has(rangeA)).toBe(false);
    expect(hl.has(rangeB)).toBe(true);

    // Flip the store's active card → card-b. The subscription calls
    // updatePaint(), which rebuilds with card-b as focused.
    store.setState({
      cards: store.getSnapshot().cards,
      panes: [makePane("pane-1", ["card-a", "card-b"], "card-b")],
      activePaneId: "pane-1",
      hasFocus: true,
    });

    expect(hl.has(rangeA)).toBe(true);
    expect(hl.has(rangeB)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T25: app resign / become-active transitions
// ---------------------------------------------------------------------------

describe("T25 – app resign / become-active", () => {
  it("applicationDidResignActive paints every Range in inactive (including focused card)", () => {
    const boundaryA = makeBoundaryInDom();
    const boundaryB = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    const rangeA = makeRangeInBoundary(boundaryA, "aaa");
    const rangeB = makeRangeInBoundary(boundaryB, "bbb");
    selectionGuard.updateCardDomSelection("card-a", rangeA);
    selectionGuard.updateCardDomSelection("card-b", rangeB);

    const hl = registry.get("inactive-selection") as MockHighlight;
    // Pre-resign: card-a focused, so only card-b is in inactive.
    expect(hl.size).toBe(1);

    appLifecycle.fireResign();

    // Post-resign: both Ranges paint in inactive — the focused card
    // too, matching browser window-blur dim.
    expect(hl.has(rangeA)).toBe(true);
    expect(hl.has(rangeB)).toBe(true);
    expect(hl.size).toBe(2);
  });

  it("applicationDidBecomeActive returns focused Range to native; others remain in inactive", () => {
    const boundaryA = makeBoundaryInDom();
    const boundaryB = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    const rangeA = makeRangeInBoundary(boundaryA, "aaa");
    const rangeB = makeRangeInBoundary(boundaryB, "bbb");
    selectionGuard.updateCardDomSelection("card-a", rangeA);
    selectionGuard.updateCardDomSelection("card-b", rangeB);

    const hl = registry.get("inactive-selection") as MockHighlight;

    appLifecycle.fireResign();
    expect(hl.size).toBe(2);

    appLifecycle.fireBecome();
    // card-a focused → its Range is back out of inactive; card-b stays in.
    expect(hl.has(rangeA)).toBe(false);
    expect(hl.has(rangeB)).toBe(true);
    expect(hl.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T26: updateCardDomSelection(cardId, null) removes from paint
// ---------------------------------------------------------------------------

describe("T26 – updateCardDomSelection clear removes from paint", () => {
  it("publishing null for a non-focused card drops its Range from inactive", () => {
    const boundaryA = makeBoundaryInDom();
    const boundaryB = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    const rangeA = makeRangeInBoundary(boundaryA, "aaa");
    const rangeB = makeRangeInBoundary(boundaryB, "bbb");
    selectionGuard.updateCardDomSelection("card-a", rangeA);
    selectionGuard.updateCardDomSelection("card-b", rangeB);

    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.has(rangeB)).toBe(true);

    selectionGuard.updateCardDomSelection("card-b", null);
    expect(hl.has(rangeB)).toBe(false);
    expect(hl.size).toBe(0);
    expect(selectionGuard.getCardRange("card-b")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T27: stale Range drop + dev-warn
// ---------------------------------------------------------------------------

describe("T27 – stale Range drop", () => {
  it("drops a Range whose anchor DOM has been detached and logs a dev-warn", () => {
    const boundaryA = makeBoundaryInDom();
    const boundaryB = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Publish a Range for card-b (non-focused, so it paints in inactive).
    const rangeB = makeRangeInBoundary(boundaryB, "bbb");
    selectionGuard.updateCardDomSelection("card-b", rangeB);

    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.has(rangeB)).toBe(true);

    // Simulate the owning component mutating its subtree WITHOUT a
    // re-publish: detach the boundary from the document entirely so
    // `document.contains(range.startContainer)` becomes false.
    (happyWindow.document.body as unknown as Element).removeChild(
      boundaryB as unknown as Node,
    );

    // Sanity check: happy-dom must report the text node as no longer
    // inside the document. If this assertion fails, the stale-drop
    // path depends on behavior the test environment doesn't provide,
    // and the test needs a different way to simulate detachment.
    expect(document.contains(rangeB.startContainer)).toBe(false);

    // Capture console.warn calls via an explicit override. spyOn on
    // the already-silenced `console.warn` (see `setup-silence.ts`) did
    // not reliably track calls in this suite's worker, so we install
    // a recording function directly and restore in `finally`.
    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    try {
      // Trigger an unrelated paint (a store-change) so updatePaint runs.
      store.setState({
        cards: store.getSnapshot().cards,
        panes: [makePane("pane-1", ["card-a", "card-b"], "card-a")],
        activePaneId: "pane-1",
        hasFocus: true,
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(selectionGuard.getCardRange("card-b")).toBeUndefined();
    expect(hl.has(rangeB)).toBe(false);
    expect(warns.length).toBeGreaterThan(0);
    const msg = String((warns[0] as unknown[])[0]);
    expect(msg).toContain("card-b");
    expect(msg).toContain("stale range");
  });
});

// ---------------------------------------------------------------------------
// T28: perf short-circuit for the focused-card hint
// ---------------------------------------------------------------------------

describe("T28 – perf short-circuit", () => {
  it("updateCardDomSelection for the focused card does not rebuild the inactive highlight", () => {
    const boundaryA = makeBoundaryInDom();
    const boundaryB = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Seed: card-b (non-focused) has a Range in the inactive highlight.
    const rangeB = makeRangeInBoundary(boundaryB, "bbb");
    selectionGuard.updateCardDomSelection("card-b", rangeB);

    const hl = registry.get("inactive-selection") as MockHighlight;
    expect(hl.has(rangeB)).toBe(true);

    // Short-circuit scenario: card-a is focused. Publishing a Range
    // for it must NOT call `inactiveHighlight.clear()`, because the
    // focused card never paints there in the first place.
    const clearSpy = spyOn(hl, "clear");
    try {
      const rangeA = makeRangeInBoundary(boundaryA, "aaa");
      selectionGuard.updateCardDomSelection("card-a", rangeA);
      expect(clearSpy).not.toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }

    // Baseline: publishing for a NON-focused card goes through the full
    // rebuild and does call `clear()`.
    const clearSpy2 = spyOn(hl, "clear");
    try {
      const rangeB2 = makeRangeInBoundary(boundaryB, "bbb2");
      selectionGuard.updateCardDomSelection("card-b", rangeB2);
      expect(clearSpy2).toHaveBeenCalled();
    } finally {
      clearSpy2.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// T29: focus-change installs the one-shot mousedown interceptor when the
//      newly-focused card has a saved Range, so the click that triggered
//      the switch doesn't collapse the restored selection.
// ---------------------------------------------------------------------------

describe("T29 – focus-change mousedown interceptor", () => {
  function dispatchMousedown(): Event {
    const event = new (happyWindow as any).MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    (happyWindow.document as unknown as EventTarget).dispatchEvent(event);
    return event;
  }

  it("intercepts the next mousedown on focus-change when the new card has a saved Range", () => {
    const boundaryA = makeBoundaryInDom();
    const boundaryB = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);

    // Seed a saved Range for card-b so that switching to it triggers
    // a restore and installs the one-shot interceptor.
    const rangeB = makeRangeInBoundary(boundaryB, "bbb");
    selectionGuard.updateCardDomSelection("card-b", rangeB);

    store.setState({
      cards: store.getSnapshot().cards,
      panes: [makePane("pane-1", ["card-a", "card-b"], "card-b")],
      activePaneId: "pane-1",
      hasFocus: true,
    });

    // The one-shot interceptor is now in place. The next mousedown
    // should be `preventDefault`'d so the browser does not move the
    // native selection to the click point, preserving the Range that
    // `updatePaint` just restored via `setBaseAndExtent`.
    const event = dispatchMousedown();
    expect(event.defaultPrevented).toBe(true);

    // Only once: a subsequent mousedown is NOT intercepted.
    const event2 = dispatchMousedown();
    expect(event2.defaultPrevented).toBe(false);
  });

  it("does NOT intercept mousedown on focus-change when the new card has no saved Range", () => {
    const boundaryA = makeBoundaryInDom();
    const boundaryB = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);
    selectionGuard.registerBoundary("card-b", boundaryB);
    // No cardRange for card-b.

    store.setState({
      cards: store.getSnapshot().cards,
      panes: [makePane("pane-1", ["card-a", "card-b"], "card-b")],
      activePaneId: "pane-1",
      hasFocus: true,
    });

    const event = dispatchMousedown();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does NOT intercept mousedown when the store fires without a focus change", () => {
    const boundaryA = makeBoundaryInDom();
    selectionGuard.registerBoundary("card-a", boundaryA);

    // Publish a Range for the already-focused card. The store notifies
    // subscribers but activeCardId/activePaneId do not change.
    const rangeA = makeRangeInBoundary(boundaryA, "aaa");
    selectionGuard.updateCardDomSelection("card-a", rangeA);

    store.setState({
      cards: store.getSnapshot().cards,
      panes: [makePane("pane-1", ["card-a", "card-b"], "card-a")],
      activePaneId: "pane-1",
      hasFocus: true,
    });

    const event = dispatchMousedown();
    expect(event.defaultPrevented).toBe(false);
  });
});
