import { describe, it, expect, beforeEach } from "bun:test";
import {
  initActionDispatch,
  dispatchAction,
  registerAction,
  registerThemeSetter,
  registerResponderChainManager,
  _resetForTest,
} from "../action-dispatch";
import { FeedId } from "../protocol";
import type { ActionEvent } from "../components/tugways/responder-chain";

// Minimal mock DeckManager.
// addCard is a stub that records calls; other methods are omitted.
function createMockDeckManager() {
  const addCardCalls: string[] = [];
  return {
    addCard(componentId: string): string | null {
      addCardCalls.push(componentId);
      return null;
    },
    _addCardCalls: addCardCalls,
  };
}

// Mock TugConnection -- initActionDispatch registers one onFrame callback.
function createMockConnection() {
  const frameCallbacks = new Map<number, (payload: Uint8Array) => void>();
  return {
    onFrame(feedId: number, cb: (payload: Uint8Array) => void): void {
      frameCallbacks.set(feedId, cb);
    },
    // Simulate a received Control frame for testing dispatchAction wiring.
    simulateFrame(feedId: number, payload: Uint8Array): void {
      frameCallbacks.get(feedId)?.(payload);
    },
  };
}

// ---- registerAction / dispatchAction ----

describe("registerAction / dispatchAction", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("dispatches to a registered handler", () => {
    const calls: Record<string, unknown>[] = [];
    registerAction("my-action", (payload) => calls.push(payload));

    dispatchAction({ action: "my-action", value: 42 });

    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ action: "my-action", value: 42 });
  });

  it("warns and does nothing for an unknown action", () => {
    // Should not throw
    expect(() => dispatchAction({ action: "no-such-action" })).not.toThrow();
  });

  it("warns and does nothing when action field is missing", () => {
    expect(() => dispatchAction({ notAction: "oops" })).not.toThrow();
  });

  it("last registration wins for duplicate action names", () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    registerAction("dup", () => first.push(1));
    registerAction("dup", () => second.push(2));

    dispatchAction({ action: "dup" });

    expect(first.length).toBe(0);
    expect(second.length).toBe(1);
  });
});

// ---- _resetForTest ----

describe("_resetForTest", () => {
  it("clears all registered handlers", () => {
    registerAction("to-be-cleared", () => {});
    _resetForTest();

    // After reset, dispatching should warn (no handler) but not throw
    expect(() => dispatchAction({ action: "to-be-cleared" })).not.toThrow();
  });
});

// ---- initActionDispatch: Control frame wiring ----

describe("initActionDispatch: Control frame wiring", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("registers a CONTROL frame callback that dispatches actions", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const received: Record<string, unknown>[] = [];
    registerAction("test-wired", (p) => received.push(p));

    const payload = new TextEncoder().encode(JSON.stringify({ action: "test-wired", x: 1 }));
    conn.simulateFrame(FeedId.CONTROL, payload);

    expect(received.length).toBe(1);
    expect(received[0]).toMatchObject({ action: "test-wired", x: 1 });
  });

  it("does not throw on malformed Control frame JSON", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const bad = new TextEncoder().encode("not json {{");
    expect(() => conn.simulateFrame(FeedId.CONTROL, bad)).not.toThrow();
  });
});

// ---- reload handler ----

describe("initActionDispatch: reload", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("calls location.reload() once", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();

    // Stub location.reload
    const originalReload = globalThis.location?.reload;
    let reloadCount = 0;
    Object.defineProperty(globalThis, "location", {
      value: { reload: () => { reloadCount++; } },
      writable: true,
      configurable: true,
    });

    initActionDispatch(conn as any, deck as any);
    dispatchAction({ action: "reload" });

    expect(reloadCount).toBe(1);

    // Restore
    Object.defineProperty(globalThis, "location", {
      value: { reload: originalReload },
      writable: true,
      configurable: true,
    });
  });

  it("deduplicates: second reload is ignored", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();

    let reloadCount = 0;
    Object.defineProperty(globalThis, "location", {
      value: { reload: () => { reloadCount++; } },
      writable: true,
      configurable: true,
    });

    initActionDispatch(conn as any, deck as any);
    dispatchAction({ action: "reload" });
    dispatchAction({ action: "reload" });

    expect(reloadCount).toBe(1);
  });
});

// ---- set-dev-mode handler ----

describe("initActionDispatch: set-dev-mode", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("does not throw when webkit bridge is absent", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    expect(() => dispatchAction({ action: "set-dev-mode", enabled: true })).not.toThrow();
  });

  it("warns and does not throw when enabled is not a boolean", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    expect(() => dispatchAction({ action: "set-dev-mode", enabled: "yes" })).not.toThrow();
  });

  it("calls webkit bridge when present", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const posted: unknown[] = [];
    (globalThis as Record<string, unknown>).webkit = {
      messageHandlers: {
        setDevMode: { postMessage: (v: unknown) => posted.push(v) },
      },
    };

    dispatchAction({ action: "set-dev-mode", enabled: false });

    expect(posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ enabled: false });

    delete (globalThis as Record<string, unknown>).webkit;
  });
});

// ---- source-tree handler ----

describe("initActionDispatch: source-tree", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("does not throw when webkit bridge is absent", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    expect(() => dispatchAction({ action: "source-tree" })).not.toThrow();
  });

  it("calls webkit bridge when present", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const posted: unknown[] = [];
    (globalThis as Record<string, unknown>).webkit = {
      messageHandlers: {
        sourceTree: { postMessage: (v: unknown) => posted.push(v) },
      },
    };

    dispatchAction({ action: "source-tree" });

    expect(posted.length).toBe(1);

    delete (globalThis as Record<string, unknown>).webkit;
  });
});

// ---- set-theme handler ----

describe("initActionDispatch: set-theme", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("calls the registered theme setter with a valid theme name", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const received: string[] = [];
    registerThemeSetter((theme) => received.push(theme));

    dispatchAction({ action: "set-theme", theme: "brio" });

    expect(received.length).toBe(1);
    expect(received[0]).toBe("brio");
  });

  it("calls the setter for the valid theme name brio", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const received: string[] = [];
    registerThemeSetter((theme) => received.push(theme));

    dispatchAction({ action: "set-theme", theme: "brio" });

    expect(received).toEqual(["brio"]);
  });

  it("accepts arbitrary theme name strings and delegates to the theme provider", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const received: string[] = [];
    registerThemeSetter((theme) => received.push(theme));

    // Arbitrary custom theme strings should be passed through to the theme provider
    dispatchAction({ action: "set-theme", theme: "my-custom-theme" });
    dispatchAction({ action: "set-theme", theme: "dark-forest" });

    expect(received).toEqual(["my-custom-theme", "dark-forest"]);
  });

  it("warns and does not throw when theme field is missing", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    expect(() => dispatchAction({ action: "set-theme" })).not.toThrow();
  });

  it("warns and does not throw when setter is not yet registered", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    // No registerThemeSetter call — themeSetterRef is null after _resetForTest
    expect(() => dispatchAction({ action: "set-theme", theme: "brio" })).not.toThrow();
  });

  it("uses the latest setter after re-registration", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const first: string[] = [];
    const second: string[] = [];
    registerThemeSetter((theme) => first.push(theme));
    registerThemeSetter((theme) => second.push(theme));

    dispatchAction({ action: "set-theme", theme: "brio" });

    expect(first.length).toBe(0);
    expect(second).toEqual(["brio"]);
  });
});

// ---- show-card handler (T23, T24) ----

describe("initActionDispatch: show-card – T23: calls deckManager.addCard", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("calls deckManager.addCard with the component value", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    dispatchAction({ action: "show-card", component: "hello" });

    expect(deck._addCardCalls.length).toBe(1);
    expect(deck._addCardCalls[0]).toBe("hello");
  });

  it("calls addCard with any string component value (not just registered ids)", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    dispatchAction({ action: "show-card", component: "settings" });
    dispatchAction({ action: "show-card", component: "about" });

    expect(deck._addCardCalls).toEqual(["settings", "about"]);
  });
});

describe("initActionDispatch: show-card – T24: missing component logs warning", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("warns and does not call addCard when component field is missing", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    expect(() => dispatchAction({ action: "show-card" })).not.toThrow();
    expect(deck._addCardCalls.length).toBe(0);
  });

  it("warns and does not call addCard when component is not a string", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    expect(() => dispatchAction({ action: "show-card", component: 42 })).not.toThrow();
    expect(deck._addCardCalls.length).toBe(0);
  });

  it("warns and does not call addCard when component is null", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    expect(() => dispatchAction({ action: "show-card", component: null })).not.toThrow();
    expect(deck._addCardCalls.length).toBe(0);
  });
});

// ---- add-tab-to-active-card handler ([D06], [D09]) ----

describe("initActionDispatch: add-tab-to-active-card", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("dispatches 'addTabToActiveCard' through the registered ResponderChainManager", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    // Create a stub ResponderChainManager that records dispatch calls.
    const dispatched: ActionEvent[] = [];
    const stubManager = {
      dispatch(event: ActionEvent): boolean {
        dispatched.push(event);
        return true;
      },
    };
    registerResponderChainManager(stubManager as any);

    dispatchAction({ action: "add-tab-to-active-card" });

    expect(dispatched.length).toBe(1);
    expect(dispatched[0]).toEqual({ action: "addTabToActiveCard", phase: "discrete" });
  });

  it("warns and does not throw when no ResponderChainManager is registered", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    // No registerResponderChainManager call -- ref is null after _resetForTest.
    expect(() => dispatchAction({ action: "add-tab-to-active-card" })).not.toThrow();
  });

  it("uses the most recently registered manager (last-registration-wins)", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const first: ActionEvent[] = [];
    const second: ActionEvent[] = [];
    registerResponderChainManager({ dispatch: (e: ActionEvent) => { first.push(e); return true; } } as any);
    registerResponderChainManager({ dispatch: (e: ActionEvent) => { second.push(e); return true; } } as any);

    dispatchAction({ action: "add-tab-to-active-card" });

    expect(first.length).toBe(0);
    expect(second.length).toBe(1);
    expect(second[0]).toEqual({ action: "addTabToActiveCard", phase: "discrete" });
  });
});
