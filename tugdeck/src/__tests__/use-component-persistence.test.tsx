/**
 * useComponentPersistence + <PersistenceScope> behavior tests.
 *
 * Pins the opt-in Component Persistence Protocol ([D13], [A9]) surface
 * visible to component authors:
 *
 *   1. Mount-time register / unmount-time unregister via the hook's
 *      `useLayoutEffect` — per [L03] registration lands before any
 *      event-driven consumer could fire.
 *   2. Ref-sync — a re-render with a new `captureState` closure shows
 *      up immediately through the registry's `captureRef.current()`
 *      path, confirming the framework never sees stale mount-time
 *      closures.
 *   3. `<PersistenceScope prefix>` prepends `prefix + "/"` to child
 *      `persistKey`s; nested scopes concatenate additively.
 *   4. Duplicate scoped keys at the same card scope throw in dev via
 *      the registry's assertion from Step 16.
 *   5. Graceful no-op when rendered outside a `CardComponentRegistryContext`
 *      provider — hook registers nothing, and a single dev-warn fires
 *      per mount (not per render).
 */

import "./setup-rtl";

import React from "react";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";

import { ComponentPersistenceRegistry } from "@/components/tugways/component-persistence-registry";
import {
  CardComponentRegistryContext,
  PersistenceScope,
  useComponentPersistence,
  usePersistenceScopePrefix,
} from "@/components/tugways/use-component-persistence";

function renderUnderCard(
  registry: ComponentPersistenceRegistry,
  ui: React.ReactElement,
) {
  return render(
    <CardComponentRegistryContext.Provider
      value={{ registry, prefix: "", treePath: [] }}
    >
      {ui}
    </CardComponentRegistryContext.Provider>,
  );
}

function Consumer({
  persistKey,
  value,
  onRestore,
}: {
  persistKey: string;
  value: unknown;
  onRestore?: (saved: unknown) => void;
}): null {
  useComponentPersistence({
    persistKey,
    captureState: () => value,
    restoreState: (saved) => onRestore?.(saved),
  });
  return null;
}

afterEach(() => {
  cleanup();
});

describe("useComponentPersistence — registration lifecycle", () => {
  test("mount registers; unmount unregisters", () => {
    const registry = new ComponentPersistenceRegistry();

    const { unmount } = renderUnderCard(
      registry,
      <Consumer persistKey="item" value={1} />,
    );

    expect(registry.keys()).toEqual(new Set(["item"]));

    unmount();
    expect(registry.keys().size).toBe(0);
  });

  test("framework reads the latest captureState closure (ref-sync)", () => {
    const registry = new ComponentPersistenceRegistry();

    function Wrapper({ value }: { value: number }): React.ReactElement {
      return <Consumer persistKey="n" value={value} />;
    }

    const { rerender } = renderUnderCard(registry, <Wrapper value={1} />);

    const [[, entry1]] = registry.entriesInTreeOrder();
    expect(entry1.captureRef.current!()).toBe(1);

    // Re-render with a new captured value; registry entry stays the
    // same (no re-register), but ref.current returns the new closure.
    rerender(
      <CardComponentRegistryContext.Provider
        value={{ registry, prefix: "", treePath: [] }}
      >
        <Wrapper value={42} />
      </CardComponentRegistryContext.Provider>,
    );

    const [[, entry2]] = registry.entriesInTreeOrder();
    expect(entry2.captureRef.current!()).toBe(42);
  });
});

describe("useComponentPersistence — <PersistenceScope>", () => {
  test("scope prepends prefix + '/' to child persistKeys", () => {
    const registry = new ComponentPersistenceRegistry();

    renderUnderCard(
      registry,
      <PersistenceScope prefix="panel">
        <Consumer persistKey="expanded" value={true} />
      </PersistenceScope>,
    );

    expect(registry.keys()).toEqual(new Set(["panel/expanded"]));
  });

  test("nested scopes concatenate additively", () => {
    const registry = new ComponentPersistenceRegistry();

    renderUnderCard(
      registry,
      <PersistenceScope prefix="outer">
        <PersistenceScope prefix="inner">
          <Consumer persistKey="leaf" value={0} />
        </PersistenceScope>
      </PersistenceScope>,
    );

    expect(registry.keys()).toEqual(new Set(["outer/inner/leaf"]));
  });

  test("ancestors sort before descendants in tree-order iteration", () => {
    const registry = new ComponentPersistenceRegistry();

    renderUnderCard(
      registry,
      <>
        <Consumer persistKey="root" value="R" />
        <PersistenceScope prefix="panel">
          <Consumer persistKey="inside" value="I" />
          <PersistenceScope prefix="inner">
            <Consumer persistKey="deep" value="D" />
          </PersistenceScope>
        </PersistenceScope>
      </>,
    );

    const ordered = registry.entriesInTreeOrder().map(([k]) => k);
    // Root is at depth 0 (treePath = []); panel/* at depth 1; deep at
    // depth 2. Lex order over tree paths: [] < [0] < [0, 0].
    expect(ordered).toEqual(["root", "panel/inside", "panel/inner/deep"]);
  });

  test("usePersistenceScopePrefix returns the accumulated prefix", () => {
    const seen: string[] = [];
    function Probe(): null {
      seen.push(usePersistenceScopePrefix());
      return null;
    }

    const registry = new ComponentPersistenceRegistry();
    renderUnderCard(
      registry,
      <>
        <Probe />
        <PersistenceScope prefix="outer">
          <Probe />
          <PersistenceScope prefix="inner">
            <Probe />
          </PersistenceScope>
        </PersistenceScope>
      </>,
    );

    expect(seen).toEqual(["", "outer/", "outer/inner/"]);
  });
});

describe("useComponentPersistence — uniqueness", () => {
  test("duplicate scopedKey within a card throws in dev", () => {
    const registry = new ComponentPersistenceRegistry();

    // Render one consumer to seat the key.
    renderUnderCard(registry, <Consumer persistKey="dup" value={1} />);

    // Rendering a second consumer with the same scopedKey into the
    // same registry should throw from the registry assertion.
    expect(() => {
      render(
        <CardComponentRegistryContext.Provider
          value={{ registry, prefix: "", treePath: [] }}
        >
          <Consumer persistKey="dup" value={2} />
        </CardComponentRegistryContext.Provider>,
      );
    }).toThrow(/duplicate persistKey within card scope: "dup"/);
  });

  test("<PersistenceScope prefix=''> throws in dev", () => {
    expect(() => {
      render(
        <PersistenceScope prefix="">
          <Consumer persistKey="x" value={0} />
        </PersistenceScope>,
      );
    }).toThrow(/non-empty `prefix`/);
  });
});

describe("useComponentPersistence — opt-in via optional persistKey", () => {
  test("persistKey === undefined: no registration, no dev-warn", () => {
    const consoleWarns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      consoleWarns.push(args);
    };
    try {
      function OptOut(): null {
        useComponentPersistence({
          persistKey: undefined,
          captureState: () => "captured",
          restoreState: () => undefined,
        });
        return null;
      }

      const registry = new ComponentPersistenceRegistry();
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

  test("toggling persistKey from undefined to a string registers the entry", () => {
    const registry = new ComponentPersistenceRegistry();
    function Toggle({ persistKey }: { persistKey?: string }): null {
      useComponentPersistence({
        persistKey,
        captureState: () => "X",
        restoreState: () => undefined,
      });
      return null;
    }

    const { rerender } = renderUnderCard(registry, <Toggle />);
    expect(registry.keys().size).toBe(0);

    rerender(
      <CardComponentRegistryContext.Provider
        value={{ registry, prefix: "", treePath: [] }}
      >
        <Toggle persistKey="late" />
      </CardComponentRegistryContext.Provider>,
    );
    expect(registry.keys()).toEqual(new Set(["late"]));
  });
});

describe("useComponentPersistence — outside-card graceful no-op", () => {
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
    // Render with NO CardComponentRegistryContext provider. Default
    // context carries `registry: null` so the hook dev-warns and
    // no-ops.
    const { rerender } = render(
      <Consumer persistKey="solo" value={"A"} />,
    );

    // A single warn per call site; no throws; no render errors.
    expect(consoleWarns.length).toBe(1);
    expect(consoleErrors).toEqual([]);
    const firstArg = consoleWarns[0][0] as string;
    expect(firstArg).toMatch(/useComponentPersistence\("solo"\)/);

    // Re-rendering the same mount does not re-warn.
    act(() => {
      rerender(<Consumer persistKey="solo" value={"B"} />);
    });
    expect(consoleWarns.length).toBe(1);
  });
});
