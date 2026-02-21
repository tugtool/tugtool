import { describe, it, expect, beforeEach } from "bun:test";
import { initActionDispatch, dispatchAction, _resetForTest } from "../action-dispatch";

// Mock DeckManager that records method calls
function createMockDeckManager() {
  const calls: { method: string; args: any[] }[] = [];
  return {
    calls,
    addNewCard(componentId: string) {
      calls.push({ method: "addNewCard", args: [componentId] });
    },
    findPanelByComponent(_componentId: string) {
      // Return based on test setup (controlled per test)
      return (this as any)._panelResult ?? null;
    },
    focusPanel(panelId: string) {
      calls.push({ method: "focusPanel", args: [panelId] });
    },
    closePanelByComponent(componentId: string) {
      calls.push({ method: "closePanelByComponent", args: [componentId] });
    },
    getDeckState() {
      return (this as any)._deckState ?? { cards: [] };
    },
    // Allow tests to set return values
    _panelResult: null as any,
    _deckState: { cards: [] } as any,
  };
}

// Mock TugConnection (initActionDispatch registers onFrame callback)
function createMockConnection() {
  return {
    onFrame(_feedId: number, _cb: (payload: Uint8Array) => void): void {},
  };
}

describe("action-dispatch: show-card", () => {
  let mockDeck: ReturnType<typeof createMockDeckManager>;

  beforeEach(() => {
    _resetForTest();
    mockDeck = createMockDeckManager();
    const mockConn = createMockConnection();
    initActionDispatch(mockConn as any, mockDeck as any);
  });

  it("should call addNewCard when no card exists", () => {
    mockDeck._panelResult = null;
    dispatchAction({ action: "show-card", component: "test" });
    expect(mockDeck.calls).toContainEqual({ method: "addNewCard", args: ["test"] });
  });

  it("should call closePanelByComponent when card is topmost (toggle off)", () => {
    const panel = {
      id: "p1",
      tabs: [],
      activeTabId: "",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
    };
    mockDeck._panelResult = panel;
    mockDeck._deckState = { cards: [panel] }; // Only card -> it's topmost (last in array)
    dispatchAction({ action: "show-card", component: "test" });
    expect(mockDeck.calls).toContainEqual({ method: "closePanelByComponent", args: ["test"] });
  });

  it("should call focusPanel when card exists but is not topmost", () => {
    const panel = {
      id: "p1",
      tabs: [],
      activeTabId: "",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
    };
    const other = {
      id: "p2",
      tabs: [],
      activeTabId: "",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
    };
    mockDeck._panelResult = panel;
    mockDeck._deckState = { cards: [panel, other] }; // panel is NOT last -> not topmost
    dispatchAction({ action: "show-card", component: "test" });
    expect(mockDeck.calls).toContainEqual({ method: "focusPanel", args: ["p1"] });
  });
});

describe("action-dispatch: close-card", () => {
  let mockDeck: ReturnType<typeof createMockDeckManager>;

  beforeEach(() => {
    _resetForTest();
    mockDeck = createMockDeckManager();
    const mockConn = createMockConnection();
    initActionDispatch(mockConn as any, mockDeck as any);
  });

  it("should call closePanelByComponent when card exists", () => {
    dispatchAction({ action: "close-card", component: "test" });
    expect(mockDeck.calls).toContainEqual({ method: "closePanelByComponent", args: ["test"] });
  });

  it("should not throw when component does not exist", () => {
    // closePanelByComponent is a no-op internally when panel not found
    expect(() => dispatchAction({ action: "close-card", component: "nonexistent" })).not.toThrow();
  });
});
