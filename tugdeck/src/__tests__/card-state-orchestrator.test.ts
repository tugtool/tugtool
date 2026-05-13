/**
 * CardStateOrchestrator behavior tests (capture-only after Phase E.8).
 *
 * Pins the contract that every save trigger routes through a single
 * entry point ([D13], [A9c]):
 *
 *   1. Empty registry + unregistered card → empty bag.
 *   2. A card with only an assembler (no opt-in components) returns
 *      the same bag its assembler produced — `bag.components` stays
 *      `undefined` (clean round-trip, no empty objects).
 *   3. A card with registered components harvests each component's
 *      `captureState` parent-first into `bag.components`.
 *   4. Nested `<ComponentStatePreservationScope>` prefixing → scoped
 *      keys land in the bag as the scoped form (the registry's sort
 *      key).
 *   5. Throwing `captureState` closures are logged and skipped — one
 *      misbehaving component never blocks a save.
 *   6. Parity: the orchestrator output includes the same axes a
 *      pre-refactor direct assembler call would have produced (every
 *      framework axis + `bag.components` when applicable), so the
 *      `saveState` RPC (which calls `saveAndFlushSync` → the
 *      orchestrator) picks up `bag.components` by construction.
 *
 * The restore side is intentionally absent: after Phase E.8 components
 * mount in their saved state via `useSavedComponentState` /
 * `useSavedRegionScroll` inside `useState` initializers. There is no
 * `restoreCardState` entry point and no observer channel; the
 * orchestrator is capture-only.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { RefObject } from "react";
import {
  CardStateOrchestrator,
  type CardAssembler,
  type ComponentStatePreservationRegistryLookup,
} from "../card-state-orchestrator";
import { ComponentStatePreservationRegistry } from "../components/tugways/component-state-preservation-registry";
import type { CardStateBag } from "../layout-tree";

function makeCaptureRef<T>(fn: () => T): RefObject<() => unknown> {
  return { current: fn as () => unknown };
}

function makeOrchestrator(
  registries: Map<string, ComponentStatePreservationRegistry>,
): CardStateOrchestrator {
  const lookup: ComponentStatePreservationRegistryLookup = (cardId) =>
    registries.get(cardId);
  return new CardStateOrchestrator(lookup);
}

function makeAssembler(bag: CardStateBag): CardAssembler {
  return { capture: () => bag };
}

// ----------------------------------------------------------------------------

describe("CardStateOrchestrator — capture", () => {
  test("unregistered card + empty registry returns empty bag", () => {
    const registries = new Map<string, ComponentStatePreservationRegistry>();
    const orchestrator = makeOrchestrator(registries);
    expect(orchestrator.captureCardState("nobody")).toEqual({});
  });

  test("assembler with no components returns its own bag verbatim; components stays undefined", () => {
    const registries = new Map<string, ComponentStatePreservationRegistry>();
    const orchestrator = makeOrchestrator(registries);

    const frameworkBag: CardStateBag = {
      scroll: { x: 10, y: 20 },
      formControls: { name: { value: "Ken" } },
    };
    orchestrator.registerAssembler("card-a", makeAssembler(frameworkBag));

    const bag = orchestrator.captureCardState("card-a");
    expect(bag).toEqual(frameworkBag);
    expect(bag.components).toBeUndefined();
  });

  test("harvests registered components into bag.components parent-first", () => {
    const registries = new Map<string, ComponentStatePreservationRegistry>();
    const registry = new ComponentStatePreservationRegistry();
    registries.set("card-a", registry);

    // Deliberate mixed registration order — harvest order comes from
    // treePath, not insertion order.
    registry.register(
      "child-b",
      makeCaptureRef(() => ({ checked: true })),
      [1],
    );
    registry.register(
      "root",
      makeCaptureRef(() => ({ value: "hello" })),
      [],
    );
    registry.register(
      "child-a",
      makeCaptureRef(() => 42),
      [0],
    );

    const orchestrator = makeOrchestrator(registries);
    orchestrator.registerAssembler("card-a", makeAssembler({}));

    const bag = orchestrator.captureCardState("card-a");
    expect(bag.components).toEqual({
      root: { value: "hello" },
      "child-a": 42,
      "child-b": { checked: true },
    });
    // Parent-first ordering is a property of the registry, but assert
    // on keys here to confirm the orchestrator preserved it.
    expect(Object.keys(bag.components ?? {})).toEqual([
      "root",
      "child-a",
      "child-b",
    ]);
  });

  test("scoped componentStatePreservationKeys from <ComponentStatePreservationScope> land as scoped keys in bag.components", () => {
    const registries = new Map<string, ComponentStatePreservationRegistry>();
    const registry = new ComponentStatePreservationRegistry();
    registries.set("card-a", registry);

    // Simulate what useComponentStatePreservation under a
    // <ComponentStatePreservationScope> would produce: scoped keys like
    // "panel/expanded".
    registry.register(
      "panel/expanded",
      makeCaptureRef(() => true),
      [0],
    );
    registry.register(
      "panel/inner/leaf",
      makeCaptureRef(() => "deep"),
      [0, 0],
    );

    const orchestrator = makeOrchestrator(registries);
    orchestrator.registerAssembler("card-a", makeAssembler({}));

    const bag = orchestrator.captureCardState("card-a");
    expect(bag.components).toEqual({
      "panel/expanded": true,
      "panel/inner/leaf": "deep",
    });
  });

  test("merges framework axes with bag.components without mutating the assembler's bag", () => {
    const registries = new Map<string, ComponentStatePreservationRegistry>();
    const registry = new ComponentStatePreservationRegistry();
    registries.set("card-a", registry);
    registry.register(
      "ck",
      makeCaptureRef(() => true),
      [],
    );

    const orchestrator = makeOrchestrator(registries);
    const frameworkBag: CardStateBag = { scroll: { x: 1, y: 2 } };
    orchestrator.registerAssembler("card-a", makeAssembler(frameworkBag));

    const bag = orchestrator.captureCardState("card-a");
    expect(bag).toEqual({ scroll: { x: 1, y: 2 }, components: { ck: true } });
    // Assembler's own bag must not be mutated — callers relying on
    // stable identity (or structural equality against a fixture) would
    // otherwise observe pollution.
    expect(frameworkBag.components).toBeUndefined();
  });

  test("registry with no entries leaves bag.components undefined", () => {
    const registries = new Map<string, ComponentStatePreservationRegistry>();
    registries.set("card-a", new ComponentStatePreservationRegistry()); // present but empty

    const orchestrator = makeOrchestrator(registries);
    orchestrator.registerAssembler("card-a", makeAssembler({}));

    const bag = orchestrator.captureCardState("card-a");
    expect(bag.components).toBeUndefined();
  });
});

describe("CardStateOrchestrator — assembler lifecycle", () => {
  test("unregister returned from registerAssembler tears down the entry", () => {
    const orchestrator = makeOrchestrator(new Map());
    const unregister = orchestrator.registerAssembler(
      "card-a",
      makeAssembler({ scroll: { x: 1, y: 1 } }),
    );
    expect(orchestrator.captureCardState("card-a")).toEqual({
      scroll: { x: 1, y: 1 },
    });
    unregister();
    expect(orchestrator.captureCardState("card-a")).toEqual({});
  });

  test("unregister is a no-op when the slot has been replaced by a later register", () => {
    const orchestrator = makeOrchestrator(new Map());
    const unregisterFirst = orchestrator.registerAssembler(
      "card-a",
      makeAssembler({ content: "v1" }),
    );
    orchestrator.registerAssembler("card-a", makeAssembler({ content: "v2" }));
    unregisterFirst();
    // The later registration should still be active.
    expect(orchestrator.captureCardState("card-a")).toEqual({ content: "v2" });
  });
});

describe("CardStateOrchestrator — error tolerance", () => {
  let warns: unknown[][];
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    warns = [];
    originalWarn = console.warn;
    console.warn = (...args) => {
      warns.push(args);
    };
  });
  afterEach(() => {
    console.warn = originalWarn;
  });

  test("throwing captureState is skipped; other components still harvest", () => {
    const registries = new Map<string, ComponentStatePreservationRegistry>();
    const registry = new ComponentStatePreservationRegistry();
    registries.set("card-a", registry);

    registry.register(
      "ok-before",
      makeCaptureRef(() => "A"),
      [0],
    );
    registry.register(
      "broken",
      makeCaptureRef(() => {
        throw new Error("boom");
      }),
      [1],
    );
    registry.register(
      "ok-after",
      makeCaptureRef(() => "B"),
      [2],
    );

    const orchestrator = makeOrchestrator(registries);
    orchestrator.registerAssembler("card-a", makeAssembler({}));

    const bag = orchestrator.captureCardState("card-a");
    expect(bag.components).toEqual({ "ok-before": "A", "ok-after": "B" });
    const captureWarn = warns.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes('captureState threw for "broken"'),
    );
    expect(captureWarn).toBeDefined();
  });
});

describe("CardStateOrchestrator — saveState RPC parity", () => {
  test("bag includes every framework axis the assembler emits plus bag.components", () => {
    // Simulate what CardHost's assembler emits: the pre-refactor
    // framework bag verbatim, with components layered on top by the
    // orchestrator. The `saveState` RPC calls `saveAndFlushSync` →
    // each card's save callback → `captureCardState`, so the RPC
    // returns this exact shape by construction ([AT0017]).
    const registries = new Map<string, ComponentStatePreservationRegistry>();
    const registry = new ComponentStatePreservationRegistry();
    registries.set("card-a", registry);
    registry.register(
      "checkbox",
      makeCaptureRef(() => true),
      [],
    );

    const frameworkBag: CardStateBag = {
      scroll: { x: 5, y: 10 },
      content: { text: "hi" },
      formControls: { name: { value: "Ken" } },
      regionScroll: { scroller: { x: 0, y: 42 } },
      domSelection: {
        anchorPath: [0],
        anchorOffset: 0,
        focusPath: [0],
        focusOffset: 1,
      },
      focus: { kind: "form-control", componentStatePreservationKey: "name" },
    };
    const orchestrator = makeOrchestrator(registries);
    orchestrator.registerAssembler("card-a", makeAssembler(frameworkBag));

    const bag = orchestrator.captureCardState("card-a");
    // Axes preserved verbatim.
    expect(bag.scroll).toEqual({ x: 5, y: 10 });
    expect(bag.content).toEqual({ text: "hi" });
    expect(bag.formControls?.["name"].value).toBe("Ken");
    expect(bag.regionScroll?.["scroller"]).toEqual({ x: 0, y: 42 });
    expect(bag.domSelection?.focusOffset).toBe(1);
    expect(bag.focus).toEqual({ kind: "form-control", componentStatePreservationKey: "name" });
    // Component harvest layered on top.
    expect(bag.components).toEqual({ checkbox: true });
  });
});
