/**
 * `usePositionStableClick` — hook tests.
 *
 * Phase E.3 introduced this hook to preserve a click target's visual
 * position across state-driven layout changes. The hook snapshots the
 * target rect before a mutator runs, then in a `useLayoutEffect`
 * measures the post-mutation rect and compensates the scrollport's
 * `scrollTop` by the delta.
 *
 * These tests pin the core contract:
 *  1. The mutator runs synchronously inside `stableClick`.
 *  2. After commit, the scrollport's `scrollTop` is adjusted by the
 *     rect delta (newTop − oldTop).
 *  3. No adjustment when the scrollport is null (standalone composition).
 *  4. No adjustment when the post-rect is off-screen (the click target
 *     scrolled out of view; snap-scrolling something else into view
 *     would be more surprising than the un-compensated case).
 *  5. No `requestAnimationFrame` anywhere — the hook compensates in a
 *     synchronous-from-React's-POV layout effect, per [L05].
 *
 * Test strategy: render a small harness that exposes the rect via a
 * controllable mock. happy-dom returns zero from `getBoundingClientRect`
 * by default, so the test stubs `Element.prototype.getBoundingClientRect`
 * to feed the hook a controllable pre/post pair. The scrollport is a
 * plain `<div>` whose `scrollTop` is read after the layout effect runs.
 */

import "../../../../__tests__/setup-rtl";

import React from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { usePositionStableClick } from "../use-position-stable-click";

afterEach(() => {
  cleanup();
});

// Harness component: exposes a button + a scrollport prop. The
// `rectQueue` array drives successive `getBoundingClientRect` returns
// for the button (one entry per call). The test pushes the pre-state
// rect, then triggers the click, then the layout effect fires the
// post-state remeasurement and consumes the second entry.
interface HarnessProps {
  scrollportRef: React.RefObject<HTMLDivElement | null>;
  rectQueue: Array<{ top: number }>;
  onClickInternal: () => void;
}
function Harness({ scrollportRef, rectQueue, onClickInternal }: HarnessProps) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  // Inject a getBoundingClientRect implementation that consumes the
  // queue in order. happy-dom's default returns all-zeros, which would
  // make pre/post indistinguishable.
  React.useLayoutEffect(() => {
    const btn = buttonRef.current;
    if (btn === null) return;
    btn.getBoundingClientRect = () => {
      const next = rectQueue.shift() ?? { top: 0 };
      return {
        top: next.top,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: next.top,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  }, [rectQueue]);

  const { stableClick } = usePositionStableClick({
    targetRef: buttonRef,
    scrollportRef: scrollportRef as React.RefObject<HTMLElement | null>,
  });

  return (
    <button
      ref={buttonRef}
      onClick={() => {
        stableClick(onClickInternal);
      }}
    >
      tap
    </button>
  );
}

describe("usePositionStableClick — core contract", () => {
  test("compensates scrollTop by newTop - oldTop after commit", () => {
    // Setup: a scrollport at scrollTop=2000, viewport height = 800.
    // The button is at screen Y=0 pre-click (sticky-pinned at top),
    // and at screen Y=−900 post-click (chrome un-pinned, button
    // dropped above viewport)… wait, off-screen guard kicks in. Use a
    // realistic stay-on-screen case: button shifts from Y=100 to
    // Y=400 (e.g. 300px of growth above the click target).
    const scrollportRef = React.createRef<HTMLDivElement>();
    const ScrollportWrapper: React.FC = () => {
      const localRef = scrollportRef as React.MutableRefObject<HTMLDivElement | null>;
      return (
        <div
          ref={localRef}
          style={{ height: 200, overflow: "auto" }}
          data-testid="scrollport"
        >
          <Harness
            scrollportRef={scrollportRef}
            rectQueue={[{ top: 100 }, { top: 400 }]}
            onClickInternal={() => undefined}
          />
        </div>
      );
    };
    const { container } = render(<ScrollportWrapper />);
    const scrollport = container.querySelector(
      '[data-testid="scrollport"]',
    ) as HTMLDivElement;
    scrollport.scrollTop = 2000;
    const btn = container.querySelector("button") as HTMLButtonElement;

    // `window.innerHeight` is 0 in happy-dom by default, which would
    // trip the off-screen guard for any non-zero top. Stub it so the
    // guard sees a normal viewport.
    const originalInnerHeight = Object.getOwnPropertyDescriptor(
      window,
      "innerHeight",
    );
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
    try {
      // act() so the layout effect runs synchronously inside the assertion.
      act(() => {
        fireEvent.click(btn);
      });
      // Expected delta: 400 − 100 = +300. New scrollTop: 2000 + 300 = 2300.
      expect(scrollport.scrollTop).toBe(2300);
    } finally {
      if (originalInnerHeight !== undefined) {
        Object.defineProperty(window, "innerHeight", originalInnerHeight);
      }
    }
  });

  test("no adjustment when scrollport ref is null", () => {
    // Standalone composition: useOuterScrollport() returned null, so
    // the scrollportRef.current is null at click time. The hook
    // degrades to running the mutator without compensation. Verifies
    // the gallery / unit-test path doesn't blow up.
    const nullScrollportRef = React.createRef<HTMLDivElement>();
    let mutatorCalls = 0;
    const { container } = render(
      <Harness
        scrollportRef={nullScrollportRef}
        rectQueue={[{ top: 100 }, { top: 400 }]}
        onClickInternal={() => {
          mutatorCalls += 1;
        }}
      />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    act(() => {
      fireEvent.click(btn);
    });
    // The mutator ran (no error, no skip).
    expect(mutatorCalls).toBe(1);
    // The scrollport is null, so there is nothing to assert about
    // scrollTop — the test passing means no crash.
    expect(nullScrollportRef.current).toBeNull();
  });

  test("compensates EVEN WHEN the post-rect lies outside the viewport (no off-screen guard)", () => {
    // Pre-rect at top=100 (visible, inside viewport), post-rect at
    // top=−900 (well above viewport — typically a sticky un-pin
    // dropping the chrome header out of view). The hook MUST still
    // compensate: the button cannot jump on screen as a consequence
    // of its own click, even if the layout change put it far above
    // the viewport. Pre-Phase-E.3-fix, an off-screen guard skipped
    // the adjustment here and left the button hundreds of pixels
    // off-screen — the exact failure mode the user reported clicking
    // "8 Hunks" in a real DiffBlock. The guard has been removed; the
    // user's contract is unconditional.
    const scrollportRef = React.createRef<HTMLDivElement>();
    const ScrollportWrapper: React.FC = () => {
      const localRef =
        scrollportRef as React.MutableRefObject<HTMLDivElement | null>;
      return (
        <div ref={localRef} data-testid="scrollport">
          <Harness
            scrollportRef={scrollportRef}
            rectQueue={[{ top: 100 }, { top: -900 }]}
            onClickInternal={() => undefined}
          />
        </div>
      );
    };
    const { container } = render(<ScrollportWrapper />);
    const scrollport = container.querySelector(
      '[data-testid="scrollport"]',
    ) as HTMLDivElement;
    scrollport.scrollTop = 1000;
    const btn = container.querySelector("button") as HTMLButtonElement;
    const originalInnerHeight = Object.getOwnPropertyDescriptor(
      window,
      "innerHeight",
    );
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
    try {
      act(() => {
        fireEvent.click(btn);
      });
      // Delta = −900 − 100 = −1000. New scrollTop = 1000 + (−1000) = 0.
      // The scroll moves up by 1000 to bring the button back to its
      // pre-click visual position. The button's absolute position in
      // the document is unchanged by the click; it's the scroll that
      // brings the cell back into view so the sticky pin can re-engage.
      expect(scrollport.scrollTop).toBe(0);
    } finally {
      if (originalInnerHeight !== undefined) {
        Object.defineProperty(window, "innerHeight", originalInnerHeight);
      }
    }
  });

  test("delta of zero skips the scrollport write (no-op when layout didn't move the target)", () => {
    // Pre and post rect are identical — the click triggered a state
    // change but the target's position didn't move. No write to
    // scrollTop (defensive: zero-delta writes still triggered
    // expensive style recalcs in pre-Phase-E.3 prototypes).
    const scrollportRef = React.createRef<HTMLDivElement>();
    const ScrollportWrapper: React.FC = () => {
      const localRef =
        scrollportRef as React.MutableRefObject<HTMLDivElement | null>;
      return (
        <div ref={localRef} data-testid="scrollport">
          <Harness
            scrollportRef={scrollportRef}
            rectQueue={[{ top: 250 }, { top: 250 }]}
            onClickInternal={() => undefined}
          />
        </div>
      );
    };
    const { container } = render(<ScrollportWrapper />);
    const scrollport = container.querySelector(
      '[data-testid="scrollport"]',
    ) as HTMLDivElement;
    scrollport.scrollTop = 1234;
    const btn = container.querySelector("button") as HTMLButtonElement;
    const originalInnerHeight = Object.getOwnPropertyDescriptor(
      window,
      "innerHeight",
    );
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
    try {
      act(() => {
        fireEvent.click(btn);
      });
      expect(scrollport.scrollTop).toBe(1234);
    } finally {
      if (originalInnerHeight !== undefined) {
        Object.defineProperty(window, "innerHeight", originalInnerHeight);
      }
    }
  });
});

describe("usePositionStableClick — [L05] conformance", () => {
  test("source contains NO `requestAnimationFrame` calls", () => {
    // [L05]: rAF timing relative to React commits is a browser
    // implementation detail. The hook MUST use `useLayoutEffect`
    // exclusively for post-commit measurements. This test pins that
    // contract — a future refactor that reaches for rAF to "schedule"
    // the measurement would break L05.
    const hookPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "use-position-stable-click.ts",
    );
    const src = readFileSync(hookPath, "utf8");
    expect(src).not.toMatch(/requestAnimationFrame\s*\(/);
    // Positive assertion: the hook DOES use useLayoutEffect.
    expect(src).toMatch(/useLayoutEffect/);
  });
});
