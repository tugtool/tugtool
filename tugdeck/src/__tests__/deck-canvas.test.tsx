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
 * - DeckCanvas responder handles cyclePanel action
 * - DeckCanvas responder handles showComponentGallery action
 * - Ctrl+` keyboard shortcut triggers cyclePanel via key pipeline (integration)
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
import type { CardState, DeckState } from "@/layout-tree";
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

    expect(manager!.canHandle("cyclePanel")).toBe(true);
  });
});

// ============================================================================
// Action handlers: cyclePanel
// ============================================================================

describe("DeckCanvas – cyclePanel action", () => {
  it("handles cyclePanel action (dispatch returns true)", () => {
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
    const handled = manager!.dispatch("cyclePanel");
    expect(handled).toBe(true);
    logSpy.mockRestore();
  });

  it("cyclePanel with no cards is a silent no-op", () => {
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

    const handled = manager!.dispatch("cyclePanel");
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
// Integration: Ctrl+` key pipeline triggers cyclePanel
// ============================================================================

describe("DeckCanvas – Ctrl+` key pipeline integration", () => {
  it("Ctrl+` fires cyclePanel through the key pipeline", () => {
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

    expect(manager!.canHandle("cyclePanel")).toBe(true);

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

  it("assigns ascending z-index by array position", () => {
    registerCard({
      componentId: "zindex-card",
      factory: (cardId, _injected) =>
        React.createElement("div", { "data-testid": `zcard-${cardId}` }, "Z"),
      defaultMeta: { title: "Z Card", closable: true },
    });

    const card1 = makeCardState("z1", "zindex-card");
    const card2 = makeCardState("z2", "zindex-card");
    const store = makeMockStore(makeDeckState([card1, card2]));

    let container!: HTMLElement;
    act(() => {
      ({ container } = renderDeckCanvasWithStore(store));
    });

    const frames = Array.from(container.querySelectorAll("[data-testid='card-frame']")) as HTMLElement[];
    expect(frames.length).toBe(2);

    const z1 = parseInt(frames[0].style.zIndex, 10);
    const z2 = parseInt(frames[1].style.zIndex, 10);
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
