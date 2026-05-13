/**
 * useComponentStatePreservation + <ComponentStatePreservationScope>
 * behavior tests.
 *
 * After Phase E.8 the hook is capture-only: `restoreState` is gone.
 * The mount-in-saved-state half lives in the separate
 * `useSavedComponentState` / `useSavedRegionScroll` accessor hooks
 * exercised by the dedicated `use-saved-component-state.test.tsx`
 * suite. These tests pin the opt-in surface that survives:
 *
 *   1. Mount-time register / unmount-time unregister via the hook's
 *      `useLayoutEffect` — per [L03] registration lands before any
 *      event-driven consumer could fire.
 *   2. Ref-sync — a re-render with a new `captureState` closure shows
 *      up immediately through the registry's `captureRef.current()`
 *      path, confirming the framework never sees stale mount-time
 *      closures.
 *   3. `<ComponentStatePreservationScope prefix>` prepends `prefix +
 *      "/"` to child `componentStatePreservationKey`s; nested scopes
 *      concatenate additively.
 *   4. Duplicate scoped keys at the same card scope throw in dev via
 *      the registry's assertion.
 *   5. Graceful no-op when rendered outside a
 *      `CardComponentStatePreservationContext` provider — hook
 *      registers nothing, and a single dev-warn fires per mount (not
 *      per render).
 */

import "./setup-rtl";

import React from "react";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";

import { ComponentStatePreservationRegistry } from "@/components/tugways/component-state-preservation-registry";
import {
  CardComponentStatePreservationContext,
  ComponentStatePreservationScope,
  useComponentStatePreservation,
  useComponentStatePreservationScopePrefix,
  type CardComponentStatePreservationContextValue,
} from "@/components/tugways/use-component-state-preservation";

function makeContextValue(
  registry: ComponentStatePreservationRegistry,
): CardComponentStatePreservationContextValue {
  return {
    registry,
    prefix: "",
    treePath: [],
    getSavedComponentState: () => undefined,
    getSavedRegionScroll: () => undefined,
    subscribe: () => () => {},
  };
}

function renderUnderCard(
  registry: ComponentStatePreservationRegistry,
  ui: React.ReactElement,
) {
  return render(
    <CardComponentStatePreservationContext.Provider
      value={makeContextValue(registry)}
    >
      {ui}
    </CardComponentStatePreservationContext.Provider>,
  );
}

function Consumer({
  componentStatePreservationKey,
  value,
}: {
  componentStatePreservationKey: string;
  value: unknown;
}): null {
  useComponentStatePreservation({
    componentStatePreservationKey,
    captureState: () => value,
  });
  return null;
}

afterEach(() => {
  cleanup();
});

describe("useComponentStatePreservation — registration lifecycle", () => {
  test("mount registers; unmount unregisters", () => {
    const registry = new ComponentStatePreservationRegistry();

    const { unmount } = renderUnderCard(
      registry,
      <Consumer componentStatePreservationKey="item" value={1} />,
    );

    expect(registry.keys()).toEqual(new Set(["item"]));

    unmount();
    expect(registry.keys().size).toBe(0);
  });

  test("framework reads the latest captureState closure (ref-sync)", () => {
    const registry = new ComponentStatePreservationRegistry();

    function Wrapper({ value }: { value: number }): React.ReactElement {
      return <Consumer componentStatePreservationKey="n" value={value} />;
    }

    const { rerender } = renderUnderCard(registry, <Wrapper value={1} />);

    const [[, entry1]] = registry.entriesInTreeOrder();
    expect(entry1.captureRef.current!()).toBe(1);

    // Re-render with a new captured value; registry entry stays the
    // same (no re-register), but ref.current returns the new closure.
    rerender(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue(registry)}
      >
        <Wrapper value={42} />
      </CardComponentStatePreservationContext.Provider>,
    );

    const [[, entry2]] = registry.entriesInTreeOrder();
    expect(entry2.captureRef.current!()).toBe(42);
  });
});

describe("useComponentStatePreservation — <ComponentStatePreservationScope>", () => {
  test("scope prepends prefix + '/' to child componentStatePreservationKeys", () => {
    const registry = new ComponentStatePreservationRegistry();

    renderUnderCard(
      registry,
      <ComponentStatePreservationScope prefix="panel">
        <Consumer componentStatePreservationKey="expanded" value={true} />
      </ComponentStatePreservationScope>,
    );

    expect(registry.keys()).toEqual(new Set(["panel/expanded"]));
  });

  test("nested scopes concatenate additively", () => {
    const registry = new ComponentStatePreservationRegistry();

    renderUnderCard(
      registry,
      <ComponentStatePreservationScope prefix="outer">
        <ComponentStatePreservationScope prefix="inner">
          <Consumer componentStatePreservationKey="leaf" value={0} />
        </ComponentStatePreservationScope>
      </ComponentStatePreservationScope>,
    );

    expect(registry.keys()).toEqual(new Set(["outer/inner/leaf"]));
  });

  test("ancestors sort before descendants in tree-order iteration", () => {
    const registry = new ComponentStatePreservationRegistry();

    renderUnderCard(
      registry,
      <>
        <Consumer componentStatePreservationKey="root" value="R" />
        <ComponentStatePreservationScope prefix="panel">
          <Consumer componentStatePreservationKey="inside" value="I" />
          <ComponentStatePreservationScope prefix="inner">
            <Consumer componentStatePreservationKey="deep" value="D" />
          </ComponentStatePreservationScope>
        </ComponentStatePreservationScope>
      </>,
    );

    const ordered = registry.entriesInTreeOrder().map(([k]) => k);
    // Root is at depth 0 (treePath = []); panel/* at depth 1; deep at
    // depth 2. Lex order over tree paths: [] < [0] < [0, 0].
    expect(ordered).toEqual(["root", "panel/inside", "panel/inner/deep"]);
  });

  test("useComponentStatePreservationScopePrefix returns the accumulated prefix", () => {
    const seen: string[] = [];
    function Probe(): null {
      seen.push(useComponentStatePreservationScopePrefix());
      return null;
    }

    const registry = new ComponentStatePreservationRegistry();
    renderUnderCard(
      registry,
      <>
        <Probe />
        <ComponentStatePreservationScope prefix="outer">
          <Probe />
          <ComponentStatePreservationScope prefix="inner">
            <Probe />
          </ComponentStatePreservationScope>
        </ComponentStatePreservationScope>
      </>,
    );

    expect(seen).toEqual(["", "outer/", "outer/inner/"]);
  });
});

describe("useComponentStatePreservation — uniqueness", () => {
  test("duplicate scopedKey within a card throws in dev", () => {
    const registry = new ComponentStatePreservationRegistry();

    // Render one consumer to seat the key.
    renderUnderCard(
      registry,
      <Consumer componentStatePreservationKey="dup" value={1} />,
    );

    // Rendering a second consumer with the same scopedKey into the
    // same registry should throw from the registry assertion.
    expect(() => {
      render(
        <CardComponentStatePreservationContext.Provider
          value={makeContextValue(registry)}
        >
          <Consumer componentStatePreservationKey="dup" value={2} />
        </CardComponentStatePreservationContext.Provider>,
      );
    }).toThrow(/duplicate componentStatePreservationKey within card scope: "dup"/);
  });

  test("<ComponentStatePreservationScope prefix=''> throws in dev", () => {
    expect(() => {
      render(
        <ComponentStatePreservationScope prefix="">
          <Consumer componentStatePreservationKey="x" value={0} />
        </ComponentStatePreservationScope>,
      );
    }).toThrow(/non-empty `prefix`/);
  });
});

describe("useComponentStatePreservation — opt-in via optional componentStatePreservationKey", () => {
  test("componentStatePreservationKey === undefined: no registration, no dev-warn", () => {
    const consoleWarns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      consoleWarns.push(args);
    };
    try {
      function OptOut(): null {
        useComponentStatePreservation({
          componentStatePreservationKey: undefined,
          captureState: () => "captured",
        });
        return null;
      }

      const registry = new ComponentStatePreservationRegistry();
      // Even inside a card, a component that opts out registers nothing.
      const { unmount } = renderUnderCard(registry, <OptOut />);
      expect(registry.keys().size).toBe(0);
      expect(consoleWarns).toEqual([]);
      unmount();

      // Outside a card, opt-out also stays silent.
      render(<OptOut />);
      expect(consoleWarns).toEqual([]);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("toggling componentStatePreservationKey from undefined to a string registers the entry", () => {
    const registry = new ComponentStatePreservationRegistry();
    function Toggle({
      componentStatePreservationKey,
    }: {
      componentStatePreservationKey?: string;
    }): null {
      useComponentStatePreservation({
        componentStatePreservationKey,
        captureState: () => "X",
      });
      return null;
    }

    const { rerender } = renderUnderCard(registry, <Toggle />);
    expect(registry.keys().size).toBe(0);

    rerender(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue(registry)}
      >
        <Toggle componentStatePreservationKey="late" />
      </CardComponentStatePreservationContext.Provider>,
    );
    expect(registry.keys()).toEqual(new Set(["late"]));
  });
});

describe("useComponentStatePreservation — outside-card graceful no-op", () => {
  const consoleErrors: unknown[][] = [];
  const consoleWarns: unknown[][] = [];
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;

  beforeEach(() => {
    consoleWarns.length = 0;
    consoleErrors.length = 0;
    originalWarn = console.warn;
    originalError = console.error;
    console.warn = (...args: unknown[]) => {
      consoleWarns.push(args);
    };
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.error = originalError;
  });

  test("rendering outside a card: no throw, one dev-warn, no registration", () => {
    // Render with NO CardComponentStatePreservationContext provider.
    // Default context carries `registry: null` so the hook dev-warns
    // and no-ops.
    const { rerender } = render(
      <Consumer componentStatePreservationKey="solo" value={"A"} />,
    );

    // A single warn per call site; no throws; no render errors.
    expect(consoleWarns.length).toBe(1);
    expect(consoleErrors).toEqual([]);
    const firstArg = consoleWarns[0][0] as string;
    expect(firstArg).toMatch(/useComponentStatePreservation\("solo"\)/);

    // Re-rendering the same mount does not re-warn.
    act(() => {
      rerender(<Consumer componentStatePreservationKey="solo" value={"B"} />);
    });
    expect(consoleWarns.length).toBe(1);
  });
});
