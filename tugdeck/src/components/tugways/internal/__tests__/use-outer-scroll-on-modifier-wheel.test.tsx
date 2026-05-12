/**
 * `useOuterScrollOnModifierWheel` — hook tests.
 *
 * Phase E.5 introduced this hook to bypass inner-block-scroller wheel
 * capture when the user holds Cmd (macOS) or Ctrl (Win/Linux). The
 * hook attaches a capture-phase, non-passive `wheel` listener on the
 * inner scrollport DOM node and, on a modifier-wheel hit, forwards
 * `event.deltaY` to the outer scrollport via `scrollBy`.
 *
 * These tests pin the contract:
 *  1. Plain wheel (no modifier) — outer scrollport's `scrollBy` is
 *     NOT called; the inner's native wheel handling is preserved.
 *  2. Cmd-wheel — outer's `scrollBy` is invoked with the event's
 *     `deltaY`; `preventDefault` + `stopPropagation` run.
 *  3. Ctrl-wheel — same as Cmd (Win/Linux parity).
 *  4. No outer scrollport (ref is null) — Cmd-wheel is a silent
 *     no-op; the inner is unaffected. (Standalone composition.)
 *  5. Listener attaches in `useLayoutEffect` so the very first
 *     paint frame has the routing live. Detaches on unmount.
 *  6. Shift / Alt only (non-routing modifiers) — outer `scrollBy`
 *     is NOT called; browser-native horizontal panning stays intact.
 *
 * happy-dom note: `new WheelEvent(...)`'s init dictionary does not
 * propagate `metaKey` / `ctrlKey` through to the constructed event in
 * happy-dom 18.x. The helper below constructs the event then defines
 * the relevant modifier properties directly, mirroring how a real
 * browser would expose them. `deltaY` is propagated correctly so it
 * does not need the same patch.
 */

import "../../../../__tests__/setup-rtl";

import React from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, act } from "@testing-library/react";

import {
  hasRoutingModifier,
  useOuterScrollOnModifierWheel,
} from "../use-outer-scroll-on-modifier-wheel";

const WheelEventCtor: typeof WheelEvent = (globalThis as { window?: { WheelEvent: typeof WheelEvent } }).window!.WheelEvent;

afterEach(() => {
  cleanup();
});

interface SyntheticWheelInit {
  deltaY?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Construct a wheel event with the requested modifier flags actually
 * set. happy-dom's `WheelEvent` constructor drops modifier flags from
 * its init dictionary; this helper patches them after construction so
 * the dispatched event matches a real browser's shape.
 */
function makeWheelEvent(init: SyntheticWheelInit): WheelEvent {
  const event = new WheelEventCtor("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: init.deltaY ?? 0,
  });
  if (init.metaKey === true) {
    Object.defineProperty(event, "metaKey", { value: true, configurable: true });
  }
  if (init.ctrlKey === true) {
    Object.defineProperty(event, "ctrlKey", { value: true, configurable: true });
  }
  if (init.shiftKey === true) {
    Object.defineProperty(event, "shiftKey", { value: true, configurable: true });
  }
  if (init.altKey === true) {
    Object.defineProperty(event, "altKey", { value: true, configurable: true });
  }
  return event;
}

// Harness: renders the inner scrollport, mounts the hook with the
// inner ref + the outer ref the test supplies. The test fires a
// synthetic WheelEvent onto the inner element and inspects whichever
// shape it cares about.
interface HarnessProps {
  outerRef: React.RefObject<HTMLDivElement | null>;
}
function Harness({ outerRef }: HarnessProps) {
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  useOuterScrollOnModifierWheel({
    innerRef,
    outerScrollportRef: outerRef as React.RefObject<HTMLElement | null>,
  });
  return <div data-testid="inner" ref={innerRef} />;
}

interface DispatchResult {
  scrollBy: { calls: Array<ScrollToOptions> };
  defaultPrevented: boolean;
  propagationStopped: boolean;
}

/**
 * Mount a harness with a stub outer-scrollport, dispatch a wheel
 * event onto the inner, return the resulting probe data. The outer
 * is a plain DOM `<div>` with a stubbed `scrollBy` that records
 * each call's options.
 */
function dispatchWheel(init: SyntheticWheelInit): DispatchResult {
  const outer = document.createElement("div");
  const scrollByCalls: Array<ScrollToOptions> = [];
  outer.scrollBy = ((options: ScrollToOptions) => {
    scrollByCalls.push(options);
  }) as typeof outer.scrollBy;

  const outerRef = { current: outer } as React.RefObject<HTMLDivElement | null>;
  const { container } = render(<Harness outerRef={outerRef} />);
  const inner = container.querySelector(
    '[data-testid="inner"]',
  ) as HTMLDivElement;
  expect(inner).not.toBeNull();

  const event = makeWheelEvent(init);

  let propagationStopped = false;
  const originalStop = event.stopPropagation.bind(event);
  event.stopPropagation = () => {
    propagationStopped = true;
    originalStop();
  };

  act(() => {
    inner.dispatchEvent(event);
  });

  return {
    scrollBy: { calls: scrollByCalls },
    defaultPrevented: event.defaultPrevented,
    propagationStopped,
  };
}

describe("hasRoutingModifier", () => {
  test("returns true for metaKey", () => {
    const e = makeWheelEvent({ metaKey: true });
    expect(hasRoutingModifier(e)).toBe(true);
  });

  test("returns true for ctrlKey", () => {
    const e = makeWheelEvent({ ctrlKey: true });
    expect(hasRoutingModifier(e)).toBe(true);
  });

  test("returns false for shiftKey only", () => {
    const e = makeWheelEvent({ shiftKey: true });
    expect(hasRoutingModifier(e)).toBe(false);
  });

  test("returns false for altKey only", () => {
    const e = makeWheelEvent({ altKey: true });
    expect(hasRoutingModifier(e)).toBe(false);
  });

  test("returns false for plain wheel (no modifier)", () => {
    const e = makeWheelEvent({});
    expect(hasRoutingModifier(e)).toBe(false);
  });
});

describe("useOuterScrollOnModifierWheel — routing", () => {
  test("Cmd-wheel forwards deltaY to outer.scrollBy", () => {
    const result = dispatchWheel({ deltaY: 42, metaKey: true });
    expect(result.scrollBy.calls).toEqual([{ top: 42, behavior: "auto" }]);
    expect(result.defaultPrevented).toBe(true);
    expect(result.propagationStopped).toBe(true);
  });

  test("Ctrl-wheel forwards deltaY to outer.scrollBy (Win/Linux parity)", () => {
    const result = dispatchWheel({ deltaY: -120, ctrlKey: true });
    expect(result.scrollBy.calls).toEqual([{ top: -120, behavior: "auto" }]);
    expect(result.defaultPrevented).toBe(true);
    expect(result.propagationStopped).toBe(true);
  });

  test("plain wheel passes through — outer not invoked, default not prevented", () => {
    const result = dispatchWheel({ deltaY: 50 });
    expect(result.scrollBy.calls).toEqual([]);
    expect(result.defaultPrevented).toBe(false);
    expect(result.propagationStopped).toBe(false);
  });

  test("Shift-wheel passes through — outer not invoked", () => {
    // Shift-wheel = browser-native horizontal panning. Must not be
    // captured.
    const result = dispatchWheel({ deltaY: 50, shiftKey: true });
    expect(result.scrollBy.calls).toEqual([]);
    expect(result.defaultPrevented).toBe(false);
  });

  test("Alt-wheel passes through — outer not invoked", () => {
    const result = dispatchWheel({ deltaY: 50, altKey: true });
    expect(result.scrollBy.calls).toEqual([]);
    expect(result.defaultPrevented).toBe(false);
  });

  test("Cmd+Shift-wheel routes to outer — routing modifier wins", () => {
    const result = dispatchWheel({
      deltaY: 7,
      metaKey: true,
      shiftKey: true,
    });
    expect(result.scrollBy.calls).toEqual([{ top: 7, behavior: "auto" }]);
    expect(result.defaultPrevented).toBe(true);
  });
});

describe("useOuterScrollOnModifierWheel — null outer scrollport", () => {
  test("Cmd-wheel is a silent no-op when outer ref is null", () => {
    const outerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    const { container } = render(<Harness outerRef={outerRef} />);
    const inner = container.querySelector(
      '[data-testid="inner"]',
    ) as HTMLDivElement;

    const event = makeWheelEvent({ deltaY: 99, metaKey: true });

    act(() => {
      inner.dispatchEvent(event);
    });

    // No scrollport to forward to → no preventDefault either.
    // Standalone composition stays inert.
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("useOuterScrollOnModifierWheel — listener lifecycle", () => {
  test("detaches the listener on unmount — no leak across remounts", () => {
    const outer = document.createElement("div");
    const scrollByCalls: Array<ScrollToOptions> = [];
    outer.scrollBy = ((options: ScrollToOptions) => {
      scrollByCalls.push(options);
    }) as typeof outer.scrollBy;
    const outerRef = { current: outer } as React.RefObject<HTMLDivElement | null>;

    const { container, unmount } = render(<Harness outerRef={outerRef} />);
    const inner = container.querySelector(
      '[data-testid="inner"]',
    ) as HTMLDivElement;

    // Live: Cmd-wheel registers.
    act(() => {
      inner.dispatchEvent(makeWheelEvent({ deltaY: 5, metaKey: true }));
    });
    expect(scrollByCalls.length).toBe(1);

    // After unmount the listener is gone — dispatch onto the detached
    // node (still a DOM element, just out of the tree) and verify the
    // handler does not run.
    unmount();
    inner.dispatchEvent(makeWheelEvent({ deltaY: 100, metaKey: true }));
    expect(scrollByCalls.length).toBe(1);
  });
});
