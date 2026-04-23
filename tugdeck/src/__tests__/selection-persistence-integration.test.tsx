/**
 * Selection-persistence integration tests — Step 15.
 *
 * These tests exercise the end-to-end pipeline — user interaction →
 * `saveCurrentCardStateRef` → `bag` in the store → fresh mount →
 * per-axis restore applies — on top of a real `CardHost` /
 * `DeckCanvas` React tree. Per-layer contracts live in the narrower
 * unit test files (form-control capture, DOM-selection capture,
 * selection-guard paint, focus apply, fast-path restoreState); these
 * tests pin the *composition* of those contracts across a transition.
 *
 * ## Plan-scenario coverage map
 *
 * The plan lists nine transitions. Where a scenario's contract is
 * already fully pinned at a lower layer, this file references that
 * coverage rather than duplicating it. Where composition actually
 * matters — the bag round-trips through the React tree, or the
 * selection-guard subscribes to the real deck store — this file
 * exercises it directly.
 *
 *   1. **Reload with DOM selection in tide card** →
 *      Covered layer-by-layer by
 *      `tug-text-engine-restore-fast-path.test.ts` (engine-side
 *      restore preserves text-node identity), `tug-text-engine.test.ts`
 *      (engine publishes via `onSelectionChanged`), and
 *      `selection-guard-restore.test.ts` (`restoreCardDomSelection`
 *      resolves `bag.domSelection` paths back to a Range). This file
 *      pins the user-driven save-then-restore round-trip at the
 *      CardHost layer with a form-control card (simpler and
 *      sufficient for the composition contract).
 *   2. **Reload with form-control selection** →
 *      `form-control reload round-trip` below.
 *   3. **Tab switch within pane** →
 *      `selection-guard-paint.test.ts` (T24 moves Range buckets on
 *      activeCardId flip). This file pins the full React-tree path in
 *      `tab switch flips paint buckets` below.
 *   4. **Cross-pane move preserves selection** →
 *      `cross-pane move preserves guard Range` below.
 *   5. **App resign → activate** →
 *      `selection-guard-paint.test.ts` (T25) at the guard layer.
 *      This file pins the full React subscription chain in
 *      `app resign dims, activate restores` below.
 *   6. **Inactive cards with selections paint simultaneously** →
 *      `selection-guard-paint.test.ts` (T24) at the guard layer.
 *      This file exercises two cards in separate panes in
 *      `two panes paint simultaneously when neither focused` below.
 *   7. **Card close flushes bag** →
 *      `deck-manager.test.ts` covers the full close path at the
 *      DeckManager layer with 4 dedicated tests (save order, throw,
 *      multi-card pane, survivor-pane). Not duplicated here.
 *   8. **Focus restore gated by active-card predicate** →
 *      `card-host-apply-focus.test.ts` covers the helper-level
 *      pre-check. This file pins the active-card-gate at the
 *      CardHost effect layer in the form-control reload test below.
 *   9. **Component-owned focus variant** →
 *      `card-host-capture-focus.test.ts` and
 *      `card-host-apply-focus.test.ts` cover it at the helper layer
 *      (capture classifier + apply dispatcher). Tide-card mount +
 *      engine integration is deferred to the plan's manual
 *      verification checklist (§deliverables).
 */

import "./setup-rtl";

import React, { useEffect, useRef } from "react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "bun:test";
import { render, act, cleanup } from "@testing-library/react";
import { Window } from "happy-dom";

import { DeckCanvas } from "@/components/chrome/deck-canvas";
import * as paneContentRegistry from "@/components/chrome/pane-content-registry";
import { registerCard, _resetForTest } from "@/card-registry";
import type {
  CardState,
  CardStateBag,
  DeckState,
  TugPaneState,
} from "@/layout-tree";
import { DeckManagerContext } from "@/deck-manager-context";
import type { IDeckManagerStore } from "@/deck-manager-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugTooltipProvider } from "@/components/tugways/tug-tooltip";
import { TugInput } from "@/components/tugways/tug-input";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { registerDeckStore } from "@/lib/deck-store-registry";
import { AppLifecycle, registerAppLifecycle } from "@/lib/app-lifecycle";

// ---------------------------------------------------------------------------
// Minimal rendering-harness Store
//
// Not a mock for call-count assertions — its purpose is to drive the
// real CardHost / DeckCanvas React tree and serve the bag shape back
// through `getCardState` / `setCardState` the way DeckManager would.
// Follows the pattern established in `card-host-composition.test.tsx`.
// ---------------------------------------------------------------------------

class Store implements IDeckManagerStore {
  private state: DeckState;
  private listeners = new Set<() => void>();
  private version = 0;
  public initialFocusedCardId: string | undefined = undefined;
  private saveCallbacks = new Map<string, () => void>();
  public cardStates = new Map<string, CardStateBag>();

  constructor(initial: DeckState) {
    this.state = initial;
  }

  private notify() {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): DeckState => this.state;
  getVersion = (): number => this.version;
  setState = (next: DeckState): void => {
    this.state = next;
    this.notify();
  };

  handlePaneMoved = (): void => {};
  handlePaneClosed = (): void => {};
  focusCard = (): void => {};
  activateCard = (): void => {};
  getFirstResponderCardId = (): string | null => null;
  observeCardDidFinishConstruction = (): (() => void) => () => {};
  observeCardDidActivate = (): (() => void) => () => {};
  observeCardDidDeactivate = (): (() => void) => () => {};
  observeCardWillBeginDestruction = (): (() => void) => () => {};
  addCard = (): string | null => null;
  addCardToPane = (): string | null => null;
  removeCard = (): void => {};
  setActiveCardInPane = (paneId: string, cardId: string): void => {
    this.state = {
      ...this.state,
      panes: this.state.panes.map((p) =>
        p.id === paneId ? { ...p, activeCardId: cardId } : p,
      ),
    };
    this.notify();
  };
  reorderCardInPane = (): void => {};
  detachCard = (): string | null => null;

  moveCardToPane = (
    sourcePaneId: string,
    cardId: string,
    targetPaneId: string,
    insertAtIndex: number,
  ): void => {
    const source = this.state.panes.find((s) => s.id === sourcePaneId);
    const target = this.state.panes.find((s) => s.id === targetPaneId);
    if (!source || !target || !source.cardIds.includes(cardId)) return;
    const newSource = source.cardIds.filter((id) => id !== cardId);
    const newTarget = [...target.cardIds];
    newTarget.splice(insertAtIndex, 0, cardId);
    this.state = {
      ...this.state,
      panes: this.state.panes
        .map((s) => {
          if (s.id === sourcePaneId) {
            return { ...s, cardIds: newSource, activeCardId: newSource[0] ?? s.activeCardId };
          }
          if (s.id === targetPaneId) {
            return { ...s, cardIds: newTarget, activeCardId: cardId };
          }
          return s;
        })
        .filter((s) => s.cardIds.length > 0),
    };
    this.notify();
  };

  getCardState = (id: string): CardStateBag | undefined => this.cardStates.get(id);
  setCardState = (id: string, bag: CardStateBag): void => {
    this.cardStates.set(id, bag);
  };
  registerSaveCallback = (id: string, cb: () => void): void => {
    this.saveCallbacks.set(id, cb);
  };
  unregisterSaveCallback = (id: string): void => {
    this.saveCallbacks.delete(id);
  };
  invokeSaveCallback = (id: string): void => {
    this.saveCallbacks.get(id)?.();
  };
  togglePaneCollapse = (): void => {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePane(id: string, cards: CardState[], position = { x: 0, y: 0 }): TugPaneState {
  return {
    id,
    position,
    size: { width: 400, height: 300 },
    cardIds: cards.map((c) => c.id),
    activeCardId: cards[0].id,
    title: "",
    acceptsFamilies: ["standard"],
  };
}

function renderDeck(store: Store) {
  let container!: HTMLElement;
  act(() => {
    ({ container } = render(
      <TugTooltipProvider>
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      </TugTooltipProvider>,
    ));
  });
  return container;
}

// ---------------------------------------------------------------------------
// CSS Highlight API mock (for paint-layer integration tests)
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
// Test card factories
// ---------------------------------------------------------------------------

const PERSIST_KEY = "integration/email";

function FormControlCard() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    // Expose the input via a data attribute so the test can find it.
    if (inputRef.current) {
      inputRef.current.setAttribute("data-testid", "integ-input");
    }
  }, []);
  return (
    <TugInput
      ref={inputRef}
      persistKey={PERSIST_KEY}
      placeholder="email"
    />
  );
}

function registerFormControlCard() {
  registerCard({
    componentId: "integ-form",
    defaultMeta: { title: "Form Control", closable: true },
    contentFactory: () => <FormControlCard />,
  });
}

function makeFormControlCardState(id: string): CardState {
  return { id, componentId: "integ-form", title: "Form Control", closable: true };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetForTest();
  paneContentRegistry._resetForTests();
  registerDeckStore(null);
  selectionGuard.reset();
});

afterEach(() => {
  cleanup();
  selectionGuard.reset();
  registerDeckStore(null);
  registerAppLifecycle(null);
  removeMockHighlightApi();
  _resetForTest();
});

// ===========================================================================
// #2. Form-control reload round-trip.
// ===========================================================================

describe("selection-persistence integration — form-control reload", () => {
  it("save captures value/selection/focus; fresh mount re-applies them", () => {
    registerFormControlCard();

    // ---- Session A: mount, simulate user interaction, save ----
    const cardId = "card-form";
    const card = makeFormControlCardState(cardId);
    const storeA = new Store({
      cards: [card],
      panes: [makePane("pane-1", [card])],
      activePaneId: "pane-1",
    });
    renderDeck(storeA);

    // The TugInput is rendered inside the card subtree. Grab it,
    // plant value/selection/focus the way a typing user would.
    const inputA = document.querySelector<HTMLInputElement>(
      `[data-tug-persist-value="${PERSIST_KEY}"]`,
    );
    expect(inputA).not.toBeNull();
    if (!inputA) return;
    inputA.value = "hello@example.com";
    inputA.setSelectionRange(6, 11, "forward");
    inputA.focus();
    expect(document.activeElement).toBe(inputA);

    // Fire the save the way DeckManager's close / resign / flush path
    // would.
    act(() => {
      storeA.invokeSaveCallback(cardId);
    });

    const savedBag = storeA.getCardState(cardId);
    expect(savedBag).not.toBeUndefined();
    if (!savedBag) return;
    expect(savedBag.formControls?.[PERSIST_KEY].value).toBe("hello@example.com");
    expect(savedBag.formControls?.[PERSIST_KEY].selectionStart).toBe(6);
    expect(savedBag.formControls?.[PERSIST_KEY].selectionEnd).toBe(11);
    expect(savedBag.focus).toEqual({ kind: "form-control", persistKey: PERSIST_KEY });

    // Tear session A down.
    cleanup();
    paneContentRegistry._resetForTests();
    selectionGuard.reset();

    // ---- Session B: mount with the saved bag pre-populated ----
    const storeB = new Store({
      cards: [card],
      panes: [makePane("pane-1", [card])],
      activePaneId: "pane-1",
    });
    storeB.setCardState(cardId, savedBag);
    renderDeck(storeB);

    const inputB = document.querySelector<HTMLInputElement>(
      `[data-tug-persist-value="${PERSIST_KEY}"]`,
    );
    expect(inputB).not.toBeNull();
    if (!inputB) return;
    // Value + selection re-applied from the saved bag.
    expect(inputB.value).toBe("hello@example.com");
    expect(inputB.selectionStart).toBe(6);
    expect(inputB.selectionEnd).toBe(11);
    // Focus re-applied because this card is the active card of the
    // active pane ([D10] Option B gate).
    expect(document.activeElement).toBe(inputB);
  });

  it("focus restore on a non-active card is suppressed by the active-card gate", () => {
    registerFormControlCard();

    const card = makeFormControlCardState("card-inactive");
    const activeCard = makeFormControlCardState("card-active");
    // Two panes, one active. The saved card is in the NON-active pane.
    const store = new Store({
      cards: [card, activeCard],
      panes: [
        makePane("pane-inactive", [card], { x: 0, y: 0 }),
        makePane("pane-active", [activeCard], { x: 500, y: 0 }),
      ],
      activePaneId: "pane-active",
    });
    store.setCardState("card-inactive", {
      formControls: {
        [PERSIST_KEY]: {
          value: "hidden",
          selectionStart: 0,
          selectionEnd: 5,
        },
      },
      focus: { kind: "form-control", persistKey: PERSIST_KEY },
    });
    renderDeck(store);

    // The inactive card's input is in the DOM and its value/selection
    // restored, but focus is NOT on it.
    const inputs = document.querySelectorAll<HTMLInputElement>(
      `[data-tug-persist-value="${PERSIST_KEY}"]`,
    );
    expect(inputs.length).toBe(2);
    // Locate the input belonging to the inactive card via its
    // ancestor card-host div.
    const inactiveInput = Array.from(inputs).find((el) =>
      el.closest('[data-card-id="card-inactive"]') !== null,
    );
    expect(inactiveInput).not.toBeUndefined();
    if (!inactiveInput) return;
    expect(inactiveInput.value).toBe("hidden");
    expect(document.activeElement).not.toBe(inactiveInput);
  });
});

// ===========================================================================
// #4. Cross-pane move preserves the guard's Range.
// ===========================================================================

describe("selection-persistence integration — cross-pane move", () => {
  it("moveCardToPane preserves cardRanges entry (DOM identity unchanged)", () => {
    registerFormControlCard();

    const cardId = "card-move";
    const card = makeFormControlCardState(cardId);
    const otherCard = makeFormControlCardState("card-other");
    const store = new Store({
      cards: [card, otherCard],
      panes: [
        makePane("pane-A", [card], { x: 0, y: 0 }),
        makePane("pane-B", [otherCard], { x: 500, y: 0 }),
      ],
      activePaneId: "pane-A",
    });

    renderDeck(store);

    // Publish a Range for card-move via the engine's wire (use
    // updateCardDomSelection directly — we're testing the guard's
    // behavior, not the engine).
    const inputA = document.querySelector<HTMLInputElement>(
      `[data-card-id="${cardId}"] [data-tug-persist-value]`,
    );
    expect(inputA).not.toBeNull();
    if (!inputA) return;
    // Manufacture a Range anchored in a text node we can later re-check.
    // TugInput renders a native <input> — we can't construct a Range
    // pointing inside its text via the public API because input values
    // are shadow-dom text. Use a DOM node visible in the card subtree
    // instead: the card-host div is a real element.
    const cardRoot = document.querySelector<HTMLElement>(
      `[data-card-id="${cardId}"]`,
    );
    expect(cardRoot).not.toBeNull();
    if (!cardRoot) return;
    const span = document.createElement("span");
    span.textContent = "preserved text";
    cardRoot.appendChild(span);
    const range = document.createRange();
    range.setStart(span.firstChild as Text, 0);
    range.setEnd(span.firstChild as Text, 9);
    selectionGuard.updateCardDomSelection(cardId, range);
    expect(selectionGuard.getCardRange(cardId)).toBe(range);

    // Move the card to pane-B.
    act(() => {
      store.moveCardToPane("pane-A", cardId, "pane-B", 0);
    });

    // The Range survives — CardPortal reparents the card's DOM
    // subtree intact, so `startContainer` / `endContainer` are still
    // the same text nodes.
    const stillRange = selectionGuard.getCardRange(cardId);
    expect(stillRange).toBe(range);
    expect(stillRange?.toString()).toBe("preserved");
  });
});

// ===========================================================================
// #3 + #5 + #6. Paint-bucket transitions via the deck-store subscription.
// ===========================================================================

describe("selection-persistence integration — paint-bucket transitions", () => {
  let registry: MockHighlightRegistry;
  let appLifecycle: AppLifecycle;

  beforeEach(() => {
    registry = installMockHighlightApi();
    appLifecycle = new AppLifecycle();
    registerAppLifecycle(appLifecycle);
  });

  it("tab switch flips which card's Range paints in inactive-selection", () => {
    registerFormControlCard();

    const c1 = makeFormControlCardState("card-1");
    const c2 = makeFormControlCardState("card-2");
    const store = new Store({
      cards: [c1, c2],
      panes: [
        {
          id: "pane-1",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: [c1.id, c2.id],
          activeCardId: c1.id,
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
      activePaneId: "pane-1",
    });
    registerDeckStore(store);
    selectionGuard.attach(appLifecycle);

    renderDeck(store);

    // Publish a Range for each card.
    const roots = [c1.id, c2.id].map((id) =>
      document.querySelector<HTMLElement>(`[data-card-id="${id}"]`),
    );
    expect(roots[0]).not.toBeNull();
    expect(roots[1]).not.toBeNull();
    const [root1, root2] = roots as [HTMLElement, HTMLElement];

    function addRangeToCard(cardId: string, root: HTMLElement): Range {
      const node = document.createTextNode("xxxxx");
      root.appendChild(node);
      const r = document.createRange();
      r.setStart(node, 0);
      r.setEnd(node, 5);
      selectionGuard.updateCardDomSelection(cardId, r);
      return r;
    }

    const r1 = addRangeToCard(c1.id, root1);
    const r2 = addRangeToCard(c2.id, root2);

    const hl = registry.get("inactive-selection") as MockHighlight;
    // c1 is the focused card → its Range is NOT in inactive; c2 IS.
    expect(hl.has(r1)).toBe(false);
    expect(hl.has(r2)).toBe(true);

    // Flip activeCardId to c2 in the deck store.
    act(() => {
      store.setActiveCardInPane("pane-1", c2.id);
    });

    // Now c2 is focused; c1's Range moves into inactive.
    expect(hl.has(r1)).toBe(true);
    expect(hl.has(r2)).toBe(false);
  });

  it("app resign dims the focused Range; activate restores it", () => {
    registerFormControlCard();

    const cardId = "card-resign";
    const card = makeFormControlCardState(cardId);
    const store = new Store({
      cards: [card],
      panes: [makePane("pane-1", [card])],
      activePaneId: "pane-1",
    });
    registerDeckStore(store);
    selectionGuard.attach(appLifecycle);

    renderDeck(store);

    const root = document.querySelector<HTMLElement>(
      `[data-card-id="${cardId}"]`,
    );
    expect(root).not.toBeNull();
    if (!root) return;
    const node = document.createTextNode("abcde");
    root.appendChild(node);
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 5);
    selectionGuard.updateCardDomSelection(cardId, range);

    const hl = registry.get("inactive-selection") as MockHighlight;
    // Initially focused → not in inactive.
    expect(hl.has(range)).toBe(false);

    // App resigns — every Range dims via inactive.
    act(() => {
      appLifecycle.notifyApplicationDidResignActive();
    });
    expect(hl.has(range)).toBe(true);

    // App becomes active again — focused Range leaves inactive.
    act(() => {
      appLifecycle.notifyApplicationDidBecomeActive();
    });
    expect(hl.has(range)).toBe(false);
  });

  it("two panes with selections paint simultaneously when neither is focused", () => {
    registerFormControlCard();

    const c1 = makeFormControlCardState("card-a");
    const c2 = makeFormControlCardState("card-b");
    const store = new Store({
      cards: [c1, c2],
      panes: [
        makePane("pane-a", [c1], { x: 0, y: 0 }),
        makePane("pane-b", [c2], { x: 500, y: 0 }),
      ],
      activePaneId: "pane-a",
    });
    registerDeckStore(store);
    selectionGuard.attach(appLifecycle);

    renderDeck(store);

    function range(cardId: string): Range {
      const root = document.querySelector<HTMLElement>(
        `[data-card-id="${cardId}"]`,
      );
      if (!root) throw new Error(`no root for ${cardId}`);
      const node = document.createTextNode("xxxxx");
      root.appendChild(node);
      const r = document.createRange();
      r.setStart(node, 0);
      r.setEnd(node, 5);
      selectionGuard.updateCardDomSelection(cardId, r);
      return r;
    }
    const r1 = range(c1.id);
    const r2 = range(c2.id);

    const hl = registry.get("inactive-selection") as MockHighlight;
    // pane-a is active → c1 focused, c2 in inactive.
    expect(hl.has(r1)).toBe(false);
    expect(hl.has(r2)).toBe(true);

    // Resign → both dim.
    act(() => {
      appLifecycle.notifyApplicationDidResignActive();
    });
    expect(hl.has(r1)).toBe(true);
    expect(hl.has(r2)).toBe(true);
    expect(hl.size).toBe(2);
  });
});
