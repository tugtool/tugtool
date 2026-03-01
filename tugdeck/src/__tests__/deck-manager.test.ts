import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { act } from "react";
import { Window } from "happy-dom";
import { DeckManager } from "../deck-manager";
import type { TugCard, TugCardMeta } from "../cards/card";
import type { FeedIdValue } from "../protocol";

// Setup DOM environment
const window = new Window();
global.window = window as any;
global.document = window.document as any;
global.localStorage = window.localStorage as any;
global.crypto = window.crypto as any;

// Mock ResizeObserver (not provided by happy-dom)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

// Signal to React that we are in a test environment
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// Suppress React act() warnings from Radix UI internal animations
// (card chrome includes dropdown menus backed by Radix).
const _origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("was not wrapped in act(")) {
    return;
  }
  _origConsoleError.call(console, ...args);
};

// Minimal mock TugConnection
class MockConnection {
  onFrame(_feedId: number, _cb: (payload: Uint8Array) => void): void {}
  onOpen(_cb: () => void): void {}
  onClose(_cb: () => void): () => void {
    return () => {};
  }
  send(_feedId: number, _payload: Uint8Array): void {}
  sendControlFrame(_action: string, _params?: Record<string, unknown>): void {}
}

// Minimal mock TugCard
function createMockCard(): TugCard {
  return {
    feedIds: [] as readonly FeedIdValue[],
    get meta(): TugCardMeta {
      return { title: "Test", icon: "Test", closable: true, menuItems: [] };
    },
    mount(_container: HTMLElement): void {},
    onFrame(_feedId: FeedIdValue, _payload: Uint8Array): void {},
    onResize(_w: number, _h: number): void {},
    destroy(): void {},
  };
}

describe("DeckManager.closePanelByComponent", () => {
  let deck: DeckManager;
  let container: HTMLElement;

  beforeEach(() => {
    // happy-dom provides document/window
    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "600px";
    // Mock clientWidth/clientHeight (happy-dom may not compute layout)
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    document.body.appendChild(container);

    const connection = new MockConnection();
    act(() => {
      deck = new DeckManager(container, connection as any);
    });
    deck.registerCardFactory("test-card", () => createMockCard());
  });

  afterEach(() => {
    act(() => {
      document.body.innerHTML = "";
    });
  });

  it("should remove a card that was added via addNewCard", () => {
    act(() => { deck.addNewCard("test-card"); });
    // Verify card exists
    const panel = deck.findPanelByComponent("test-card");
    expect(panel).not.toBeNull();

    // Now close it
    act(() => { deck.closePanelByComponent("test-card"); });

    // Verify card is gone
    const panelAfter = deck.findPanelByComponent("test-card");
    expect(panelAfter).toBeNull();
  });

  it("should be a no-op when component does not exist", () => {
    // Should not throw
    act(() => { deck.closePanelByComponent("nonexistent"); });
    expect(deck.findPanelByComponent("nonexistent")).toBeNull();
  });
});
