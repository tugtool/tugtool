/**
 * Integration tests for the show-component-gallery action -- Step 6 rewrite.
 *
 * Phase 5b3: show-component-gallery now dispatches "showComponentGallery"
 * through the responder chain manager (gallerySetterRef / registerGallerySetter
 * are removed). Tests updated accordingly.
 *
 * Tests cover:
 * - show-component-gallery dispatches "showComponentGallery" through the
 *   responder chain manager
 * - show-component-gallery does not throw when responder chain manager is null
 * - _resetForTest clears the responder chain manager ref
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
    register: mock((_id, _actions, _opts) => {}),
    unregister: mock((_id) => {}),
    dispatch: mock((_action) => false),
    canHandle: mock((_action) => false),
    makeFirstResponder: mock((_id) => {}),
    getFirstResponder: mock(() => null),
    subscribe: mock((_cb) => () => {}),
    getValidationVersion: mock(() => 0),
    validateAction: mock((_action) => false),
    ...overrides,
  } as unknown as ResponderChainManager;
}

// ============================================================================
// show-component-gallery action
// ============================================================================

describe("initActionDispatch: show-component-gallery", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("dispatches 'showComponentGallery' through the responder chain manager when action fires", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    const dispatchMock = mock((_event: ActionEvent) => false);
    const manager = createMockResponderChainManager({ dispatch: dispatchMock });
    registerResponderChainManager(manager);

    dispatchAction({ action: "show-component-gallery" });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith({ action: "showComponentGallery", phase: "discrete" });
  });

  it("does not throw when responder chain manager is not registered", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    // No registerResponderChainManager call -- responderChainManagerRef is null
    expect(() => dispatchAction({ action: "show-component-gallery" })).not.toThrow();
  });

  it("warns (not throws) when responder chain manager is not registered", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    const warnSpy = mock((..._args: unknown[]) => {});
    const origWarn = console.warn;
    console.warn = warnSpy as typeof console.warn;

    try {
      dispatchAction({ action: "show-component-gallery" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = origWarn;
    }
  });
});

// ============================================================================
// _resetForTest clears responder chain manager
// ============================================================================

describe("_resetForTest: clears responder chain manager for show-component-gallery", () => {
  it("manager is cleared after _resetForTest -- action warns but does not throw", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as never, deck as never);

    const dispatchMock = mock((_action: string) => false);
    const manager = createMockResponderChainManager({ dispatch: dispatchMock });
    registerResponderChainManager(manager);

    _resetForTest();

    // After reset, initActionDispatch must be called again to re-register handlers
    const conn2 = createMockConnection();
    initActionDispatch(conn2 as never, deck as never);

    // manager was registered before reset; dispatch should NOT be called now
    expect(() => dispatchAction({ action: "show-component-gallery" })).not.toThrow();
    expect(dispatchMock).toHaveBeenCalledTimes(0);
  });
});
