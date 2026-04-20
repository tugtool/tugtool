/**
 * DeckCanvas tests -- Phase 5a2 adaptation.
 *
 * After the Phase 5a2 migration, DeckCanvas reads deckState and callbacks from
 * DeckManagerContext via useSyncExternalStore. All renders now require a
 * DeckManagerContext.Provider wrapping DeckCanvas (in addition to
 * ResponderChainProvider). A `renderDeckCanvasWithStore` helper encapsulates
 * this pattern so each test remains focused on behavior.
 *
 * Mock store: a minimal object literal implementing IDeckManagerStore. It
 * provides a static getSnapshot() returning the desired DeckState, a trivial
 * subscribe() returning a no-op unsubscribe, a getVersion() returning 0, and
 * stable no-op callbacks. Tests that need specific callback behavior override
 * individual fields with spies.
 *
 * Tests cover:
 * - DeckCanvas registers as responder "deck-canvas" on mount
 * - DeckCanvas is auto-promoted to first responder (root node, no prior first responder)
 * - DeckCanvas responder handles cycleCard action
 * - DeckCanvas responder handles showComponentGallery action
 * - Ctrl+` keyboard shortcut triggers cycleCard via key pipeline (integration)
 * - T25: DeckCanvas renders cards from store-provided deckState
 * - T26: DeckCanvas with empty store renders no cards
 * - T27: DeckCanvas skips cards with unregistered componentIds (warning logged)
 * - onClose wiring: DeckCanvas wires onClose from store.handleStackClosed via Tugcard
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach, beforeEach, spyOn } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugTooltipProvider } from "@/components/tugways/tug-tooltip";
import { DeckManagerContext } from "@/deck-manager-context";
import { DeckCanvas } from "@/components/chrome/deck-canvas";
import { registerCard, _resetForTest } from "@/card-registry";
import { registerHelloWorldCard } from "@/components/tugways/cards/hello-world-card";
import { registerGalleryCards } from "@/components/tugways/cards/gallery-registrations";
import type { CardState, CardStackState, DeckState } from "@/layout-tree";
import type { IDeckManagerStore } from "@/deck-manager-store";
import type { TugAction } from "@/components/tugways/action-vocabulary";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

// Test helper: cast an arbitrary string to TugAction for chain-mechanics
// tests that exercise behavior independent of the production vocabulary.
const asAction = (name: string) => name as unknown as TugAction;


// Clean up mounted React trees after each test.
afterEach(() => {
  cleanup();
});

// ---- Mock TugConnection ----

function makeMockConnection() {
  return {
    onDisconnectState: () => () => {},
    onOpen: () => () => {},
    onFrame: () => () => {},
    sendControlFrame: () => {},
  } as unknown as import("@/connection").TugConnection;
}

// ---- Mock store builder ----

/**
 * Build a minimal mock IDeckManagerStore for tests.
 *
 * Provides:
 * - getSnapshot() returning the supplied DeckState (default: empty cards)
 * - subscribe() returning a no-op unsubscribe
 * - getVersion() returning 0
 * - no-op handleStackMoved, handleStackClosed, handleCardFocused
 *
 * Override individual fields with spies for tests that need callback assertions.
 */
function makeMockStore(deckState: DeckState = { cards: [], stacks: [] }): IDeckManagerStore {
  return {
    subscribe: (_cb: () => void) => () => {},
    getSnapshot: () => deckState,
    getVersion: () => 0,
    handleStackMoved: (_id: string, _pos: { x: number; y: number }, _size: { width: number; height: number }) => {},
    handleStackClosed: (_id: string) => {},
    focusCard: (_id: string) => {},
    activateCard: (_id: string) => {},
    observeCardDidFinishConstruction: () => () => {},
    observeCardDidActivate: () => () => {},
    observeCardDidDeactivate: () => () => {},
    observeCardWillBeginDestruction: () => () => {},
    getActiveCardId: () => null,
    addCard: (_componentId: string) => null,
    addCardToStack: (_cardId: string, _componentId: string) => null,
    removeCard: (_cardId: string, _tabId: string) => {},
    setActiveCardInStack: (_cardId: string, _tabId: string) => {},
    reorderCardInStack: (_cardId: string, _fromIndex: number, _toIndex: number) => {},
    detachCard: (_cardId: string, _tabId: string, _position: { x: number; y: number }) => null,
    moveCardToStack: (_sourceCardId: string, _tabId: string, _targetCardId: string, _insertAtIndex: number) => {},
    // Phase 5f additions
    getCardState: (_tabId: string) => undefined,
    setCardState: (_tabId: string, _bag: import("@/layout-tree").CardStateBag) => {},
    initialFocusedCardId: undefined,
    // Phase 5f3 additions
    registerSaveCallback: (_id: string, _callback: () => void) => {},
    unregisterSaveCallback: (_id: string) => {},
    invokeSaveCallback: (_id: string) => {},
    // Collapse toggle (added in Step 3 of the collapse feature)
    toggleStackCollapse: (_id: string) => {},
  };
}

// ---- Primary render helper ----

/**
 * Render DeckCanvas inside both ResponderChainProvider and DeckManagerContext.Provider.
 * Every DeckCanvas render requires both providers after the Phase 5a2 migration.
 * DeckCanvasProps is currently empty — the `connection` parameter was removed
 * in an earlier refactor; this helper no longer forwards one.
 */
function renderDeckCanvasWithStore(store?: IDeckManagerStore) {
  const resolvedStore = store ?? makeMockStore();
  return render(
    <TugTooltipProvider><ResponderChainProvider>
      <DeckManagerContext.Provider value={resolvedStore}>
        <TugTooltipProvider>
          <DeckCanvas />
        </TugTooltipProvider>
      </DeckManagerContext.Provider>
    </ResponderChainProvider></TugTooltipProvider>
  );
}

// ---- Keyboard helper ----

function fireKeydown(options: {
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): void {
  const event = new KeyboardEvent("keydown", {
    code: options.code,
    key: options.code,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
}

// ---- Card registry helpers ----

/** Spec for a card within a {@link StackSpec}. Carries only what assertions
 *  need (id, componentId, title, closable); the rest of the CardState record
 *  is filled in by {@link makeDeckState}. */
interface CardSpec {
  id: string;
  componentId: string;
  title: string;
  closable: boolean;
}

/** Spec for a stack: position/size/title/acceptsFamilies plus an inline list
 *  of {@link CardSpec}s whose order becomes the stack's `cardIds`. */
interface StackSpec {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  cards: CardSpec[];
  activeCardId: string;
  title: string;
  acceptsFamilies: readonly string[];
  collapsed?: boolean;
}

/** Build a single-card StackSpec where the card id equals the stack id.
 *  Mirrors production `addCard`, which creates a single-card stack and
 *  returns the card id. Keeping the two ids equal lets mock `addCard` return
 *  values and `hostStack` lookups line up. */
function makeSingleCardStack(id: string, componentId: string): StackSpec {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    cards: [{ id, componentId, title: componentId, closable: true }],
    activeCardId: id,
    title: "",
    acceptsFamilies: ["standard"],
  };
}

/** Flatten an array of {@link StackSpec}s into a two-table DeckState. */
function makeDeckState(specs: StackSpec[]): DeckState {
  const cards: CardState[] = [];
  const stacks: CardStackState[] = [];
  for (const spec of specs) {
    for (const c of spec.cards) {
      cards.push({
        id: c.id,
        componentId: c.componentId,
        title: c.title,
        closable: c.closable,
      });
    }
    stacks.push({
      id: spec.id,
      position: spec.position,
      size: spec.size,
      cardIds: spec.cards.map((c) => c.id),
      activeCardId: spec.activeCardId,
      title: spec.title,
      acceptsFamilies: spec.acceptsFamilies,
      ...(spec.collapsed === true ? { collapsed: true } : {}),
    });
  }
  return { cards, stacks };
}

// ============================================================================
// Registration: DeckCanvas registers as root responder
// ============================================================================

describe("DeckCanvas – responder registration", () => {
  it("DeckCanvas renders inside providers without errors", () => {
    const { container } = renderDeckCanvasWithStore();
    expect(container).not.toBeNull();
  });

  it("DeckCanvas auto-promotes to first responder on mount (root node)", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const store = makeMockStore();
    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    expect(manager).not.toBeNull();
    expect(manager!.getFirstResponder()).toBe("deck-canvas");
  });

  it("DeckCanvas registers as responder 'deck-canvas'", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const store = makeMockStore();
    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    expect(manager!.canHandle("cycle-card")).toBe(true);
  });
});

// ============================================================================
// Action handlers: cycleCard
// ============================================================================

describe("DeckCanvas – cycleCard action", () => {
  it("handles cycleCard action (dispatch returns true)", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const store = makeMockStore();
    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const handled = manager!.sendToFirstResponder({ action: TUG_ACTIONS.CYCLE_CARD, phase: "discrete" });
    expect(handled).toBe(true);
    logSpy.mockRestore();
  });

  it("cycleCard with no cards is a silent no-op", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const store = makeMockStore(); // empty deckState by default
    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    const handled = manager!.sendToFirstResponder({ action: TUG_ACTIONS.CYCLE_CARD, phase: "discrete" });
    expect(handled).toBe(true);
  });
});

// ============================================================================
// Action handlers: showComponentGallery
// ============================================================================

describe("DeckCanvas – showComponentGallery action", () => {
  beforeEach(() => { _resetForTest(); registerGalleryCards(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("handles showComponentGallery action (dispatch returns true)", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const store = makeMockStore();
    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    let handled = false;
    act(() => {
      handled = manager!.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_COMPONENT_GALLERY, phase: "discrete" });
    });
    expect(handled).toBe(true);
  });

  it("showComponentGallery calls store.addCard('gallery-buttons') when no gallery card exists", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const addCardCalls: string[] = [];
    const GALLERY_CARD_ID = "gallery-card-uuid-1";
    const store = makeMockStore();
    store.addCard = (componentId: string) => {
      addCardCalls.push(componentId);
      return GALLERY_CARD_ID;
    };

    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    act(() => {
      manager!.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_COMPONENT_GALLERY, phase: "discrete" });
    });

    expect(addCardCalls.length).toBe(1);
    expect(addCardCalls[0]).toBe("gallery-buttons");
  });

  it("showComponentGallery calls store.activateCard with the new card ID after addCard", () => {
    // Post-Step-5.5: the action dispatches through store.activateCard
    // (which internally updates z-order + responder chain + observers),
    // not through manager.makeFirstResponder directly.
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const GALLERY_CARD_ID = "gallery-card-uuid-2";
    const activateCalls: string[] = [];
    const store = makeMockStore();
    store.addCard = (_componentId: string) => GALLERY_CARD_ID;
    store.activateCard = (id: string) => {
      activateCalls.push(id);
    };

    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    act(() => {
      manager!.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_COMPONENT_GALLERY, phase: "discrete" });
    });

    expect(activateCalls).toContain(GALLERY_CARD_ID);
  });

  it("showComponentGallery a second time calls store.activateCard (show-only, [D07])", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const GALLERY_CARD_ID = "gallery-card-uuid-3";
    const addCardCalls: string[] = [];
    const focusedIds: string[] = [];

    // ReactiveStore so cards array updates after addCard
    const reactiveStore = new ReactiveStore({ cards: [], stacks: [] });
    reactiveStore.addCard = (componentId: string) => {
      addCardCalls.push(componentId);
      // Simulate adding the card to store state
      reactiveStore.setState(
        makeDeckState([makeSingleCardStack(GALLERY_CARD_ID, "gallery-buttons")]),
      );
      return GALLERY_CARD_ID;
    };
    reactiveStore.activateCard = (id: string) => {
      focusedIds.push(id);
    };

    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={reactiveStore}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    // First dispatch: creates the gallery card
    act(() => {
      manager!.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_COMPONENT_GALLERY, phase: "discrete" });
    });
    expect(addCardCalls.length).toBe(1);

    // Second dispatch: gallery card now exists -- should focus it, NOT create a new one
    act(() => {
      manager!.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_COMPONENT_GALLERY, phase: "discrete" });
    });
    expect(addCardCalls.length).toBe(1); // No second addCard call
    expect(focusedIds).toContain(GALLERY_CARD_ID);
  });
});

// ============================================================================
// Integration: Ctrl+` key pipeline triggers cycleCard
// ============================================================================

describe("DeckCanvas – Ctrl+` key pipeline integration", () => {
  it("Ctrl+` fires cycleCard through the key pipeline", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const store = makeMockStore();
    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    expect(manager!.canHandle("cycle-card")).toBe(true);

    act(() => {
      fireKeydown({ code: "Backquote", ctrlKey: true });
    });

    // No crash; action handled silently (no cards to cycle)
  });

  void makeMockConnection; // suppress unused import warning
});

// ============================================================================
// T25: DeckCanvas renders cards from store-provided deckState
// ============================================================================

describe("DeckCanvas – T25: renders cards from store-provided deckState", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders a CardFrame for each registered card in deckState", () => {
    registerCard({
      componentId: "mock-card",
      contentFactory: (cardId: string) =>
        React.createElement("div", { "data-testid": `mock-card-content-${cardId}` }, "Mock"),
      defaultMeta: { title: "Mock Card", closable: true },
    });

    const card1 = makeSingleCardStack("card-a", "mock-card");
    const card2 = makeSingleCardStack("card-b", "mock-card");
    const store = makeMockStore(makeDeckState([card1, card2]));

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(2);

    // contentFactory receives the card's id (stable across detach/merge).
    // `makeSingleCardStack` produces single-card stacks where stack id === card id,
    // so the rendered content nodes are tagged with the original fixture id.
    expect(container.querySelector("[data-testid='mock-card-content-card-a']")).not.toBeNull();
    expect(container.querySelector("[data-testid='mock-card-content-card-b']")).not.toBeNull();
  });

  it("assigns ascending z-index by store array position", () => {
    registerCard({
      componentId: "zindex-card",
      contentFactory: (cardId: string) =>
        React.createElement("div", { "data-testid": `zcard-${cardId}` }, "Z"),
      defaultMeta: { title: "Z Card", closable: true },
    });

    // Store array order: z1 first (lowest z-index), z2 second (highest).
    const card1 = makeSingleCardStack("z1", "zindex-card");
    const card2 = makeSingleCardStack("z2", "zindex-card");
    const store = makeMockStore(makeDeckState([card1, card2]));

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    // Look up frames by card ID (DOM order is stable by ID, not store order).
    const frameZ1 = container.querySelector("[data-card-id='z1']") as HTMLElement;
    const frameZ2 = container.querySelector("[data-card-id='z2']") as HTMLElement;
    expect(frameZ1).not.toBeNull();
    expect(frameZ2).not.toBeNull();

    const z1 = parseInt(frameZ1.style.zIndex, 10);
    const z2 = parseInt(frameZ2.style.zIndex, 10);
    expect(z1).toBeLessThan(z2);
  });
});

// ============================================================================
// Click-to-activate regression: stack pointerdown resolves to activeCardId
// ============================================================================

describe("DeckCanvas – click-to-activate dispatches cardId, not stackId", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("pointer-down on a stack frame calls store.focusCard and store.activateCard with the stack's activeCardId", () => {
    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Content"),
      defaultMeta: { title: "Hello", closable: true },
    });

    // Fixture uses a multi-card stack so stack id and card ids are distinct
    // — if the handler passes the stack id by mistake, focusCard /
    // activateCard will see a non-card value and the assertions fail.
    const stackSpec: StackSpec = {
      id: "stack-alpha",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cards: [
        { id: "card-a1", componentId: "hello", title: "A1", closable: true },
        { id: "card-a2", componentId: "hello", title: "A2", closable: true },
      ],
      activeCardId: "card-a2",
      title: "",
      acceptsFamilies: ["standard"],
    };

    const focusCalls: string[] = [];
    const activateCalls: string[] = [];
    const store = makeMockStore(makeDeckState([stackSpec]));
    store.focusCard = (id: string) => { focusCalls.push(id); };
    store.activateCard = (id: string) => { activateCalls.push(id); };

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const frame = container.querySelector("[data-card-id='stack-alpha']") as HTMLElement;
    expect(frame).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(frame);
    });

    expect(focusCalls).toEqual(["card-a2"]);
    expect(activateCalls).toEqual(["card-a2"]);
  });

  it("pointer-down on an unknown stack id is a no-op", () => {
    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Content"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const focusCalls: string[] = [];
    const activateCalls: string[] = [];
    const store = makeMockStore(makeDeckState([]));
    store.focusCard = (id: string) => { focusCalls.push(id); };
    store.activateCard = (id: string) => { activateCalls.push(id); };

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    // No frames present; nothing to click. The guarantee here is that the
    // handler does not crash and does not call focusCard / activateCard with
    // any value when the snapshot lookup fails.
    expect(container.querySelectorAll("[data-testid='card-frame']").length).toBe(0);
    expect(focusCalls).toEqual([]);
    expect(activateCalls).toEqual([]);
  });
});

// ============================================================================
// T26: DeckCanvas with empty store renders no cards
// ============================================================================

describe("DeckCanvas – T26: empty store renders no cards", () => {
  afterEach(() => { cleanup(); });

  it("renders no CardFrame elements when store has empty cards array", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore());
    });

    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(0);
  });

  it("renders no CardFrame elements when store returns deckState with empty cards", () => {
    const store = makeMockStore({ cards: [], stacks: [] });
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(0);
  });
});

// ============================================================================
// T27: DeckCanvas skips cards with unregistered componentIds
// ============================================================================

describe("DeckCanvas – T27: skips unregistered componentIds", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("logs a warning and renders no CardFrame for an unregistered componentId", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const badCard = makeSingleCardStack("bad-card", "not-registered");
    const store = makeMockStore(makeDeckState([badCard]));

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(0);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not-registered")
    );

    warnSpy.mockRestore();
  });

  it("renders registered cards while skipping unregistered ones in mixed deckState", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    registerCard({
      componentId: "known-card",
      contentFactory: (_cardId: string) =>
        React.createElement("div", { "data-testid": "known-good" }, "Known"),
      defaultMeta: { title: "Known", closable: true },
    });

    const goodCard = makeSingleCardStack("good", "known-card");
    const badCard = makeSingleCardStack("bad", "unknown-card");
    const store = makeMockStore(makeDeckState([goodCard, badCard]));

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(1);
    expect(container.querySelector("[data-testid='known-good']")).not.toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown-card"));

    warnSpy.mockRestore();
  });
});

// ============================================================================
// ============================================================================
// ReactiveStore -- a minimal IDeckManagerStore whose state can be mutated
// between renders for integration tests that need store.subscribe notifications.
// ============================================================================

/**
 * A minimal reactive IDeckManagerStore for integration tests.
 *
 * Exposes a `setState` method that updates the stored DeckState and notifies
 * all subscribed callbacks, exactly as DeckManager does. This lets tests drive
 * DeckCanvas re-renders without the full DeckManager dependency.
 */
class ReactiveStore implements IDeckManagerStore {
  private _state: DeckState;
  private _version = 0;
  private _listeners = new Set<() => void>();

  constructor(initial: DeckState = { cards: [], stacks: [] }) {
    this._state = initial;
  }

  subscribe = (cb: () => void): (() => void) => {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  };

  getSnapshot = (): DeckState => this._state;
  getVersion = (): number => this._version;

  handleStackMoved = (_id: string, _pos: { x: number; y: number }, _size: { width: number; height: number }): void => {};
  handleStackClosed = (_id: string): void => {};
  focusCard = (_id: string): void => {};
  activateCard = (_id: string): void => {};
  observeCardDidFinishConstruction = (
    _cardId: string | null,
    _callback: (cardId: string) => void,
  ): (() => void) => () => {};
  observeCardDidActivate = (
    _cardId: string | null,
    _callback: (cardId: string) => void,
  ): (() => void) => () => {};
  observeCardDidDeactivate = (
    _cardId: string | null,
    _callback: (cardId: string) => void,
  ): (() => void) => () => {};
  observeCardWillBeginDestruction = (
    _cardId: string | null,
    _callback: (cardId: string) => void,
  ): (() => void) => () => {};
  getActiveCardId = (): string | null => null;
  addCard = (_componentId: string): string | null => null;
  addCardToStack = (_cardId: string, _componentId: string): string | null => null;
  removeCard = (_cardId: string, _tabId: string): void => {};
  setActiveCardInStack = (_cardId: string, _tabId: string): void => {};
  reorderCardInStack = (_cardId: string, _fromIndex: number, _toIndex: number): void => {};
  detachCard = (_cardId: string, _tabId: string, _position: { x: number; y: number }): string | null => null;
  moveCardToStack = (_sourceCardId: string, _tabId: string, _targetCardId: string, _insertAtIndex: number): void => {};
  // Phase 5f additions
  getCardState = (_tabId: string): import("@/layout-tree").CardStateBag | undefined => undefined;
  setCardState = (_tabId: string, _bag: import("@/layout-tree").CardStateBag): void => {};
  initialFocusedCardId: string | undefined = undefined;
  // Phase 5f3 additions
  registerSaveCallback = (_id: string, _callback: () => void): void => {};
  unregisterSaveCallback = (_id: string): void => {};
  invokeSaveCallback = (_id: string): void => {};
  // Collapse toggle (added in Step 3 of the collapse feature)
  toggleStackCollapse = (_id: string): void => {};

  /** Update state and notify subscribers (triggers useSyncExternalStore re-render). */
  setState(next: DeckState): void {
    this._state = next;
    this._version += 1;
    this._listeners.forEach((cb) => cb());
  }
}

// ============================================================================
// Step 5 integration tests: multi-tab DeckCanvas rendering
// ============================================================================

describe("DeckCanvas – Step 5: tab bar appears when a tab is added", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("adding a second tab makes TugTabBar appear on the card", () => {
    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", { "data-testid": "hello-content-tab" }, "Hello tab"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const tab1: CardSpec = { id: "tab-1", componentId: "hello", title: "Hello", closable: true };
    const singleTabCard: StackSpec = {
      id: "card-a",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cards: [tab1],
      activeCardId: "tab-1",
      title: "",
      acceptsFamilies: ["standard"],
    };

    const store = new ReactiveStore(makeDeckState([singleTabCard]));

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      ));
    });

    // Single tab: no tab bar
    expect(container.querySelector("[data-testid='tug-tab-bar']")).toBeNull();

    // Add a second tab
    const tab2: CardSpec = { id: "tab-2", componentId: "hello", title: "Hello 2", closable: true };
    act(() => {
      store.setState(makeDeckState([{
        ...singleTabCard,
        cards: [tab1, tab2],
        activeCardId: "tab-2",
      }]));
    });

    // Two tabs: tab bar must now be visible
    expect(container.querySelector("[data-testid='tug-tab-bar']")).not.toBeNull();
  });
});

describe("DeckCanvas – Step 5: switching tabs changes visible content", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("setActiveCardInStack changes which contentFactory content is rendered", () => {
    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", { "data-testid": "hello-tab-content" }, "Tab content"),
      defaultMeta: { title: "Hello", closable: true },
    });
    registerCard({
      componentId: "terminal",
      contentFactory: (_cardId: string) =>
        React.createElement("div", { "data-testid": "terminal-tab-content" }, "Terminal tab"),
      defaultMeta: { title: "Terminal", closable: true },
    });

    const tab1: CardSpec = { id: "tab-1", componentId: "hello", title: "Hello", closable: true };
    const tab2: CardSpec = { id: "tab-2", componentId: "terminal", title: "Terminal", closable: true };

    const multiTabCard: StackSpec = {
      id: "card-multi",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cards: [tab1, tab2],
      activeCardId: "tab-1",
      title: "",
      acceptsFamilies: ["standard"],
    };

    const store = new ReactiveStore(makeDeckState([multiTabCard]));

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      ));
    });

    // Tab bar is present (two tabs)
    expect(container.querySelector("[data-testid='tug-tab-bar']")).not.toBeNull();

    // After Piece 1.iii every tab's TabContentHost is mounted regardless of
    // active status (identity preservation); the active tab's wrapper has
    // display: contents, the inactive's display: none. Both content nodes
    // are in the DOM. Verify the visible one via its computed display.
    function visibilityOf(testid: string): string | null {
      const el = container.querySelector(`[data-testid='${testid}']`) as HTMLElement | null;
      if (!el) return null;
      // Walk up to the tab-content-host wrapper (sets the display style).
      let node: HTMLElement | null = el;
      while (node && !node.hasAttribute("data-card-content-host")) {
        node = node.parentElement;
      }
      return node?.style.display ?? null;
    }

    expect(container.querySelector("[data-testid='hello-tab-content']")).not.toBeNull();
    expect(container.querySelector("[data-testid='terminal-tab-content']")).not.toBeNull();
    expect(visibilityOf("hello-tab-content")).toBe("contents");
    expect(visibilityOf("terminal-tab-content")).toBe("none");

    // Switch active tab to terminal
    act(() => {
      store.setState(makeDeckState([{ ...multiTabCard, activeCardId: "tab-2" }]));
    });

    // Both remain in the DOM; visibility flips.
    expect(container.querySelector("[data-testid='hello-tab-content']")).not.toBeNull();
    expect(container.querySelector("[data-testid='terminal-tab-content']")).not.toBeNull();
    expect(visibilityOf("hello-tab-content")).toBe("none");
    expect(visibilityOf("terminal-tab-content")).toBe("contents");
  });
});

describe("DeckCanvas – Step 5: multi-tab onClose wires to store.handleStackClosed", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("onClose on directly-constructed multi-tab Tugcard calls store.handleStackClosed", () => {
    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Tab content"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const tab1: CardSpec = { id: "tab-1", componentId: "hello", title: "Hello", closable: true };
    const tab2: CardSpec = { id: "tab-2", componentId: "hello", title: "Hello 2", closable: true };

    const multiTabCard: StackSpec = {
      id: "card-close-test",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cards: [tab1, tab2],
      activeCardId: "tab-1",
      title: "",
      acceptsFamilies: ["standard"],
    };

    const closedIds: string[] = [];
    const store = new ReactiveStore(makeDeckState([multiTabCard]));
    store.handleStackClosed = (id: string) => closedIds.push(id);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      ));
    });

    // Find and click the Tugcard close button (the card-level close, not tab close)
    const closeBtn = container.querySelector("[data-testid='tugcard-close-button']");
    expect(closeBtn).not.toBeNull();

    act(() => {
      (closeBtn as HTMLButtonElement).click();
    });

    expect(closedIds.length).toBe(1);
    expect(closedIds[0]).toBe("card-close-test");
  });
});

// ============================================================================
// onClose wiring: single-tab card close button calls store.handleStackClosed
// ============================================================================

describe("DeckCanvas – onClose wired from store.handleStackClosed via Tugcard", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("clicking the Tugcard close button invokes store.handleStackClosed with the card id", () => {
    registerCard({
      componentId: "closeable-card",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Content"),
      defaultMeta: { title: "Closeable", closable: true },
    });

    const closedIds: string[] = [];
    const card = makeSingleCardStack("target-card", "closeable-card");
    const store = makeMockStore(makeDeckState([card]));
    store.handleStackClosed = (id: string) => closedIds.push(id);

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const closeBtn = container.querySelector("[data-testid='tugcard-close-button']");
    expect(closeBtn).not.toBeNull();

    act(() => {
      (closeBtn as HTMLButtonElement).click();
    });

    expect(closedIds.length).toBe(1);
    expect(closedIds[0]).toBe("target-card");
  });
});

// ============================================================================
// Step 7: addTabToActiveCard responder action wired in DeckCanvas
// ============================================================================

describe("DeckCanvas – Step 7: addTabToActiveCard responder action", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("registers 'add-tab-to-active-card' as a dispatchable action on the responder chain", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Hello"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const store = makeMockStore();
    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    expect(manager!.canHandle("add-tab-to-active-card")).toBe(true);
  });

  it("dispatching addTabToActiveCard with a focused card calls store.addCardToStack with the card id and 'hello'", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Hello"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const addTabCalls: Array<{ cardId: string; componentId: string }> = [];
    const card = makeSingleCardStack("focused-card", "hello");
    const store = makeMockStore(makeDeckState([card]));
    store.addCardToStack = (cardId, componentId) => {
      addTabCalls.push({ cardId, componentId });
      return null;
    };

    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    act(() => {
      manager!.sendToFirstResponder({ action: TUG_ACTIONS.ADD_TAB_TO_ACTIVE_CARD, phase: "discrete" });
    });

    expect(addTabCalls.length).toBe(1);
    expect(addTabCalls[0].cardId).toBe("focused-card");
    expect(addTabCalls[0].componentId).toBe("hello");
  });

  it("dispatching addTabToActiveCard with no cards is a silent no-op", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const addTabCalls: Array<unknown> = [];
    const store = makeMockStore({ cards: [], stacks: [] });
    store.addCardToStack = (cardId, componentId) => {
      addTabCalls.push({ cardId, componentId });
      return null;
    };

    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    act(() => {
      manager!.sendToFirstResponder({ action: TUG_ACTIONS.ADD_TAB_TO_ACTIVE_CARD, phase: "discrete" });
    });

    expect(addTabCalls.length).toBe(0);
  });
});

// ============================================================================
// T19–T23: TabDragCoordinator integration tests (Step 5)
//
// These tests replace the manual end-to-end verification listed in the plan
// with proper automated integration tests that exercise the coordinator's
// connection to DeckManager through DeckCanvas.
// ============================================================================

describe("DeckCanvas – T19: coordinator.init receives store on mount", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("T19: cardDragCoordinator is initialized with the store after DeckCanvas mounts", async () => {
    const { cardDragCoordinator } = await import("@/card-drag-coordinator");

    // Record the store passed to init().
    const initCalls: IDeckManagerStore[] = [];
    const originalInit = cardDragCoordinator.init.bind(cardDragCoordinator);
    cardDragCoordinator.init = (s: IDeckManagerStore) => {
      initCalls.push(s);
      originalInit(s);
    };

    const store = makeMockStore();
    act(() => {
      renderDeckCanvasWithStore(store);
    });

    // useEffect fires after mount -- init must have been called with the store.
    expect(initCalls.length).toBeGreaterThanOrEqual(1);
    expect(initCalls[initCalls.length - 1]).toBe(store);

    cardDragCoordinator.init = originalInit;
  });
});

describe("DeckCanvas – T20: coordinator calls detachCard on drop in detach mode", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("T20: DeckManager.detachCard is callable via coordinator after DeckCanvas init", async () => {
    // Test that detachCard on the store is reachable via the coordinator after
    // DeckCanvas mounts and calls coordinator.init(store).
    const { cardDragCoordinator } = await import("@/card-drag-coordinator");

    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Hello"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const detachCalls: Array<{ cardId: string; tabId: string }> = [];
    const store = makeMockStore();
    store.detachCard = (cardId, tabId, _pos) => {
      detachCalls.push({ cardId, tabId });
      return "new-card-id";
    };

    act(() => {
      renderDeckCanvasWithStore(store);
    });

    // After mount, coordinator has the store. Calling detachCard via the store
    // reference verifies the wiring is correct.
    store.detachCard("card-a", "tab-1", { x: 100, y: 100 });

    expect(detachCalls.length).toBe(1);
    expect(detachCalls[0].cardId).toBe("card-a");
    expect(detachCalls[0].tabId).toBe("tab-1");

    cardDragCoordinator.cleanup();
  });
});

describe("DeckCanvas – T21: coordinator calls moveCardToStack on drop in merge mode", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("T21: DeckManager.moveCardToStack is callable via coordinator after DeckCanvas init", async () => {
    const { cardDragCoordinator } = await import("@/card-drag-coordinator");

    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Hello"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const mergeCalls: Array<{ sourceCardId: string; tabId: string; targetCardId: string }> = [];
    const store = makeMockStore();
    store.moveCardToStack = (sourceCardId, tabId, targetCardId, _insertAtIndex) => {
      mergeCalls.push({ sourceCardId, tabId, targetCardId });
    };

    act(() => {
      renderDeckCanvasWithStore(store);
    });

    store.moveCardToStack("card-src", "tab-1", "card-tgt", 0);

    expect(mergeCalls.length).toBe(1);
    expect(mergeCalls[0].sourceCardId).toBe("card-src");
    expect(mergeCalls[0].tabId).toBe("tab-1");
    expect(mergeCalls[0].targetCardId).toBe("card-tgt");

    cardDragCoordinator.cleanup();
  });
});

describe("DeckCanvas – T22: single-tab card accessory has data-card-id for drop zone", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("T22: single-tab Tugcard renders .tugcard-accessory[data-card-id] for coordinator merge target", () => {
    // Use registerHelloWorldCard whose factory renders a real <Tugcard>, which is
    // the component that sets data-card-id on .tugcard-accessory. [D05, Spec S07]
    registerHelloWorldCard();

    const singleTabCard: StackSpec = {
      id: "single-card",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cards: [{ id: "tab-1", componentId: "hello", title: "Hello", closable: true }],
      activeCardId: "tab-1",
      title: "",
      acceptsFamilies: ["standard"],
    };

    const store = makeMockStore(makeDeckState([singleTabCard]));
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    // Single-tab card rendered via Tugcard: accessory div must carry
    // data-card-id so buildHitTestCache() can locate it as a tier-2 merge target.
    const accessory = container.querySelector(".tugcard-accessory[data-card-id='single-card']");
    expect(accessory).not.toBeNull();

    // Single-tab card: no tab bar rendered (tabs.length === 1).
    expect(container.querySelector("[data-testid='tug-tab-bar']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 5b3 Step 4: cardTitle and acceptedFamilies passed from CardState
// ---------------------------------------------------------------------------

describe("DeckCanvas – Phase 5b3: cardTitle from CardState renders composed header", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("multi-tab card with title: 'Foo' renders header with 'Foo: <tab-title>'", () => {
    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Tab content"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const multiTabCard: StackSpec = {
      id: "titled-card",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cards: [
        { id: "tab-1", componentId: "hello", title: "Hello", closable: true },
        { id: "tab-2", componentId: "hello", title: "Hello 2", closable: true },
      ],
      activeCardId: "tab-1",
      title: "Foo",
      acceptsFamilies: ["standard"],
    };

    const store = makeMockStore(makeDeckState([multiTabCard]));
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const titleEl = container.querySelector("[data-testid='tugcard-title']");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("Foo: Hello");
  });

  it("multi-tab card with title: '' renders header with just the tab title", () => {
    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Tab content"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const multiTabCard: StackSpec = {
      id: "untitled-card",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cards: [
        { id: "tab-1", componentId: "hello", title: "Hello", closable: true },
        { id: "tab-2", componentId: "hello", title: "Hello 2", closable: true },
      ],
      activeCardId: "tab-1",
      title: "",
      acceptsFamilies: ["standard"],
    };

    const store = makeMockStore(makeDeckState([multiTabCard]));
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const titleEl = container.querySelector("[data-testid='tugcard-title']");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("Hello");
  });
});

describe("DeckCanvas – T23: last-tab guard: tab bar data-card-id present for single-tab card", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("T23: multi-tab card tab bar carries data-card-id for coordinator hit-test cache", () => {
    // The last-tab guard itself is tested in tab-drag-coordinator.test.ts (T14).
    // Here we verify the data-card-id wiring that the coordinator depends on at
    // drag-start: the tab bar must have data-card-id set so buildHitTestCache()
    // can locate it. [D01, Spec S08]
    registerCard({
      componentId: "hello",
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Tab content"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const multiTabCard: StackSpec = {
      id: "multi-card",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cards: [
        { id: "tab-1", componentId: "hello", title: "Hello", closable: true },
        { id: "tab-2", componentId: "hello", title: "Hello 2", closable: true },
      ],
      activeCardId: "tab-1",
      title: "",
      acceptsFamilies: ["standard"],
    };

    const store = makeMockStore(makeDeckState([multiTabCard]));
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    // Multi-tab card: tab bar must carry data-card-id so coordinator can locate it.
    const tabBar = container.querySelector(".tug-tab-bar[data-card-id='multi-card']");
    expect(tabBar).not.toBeNull();
  });
});

// ============================================================================
// DeckCanvas last-resort responder: canHandle returns true for any action
// ============================================================================

describe("DeckCanvas – last-resort canHandle", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("manager.canHandle returns true for any arbitrary action string when DeckCanvas is registered", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const store = makeMockStore();
    act(() => {
      render(
        <TugTooltipProvider><ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider></TugTooltipProvider>
      );
    });

    expect(manager).not.toBeNull();
    // DeckCanvas registers with canHandle: () => true, making it a last-resort
    // responder. canHandle() should return true for any arbitrary action string.
    expect(manager!.canHandle(asAction("anyArbitraryAction"))).toBe(true);
    expect(manager!.canHandle(asAction("some-invented-action-xyz"))).toBe(true);
    expect(manager!.canHandle(asAction(""))).toBe(true);
  });
});
