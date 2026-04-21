/**
 * Identity-preservation tests for the two-table Card/CardStack model.
 *
 * CardContentHost renders via CardPortal at deck level, so card content must
 * mount exactly once and survive every deck operation that preserves card
 * identity: setActiveCardInStack (in-stack card switch), detachCard
 * (cross-stack move to new stack), moveCardToStack (cross-stack move to
 * existing stack). addCardToStack creates a genuinely new card so a new mount
 * is expected; existing cards on the same stack must not re-mount.
 *
 * Probe strategy: a single module-level counter tracks total mount/unmount
 * of Probe instances. Identity preservation == mount count stays flat (or
 * grows only when a genuinely new card enters the deck).
 */
import "./setup-rtl";

import React, { useEffect } from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { DeckCanvas } from "@/components/chrome/deck-canvas";
import * as registry from "@/components/chrome/card-content-registry";
import { registerCard, _resetForTest } from "@/card-registry";
import type { CardState, CardStackState, DeckState, CardStateBag } from "@/layout-tree";
import { DeckManagerContext } from "@/deck-manager-context";
import type { IDeckManagerStore } from "@/deck-manager-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugTooltipProvider } from "@/components/tugways/tug-tooltip";

const probeStats = { aliveMount: 0, aliveUnmount: 0, mountTotal: 0 };

function Probe({ cardId }: { cardId: string }) {
  useEffect(() => {
    probeStats.aliveMount += 1;
    probeStats.mountTotal += 1;
    return () => {
      probeStats.aliveUnmount += 1;
    };
  }, []);
  return <div data-testid={`probe-${cardId}`}>probe</div>;
}

/**
 * Minimal subscribable store that supports the mutations under test, against
 * the two-table model.
 */
class Store implements IDeckManagerStore {
  private state: DeckState;
  private listeners = new Set<() => void>();
  private version = 0;
  public initialFocusedCardId: string | undefined = undefined;
  private saveCallbacks = new Map<string, () => void>();
  private cardStates = new Map<string, CardStateBag>();

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

  handleStackMoved = (): void => {};
  handleStackClosed = (stackId: string): void => {
    const stack = this.state.stacks.find((s) => s.id === stackId);
    if (!stack) return;
    const dropped = new Set(stack.cardIds);
    this.state = {
      ...this.state,
      stacks: this.state.stacks.filter((s) => s.id !== stackId),
      cards: this.state.cards.filter((c) => !dropped.has(c.id)),
    };
    this.notify();
  };

  focusCard = (): void => {};
  activateCard = (): void => {};
  getFirstResponderCardId = (): string | null => null;
  observeCardDidFinishConstruction = (): (() => void) => () => {};
  observeCardDidActivate = (): (() => void) => () => {};
  observeCardDidDeactivate = (): (() => void) => () => {};
  observeCardWillBeginDestruction = (): (() => void) => () => {};
  getActiveCardId = (): string | null => null;
  addCard = (): string | null => null;

  addCardToStack = (stackId: string, componentId: string): string | null => {
    const newCardId = `card-${Math.random().toString(36).slice(2, 8)}`;
    const newCard: CardState = { id: newCardId, componentId, title: "Added", closable: true };
    this.state = {
      ...this.state,
      cards: [...this.state.cards, newCard],
      stacks: this.state.stacks.map((s) =>
        s.id === stackId
          ? { ...s, cardIds: [...s.cardIds, newCardId], activeCardId: newCardId }
          : s,
      ),
    };
    this.notify();
    return newCardId;
  };

  removeCard = (): void => {};

  setActiveCardInStack = (stackId: string, cardId: string): void => {
    this.state = {
      ...this.state,
      stacks: this.state.stacks.map((s) =>
        s.id === stackId ? { ...s, activeCardId: cardId } : s,
      ),
    };
    this.notify();
  };

  reorderCardInStack = (): void => {};

  detachCard = (stackId: string, cardId: string, position: { x: number; y: number }): string | null => {
    const stack = this.state.stacks.find((s) => s.id === stackId);
    if (!stack || !stack.cardIds.includes(cardId)) return null;
    const newStackId = `stack-${Math.random().toString(36).slice(2, 8)}`;
    const remainingCardIds = stack.cardIds.filter((id) => id !== cardId);
    const newStack: CardStackState = {
      id: newStackId,
      position,
      size: { width: 400, height: 300 },
      cardIds: [cardId],
      activeCardId: cardId,
      title: "",
      acceptsFamilies: stack.acceptsFamilies,
    };
    const updatedSource: CardStackState = {
      ...stack,
      cardIds: remainingCardIds,
      activeCardId: remainingCardIds[0] ?? stack.activeCardId,
    };
    this.state = {
      ...this.state,
      stacks: [
        ...this.state.stacks.map((s) => (s.id === stackId ? updatedSource : s)),
        newStack,
      ],
    };
    this.notify();
    return newStackId;
  };

  moveCardToStack = (sourceStackId: string, cardId: string, targetStackId: string, insertAtIndex: number): void => {
    const source = this.state.stacks.find((s) => s.id === sourceStackId);
    const target = this.state.stacks.find((s) => s.id === targetStackId);
    if (!source || !target || !source.cardIds.includes(cardId)) return;
    const newSourceCardIds = source.cardIds.filter((id) => id !== cardId);
    const newTargetCardIds = [...target.cardIds];
    newTargetCardIds.splice(insertAtIndex, 0, cardId);
    const updatedSource: CardStackState = {
      ...source,
      cardIds: newSourceCardIds,
      activeCardId: newSourceCardIds[0] ?? source.activeCardId,
    };
    const updatedTarget: CardStackState = {
      ...target,
      cardIds: newTargetCardIds,
      activeCardId: cardId,
    };
    this.state = {
      ...this.state,
      stacks: this.state.stacks
        .map((s) => {
          if (s.id === sourceStackId) return updatedSource;
          if (s.id === targetStackId) return updatedTarget;
          return s;
        })
        .filter((s) => s.cardIds.length > 0),
    };
    this.notify();
  };

  getCardState = (id: string) => this.cardStates.get(id);
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

  toggleStackCollapse = (): void => {};
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

function makeStack(
  id: string,
  cards: CardState[],
  activeIndex = 0,
  position = { x: 0, y: 0 },
): CardStackState {
  return {
    id,
    position,
    size: { width: 400, height: 300 },
    cardIds: cards.map((c) => c.id),
    activeCardId: cards[activeIndex].id,
    title: "",
    acceptsFamilies: ["standard"],
  };
}

describe("Card content identity preservation (two-table model)", () => {
  beforeEach(() => {
    probeStats.aliveMount = 0;
    probeStats.aliveUnmount = 0;
    probeStats.mountTotal = 0;
    registry._resetForTests();
    _resetForTest();
    registerCard({
      componentId: "probe-hello",
      defaultMeta: { title: "Probe Hello", closable: true },
      contentFactory: (cardId: string) => <Probe cardId={cardId} />,
    });
    registerCard({
      componentId: "probe-other",
      defaultMeta: { title: "Probe Other", closable: true },
      contentFactory: (cardId: string) => <Probe cardId={cardId} />,
    });
  });
  afterEach(() => {
    cleanup();
  });

  it("setActiveCardInStack does not unmount either card's content", () => {
    const cX: CardState = { id: "card-x", componentId: "probe-hello", title: "X", closable: true };
    const cY: CardState = { id: "card-y", componentId: "probe-other", title: "Y", closable: true };
    const stack = makeStack("stack-B", [cX, cY], 0);
    const store = new Store({ cards: [cX, cY], stacks: [stack] });
    renderDeck(store);

    // Two cards in the stack → two Probe mounts on initial render.
    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);

    act(() => {
      store.setActiveCardInStack("stack-B", "card-y");
    });

    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);
  });

  it("addCardToStack mounts the new card's content without unmounting the existing card", () => {
    const cOrig: CardState = { id: "card-orig", componentId: "probe-hello", title: "Orig", closable: true };
    const stack = makeStack("stack-A", [cOrig]);
    const store = new Store({ cards: [cOrig], stacks: [stack] });
    renderDeck(store);

    expect(probeStats.mountTotal).toBe(1);
    expect(probeStats.aliveUnmount).toBe(0);

    act(() => {
      store.addCardToStack("stack-A", "probe-other");
    });

    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);
  });

  it("detachCard preserves the moved card's content identity (no mount, no unmount)", () => {
    const cStay: CardState = { id: "card-stay", componentId: "probe-hello", title: "Stay", closable: true };
    const cMove: CardState = { id: "card-move", componentId: "probe-other", title: "Move", closable: true };
    const stack = makeStack("stack-C", [cStay, cMove], 0);
    const store = new Store({ cards: [cStay, cMove], stacks: [stack] });
    renderDeck(store);

    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);

    act(() => {
      store.detachCard("stack-C", "card-move", { x: 300, y: 300 });
    });

    // Detach creates a new stack containing the moved card. The moved card's
    // Probe must stay mounted — React reconciles the flat deck-level
    // CardContentHost list by cardId, and the portal re-roots the DOM into
    // the new host stack.
    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);
  });

  it("moveCardToStack preserves the moved card's content identity", () => {
    const srcA: CardState = { id: "card-src-1", componentId: "probe-hello", title: "Src", closable: true };
    const mv: CardState = { id: "card-move", componentId: "probe-other", title: "Move", closable: true };
    const tgt: CardState = { id: "card-tgt-1", componentId: "probe-hello", title: "Tgt", closable: true };
    const stackSrc = makeStack("stack-src", [srcA, mv], 1);
    const stackTgt = makeStack("stack-tgt", [tgt], 0, { x: 500, y: 0 });
    const store = new Store({ cards: [srcA, mv, tgt], stacks: [stackSrc, stackTgt] });
    renderDeck(store);

    // 3 total cards → 3 mounts.
    expect(probeStats.mountTotal).toBe(3);
    expect(probeStats.aliveUnmount).toBe(0);

    act(() => {
      store.moveCardToStack("stack-src", "card-move", "stack-tgt", 1);
    });

    // Card count unchanged; identity preserved.
    expect(probeStats.mountTotal).toBe(3);
    expect(probeStats.aliveUnmount).toBe(0);
  });

  it("moveCardToStack roots the moved card's DOM inside the destination stack's content element", () => {
    const srcA: CardState = { id: "card-src-1", componentId: "probe-hello", title: "Src", closable: true };
    const mv: CardState = { id: "card-move", componentId: "probe-other", title: "Move", closable: true };
    const tgt: CardState = { id: "card-tgt-1", componentId: "probe-hello", title: "Tgt", closable: true };
    const stackSrc = makeStack("stack-src", [srcA, mv], 1);
    const stackTgt = makeStack("stack-tgt", [tgt], 0, { x: 500, y: 0 });
    const store = new Store({ cards: [srcA, mv, tgt], stacks: [stackSrc, stackTgt] });
    renderDeck(store);

    // Before the move, the moved card's DOM is inside the source stack's
    // content element, not the target's.
    const movedProbeBefore = document.querySelector('[data-testid="probe-card-move"]');
    expect(movedProbeBefore).not.toBeNull();
    const sourceHostBefore = registry.getElement("stack-src");
    const targetHostBefore = registry.getElement("stack-tgt");
    expect(sourceHostBefore).not.toBeNull();
    expect(targetHostBefore).not.toBeNull();
    expect(sourceHostBefore!.contains(movedProbeBefore!)).toBe(true);
    expect(targetHostBefore!.contains(movedProbeBefore!)).toBe(false);

    act(() => {
      store.moveCardToStack("stack-src", "card-move", "stack-tgt", 1);
    });

    // After the move, the moved card's DOM root is re-parented into the
    // target stack's content element. Portal re-rooting preserves the same
    // DOM node (identity) — query the same probe element.
    const movedProbeAfter = document.querySelector('[data-testid="probe-card-move"]');
    expect(movedProbeAfter).toBe(movedProbeBefore);
    const targetHostAfter = registry.getElement("stack-tgt");
    expect(targetHostAfter).not.toBeNull();
    expect(targetHostAfter!.contains(movedProbeAfter!)).toBe(true);
  });
});
