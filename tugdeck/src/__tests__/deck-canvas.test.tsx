/**
 * DeckCanvas responder chain tests -- Step 5.
 *
 * Tests cover:
 * - DeckCanvas registers as responder "deck-canvas" on mount
 * - DeckCanvas is auto-promoted to first responder (root node, no prior first responder)
 * - DeckCanvas responder handles cyclePanel action
 * - DeckCanvas responder handles showComponentGallery action
 * - Ctrl+` keyboard shortcut triggers cyclePanel via key pipeline (integration)
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach, spyOn } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { DeckCanvas } from "@/components/chrome/deck-canvas";

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
