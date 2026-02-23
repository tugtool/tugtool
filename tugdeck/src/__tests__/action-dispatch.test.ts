import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { initActionDispatch, dispatchAction, _resetForTest } from "../action-dispatch";

// Mock DeckManager that records method calls
function createMockDeckManager() {
  const calls: { method: string; args: any[] }[] = [];
  const cardRegistry = new Map<string, any>();
  return {
    calls,
    cardRegistry,
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
    getCardRegistry() {
      return this.cardRegistry;
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

describe("action-dispatch: dev_notification", () => {
  let mockDeck: ReturnType<typeof createMockDeckManager>;
  let badgeEvents: Array<{ componentId: string; count: number }> = [];
  let badgeListener: ((e: Event) => void) | null = null;

  beforeEach(() => {
    _resetForTest();
    mockDeck = createMockDeckManager();
    const mockConn = createMockConnection();
    initActionDispatch(mockConn as any, mockDeck as any);

    // Clear and setup badge listener
    badgeEvents = [];
    if (badgeListener) {
      document.removeEventListener("td-dev-badge", badgeListener);
    }
    badgeListener = (e: Event) => {
      const customEvent = e as CustomEvent;
      badgeEvents.push(customEvent.detail);
    };
    document.addEventListener("td-dev-badge", badgeListener);
  });

  afterEach(() => {
    if (badgeListener) {
      document.removeEventListener("td-dev-badge", badgeListener);
      badgeListener = null;
    }
  });

  it("should route to card.update() when developer card is open", () => {
    const mockCard = {
      update: (payload: any) => {
        (mockCard as any).lastUpdate = payload;
      },
    };

    // Setup panel and card state
    const panel = { id: "p1" };
    const tabId = "tab1";
    mockDeck._panelResult = panel;
    mockDeck._deckState = {
      cards: [{
        id: "p1",
        tabItems: [{ id: tabId, componentId: "developer" }],
      }],
    };
    mockDeck.cardRegistry.set(tabId, mockCard);

    dispatchAction({
      action: "dev_notification",
      type: "restart_available",
      count: 3,
    });

    expect((mockCard as any).lastUpdate).toEqual({
      action: "dev_notification",
      type: "restart_available",
      count: 3,
    });
  });

  it("should dispatch badge event when card closed and type is restart_available", () => {
    mockDeck._panelResult = null; // Card closed

    dispatchAction({
      action: "dev_notification",
      type: "restart_available",
      count: 5,
    });

    expect(badgeEvents.length).toBe(1);
    expect(badgeEvents[0].count).toBe(5);
  });

  it("should dispatch badge event when card closed and type is relaunch_available", () => {
    mockDeck._panelResult = null; // Card closed

    dispatchAction({
      action: "dev_notification",
      type: "relaunch_available",
      count: 2,
    });

    expect(badgeEvents.length).toBe(1);
    expect(badgeEvents[0].count).toBe(2);
  });

  it("should not dispatch badge event when card closed and type is reloaded", () => {
    mockDeck._panelResult = null; // Card closed

    dispatchAction({
      action: "dev_notification",
      type: "reloaded",
      changes: ["styles.css"],
    });

    // reloaded type should not set badge when card is closed (clean state)
    expect(badgeEvents.length).toBe(0);
  });

  it("should not crash when card exists but has no update method", () => {
    const mockCard = {}; // No update method

    const panel = { id: "p1" };
    const tabId = "tab1";
    mockDeck._panelResult = panel;
    mockDeck._deckState = {
      cards: [{
        id: "p1",
        tabItems: [{ id: tabId, componentId: "developer" }],
      }],
    };
    mockDeck.cardRegistry.set(tabId, mockCard);

    expect(() => {
      dispatchAction({
        action: "dev_notification",
        type: "restart_available",
        count: 1,
      });
    }).not.toThrow();
  });
});

describe("action-dispatch: dev_build_progress", () => {
  let mockDeck: ReturnType<typeof createMockDeckManager>;

  beforeEach(() => {
    _resetForTest();
    mockDeck = createMockDeckManager();
    const mockConn = createMockConnection();
    initActionDispatch(mockConn as any, mockDeck as any);
  });

  it("should route to card.updateBuildProgress() when developer card is open", () => {
    const mockCard = {
      updateBuildProgress: (payload: any) => {
        (mockCard as any).lastBuildProgress = payload;
      },
    };

    // Setup panel and card state
    const panel = { id: "p1" };
    const tabId = "tab1";
    mockDeck._panelResult = panel;
    mockDeck._deckState = {
      cards: [{
        id: "p1",
        tabItems: [{ id: tabId, componentId: "developer" }],
      }],
    };
    mockDeck.cardRegistry.set(tabId, mockCard);

    dispatchAction({
      action: "dev_build_progress",
      stage: "compile",
      status: "running",
    });

    expect((mockCard as any).lastBuildProgress).toEqual({
      action: "dev_build_progress",
      stage: "compile",
      status: "running",
    });
  });

  it("should be no-op when developer card is closed", () => {
    mockDeck._panelResult = null; // Card closed

    // Should not crash
    expect(() => {
      dispatchAction({
        action: "dev_build_progress",
        stage: "compile",
        status: "done",
      });
    }).not.toThrow();
  });

  it("should not crash when card exists but has no updateBuildProgress method", () => {
    const mockCard = {}; // No updateBuildProgress method

    const panel = { id: "p1" };
    const tabId = "tab1";
    mockDeck._panelResult = panel;
    mockDeck._deckState = {
      cards: [{
        id: "p1",
        tabItems: [{ id: tabId, componentId: "developer" }],
      }],
    };
    mockDeck.cardRegistry.set(tabId, mockCard);

    expect(() => {
      dispatchAction({
        action: "dev_build_progress",
        stage: "test",
        status: "running",
      });
    }).not.toThrow();
  });
});
