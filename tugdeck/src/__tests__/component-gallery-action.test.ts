/**
 * Integration tests for the show-component-gallery action -- Step 2.
 *
 * Tests cover:
 * - show-component-gallery calls the registered gallery setter
 * - show-component-gallery does not throw when setter is not registered
 * - registerGallerySetter replaces previous setter (last-registration-wins)
 * - _resetForTest clears the gallery setter
 *
 * Patterns mirror action-dispatch.test.ts (set-theme handler tests).
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  initActionDispatch,
  dispatchAction,
  registerGallerySetter,
  _resetForTest,
} from "../action-dispatch";

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

// ============================================================================
// show-component-gallery action
// ============================================================================

describe("initActionDispatch: show-component-gallery", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("calls registered gallery setter when action is dispatched", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const calls: Array<Parameters<typeof registerGallerySetter>[0]> = [];
    const setter = mock((updater: boolean | ((prev: boolean) => boolean)) => {
      calls.push(updater as any);
    });
    registerGallerySetter(setter as any);

    dispatchAction({ action: "show-component-gallery" });

    expect(setter).toHaveBeenCalledTimes(1);
  });

  it("passes a toggle function (not a direct value) to the setter", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    let capturedUpdater: unknown = undefined;
    registerGallerySetter(((updater: unknown) => {
      capturedUpdater = updater;
    }) as any);

    dispatchAction({ action: "show-component-gallery" });

    // The updater must be a function (toggle callback), not a raw boolean
    expect(typeof capturedUpdater).toBe("function");
  });

  it("toggle function flips false to true", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    let capturedUpdater: ((prev: boolean) => boolean) | null = null;
    registerGallerySetter(((updater: (prev: boolean) => boolean) => {
      capturedUpdater = updater;
    }) as any);

    dispatchAction({ action: "show-component-gallery" });

    expect(capturedUpdater).not.toBeNull();
    expect(capturedUpdater!(false)).toBe(true);
  });

  it("toggle function flips true to false", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    let capturedUpdater: ((prev: boolean) => boolean) | null = null;
    registerGallerySetter(((updater: (prev: boolean) => boolean) => {
      capturedUpdater = updater;
    }) as any);

    dispatchAction({ action: "show-component-gallery" });

    expect(capturedUpdater).not.toBeNull();
    expect(capturedUpdater!(true)).toBe(false);
  });

  it("does not throw when gallery setter is not registered", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    // No registerGallerySetter call -- gallerySetterRef is null after _resetForTest
    expect(() => dispatchAction({ action: "show-component-gallery" })).not.toThrow();
  });

  it("uses the latest setter after re-registration (last-registration-wins)", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const first = mock((_: unknown) => {});
    const second = mock((_: unknown) => {});

    registerGallerySetter(first as any);
    registerGallerySetter(second as any);

    dispatchAction({ action: "show-component-gallery" });

    expect(first).toHaveBeenCalledTimes(0);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// _resetForTest clears gallery setter
// ============================================================================

describe("_resetForTest: clears gallery setter", () => {
  it("gallery setter is cleared after _resetForTest -- action warns but does not throw", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const setter = mock((_: unknown) => {});
    registerGallerySetter(setter as any);

    _resetForTest();

    // After reset, initActionDispatch must be called again to re-register handlers
    const conn2 = createMockConnection();
    initActionDispatch(conn2 as any, deck as any);

    // setter was registered before reset; it should NOT be called now
    expect(() => dispatchAction({ action: "show-component-gallery" })).not.toThrow();
    expect(setter).toHaveBeenCalledTimes(0);
  });
});

// ============================================================================
// registerGallerySetter
// ============================================================================

describe("registerGallerySetter", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("can be called before initActionDispatch without throwing", () => {
    const setter = mock((_: unknown) => {});
    expect(() => registerGallerySetter(setter as any)).not.toThrow();
  });

  it("replaces the previous setter (last-registration-wins)", () => {
    const conn = createMockConnection();
    const deck = createMockDeckManager();
    initActionDispatch(conn as any, deck as any);

    const first = mock((_: unknown) => {});
    const second = mock((_: unknown) => {});

    registerGallerySetter(first as any);
    registerGallerySetter(second as any);

    dispatchAction({ action: "show-component-gallery" });

    expect(first).toHaveBeenCalledTimes(0);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
