/**
 * useSavedComponentState / useSavedRegionScroll — accessor-hook
 * semantics for the Phase E.8 mount-in-saved-state pattern.
 *
 * Pins the contract:
 *
 *   1. With no enclosing
 *      `CardComponentStatePreservationContext` provider, the accessors
 *      return `undefined` — components rendered outside a card fall
 *      back to their `useState` default.
 *   2. Inside a card, the accessors read the saved value from the
 *      context's `getSavedComponentState` / `getSavedRegionScroll`
 *      accessor — the value the card host wires to the deck manager's
 *      `cardStateCache`. Components consume the result inside
 *      `useState`'s initializer so the first render sees the user's
 *      last-saved value.
 *   3. `<ComponentStatePreservationScope prefix>` prefixes apply to
 *      `useSavedComponentState` reads the same way they apply to
 *      registration: a `key="done"` inside `prefix="task-panel"` reads
 *      `bag.components["task-panel/done"]`.
 *   4. An undefined `componentStatePreservationKey` always returns
 *      `undefined` (the opt-out gate).
 */

import "./setup-rtl";

import React from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { ComponentStatePreservationRegistry } from "@/components/tugways/component-state-preservation-registry";
import {
  CardComponentStatePreservationContext,
  ComponentStatePreservationScope,
  useSavedComponentState,
  useSavedRegionScroll,
  type CardComponentStatePreservationContextValue,
  type SavedRegionScroll,
} from "@/components/tugways/use-component-state-preservation";

function makeContextValue(args: {
  registry?: ComponentStatePreservationRegistry;
  components?: Record<string, unknown>;
  regionScroll?: Record<string, SavedRegionScroll>;
}): CardComponentStatePreservationContextValue {
  const components = args.components ?? {};
  const regionScroll = args.regionScroll ?? {};
  return {
    registry: args.registry ?? new ComponentStatePreservationRegistry(),
    prefix: "",
    treePath: [],
    getSavedComponentState: (scopedKey: string): unknown =>
      components[scopedKey],
    getSavedRegionScroll: (scrollKey: string): SavedRegionScroll | undefined =>
      regionScroll[scrollKey],
    subscribe: () => () => {},
  };
}

afterEach(() => {
  cleanup();
});

describe("useSavedComponentState", () => {
  test("outside a card: returns undefined", () => {
    let seen: unknown = "sentinel";
    function Probe(): null {
      seen = useSavedComponentState<{ checked: boolean }>("done");
      return null;
    }
    render(<Probe />);
    expect(seen).toBeUndefined();
  });

  test("undefined key: returns undefined even when the bag has a value", () => {
    let seen: unknown = "sentinel";
    function Probe(): null {
      seen = useSavedComponentState<unknown>(undefined);
      return null;
    }
    render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue({ components: { done: { checked: true } } })}
      >
        <Probe />
      </CardComponentStatePreservationContext.Provider>,
    );
    expect(seen).toBeUndefined();
  });

  test("inside a card with no saved value: returns undefined", () => {
    let seen: unknown = "sentinel";
    function Probe(): null {
      seen = useSavedComponentState<{ checked: boolean }>("absent");
      return null;
    }
    render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue({})}
      >
        <Probe />
      </CardComponentStatePreservationContext.Provider>,
    );
    expect(seen).toBeUndefined();
  });

  test("inside a card with a saved value: returns the value", () => {
    let seen: unknown = "sentinel";
    function Probe(): null {
      seen = useSavedComponentState<{ checked: boolean }>("done");
      return null;
    }
    render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue({
          components: { done: { checked: true } },
        })}
      >
        <Probe />
      </CardComponentStatePreservationContext.Provider>,
    );
    expect(seen).toEqual({ checked: true });
  });

  test("<ComponentStatePreservationScope prefix> applies to the key lookup", () => {
    let seen: unknown = "sentinel";
    function Probe(): null {
      seen = useSavedComponentState<number>("count");
      return null;
    }
    render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue({
          components: { "task-panel/count": 7 },
        })}
      >
        <ComponentStatePreservationScope prefix="task-panel">
          <Probe />
        </ComponentStatePreservationScope>
      </CardComponentStatePreservationContext.Provider>,
    );
    expect(seen).toBe(7);
  });

  test("seeds useState initializer; the rendered value is the saved value at first paint", () => {
    function Consumer({ savedKey }: { savedKey: string }): React.ReactElement {
      const saved = useSavedComponentState<{ collapsed: boolean }>(savedKey);
      const [collapsed] = React.useState<boolean>(() =>
        typeof saved?.collapsed === "boolean" ? saved.collapsed : false,
      );
      return <span data-testid="state">{collapsed ? "collapsed" : "expanded"}</span>;
    }

    const { getByTestId } = render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue({
          components: { fold: { collapsed: true } },
        })}
      >
        <Consumer savedKey="fold" />
      </CardComponentStatePreservationContext.Provider>,
    );
    // First paint already reflects the saved value — no post-mount
    // apply needed.
    expect(getByTestId("state").textContent).toBe("collapsed");
  });
});

describe("useSavedRegionScroll", () => {
  test("outside a card: returns undefined", () => {
    let seen: SavedRegionScroll | undefined = { x: 999, y: 999 };
    function Probe(): null {
      seen = useSavedRegionScroll("foo/term-scroll");
      return null;
    }
    render(<Probe />);
    expect(seen).toBeUndefined();
  });

  test("undefined scrollKey: returns undefined", () => {
    let seen: SavedRegionScroll | undefined = { x: 999, y: 999 };
    function Probe(): null {
      seen = useSavedRegionScroll(undefined);
      return null;
    }
    render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue({
          regionScroll: { "foo/term-scroll": { x: 0, y: 240 } },
        })}
      >
        <Probe />
      </CardComponentStatePreservationContext.Provider>,
    );
    expect(seen).toBeUndefined();
  });

  test("inside a card with a saved scroll: returns the {x, y, meta} snapshot", () => {
    let seen: SavedRegionScroll | undefined;
    function Probe(): null {
      seen = useSavedRegionScroll("foo/term-scroll");
      return null;
    }
    render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue({
          regionScroll: { "foo/term-scroll": { x: 0, y: 240 } },
        })}
      >
        <Probe />
      </CardComponentStatePreservationContext.Provider>,
    );
    expect(seen).toEqual({ x: 0, y: 240 });
  });

  test("inside a card with no saved value for the scrollKey: returns undefined", () => {
    let seen: SavedRegionScroll | undefined = { x: 999, y: 999 };
    function Probe(): null {
      seen = useSavedRegionScroll("absent");
      return null;
    }
    render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue({
          regionScroll: { "other": { x: 0, y: 100 } },
        })}
      >
        <Probe />
      </CardComponentStatePreservationContext.Provider>,
    );
    expect(seen).toBeUndefined();
  });
});
