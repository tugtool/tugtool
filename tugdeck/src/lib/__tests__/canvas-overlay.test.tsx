/**
 * canvas-overlay.test.tsx — registry + hook unit tests.
 *
 * Covers:
 *   - Registry register / unregister / subscribe semantics.
 *   - Registry single-registration no-op behavior on duplicate
 *     register and mismatched unregister.
 *   - useCanvasOverlay returns the registered root when present.
 *   - useCanvasOverlay falls back to `document.body` when no root
 *     is registered (the [D02] standalone-harness path).
 *   - useCanvasOverlay re-renders consumers on registration change.
 */

import "../../__tests__/setup-rtl";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderHook, act } from "@testing-library/react";

import * as canvasOverlayRegistry from "@/lib/canvas-overlay-registry";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";

beforeEach(() => {
  canvasOverlayRegistry._resetForTests();
});

afterEach(() => {
  canvasOverlayRegistry._resetForTests();
});

describe("canvas-overlay-registry", () => {
  test("register stores the element and getRoot returns it", () => {
    const el = document.createElement("div");
    canvasOverlayRegistry.register(el);
    expect(canvasOverlayRegistry.getRoot()).toBe(el);
  });

  test("subscribe fires on register", () => {
    let fired = 0;
    const unsub = canvasOverlayRegistry.subscribe(() => {
      fired++;
    });
    const el = document.createElement("div");
    canvasOverlayRegistry.register(el);
    expect(fired).toBe(1);
    unsub();
  });

  test("registering the same element twice is a no-op", () => {
    const el = document.createElement("div");
    let fired = 0;
    const unsub = canvasOverlayRegistry.subscribe(() => {
      fired++;
    });
    canvasOverlayRegistry.register(el);
    canvasOverlayRegistry.register(el);
    expect(fired).toBe(1);
    unsub();
  });

  test("registering a different element replaces and notifies", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    let fired = 0;
    const unsub = canvasOverlayRegistry.subscribe(() => {
      fired++;
    });
    canvasOverlayRegistry.register(a);
    canvasOverlayRegistry.register(b);
    expect(fired).toBe(2);
    expect(canvasOverlayRegistry.getRoot()).toBe(b);
    unsub();
  });

  test("unregister with the registered element clears state and notifies", () => {
    const el = document.createElement("div");
    canvasOverlayRegistry.register(el);
    let fired = 0;
    const unsub = canvasOverlayRegistry.subscribe(() => {
      fired++;
    });
    canvasOverlayRegistry.unregister(el);
    expect(canvasOverlayRegistry.getRoot()).toBeNull();
    expect(fired).toBe(1);
    unsub();
  });

  test("unregister with a different element is a no-op", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    canvasOverlayRegistry.register(a);
    let fired = 0;
    const unsub = canvasOverlayRegistry.subscribe(() => {
      fired++;
    });
    canvasOverlayRegistry.unregister(b);
    // Stale unregister calls (e.g. from an old useLayoutEffect cleanup
    // racing a fresh registration during HMR) MUST NOT clear the
    // current registration. This is the load-bearing protection.
    expect(canvasOverlayRegistry.getRoot()).toBe(a);
    expect(fired).toBe(0);
    unsub();
  });

  test("unsubscribe stops further notifications", () => {
    let fired = 0;
    const unsub = canvasOverlayRegistry.subscribe(() => {
      fired++;
    });
    unsub();
    canvasOverlayRegistry.register(document.createElement("div"));
    expect(fired).toBe(0);
  });

  test("_resetForTests clears registration and listeners", () => {
    let fired = 0;
    canvasOverlayRegistry.subscribe(() => {
      fired++;
    });
    canvasOverlayRegistry.register(document.createElement("div"));
    expect(fired).toBe(1);
    canvasOverlayRegistry._resetForTests();
    expect(canvasOverlayRegistry.getRoot()).toBeNull();
    canvasOverlayRegistry.register(document.createElement("div"));
    // The pre-reset listener is gone; counter does not advance.
    expect(fired).toBe(1);
  });
});

describe("useCanvasOverlay", () => {
  test("returns the registered root when one is present", () => {
    const el = document.createElement("div");
    el.id = "registered-root";
    canvasOverlayRegistry.register(el);
    const { result } = renderHook(() => useCanvasOverlay());
    expect(result.current).toBe(el);
  });

  test("falls back to document.body when no root is registered", () => {
    const { result } = renderHook(() => useCanvasOverlay());
    expect(result.current).toBe(document.body);
  });

  test("re-renders when a root registers after the hook mounts", () => {
    const { result } = renderHook(() => useCanvasOverlay());
    // Initial: no root, body fallback.
    expect(result.current).toBe(document.body);
    const el = document.createElement("div");
    act(() => {
      canvasOverlayRegistry.register(el);
    });
    // After registration, the hook's useSyncExternalStore reading
    // observes the change and the consumer re-renders with the new
    // value.
    expect(result.current).toBe(el);
  });

  test("re-renders to body fallback when root unregisters", () => {
    const el = document.createElement("div");
    canvasOverlayRegistry.register(el);
    const { result } = renderHook(() => useCanvasOverlay());
    expect(result.current).toBe(el);
    act(() => {
      canvasOverlayRegistry.unregister(el);
    });
    expect(result.current).toBe(document.body);
  });
});
