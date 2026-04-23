/**
 * CardHost composition tests.
 *
 * Hook-level tests (use-card-property-store, use-card-feed-store,
 * use-card-content-restore, use-card-dirty-state) exercise each seam in
 * isolation. They do not exercise the *composed* harness — specifically
 * the `saveCurrentCardStateRef` closure that is rewritten every render
 * and read by two downstream consumers (the debounced save path in
 * `useCardDirtyState` and `DeckManager.invokeSaveCallback`).
 *
 * These tests pin three invariants of the composed CardHost:
 *
 *   1. **Debounced save** — scroll → markDirty → debounce fires with a
 *      bag composed from the current host content element, selection,
 *      and persistence-callback onSave payload.
 *   2. **Direct invokeSaveCallback** — DeckManager invoking the
 *      registered callback produces the same bag shape as the debounced
 *      path.
 *   3. **Every-render-rewrite** — after `hostStackId` changes (card
 *      moves to a new pane), the save closure reads the *new* pane's
 *      content element. This is the invariant the harness's
 *      `saveCurrentCardStateRef.current = () => {…}` write-during-render
 *      upholds; any future refactor that replaces it with a
 *      useCallback-with-stale-deps would break this test.
 *
 * The test renders a real DeckCanvas + a real content factory that calls
 * `useCardDirty` / `useCardPersistence`, against a minimal Store that
 * implements the subset of `IDeckManagerStore` these tests exercise.
 */
import "./setup-rtl";

import React, { useEffect } from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { DeckCanvas } from "@/components/chrome/deck-canvas";
import * as paneContentRegistry from "@/components/chrome/pane-content-registry";
import { registerCard, _resetForTest } from "@/card-registry";
import type { CardState, TugPaneState, DeckState, CardStateBag } from "@/layout-tree";
import { DeckManagerContext } from "@/deck-manager-context";
import type { IDeckManagerStore } from "@/deck-manager-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugTooltipProvider } from "@/components/tugways/tug-tooltip";
import { useCardDirty } from "@/components/chrome/tug-pane";
import { useCardPersistence } from "@/components/tugways/use-card-persistence";
import { ComponentPersistenceRegistry } from "@/components/tugways/component-persistence-registry";
import { selectionGuard } from "@/components/tugways/selection-guard";
import {
  TugPromptInput,
  type TugPromptInputDelegate,
} from "@/components/tugways/tug-prompt-input";

const DEBOUNCE_MS = 1000;

// ---------------------------------------------------------------------------
// Test probe: a card content component that exposes markDirty via a
// module-scope ref and registers a predictable onSave payload.
// ---------------------------------------------------------------------------

const probeHandles = {
  markDirty: null as (() => void) | null,
  onSavePayload: { version: 1, body: "initial" } as unknown,
};

function Probe({ cardId }: { cardId: string }) {
  const markDirty = useCardDirty();
  useCardPersistence({
    onSave: () => probeHandles.onSavePayload,
    onRestore: () => {},
  });
  useEffect(() => {
    probeHandles.markDirty = markDirty;
    return () => {
      probeHandles.markDirty = null;
    };
  }, [markDirty]);
  return <div data-testid={`probe-${cardId}`}>probe</div>;
}

// ---------------------------------------------------------------------------
// Minimal IDeckManagerStore stub — just enough for CardHost composition.
// ---------------------------------------------------------------------------

class Store implements IDeckManagerStore {
  private state: DeckState;
  private listeners = new Set<() => void>();
  private version = 0;
  public initialFocusedCardId: string | undefined = undefined;
  private saveCallbacks = new Map<string, () => void>();
  public cardStates = new Map<string, CardStateBag>();
  public setCardStateCalls: Array<{ id: string; bag: CardStateBag }> = [];

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
  setActiveCardInPane = (): void => {};
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
    const newSourceCardIds = source.cardIds.filter((id) => id !== cardId);
    const newTargetCardIds = [...target.cardIds];
    newTargetCardIds.splice(insertAtIndex, 0, cardId);
    const updatedSource: TugPaneState = {
      ...source,
      cardIds: newSourceCardIds,
      activeCardId: newSourceCardIds[0] ?? source.activeCardId,
    };
    const updatedTarget: TugPaneState = {
      ...target,
      cardIds: newTargetCardIds,
      activeCardId: cardId,
    };
    this.state = {
      ...this.state,
      panes: this.state.panes
        .map((s) => {
          if (s.id === sourcePaneId) return updatedSource;
          if (s.id === targetPaneId) return updatedTarget;
          return s;
        })
        .filter((s) => s.cardIds.length > 0),
    };
    this.notify();
  };

  getCardState = (id: string): CardStateBag | undefined => this.cardStates.get(id);
  setCardState = (id: string, bag: CardStateBag): void => {
    this.cardStates.set(id, bag);
    this.setCardStateCalls.push({ id, bag });
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeStack(id: string, cards: CardState[], position = { x: 0, y: 0 }): TugPaneState {
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

function getContentEl(paneId: string): HTMLDivElement {
  const el = paneContentRegistry.getElement(paneId);
  if (!el) throw new Error(`content element for pane ${paneId} is not registered`);
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CardHost composition", () => {
  beforeEach(() => {
    probeHandles.markDirty = null;
    probeHandles.onSavePayload = { version: 1, body: "initial" };
    paneContentRegistry._resetForTests();
    _resetForTest();
    registerCard({
      componentId: "probe",
      defaultMeta: { title: "Probe", closable: true },
      contentFactory: (cardId: string) => <Probe cardId={cardId} />,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("debounced save: scroll → markDirty → setCardState fires with the composed bag", async () => {
    const card: CardState = { id: "c1", componentId: "probe", title: "Probe", closable: true };
    const store = new Store({ cards: [card], panes: [makeStack("p1", [card])] });
    renderDeck(store);

    const contentEl = getContentEl("p1");
    Object.defineProperty(contentEl, "scrollLeft", { value: 42, writable: true, configurable: true });
    Object.defineProperty(contentEl, "scrollTop", { value: 84, writable: true, configurable: true });

    act(() => {
      contentEl.dispatchEvent(new Event("scroll"));
    });

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));

    const call = store.setCardStateCalls[store.setCardStateCalls.length - 1];
    expect(call).toBeDefined();
    expect(call!.id).toBe("c1");
    expect(call!.bag.scroll).toEqual({ x: 42, y: 84 });
    expect(call!.bag.content).toEqual({ version: 1, body: "initial" });
  });

  it("direct invokeSaveCallback produces the same bag shape as the debounced path", () => {
    const card: CardState = { id: "c1", componentId: "probe", title: "Probe", closable: true };
    const store = new Store({ cards: [card], panes: [makeStack("p1", [card])] });
    renderDeck(store);

    const contentEl = getContentEl("p1");
    Object.defineProperty(contentEl, "scrollLeft", { value: 10, writable: true, configurable: true });
    Object.defineProperty(contentEl, "scrollTop", { value: 20, writable: true, configurable: true });

    act(() => {
      store.invokeSaveCallback("c1");
    });

    const call = store.setCardStateCalls[store.setCardStateCalls.length - 1];
    expect(call).toBeDefined();
    expect(call!.id).toBe("c1");
    expect(call!.bag.scroll).toEqual({ x: 10, y: 20 });
    expect(call!.bag.content).toEqual({ version: 1, body: "initial" });
  });

  it("every-render-rewrite: after hostStackId changes, the save reads the new pane's content element", async () => {
    const card: CardState = { id: "c1", componentId: "probe", title: "Card A", closable: true };
    const sentinelA: CardState = { id: "cA", componentId: "probe", title: "Sentinel A", closable: true };
    const sentinelB: CardState = { id: "cB", componentId: "probe", title: "Sentinel B", closable: true };
    const store = new Store({
      cards: [card, sentinelA, sentinelB],
      panes: [
        makeStack("paneA", [card, sentinelA], { x: 0, y: 0 }),
        makeStack("paneB", [sentinelB], { x: 500, y: 0 }),
      ],
    });
    renderDeck(store);

    // Pre-move save: card is on paneA.
    const contentElA = getContentEl("paneA");
    Object.defineProperty(contentElA, "scrollLeft", { value: 100, writable: true, configurable: true });
    Object.defineProperty(contentElA, "scrollTop", { value: 200, writable: true, configurable: true });
    act(() => {
      store.invokeSaveCallback("c1");
    });
    const beforeMove = store.setCardStateCalls[store.setCardStateCalls.length - 1]!;
    expect(beforeMove.bag.scroll).toEqual({ x: 100, y: 200 });

    // Move the card to paneB. This re-renders CardHost with a new hostStackId.
    act(() => {
      store.moveCardToPane("paneA", "c1", "paneB", 1);
    });

    // Post-move save: must read paneB's content element. If the save
    // closure had stale-captured paneA, the bag would still reflect
    // paneA's scroll values.
    const contentElB = getContentEl("paneB");
    Object.defineProperty(contentElB, "scrollLeft", { value: 300, writable: true, configurable: true });
    Object.defineProperty(contentElB, "scrollTop", { value: 400, writable: true, configurable: true });
    act(() => {
      store.invokeSaveCallback("c1");
    });
    const afterMove = store.setCardStateCalls[store.setCardStateCalls.length - 1]!;
    expect(afterMove.bag.scroll).toEqual({ x: 300, y: 400 });
    // And it is a genuinely new write, not the pre-move one cached.
    expect(afterMove).not.toBe(beforeMove);
  });
});

// ---------------------------------------------------------------------------
// Engine → selectionGuard wiring (Step 4)
// ---------------------------------------------------------------------------
//
// A `TugPromptInput` mounted inside a `CardHost` must relay every engine
// selection change to `selectionGuard.updateCardDomSelection(cardId, range)`
// and clear the entry on unmount. This is the hand-off that lets
// `selectionGuard` paint remembered selections for non-focused cards
// (Step 5) without reading engine internals.
// ---------------------------------------------------------------------------

const promptProbeHandles = {
  delegate: null as TugPromptInputDelegate | null,
};

function PromptProbe() {
  const ref = React.useRef<TugPromptInputDelegate | null>(null);
  useEffect(() => {
    promptProbeHandles.delegate = ref.current;
    return () => {
      promptProbeHandles.delegate = null;
    };
  }, []);
  return <TugPromptInput ref={ref} />;
}

describe("CardHost → TugPromptInput → selectionGuard wiring", () => {
  beforeEach(() => {
    promptProbeHandles.delegate = null;
    paneContentRegistry._resetForTests();
    _resetForTest();
    selectionGuard.reset();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    registerCard({
      componentId: "prompt-probe",
      defaultMeta: { title: "Prompt Probe", closable: true },
      contentFactory: () => <PromptProbe />,
    });
  });

  afterEach(() => {
    cleanup();
    selectionGuard.reset();
  });

  it("engine.setSelectedRange publishes a Range to selectionGuard.cardRanges under the enclosing cardId", () => {
    const card: CardState = {
      id: "c-prompt",
      componentId: "prompt-probe",
      title: "Prompt",
      closable: true,
    };
    const store = new Store({ cards: [card], panes: [makeStack("p1", [card])] });
    renderDeck(store);

    const delegate = promptProbeHandles.delegate;
    expect(delegate).not.toBeNull();

    // Seed the engine with text so the 3–7 offsets resolve to real DOM
    // positions; without content, `setSelectedRange` has nothing to point at.
    act(() => {
      delegate!.restoreState({
        text: "hello world",
        atoms: [],
        selection: null,
      });
    });
    // Prime: at this point the restore-null path has emitted once; guard
    // has no entry. Verify.
    expect(selectionGuard.getCardRange("c-prompt")).toBeUndefined();

    act(() => {
      delegate!.setSelectedRange(3, 7);
    });

    const range = selectionGuard.getCardRange("c-prompt");
    expect(range).toBeDefined();
    expect(range).not.toBeNull();
    expect(range!.startOffset).toBe(3);
    expect(range!.endOffset).toBe(7);
  });

  it("unmount clears the card's entry from selectionGuard.cardRanges", () => {
    const card: CardState = {
      id: "c-prompt-unmount",
      componentId: "prompt-probe",
      title: "Prompt",
      closable: true,
    };
    const store = new Store({ cards: [card], panes: [makeStack("p1", [card])] });
    const { unmount } = render(
      <TugTooltipProvider>
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      </TugTooltipProvider>,
    );

    const delegate = promptProbeHandles.delegate;
    expect(delegate).not.toBeNull();

    act(() => {
      delegate!.restoreState({
        text: "hello world",
        atoms: [],
        selection: null,
      });
      delegate!.setSelectedRange(1, 5);
    });

    expect(selectionGuard.getCardRange("c-prompt-unmount")).toBeDefined();

    act(() => {
      unmount();
    });

    // After unmount, the engine's cleanup has fired
    // `updateCardDomSelection(id, null)` and `unregisterBoundary(id)`.
    // Either path clears the entry; the observable is the same.
    expect(selectionGuard.getCardRange("c-prompt-unmount")).toBeUndefined();
  });
});
