import { describe, it, expect, beforeEach } from "bun:test";
import { initActionDispatch, dispatchAction, _resetForTest } from "../action-dispatch";
import type { DevNotificationRef } from "../contexts/dev-notification-context";

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

// Mock DevNotificationRef for verifying context-based notification flow
function createMockDevNotificationRef() {
  const calls: { method: string; args: any[] }[] = [];
  const ref: { current: DevNotificationRef | null } = {
    current: {
      notify: (payload: Record<string, unknown>) => {
        calls.push({ method: "notify", args: [payload] });
      },
      updateBuildProgress: (payload: Record<string, unknown>) => {
        calls.push({ method: "updateBuildProgress", args: [payload] });
      },
      setBadge: (componentId: string, count: number) => {
        calls.push({ method: "setBadge", args: [componentId, count] });
      },
    },
  };
  return { ref, calls };
}

describe("action-dispatch: show-card", () => {
  let mockDeck: ReturnType<typeof createMockDeckManager>;

  beforeEach(() => {
    _resetForTest();
    mockDeck = createMockDeckManager();
    const mockConn = createMockConnection();
    const mockDevRef = createMockDevNotificationRef();
    initActionDispatch(mockConn as any, mockDeck as any, mockDevRef.ref);
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
    const mockDevRef = createMockDevNotificationRef();
    initActionDispatch(mockConn as any, mockDeck as any, mockDevRef.ref);
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
  let mockDevRef: ReturnType<typeof createMockDevNotificationRef>;

  beforeEach(() => {
    _resetForTest();
    mockDeck = createMockDeckManager();
    mockDevRef = createMockDevNotificationRef();
    const mockConn = createMockConnection();
    initActionDispatch(mockConn as any, mockDeck as any, mockDevRef.ref);
  });

  it("should route to card.update() when developer card is open (vanilla card)", () => {
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
        tabs: [{ id: tabId, componentId: "developer" }],
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

  it("should call devNotificationRef.notify() when React card is open (no update method)", () => {
    const mockCard = {}; // React card adapter: no update method

    const panel = { id: "p1" };
    const tabId = "tab1";
    mockDeck._panelResult = panel;
    mockDeck._deckState = {
      cards: [{
        id: "p1",
        tabs: [{ id: tabId, componentId: "developer" }],
      }],
    };
    mockDeck.cardRegistry.set(tabId, mockCard);

    dispatchAction({
      action: "dev_notification",
      type: "restart_available",
      count: 3,
    });

    const notifyCalls = mockDevRef.calls.filter((c) => c.method === "notify");
    expect(notifyCalls.length).toBe(1);
    expect(notifyCalls[0].args[0]).toMatchObject({ type: "restart_available", count: 3 });
  });

  it("should call devNotificationRef.notify() and setBadge() when card closed and type is restart_available", () => {
    mockDeck._panelResult = null; // Card closed

    dispatchAction({
      action: "dev_notification",
      type: "restart_available",
      count: 5,
    });

    const notifyCalls = mockDevRef.calls.filter((c) => c.method === "notify");
    expect(notifyCalls.length).toBe(1);

    const badgeCalls = mockDevRef.calls.filter((c) => c.method === "setBadge");
    expect(badgeCalls.length).toBe(1);
    expect(badgeCalls[0].args).toEqual(["developer", 5]);
  });

  it("should call devNotificationRef.notify() and setBadge() when card closed and type is relaunch_available", () => {
    mockDeck._panelResult = null; // Card closed

    dispatchAction({
      action: "dev_notification",
      type: "relaunch_available",
      count: 2,
    });

    const badgeCalls = mockDevRef.calls.filter((c) => c.method === "setBadge");
    expect(badgeCalls.length).toBe(1);
    expect(badgeCalls[0].args).toEqual(["developer", 2]);
  });

  it("should call notify() but not setBadge() when card closed and type is unknown", () => {
    mockDeck._panelResult = null; // Card closed

    dispatchAction({
      action: "dev_notification",
      type: "unknown_type",
    });

    // Unknown notification types should not set a dock badge
    const badgeCalls = mockDevRef.calls.filter((c) => c.method === "setBadge");
    expect(badgeCalls.length).toBe(0);

    // But notify() should still be called
    const notifyCalls = mockDevRef.calls.filter((c) => c.method === "notify");
    expect(notifyCalls.length).toBe(1);
  });

  it("should not crash when card exists but has no update method", () => {
    const mockCard = {}; // No update method

    const panel = { id: "p1" };
    const tabId = "tab1";
    mockDeck._panelResult = panel;
    mockDeck._deckState = {
      cards: [{
        id: "p1",
        tabs: [{ id: tabId, componentId: "developer" }],
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
  let mockDevRef: ReturnType<typeof createMockDevNotificationRef>;

  beforeEach(() => {
    _resetForTest();
    mockDeck = createMockDeckManager();
    mockDevRef = createMockDevNotificationRef();
    const mockConn = createMockConnection();
    initActionDispatch(mockConn as any, mockDeck as any, mockDevRef.ref);
  });

  it("should route to card.updateBuildProgress() when developer card is open (vanilla card)", () => {
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
        tabs: [{ id: tabId, componentId: "developer" }],
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

  it("should call devNotificationRef.updateBuildProgress() when React card is open (no updateBuildProgress method)", () => {
    const mockCard = {}; // React card: no updateBuildProgress method

    const panel = { id: "p1" };
    const tabId = "tab1";
    mockDeck._panelResult = panel;
    mockDeck._deckState = {
      cards: [{
        id: "p1",
        tabs: [{ id: tabId, componentId: "developer" }],
      }],
    };
    mockDeck.cardRegistry.set(tabId, mockCard);

    dispatchAction({
      action: "dev_build_progress",
      stage: "compile",
      status: "running",
    });

    const progressCalls = mockDevRef.calls.filter((c) => c.method === "updateBuildProgress");
    expect(progressCalls.length).toBe(1);
    expect(progressCalls[0].args[0]).toMatchObject({ stage: "compile", status: "running" });
  });

  it("should call devNotificationRef.updateBuildProgress() when developer card is closed", () => {
    mockDeck._panelResult = null; // Card closed

    expect(() => {
      dispatchAction({
        action: "dev_build_progress",
        stage: "compile",
        status: "done",
      });
    }).not.toThrow();

    const progressCalls = mockDevRef.calls.filter((c) => c.method === "updateBuildProgress");
    expect(progressCalls.length).toBe(1);
  });

  it("should not crash when card exists but has no updateBuildProgress method", () => {
    const mockCard = {}; // No updateBuildProgress method

    const panel = { id: "p1" };
    const tabId = "tab1";
    mockDeck._panelResult = panel;
    mockDeck._deckState = {
      cards: [{
        id: "p1",
        tabs: [{ id: tabId, componentId: "developer" }],
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
