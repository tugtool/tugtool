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
 * - onClose wiring: DeckCanvas injects onClose from store.handleCardClosed
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach, beforeEach, spyOn } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { DeckManagerContext } from "@/deck-manager-context";
import { DeckCanvas } from "@/components/chrome/deck-canvas";
import { registerCard, _resetForTest } from "@/card-registry";
import type { CardState, DeckState, TabItem } from "@/layout-tree";
import type { IDeckManagerStore } from "@/deck-manager-store";
import type { CardFrameInjectedProps } from "@/components/chrome/card-frame";

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
 * - no-op handleCardMoved, handleCardClosed, handleCardFocused
 *
 * Override individual fields with spies for tests that need callback assertions.
 */
function makeMockStore(deckState: DeckState = { cards: [] }): IDeckManagerStore {
  return {
    subscribe: (_cb: () => void) => () => {},
    getSnapshot: () => deckState,
    getVersion: () => 0,
    handleCardMoved: (_id: string, _pos: { x: number; y: number }, _size: { width: number; height: number }) => {},
    handleCardClosed: (_id: string) => {},
    handleCardFocused: (_id: string) => {},
    addTab: (_cardId: string, _componentId: string) => null,
    removeTab: (_cardId: string, _tabId: string) => {},
    setActiveTab: (_cardId: string, _tabId: string) => {},
  };
}

// ---- Primary render helper ----

/**
 * Render DeckCanvas inside both ResponderChainProvider and DeckManagerContext.Provider.
 * Every DeckCanvas render requires both providers after the Phase 5a2 migration.
 */
function renderDeckCanvasWithStore(
  store?: IDeckManagerStore,
  connection: import("@/connection").TugConnection | null = null,
) {
  const resolvedStore = store ?? makeMockStore();
  return render(
    <ResponderChainProvider>
      <DeckManagerContext.Provider value={resolvedStore}>
        <DeckCanvas connection={connection} />
      </DeckManagerContext.Provider>
    </ResponderChainProvider>
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

/** Build a minimal CardState for a given componentId. */
function makeCardState(id: string, componentId: string): CardState {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    tabs: [{ id: `${id}-tab`, componentId, title: componentId, closable: true }],
    activeTabId: `${id}-tab`,
  };
}

/** Build a DeckState from an array of CardState. */
function makeDeckState(cards: CardState[]): DeckState {
  return { cards };
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
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
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
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      );
    });

    expect(manager!.canHandle("cycleCard")).toBe(true);
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
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      );
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const handled = manager!.dispatch("cycleCard");
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
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      );
    });

    const handled = manager!.dispatch("cycleCard");
    expect(handled).toBe(true);
  });
});

// ============================================================================
// Action handlers: showComponentGallery
// ============================================================================

describe("DeckCanvas – showComponentGallery action", () => {
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
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      );
    });

    let handled = false;
    act(() => {
      handled = manager!.dispatch("showComponentGallery");
    });
    expect(handled).toBe(true);
  });

  it("showComponentGallery toggles gallery visibility", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    const store = makeMockStore();
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      ));
    });

    expect(container.querySelector(".cg-panel")).toBeNull();

    act(() => {
      manager!.dispatch("showComponentGallery");
    });
    expect(container.querySelector(".cg-panel")).not.toBeNull();

    act(() => {
      manager!.dispatch("showComponentGallery");
    });
    expect(container.querySelector(".cg-panel")).toBeNull();
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
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
            <ManagerCapture />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      );
    });

    expect(manager!.canHandle("cycleCard")).toBe(true);

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
      factory: (cardId, _injected) =>
        React.createElement("div", { "data-testid": `mock-card-content-${cardId}` }, "Mock"),
      defaultMeta: { title: "Mock Card", closable: true },
    });

    const card1 = makeCardState("card-a", "mock-card");
    const card2 = makeCardState("card-b", "mock-card");
    const store = makeMockStore(makeDeckState([card1, card2]));

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(2);

    expect(container.querySelector("[data-testid='mock-card-content-card-a']")).not.toBeNull();
    expect(container.querySelector("[data-testid='mock-card-content-card-b']")).not.toBeNull();
  });

  it("assigns ascending z-index by store array position", () => {
    registerCard({
      componentId: "zindex-card",
      factory: (cardId, _injected) =>
        React.createElement("div", { "data-testid": `zcard-${cardId}` }, "Z"),
      defaultMeta: { title: "Z Card", closable: true },
    });

    // Store array order: z1 first (lowest z-index), z2 second (highest).
    const card1 = makeCardState("z1", "zindex-card");
    const card2 = makeCardState("z2", "zindex-card");
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
    const store = makeMockStore({ cards: [] });
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

    const badCard = makeCardState("bad-card", "not-registered");
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
      factory: (cardId, _injected) =>
        React.createElement("div", { "data-testid": `known-${cardId}` }, "Known"),
      defaultMeta: { title: "Known", closable: true },
    });

    const goodCard = makeCardState("good", "known-card");
    const badCard = makeCardState("bad", "unknown-card");
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
// onClose wiring: store.handleCardClosed is called via cloneElement injection
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

  constructor(initial: DeckState = { cards: [] }) {
    this._state = initial;
  }

  subscribe = (cb: () => void): (() => void) => {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  };

  getSnapshot = (): DeckState => this._state;
  getVersion = (): number => this._version;

  handleCardMoved = (_id: string, _pos: { x: number; y: number }, _size: { width: number; height: number }): void => {};
  handleCardClosed = (_id: string): void => {};
  handleCardFocused = (_id: string): void => {};
  addTab = (_cardId: string, _componentId: string): string | null => null;
  removeTab = (_cardId: string, _tabId: string): void => {};
  setActiveTab = (_cardId: string, _tabId: string): void => {};

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
      factory: (_cardId, _injected: CardFrameInjectedProps) =>
        React.createElement("div", { "data-testid": "hello-content" }, "Hello"),
      contentFactory: (_cardId: string) =>
        React.createElement("div", { "data-testid": "hello-content-tab" }, "Hello tab"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const tab1: TabItem = { id: "tab-1", componentId: "hello", title: "Hello", closable: true };
    const singleTabCard: CardState = {
      id: "card-a",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [tab1],
      activeTabId: "tab-1",
    };

    const store = new ReactiveStore({ cards: [singleTabCard] });

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      ));
    });

    // Single tab: no tab bar
    expect(container.querySelector("[data-testid='tug-tab-bar']")).toBeNull();

    // Add a second tab
    const tab2: TabItem = { id: "tab-2", componentId: "hello", title: "Hello 2", closable: true };
    act(() => {
      store.setState({
        cards: [{
          ...singleTabCard,
          tabs: [tab1, tab2],
          activeTabId: "tab-2",
        }],
      });
    });

    // Two tabs: tab bar must now be visible
    expect(container.querySelector("[data-testid='tug-tab-bar']")).not.toBeNull();
  });
});

describe("DeckCanvas – Step 5: switching tabs changes visible content", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("setActiveTab changes which contentFactory content is rendered", () => {
    registerCard({
      componentId: "hello",
      factory: (_cardId, _injected: CardFrameInjectedProps) =>
        React.createElement("div", { "data-testid": "hello-factory" }, "Factory"),
      contentFactory: (_cardId: string) =>
        React.createElement("div", { "data-testid": "hello-tab-content" }, "Tab content"),
      defaultMeta: { title: "Hello", closable: true },
    });
    registerCard({
      componentId: "terminal",
      factory: (_cardId, _injected: CardFrameInjectedProps) =>
        React.createElement("div", { "data-testid": "terminal-factory" }, "Terminal"),
      contentFactory: (_cardId: string) =>
        React.createElement("div", { "data-testid": "terminal-tab-content" }, "Terminal tab"),
      defaultMeta: { title: "Terminal", closable: true },
    });

    const tab1: TabItem = { id: "tab-1", componentId: "hello", title: "Hello", closable: true };
    const tab2: TabItem = { id: "tab-2", componentId: "terminal", title: "Terminal", closable: true };

    const multiTabCard: CardState = {
      id: "card-multi",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [tab1, tab2],
      activeTabId: "tab-1",
    };

    const store = new ReactiveStore({ cards: [multiTabCard] });

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      ));
    });

    // Tab bar is present (two tabs)
    expect(container.querySelector("[data-testid='tug-tab-bar']")).not.toBeNull();
    // Hello contentFactory content is rendered (activeTabId = tab-1)
    expect(container.querySelector("[data-testid='hello-tab-content']")).not.toBeNull();

    // Switch active tab to terminal
    act(() => {
      store.setState({
        cards: [{ ...multiTabCard, activeTabId: "tab-2" }],
      });
    });

    // Terminal contentFactory content now rendered
    expect(container.querySelector("[data-testid='terminal-tab-content']")).not.toBeNull();
    // Hello content is no longer in DOM (inactive tab unmounts -- D04)
    expect(container.querySelector("[data-testid='hello-tab-content']")).toBeNull();
  });
});

describe("DeckCanvas – Step 5: single-tab card uses existing factory path", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("single-tab card renders via factory (not contentFactory), backward compatible", () => {
    let factoryCalled = false;
    let contentFactoryCalled = false;

    registerCard({
      componentId: "hello",
      factory: (_cardId, _injected: CardFrameInjectedProps) => {
        factoryCalled = true;
        return React.createElement("div", { "data-testid": "factory-output" }, "From factory");
      },
      contentFactory: (_cardId: string) => {
        contentFactoryCalled = true;
        return React.createElement("div", { "data-testid": "content-factory-output" }, "From contentFactory");
      },
      defaultMeta: { title: "Hello", closable: true },
    });

    const singleTabCard: CardState = {
      id: "card-single",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [{ id: "tab-1", componentId: "hello", title: "Hello", closable: true }],
      activeTabId: "tab-1",
    };

    const store = new ReactiveStore({ cards: [singleTabCard] });

    act(() => {
      render(
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      );
    });

    // Single-tab card: factory must have been called, contentFactory must NOT
    expect(factoryCalled).toBe(true);
    expect(contentFactoryCalled).toBe(false);
  });
});

describe("DeckCanvas – Step 5: multi-tab onClose wires to store.handleCardClosed", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("onClose on directly-constructed multi-tab Tugcard calls store.handleCardClosed", () => {
    registerCard({
      componentId: "hello",
      factory: (_cardId, _injected: CardFrameInjectedProps) =>
        React.createElement("div", {}, "Factory"),
      contentFactory: (_cardId: string) =>
        React.createElement("div", {}, "Tab content"),
      defaultMeta: { title: "Hello", closable: true },
    });

    const tab1: TabItem = { id: "tab-1", componentId: "hello", title: "Hello", closable: true };
    const tab2: TabItem = { id: "tab-2", componentId: "hello", title: "Hello 2", closable: true };

    const multiTabCard: CardState = {
      id: "card-close-test",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [tab1, tab2],
      activeTabId: "tab-1",
    };

    const closedIds: string[] = [];
    const store = new ReactiveStore({ cards: [multiTabCard] });
    store.handleCardClosed = (id: string) => closedIds.push(id);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas connection={null} />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      ));
    });

    // Find and click the Tugcard close button (the card-level close, not tab close)
    const closeBtn = container.querySelector("[data-testid='tugcard-close-btn']");
    expect(closeBtn).not.toBeNull();

    act(() => {
      (closeBtn as HTMLButtonElement).click();
    });

    expect(closedIds.length).toBe(1);
    expect(closedIds[0]).toBe("card-close-test");
  });
});

// ============================================================================
// onClose wiring: store.handleCardClosed is called via cloneElement injection
// ============================================================================

describe("DeckCanvas – onClose wired from store.handleCardClosed via cloneElement", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("calling onClose on the produced element invokes store.handleCardClosed with the card id", () => {
    // Factory produces a component that exposes onClose via a test button.
    // DeckCanvas injects the real onClose via React.cloneElement from
    // store.handleCardClosed.
    function Closeable({ onClose }: { onClose?: () => void }) {
      return React.createElement(
        "button",
        { "data-testid": "close-trigger", onClick: onClose },
        "close"
      );
    }

    registerCard({
      componentId: "closeable-card",
      factory: (_cardId, _injected: CardFrameInjectedProps) =>
        React.createElement(Closeable, {}),
      defaultMeta: { title: "Closeable", closable: true },
    });

    const closedIds: string[] = [];
    const card = makeCardState("target-card", "closeable-card");
    const store = makeMockStore(makeDeckState([card]));
    // Override handleCardClosed with a spy
    store.handleCardClosed = (id: string) => closedIds.push(id);

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const btn = container.querySelector("[data-testid='close-trigger']");
    expect(btn).not.toBeNull();

    act(() => {
      (btn as HTMLButtonElement).click();
    });

    expect(closedIds.length).toBe(1);
    expect(closedIds[0]).toBe("target-card");
  });
});
