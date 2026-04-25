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
import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { ComponentPersistenceRegistry } from "@/components/tugways/component-persistence-registry";
import { CardStateOrchestrator } from "@/card-state-orchestrator";
import { registerDeckStore } from "@/lib/deck-store-registry";
import { AppLifecycle, registerAppLifecycle } from "@/lib/app-lifecycle";
import type { TugTextEditingState } from "@/lib/tug-text-engine";

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

  private componentRegistries = new Map<string, ComponentPersistenceRegistry>();
  getComponentRegistry = (cardId: string): ComponentPersistenceRegistry => {
    let r = this.componentRegistries.get(cardId);
    if (!r) {
      r = new ComponentPersistenceRegistry();
      this.componentRegistries.set(cardId, r);
    }
    return r;
  };
  peekComponentRegistry = (
    cardId: string,
  ): ComponentPersistenceRegistry | undefined =>
    this.componentRegistries.get(cardId);

  private orchestrator = new CardStateOrchestrator((cardId) =>
    this.componentRegistries.get(cardId),
  );
  registerCardAssembler: IDeckManagerStore["registerCardAssembler"] = (
    cardId,
    assembler,
  ) => this.orchestrator.registerAssembler(cardId, assembler);
  captureCardState: IDeckManagerStore["captureCardState"] = (cardId) =>
    this.orchestrator.captureCardState(cardId);
  restoreCardState: IDeckManagerStore["restoreCardState"] = (cardId, bag) =>
    this.orchestrator.restoreCardState(cardId, bag);

  setHasFocus = (value: boolean): void => {
    if (this.state.hasFocus === value) return;
    this.state = { ...this.state, hasFocus: value };
    this.notify();
  };

  private activationCallbacks = new Map<string, () => void>();
  private cardHostRoots = new Map<string, HTMLElement>();
  registerActivationCallback = (cardId: string, cb: () => void): (() => void) => {
    this.activationCallbacks.set(cardId, cb);
    return () => {
      if (this.activationCallbacks.get(cardId) === cb) {
        this.activationCallbacks.delete(cardId);
      }
    };
  };
  invokeActivationCallback = (cardId: string): void => {
    this.activationCallbacks.get(cardId)?.();
  };
  registerCardHostRoot = (cardId: string, el: HTMLElement | null): void => {
    if (el === null) this.cardHostRoots.delete(cardId);
    else this.cardHostRoots.set(cardId, el);
  };
  peekCardHostRoot = (cardId: string): HTMLElement | null =>
    this.cardHostRoots.get(cardId) ?? null;
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

// ---- [A9] first-consumer proof: TugCheckbox + persistKey ----

const CHECKBOX_KEY = "integration/done";

function CheckboxCard() {
  return <TugCheckbox persistKey={CHECKBOX_KEY} label="Done" />;
}

function registerCheckboxCard() {
  registerCard({
    componentId: "integ-checkbox",
    defaultMeta: { title: "Checkbox", closable: true },
    contentFactory: () => <CheckboxCard />,
  });
}

function makeCheckboxCardState(id: string): CardState {
  return { id, componentId: "integ-checkbox", title: "Checkbox", closable: true };
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
      hasFocus: true,
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
      hasFocus: true,
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

  it("save flows through the orchestrator — bag round-trips identically and bag.components stays undefined without opt-in components", () => {
    // Step-18 regression: `invokeSaveCallback` routes through
    // `captureCardState` via CardHost's new save closure. The saved
    // bag must match what the orchestrator returns directly, and
    // `bag.components` must stay `undefined` (not an empty object)
    // when no component opted into [D13] / [A9].
    registerFormControlCard();

    const cardId = "card-form-orchestrator";
    const card = makeFormControlCardState(cardId);
    const store = new Store({
      cards: [card],
      panes: [makePane("pane-1", [card])],
      activePaneId: "pane-1",
      hasFocus: true,
    });
    renderDeck(store);

    const input = document.querySelector<HTMLInputElement>(
      `[data-tug-persist-value="${PERSIST_KEY}"]`,
    );
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = "orchestrated@example.com";
    input.setSelectionRange(3, 15, "forward");
    input.focus();

    // Fire the save trigger the way the close / resign path would.
    act(() => {
      store.invokeSaveCallback(cardId);
    });

    const savedBag = store.getCardState(cardId);
    expect(savedBag).not.toBeUndefined();
    if (!savedBag) return;
    // Direct orchestrator call must produce a bag equal to what the
    // save callback wrote — the callback is literally
    // `store.setCardState(id, store.captureCardState(id))`.
    const fresh = store.captureCardState(cardId);
    expect(fresh).toEqual(savedBag);
    // No components opted in, so bag.components never materialized.
    expect(savedBag.components).toBeUndefined();
    // And the framework axes are still captured by construction, so
    // the [M17] RPC parity gap (pre-Step-18 the RPC missed axes the
    // orchestrator now captures) closes for this card.
    expect(savedBag.formControls?.[PERSIST_KEY].value).toBe(
      "orchestrated@example.com",
    );
    expect(savedBag.focus).toEqual({
      kind: "form-control",
      persistKey: PERSIST_KEY,
    });
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
      hasFocus: true,
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
// [A9] First-consumer integration proof — TugCheckbox opt-in round-trip.
// ===========================================================================

describe("selection-persistence integration — [A9] tug-checkbox opt-in", () => {
  it("save captures bag.components[persistKey]; fresh mount re-applies checked state", () => {
    registerCheckboxCard();

    // ---- Session A: mount the card, toggle the checkbox, fire save ----
    const cardId = "card-checkbox";
    const card = makeCheckboxCardState(cardId);
    const storeA = new Store({
      cards: [card],
      panes: [makePane("pane-1", [card])],
      activePaneId: "pane-1",
      hasFocus: true,
    });
    renderDeck(storeA);

    const buttonA = document.querySelector<HTMLButtonElement>(
      'button[data-slot="tug-checkbox"]',
    );
    expect(buttonA).not.toBeNull();
    if (!buttonA) return;
    expect(buttonA.getAttribute("data-state")).toBe("unchecked");

    act(() => {
      buttonA.click();
    });
    expect(buttonA.getAttribute("data-state")).toBe("checked");

    // Fire the save the way the close / will-resign path would.
    act(() => {
      storeA.invokeSaveCallback(cardId);
    });

    const savedBag = storeA.getCardState(cardId);
    expect(savedBag).not.toBeUndefined();
    if (!savedBag) return;
    // The orchestrator wrote the checkbox state into the components
    // slot of the bag — first visible [A9] round-trip.
    expect(savedBag.components?.[CHECKBOX_KEY]).toEqual({ checked: true });

    // Tear session A down.
    cleanup();
    paneContentRegistry._resetForTests();
    selectionGuard.reset();

    // ---- Session B: mount with the saved bag pre-populated ----
    const storeB = new Store({
      cards: [card],
      panes: [makePane("pane-1", [card])],
      activePaneId: "pane-1",
      hasFocus: true,
    });
    storeB.setCardState(cardId, savedBag);
    renderDeck(storeB);

    const buttonB = document.querySelector<HTMLButtonElement>(
      'button[data-slot="tug-checkbox"]',
    );
    expect(buttonB).not.toBeNull();
    if (!buttonB) return;
    // The mount-time restore pass ([A9c]) walked the component
    // registry and applied the saved payload to the new mount's
    // internal state.
    expect(buttonB.getAttribute("data-state")).toBe("checked");
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
      hasFocus: true,
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
      hasFocus: true,
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
      hasFocus: true,
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
      hasFocus: true,
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

// ===========================================================================
// #1 + #9. Engine-managed (tide-like) card reload preserves selection.
//
// Pins the [D07] contract for content-owning cards:
//   - `bag.content` carries the engine's flat-offset selection
//     (`captureState`), which is the sole source of truth for
//     engine-managed cards.
//   - `bag.domSelection` and `bag.focus` are NOT saved for these
//     cards — CardHost's save-side gate sees `bag.content !==
//     undefined` and skips the redundant captures.
//   - On restore, CardHost does NOT call `restoreCardDomSelection`
//     or `applyFocusSnapshot`. The engine's own `restoreState` (via
//     `setSelectedRange`) focuses its root and sets the selection
//     end-to-end.
//
// This test is the regression gate that would have caught the
// tide-card-reload selection-loss bug earlier — the failure mode
// only manifests in the composition of three layers (CardHost +
// engine + WebKit focus quirks), which per-layer unit tests cannot
// see.
// ===========================================================================

function EnginePromptCard() {
  return <TugPromptInput persistState />;
}

function registerEnginePromptCard() {
  registerCard({
    componentId: "engine-prompt",
    defaultMeta: { title: "Engine Prompt", closable: true },
    contentFactory: () => <EnginePromptCard />,
  });
}

function makeEnginePromptCardState(id: string): CardState {
  return {
    id,
    componentId: "engine-prompt",
    title: "Engine Prompt",
    closable: true,
  };
}

describe("selection-persistence integration — engine-managed card reload", () => {
  it("save gates off domSelection/focus for content-owning cards; bag.content owns both", () => {
    registerEnginePromptCard();

    const cardId = "engine-card";
    const card = makeEnginePromptCardState(cardId);
    const store = new Store({
      cards: [card],
      panes: [makePane("pane-1", [card])],
      activePaneId: "pane-1",
      hasFocus: true,
    });
    renderDeck(store);

    // Locate the engine root (contentEditable) inside the rendered
    // TugPromptInput.
    const editor = document.querySelector<HTMLElement>(
      `[data-card-id="${cardId}"] [data-tug-prompt-input-root] [contenteditable]`,
    );
    expect(editor).not.toBeNull();
    if (!editor) return;

    // Plant text + a non-collapsed selection the way a typing user
    // would. Direct DOM manipulation + native selection API is the
    // shortest path in happy-dom; the engine's selectionchange
    // listener relays the range up to selection-guard naturally.
    editor.textContent = "hello world";
    const textNode = editor.firstChild as Text;
    const r = document.createRange();
    r.setStart(textNode, 2);
    r.setEnd(textNode, 8);
    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
    editor.focus();

    // Trigger save — same entry point as `saveAndFlush` uses.
    act(() => {
      store.invokeSaveCallback(cardId);
    });

    const savedBag = store.getCardState(cardId);
    expect(savedBag).not.toBeUndefined();
    if (!savedBag) return;

    // bag.content carries the engine's captured selection.
    expect(savedBag.content).not.toBeUndefined();
    const content = savedBag.content as TugTextEditingState;
    expect(content.text).toBe("hello world");
    expect(content.selection).toEqual({ start: 2, end: 8 });

    // The architectural gate: CardHost did NOT save `bag.domSelection`
    // or `bag.focus` for the engine-managed card. The engine's
    // `bag.content.selection` is the sole source of truth. Without
    // this gate, a second CardHost-driven restore would race the
    // engine on mount and (WebKit focus-with-selection quirk) collapse
    // the just-restored selection.
    expect(savedBag.domSelection).toBeUndefined();
    expect(savedBag.focus).toBeUndefined();
  });

  it("fresh mount with a saved engine bag reapplies the engine's selection via the engine's own restore path", () => {
    registerEnginePromptCard();

    const cardId = "engine-card-restore";
    const card = makeEnginePromptCardState(cardId);

    // Pre-populate a store with a bag that only carries `bag.content`
    // (the shape the save gate produces for engine-managed cards).
    // No `bag.domSelection`, no `bag.focus` — CardHost must not
    // rely on those axes for this class of card.
    const content: TugTextEditingState = {
      text: "hello world",
      atoms: [],
      selection: { start: 2, end: 8 },
    };
    const store = new Store({
      cards: [card],
      panes: [makePane("pane-1", [card])],
      activePaneId: "pane-1",
      hasFocus: true,
    });
    store.setCardState(cardId, { content });

    renderDeck(store);

    // After mount, the engine should have restored text + set the
    // native selection via `setSelectedRange`. Find the contentEditable
    // and assert its selection matches the saved bag.
    const editor = document.querySelector<HTMLElement>(
      `[data-card-id="${cardId}"] [data-tug-prompt-input-root] [contenteditable]`,
    );
    expect(editor).not.toBeNull();
    if (!editor) return;
    expect(editor.textContent).toBe("hello world");

    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    if (!sel) return;
    expect(sel.rangeCount).toBe(1);
    expect(sel.anchorOffset).toBe(2);
    expect(sel.focusOffset).toBe(8);

    // Note: we deliberately do NOT assert `document.activeElement ===
    // editor` here. happy-dom's focus semantics for contentEditable
    // diverge from WebKit (focus-establishment side effects, focus-
    // event ordering), and the focus-before-addRange contract that
    // matters for the user-visible bug lives in `tug-text-engine`'s
    // own unit tests (`setSelectedRange focuses root before setting
    // selection`) which exercise the focus path directly. The
    // integration assertion that matters here is that the selection
    // Range is restored to the saved offsets — which it is.
  });

  it("pre-existing (pre-fix) bag with both content.selection and domSelection still restores via content only — CardHost's restore gate ignores domSelection when content is present", () => {
    registerEnginePromptCard();

    const cardId = "engine-card-legacy";
    const card = makeEnginePromptCardState(cardId);

    // Legacy bag shape from before the save-side gate landed — both
    // `bag.content` AND `bag.domSelection` present. The restore gate
    // must ignore `bag.domSelection` when `bag.content` is defined.
    // A tainted `domSelection` that doesn't match the engine's would
    // otherwise clobber the engine's correctly-set range.
    const content: TugTextEditingState = {
      text: "hello world",
      atoms: [],
      selection: { start: 2, end: 8 },
    };
    const store = new Store({
      cards: [card],
      panes: [makePane("pane-1", [card])],
      activePaneId: "pane-1",
      hasFocus: true,
    });
    store.setCardState(cardId, {
      content,
      domSelection: {
        // A deliberately wrong path; if CardHost honours it, the
        // engine's range gets clobbered to {0, 0}.
        anchorPath: [0, 0],
        anchorOffset: 0,
        focusPath: [0, 0],
        focusOffset: 0,
      },
      focus: { kind: "component-owned" },
    });

    renderDeck(store);

    const editor = document.querySelector<HTMLElement>(
      `[data-card-id="${cardId}"] [data-tug-prompt-input-root] [contenteditable]`,
    );
    expect(editor).not.toBeNull();
    if (!editor) return;

    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    if (!sel) return;
    // Engine's selection wins; domSelection was correctly ignored.
    expect(sel.anchorOffset).toBe(2);
    expect(sel.focusOffset).toBe(8);
  });
});

// ===========================================================================
// [A3] Shared activation effect — FC reactivation paths (Step 23).
//
// These scenarios pin the three transition classes [A3] closes for FC
// cards: intra-pane tab switch ([M01]), pane activation ([M03]), tab
// close handoff ([M16]). All three reduce to the same question — "is
// this card now the focus destination? if so, re-apply its bag.focus
// + bag.domSelection." The activation effect answers it.
// ===========================================================================

// `[A3] FC reactivation` integration tests removed in selection plan
// #step-23b Pass 3 split (c). The three former tests ([M01] intra-pane
// tab switch, [M03] pane activation, [M16] tab close handoff) drove a
// fake Store that mutated `activeCardId` directly and asserted
// `document.activeElement === inputA` under happy-dom. They worked
// because the retired `[A3]` `useLayoutEffect` reacted to the
// `useFocusDestination` flip the fake Store published. After [A3]'s
// retirement (the helper now owns activation transfer and is only
// invoked from real gesture sources — `tug-pane#performSelectCard`,
// `pane-focus-controller`, `_removeCard` / `_closePane`), a fake
// Store cannot exercise the path. Per the project's "no happy-dom
// tests for focus/selection" rule, the right replacement is the
// in-app harness rather than restoring the fake-Store coverage:
// `tests/in-app/m01-tab-switch-fc.test.ts`,
// `m01-rapid-cadence.test.ts`, `m03-pane-activation.test.ts`,
// `m03-rapid-cadence.test.ts`, `m16-tab-close-handoff.test.ts`,
// `m16-rapid-cadence.test.ts` are the trusted-click coverage that
// drives a real WebKit focus call inside Tug.app.
