/**
 * DeckCanvas tests -- Steps 5 and 6.
 *
 * Steps 5 tests cover:
 * - DeckCanvas registers as responder "deck-canvas" on mount
 * - DeckCanvas is auto-promoted to first responder (root node, no prior first responder)
 * - DeckCanvas responder handles cyclePanel action
 * - DeckCanvas responder handles showComponentGallery action
 * - Ctrl+` keyboard shortcut triggers cyclePanel via key pipeline (integration)
 *
 * Step 6 tests (T25, T26, T27) cover:
 * - T25: DeckCanvas renders cards from deckState prop
 * - T26: DeckCanvas with no deckState prop renders empty (backward compat)
 * - T27: DeckCanvas skips cards with unregistered componentIds (warning logged)
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach, beforeEach, spyOn } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { DeckCanvas } from "@/components/chrome/deck-canvas";
import { registerCard, _resetForTest } from "@/card-registry";
import type { CardState, DeckState } from "@/layout-tree";
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

// ---- Helper: render DeckCanvas inside ResponderChainProvider ----

function renderDeckCanvas() {
  const result = render(
    <ResponderChainProvider>
      <DeckCanvas connection={null} />
    </ResponderChainProvider>
  );
  return result;
}

// ---- Helpers for simulating keyboard events ----

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

// ============================================================================
// Registration: DeckCanvas registers as root responder
// ============================================================================

describe("DeckCanvas – responder registration", () => {
  it("DeckCanvas renders inside ResponderChainProvider without errors", () => {
    const { container } = renderDeckCanvas();
    // DeckCanvas renders a ResponderScope (a Provider), not a visible element itself.
    // We just verify it renders without throwing.
    expect(container).not.toBeNull();
  });

  it("DeckCanvas auto-promotes to first responder on mount (root node)", () => {
    // We need to access the manager to query first responder.
    // The easiest way is to render a consumer alongside DeckCanvas.
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    act(() => {
      render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} />
          <ManagerCapture />
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

    act(() => {
      render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} />
          <ManagerCapture />
        </ResponderChainProvider>
      );
    });

    // canHandle on a registered action should return true
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

    act(() => {
      render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} />
          <ManagerCapture />
        </ResponderChainProvider>
      );
    });

    // Suppress the console.log stub output
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    const handled = manager!.dispatch("cyclePanel");
    expect(handled).toBe(true);

    logSpy.mockRestore();
  });

  it("cyclePanel handler logs a stub message", () => {
    const { useResponderChain } = require("@/components/tugways/responder-chain-provider");
    let manager: import("@/components/tugways/responder-chain").ResponderChainManager | null = null;

    function ManagerCapture() {
      manager = useResponderChain();
      return null;
    }

    act(() => {
      render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} />
          <ManagerCapture />
        </ResponderChainProvider>
      );
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    manager!.dispatch("cyclePanel");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("cyclePanel"));
    logSpy.mockRestore();
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

    act(() => {
      render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} />
          <ManagerCapture />
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

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} />
          <ManagerCapture />
        </ResponderChainProvider>
      ));
    });

    // Gallery should be hidden initially
    expect(container.querySelector(".cg-panel")).toBeNull();

    // Dispatch showComponentGallery to toggle gallery on
    act(() => {
      manager!.dispatch("showComponentGallery");
    });
    expect(container.querySelector(".cg-panel")).not.toBeNull();

    // Dispatch again to toggle gallery off
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
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    act(() => {
      render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} />
        </ResponderChainProvider>
      );
    });

    act(() => {
      fireKeydown({ code: "Backquote", ctrlKey: true });
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("cyclePanel"));
    logSpy.mockRestore();
  });

  void makeMockConnection; // suppress unused import warning
});

// ============================================================================
// Step 6: DeckCanvas renders CardFrame components from DeckState
// ============================================================================

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

// ---- T25: DeckCanvas renders cards from deckState prop ----

describe("DeckCanvas – T25: renders cards from deckState prop", () => {
  // Reset the registry before each test for isolation.
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders a CardFrame for each registered card in deckState", () => {
    // Register a simple div factory for componentId "mock-card"
    registerCard({
      componentId: "mock-card",
      factory: (cardId, _injected) =>
        React.createElement("div", { "data-testid": `mock-card-content-${cardId}` }, "Mock"),
      defaultMeta: { title: "Mock Card", closable: true },
    });

    const card1 = makeCardState("card-a", "mock-card");
    const card2 = makeCardState("card-b", "mock-card");
    const deckState = makeDeckState([card1, card2]);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} deckState={deckState} />
        </ResponderChainProvider>
      ));
    });

    // Both cards should render a card-frame div
    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(2);

    // Factory content is rendered inside frames
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
    const deckState = makeDeckState([card1, card2]);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} deckState={deckState} />
        </ResponderChainProvider>
      ));
    });

    const frames = Array.from(container.querySelectorAll("[data-testid='card-frame']")) as HTMLElement[];
    expect(frames.length).toBe(2);

    const z1 = parseInt(frames[0].style.zIndex, 10);
    const z2 = parseInt(frames[1].style.zIndex, 10);
    // First card gets lower z-index than second card
    expect(z1).toBeLessThan(z2);
  });
});

// ---- T26: DeckCanvas with no deckState renders empty (backward compat) ----

describe("DeckCanvas – T26: no deckState renders empty", () => {
  afterEach(() => { cleanup(); });

  it("renders no CardFrame elements when deckState is omitted", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} />
        </ResponderChainProvider>
      ));
    });

    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(0);
  });

  it("renders no CardFrame elements when deckState has empty cards array", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} deckState={{ cards: [] }} />
        </ResponderChainProvider>
      ));
    });

    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(0);
  });
});

// ---- T27: DeckCanvas skips cards with unregistered componentIds ----

describe("DeckCanvas – T27: skips unregistered componentIds", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("logs a warning and renders no CardFrame for an unregistered componentId", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const badCard = makeCardState("bad-card", "not-registered");
    const deckState = makeDeckState([badCard]);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} deckState={deckState} />
        </ResponderChainProvider>
      ));
    });

    // No CardFrame rendered
    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(0);

    // Warning logged about unregistered componentId
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
    const deckState = makeDeckState([goodCard, badCard]);

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckCanvas connection={null} deckState={deckState} />
        </ResponderChainProvider>
      ));
    });

    // Only the registered card renders a CardFrame
    const frames = container.querySelectorAll("[data-testid='card-frame']");
    expect(frames.length).toBe(1);
    expect(container.querySelector("[data-testid='known-good']")).not.toBeNull();

    // Warning issued for the unknown one
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown-card"));

    warnSpy.mockRestore();
  });
});

// ---- onClose wiring: DeckCanvas injects onClose via cloneElement ----

describe("DeckCanvas – onClose wired from factory through cloneElement to onCardClosed", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("calling onClose on the produced element invokes onCardClosed with the card id", () => {
    // Factory produces a component that exposes onClose via a test button.
    // DeckCanvas injects the real onClose via React.cloneElement.
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

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <DeckCanvas
            connection={null}
            deckState={makeDeckState([card])}
            onCardClosed={(id) => closedIds.push(id)}
          />
        </ResponderChainProvider>
      ));
    });

    // Click the test button which fires onClose (injected by DeckCanvas)
    const btn = container.querySelector("[data-testid='close-trigger']");
    expect(btn).not.toBeNull();

    act(() => {
      (btn as HTMLButtonElement).click();
    });

    // onCardClosed should have been called with the card's id
    expect(closedIds.length).toBe(1);
    expect(closedIds[0]).toBe("target-card");
  });
});
