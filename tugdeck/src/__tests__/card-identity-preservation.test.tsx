/**
 * Identity-preservation tests for Step 11.6.1a Piece 1.iii.
 *
 * After TabContentHost flipped to render via CardPortal at deck level, tab
 * content must mount exactly once and survive every card-level operation
 * that preserves tab identity: setActiveCardInStack (in-card tab switch), detachCard
 * (cross-card move to new card), moveCardToStack (cross-card move to existing card).
 * addCardToStack creates a genuinely new tab so a new mount is expected; existing
 * tabs on the same card must not re-mount.
 *
 * Probe strategy: a single module-level counter tracks total mount/unmount
 * of Probe instances. Identity preservation == mount count stays flat (or
 * grows only when a genuinely new tab enters the deck).
 */
import "./setup-rtl";

import React, { useEffect } from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { DeckCanvas } from "@/components/chrome/deck-canvas";
import * as registry from "@/components/chrome/card-content-registry";
import { registerCard, _resetForTest } from "@/card-registry";
import type { CardState, TabItem, DeckState } from "@/layout-tree";
import { DeckManagerContext } from "@/deck-manager-context";
import type { IDeckManagerStore } from "@/deck-manager-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugTooltipProvider } from "@/components/tugways/tug-tooltip";

// Module-level probe counters: one pair of (mount, unmount) across all Probe
// instances in the current test. Incremented on mount, decremented on
// unmount. `mountTotal` is a monotonic counter (never decremented) used to
// verify that no NEW mounts occurred across an operation.
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
 * Minimal subscribable store that supports the mutations under test.
 */
class Store implements IDeckManagerStore {
  private state: DeckState;
  private listeners = new Set<() => void>();
  private version = 0;
  public initialFocusedCardId: string | undefined = undefined;
  private saveCallbacks = new Map<string, () => void>();
  private tabStates = new Map<string, import("@/layout-tree").TabStateBag>();

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
  handleCardClosed = (id: string): void => {
    this.state = { cards: this.state.cards.filter((c) => c.id !== id) };
    this.notify();
  };

  activateCard = (): void => {};
  observeCardDidFinishConstruction = (): (() => void) => () => {};
  observeCardDidActivate = (): (() => void) => () => {};
  observeCardDidDeactivate = (): (() => void) => () => {};
  observeCardWillBeginDestruction = (): (() => void) => () => {};
  getActiveCardId = (): string | null => null;
  addCard = (): string | null => null;

  addCardToStack = (cardId: string, componentId: string): string | null => {
    const newTabId = `tab-${Math.random().toString(36).slice(2, 8)}`;
    const newTab: TabItem = { id: newTabId, componentId, title: "Added", closable: true };
    this.state = {
      cards: this.state.cards.map((c) =>
        c.id === cardId ? { ...c, tabs: [...c.tabs, newTab], activeTabId: newTabId } : c,
      ),
    };
    this.notify();
    return newTabId;
  };

  removeCard = (): void => {};

  setActiveCardInStack = (cardId: string, tabId: string): void => {
    this.state = {
      cards: this.state.cards.map((c) => (c.id === cardId ? { ...c, activeTabId: tabId } : c)),
    };
    this.notify();
  };

  reorderCardInStack = (): void => {};

  detachCard = (cardId: string, tabId: string, position: { x: number; y: number }): string | null => {
    const card = this.state.cards.find((c) => c.id === cardId);
    if (!card) return null;
    const tab = card.tabs.find((t) => t.id === tabId);
    if (!tab) return null;
    const newCardId = `card-${Math.random().toString(36).slice(2, 8)}`;
    const newCard: CardState = {
      id: newCardId,
      position,
      size: { width: 400, height: 300 },
      tabs: [tab],
      activeTabId: tab.id,
      title: "",
      acceptsFamilies: card.acceptsFamilies,
    };
    const remainingTabs = card.tabs.filter((t) => t.id !== tabId);
    const updatedSource: CardState = {
      ...card,
      tabs: remainingTabs,
      activeTabId: remainingTabs.length > 0 ? remainingTabs[0].id : card.activeTabId,
    };
    this.state = {
      cards: [
        ...this.state.cards.map((c) => (c.id === cardId ? updatedSource : c)),
        newCard,
      ],
    };
    this.notify();
    return newCardId;
  };

  moveCardToStack = (sourceCardId: string, tabId: string, targetCardId: string, insertAtIndex: number): void => {
    const source = this.state.cards.find((c) => c.id === sourceCardId);
    const target = this.state.cards.find((c) => c.id === targetCardId);
    if (!source || !target) return;
    const tab = source.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const newSourceTabs = source.tabs.filter((t) => t.id !== tabId);
    const newTargetTabs = [...target.tabs];
    newTargetTabs.splice(insertAtIndex, 0, tab);
    const updatedSource: CardState = {
      ...source,
      tabs: newSourceTabs,
      activeTabId: newSourceTabs.length > 0 ? newSourceTabs[0].id : source.activeTabId,
    };
    const updatedTarget: CardState = { ...target, tabs: newTargetTabs, activeTabId: tab.id };
    this.state = {
      cards: this.state.cards
        .map((c) => {
          if (c.id === sourceCardId) return updatedSource;
          if (c.id === targetCardId) return updatedTarget;
          return c;
        })
        .filter((c) => c.tabs.length > 0),
    };
    this.notify();
  };

  getCardState = (id: string) => this.tabStates.get(id);
  setCardState = (id: string, bag: import("@/layout-tree").TabStateBag): void => {
    this.tabStates.set(id, bag);
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

describe("Tab content identity preservation (Step 11.6.1a Piece 1.iii)", () => {
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

  it("setActiveCardInStack does not unmount either tab's content", () => {
    const card: CardState = {
      id: "card-B",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [
        { id: "tab-x", componentId: "probe-hello", title: "X", closable: true },
        { id: "tab-y", componentId: "probe-other", title: "Y", closable: true },
      ],
      activeTabId: "tab-x",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const store = new Store({ cards: [card] });
    renderDeck(store);

    // Two tabs → two Probe mounts on initial render; neither has unmounted.
    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);

    act(() => {
      store.setActiveCardInStack("card-B", "tab-y");
    });

    // Tab switch must not mount or unmount anything.
    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);
  });

  it("addCardToStack mounts the new tab's content without unmounting the existing tab", () => {
    const card: CardState = {
      id: "card-A",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [{ id: "tab-orig", componentId: "probe-hello", title: "Orig", closable: true }],
      activeTabId: "tab-orig",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const store = new Store({ cards: [card] });
    renderDeck(store);

    expect(probeStats.mountTotal).toBe(1);
    expect(probeStats.aliveUnmount).toBe(0);

    act(() => {
      store.addCardToStack("card-A", "probe-other");
    });

    // The new tab mounts (mountTotal becomes 2). The original tab's content
    // must not have unmounted — identity preserved across the add.
    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);
  });

  it("detachCard preserves the moved tab's content identity (no mount, no unmount)", () => {
    const card: CardState = {
      id: "card-C",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [
        { id: "tab-stay", componentId: "probe-hello", title: "Stay", closable: true },
        { id: "tab-move", componentId: "probe-other", title: "Move", closable: true },
      ],
      activeTabId: "tab-stay",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const store = new Store({ cards: [card] });
    renderDeck(store);

    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);

    act(() => {
      store.detachCard("card-C", "tab-move", { x: 300, y: 300 });
    });

    // Detach creates a new CardStack containing the moved tab. The moved
    // tab's Probe must stay mounted — React reconciles the flat deck-level
    // TabContentHost list by tabId, and the portal re-roots the DOM into
    // the new host card. No mount, no unmount.
    expect(probeStats.mountTotal).toBe(2);
    expect(probeStats.aliveUnmount).toBe(0);
  });

  it("moveCardToStack preserves the moved tab's content identity", () => {
    const cardA: CardState = {
      id: "card-src",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [
        { id: "tab-src-1", componentId: "probe-hello", title: "Src", closable: true },
        { id: "tab-move", componentId: "probe-other", title: "Move", closable: true },
      ],
      activeTabId: "tab-move",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const cardB: CardState = {
      id: "card-tgt",
      position: { x: 500, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [{ id: "tab-tgt-1", componentId: "probe-hello", title: "Tgt", closable: true }],
      activeTabId: "tab-tgt-1",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const store = new Store({ cards: [cardA, cardB] });
    renderDeck(store);

    // 3 total tabs → 3 mounts.
    expect(probeStats.mountTotal).toBe(3);
    expect(probeStats.aliveUnmount).toBe(0);

    act(() => {
      store.moveCardToStack("card-src", "tab-move", "card-tgt", 1);
    });

    // Merge leaves total tab count at 3 (tab-move moved, not created). No
    // mount, no unmount — identity preserved.
    expect(probeStats.mountTotal).toBe(3);
    expect(probeStats.aliveUnmount).toBe(0);
  });
});
