/**
 * Integration tests for the show-style-inspector and toggle-style-inspector-scan actions.
 *
 * Tests cover:
 * - show-style-inspector dispatches "showStyleInspector" through the
 *   responder chain manager
 * - show-style-inspector does not throw when responder chain manager is null
 * - show-style-inspector warns when responder chain manager is not registered
 * - toggle-style-inspector-scan dispatches "toggleStyleInspectorScan" through the
 *   responder chain manager
 * - toggle-style-inspector-scan does not throw when responder chain manager is null
 * - toggle-style-inspector-scan warns when responder chain manager is not registered
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  initActionDispatch,
  dispatchAction,
  registerResponderChainManager,
  _resetForTest,
} from "../action-dispatch";
import type { ResponderChainManager } from "../components/tugways/responder-chain";
import type { ActionEvent } from "../components/tugways/responder-chain";

// ---- Mock helpers ----

function createMockDeckManager() {
  return {};
}

function createMockConnection() {
  const frameCallbacks = new Map<number, (payload: Uint8Array) => void>();
  return {
    onFrame(feedId: number, cb: (payload: Uint8Array) => void): void {
      frameCallbacks.set(feedId, cb);
    },
    simulateFrame(feedId: number, payload: Uint8Array): void {
      frameCallbacks.get(feedId)?.(payload);
    },
  };
}

function createMockResponderChainManager(overrides: Partial<ResponderChainManager> = {}): ResponderChainManager {
  return {
    register: mock((_id: string, _actions: unknown, _opts: unknown) => {}),
    unregister: mock((_id: string) => {}),
    dispatch: mock((_action: unknown) => false),
    canHandle: mock((_action: unknown) => false),
    makeFirstResponder: mock((_id: string) => {}),
    getFirstResponder: mock(() => null),
    subscribe: mock((_cb: unknown) => () => {}),
    getValidationVersion: mock(() => 0),
    validateAction: mock((_action: unknown) => false),
    ...overrides,
  } as unknown as ResponderChainManager;
}

// ============================================================================
// show-style-inspector action
// ============================================================================

describe("initActionDispatch: show-style-inspector", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("dispatches 'showStyleInspector' through the responder chain manager when action fires", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    const dispatchMock = mock((_event: ActionEvent) => false);
    const manager = createMockResponderChainManager({ dispatch: dispatchMock });
    registerResponderChainManager(manager);

    dispatchAction({ action: "show-style-inspector" });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith({ action: "showStyleInspector", phase: "discrete" });
  });

  it("does not throw when responder chain manager is not registered", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    // No registerResponderChainManager call -- responderChainManagerRef is null
    expect(() => dispatchAction({ action: "show-style-inspector" })).not.toThrow();
  });

  it("warns (not throws) when responder chain manager is not registered", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    const warnSpy = mock((..._args: unknown[]) => {});
    const origWarn = console.warn;
    console.warn = warnSpy as typeof console.warn;

    try {
      dispatchAction({ action: "show-style-inspector" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = origWarn;
    }
  });
});

// ============================================================================
// toggle-style-inspector-scan action
// ============================================================================

describe("initActionDispatch: toggle-style-inspector-scan", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("dispatches 'toggleStyleInspectorScan' through the responder chain manager when action fires", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    const dispatchMock = mock((_event: ActionEvent) => false);
    const manager = createMockResponderChainManager({ dispatch: dispatchMock });
    registerResponderChainManager(manager);

    dispatchAction({ action: "toggle-style-inspector-scan" });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith({ action: "toggleStyleInspectorScan", phase: "discrete" });
  });

  it("does not throw when responder chain manager is not registered", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    // No registerResponderChainManager call -- responderChainManagerRef is null
    expect(() => dispatchAction({ action: "toggle-style-inspector-scan" })).not.toThrow();
  });

  it("warns (not throws) when responder chain manager is not registered", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    const warnSpy = mock((..._args: unknown[]) => {});
    const origWarn = console.warn;
    console.warn = warnSpy as typeof console.warn;

    try {
      dispatchAction({ action: "toggle-style-inspector-scan" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = origWarn;
    }
  });
});
