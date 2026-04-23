/**
 * CardStateOrchestrator behavior tests.
 *
 * Pins the contract that every save trigger now routes through a
 * single entry point ([D13], [A9c]):
 *
 *   1. Empty registry + unregistered card → empty bag. (Identity for
 *      the "no state" baseline.)
 *   2. A card with only an assembler (no opt-in components) returns
 *      the same bag its assembler produced — `bag.components` stays
 *      `undefined` (clean round-trip, no empty objects).
 *   3. A card with registered components harvests each component's
 *      `captureState` parent-first into `bag.components`.
 *   4. Nested `<PersistenceScope>` prefixing → scoped keys land in the
 *      bag as the scoped form (the registry's sort key).
 *   5. `restoreCardState` invokes each component's `restoreState` in
 *      parent-first order.
 *   6. Orphan persistKeys (present in `bag.components` but not
 *      registered) are silently dropped; a single dev-warn lists them.
 *   7. Throwing `captureState` / `restoreState` closures are logged
 *      and skipped — one misbehaving component never blocks a save or
 *      restore.
 *   8. Parity: the orchestrator output includes the same axes a
 *      pre-refactor direct assembler call would have produced (every
 *      framework axis + `bag.components` when applicable), so the
 *      `saveState` RPC (which calls `saveAndFlushSync` → the
 *      orchestrator) picks up `bag.components` by construction.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { RefObject } from "react";
import {
  CardStateOrchestrator,
  type CardAssembler,
  type ComponentRegistryLookup,
} from "../card-state-orchestrator";
import { ComponentPersistenceRegistry } from "../components/tugways/component-persistence-registry";
import type { CardStateBag } from "../layout-tree";

function makeCaptureRef<T>(fn: () => T): RefObject<() => unknown> {
  return { current: fn as () => unknown };
}
function makeRestoreRef<T>(
  fn: (saved: T) => void,
): RefObject<(saved: unknown) => void> {
  return { current: fn as (saved: unknown) => void };
}

function makeOrchestrator(
  registries: Map<string, ComponentPersistenceRegistry>,
): CardStateOrchestrator {
  const lookup: ComponentRegistryLookup = (cardId) => registries.get(cardId);
  return new CardStateOrchestrator(lookup);
}

function makeAssembler(bag: CardStateBag): CardAssembler {
  return { capture: () => bag };
}

// ----------------------------------------------------------------------------

describe("CardStateOrchestrator — capture", () => {
  test("unregistered card + empty registry returns empty bag", () => {
    const registries = new Map<string, ComponentPersistenceRegistry>();
    const orchestrator = makeOrchestrator(registries);
    expect(orchestrator.captureCardState("nobody")).toEqual({});
  });

  test("assembler with no components returns its own bag verbatim; components stays undefined", () => {
    const registries = new Map<string, ComponentPersistenceRegistry>();
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
    const registries = new Map<string, ComponentPersistenceRegistry>();
    const registry = new ComponentPersistenceRegistry();
    registries.set("card-a", registry);

    // Deliberate mixed registration order — harvest order comes from
    // treePath, not insertion order.
    registry.register(
      "child-b",
      makeCaptureRef(() => ({ checked: true })),
      makeRestoreRef(() => undefined),
      [1],
    );
    registry.register(
      "root",
      makeCaptureRef(() => ({ value: "hello" })),
      makeRestoreRef(() => undefined),
      [],
    );
    registry.register(
      "child-a",
      makeCaptureRef(() => 42),
      makeRestoreRef(() => undefined),
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

  test("scoped persistKeys from <PersistenceScope> land as scoped keys in bag.components", () => {
    const registries = new Map<string, ComponentPersistenceRegistry>();
    const registry = new ComponentPersistenceRegistry();
    registries.set("card-a", registry);

    // Simulate what useComponentPersistence under a <PersistenceScope>
    // would produce: scoped keys like "panel/expanded".
    registry.register(
      "panel/expanded",
      makeCaptureRef(() => true),
      makeRestoreRef(() => undefined),
      [0],
    );
    registry.register(
      "panel/inner/leaf",
      makeCaptureRef(() => "deep"),
      makeRestoreRef(() => undefined),
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
    const registries = new Map<string, ComponentPersistenceRegistry>();
    const registry = new ComponentPersistenceRegistry();
    registries.set("card-a", registry);
    registry.register(
      "ck",
      makeCaptureRef(() => true),
      makeRestoreRef(() => undefined),
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
    const registries = new Map<string, ComponentPersistenceRegistry>();
    registries.set("card-a", new ComponentPersistenceRegistry()); // present but empty

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

describe("CardStateOrchestrator — restore", () => {
  test("dispatches bag.components to each component parent-first", () => {
    const registries = new Map<string, ComponentPersistenceRegistry>();
    const registry = new ComponentPersistenceRegistry();
    registries.set("card-a", registry);

    const calls: Array<[string, unknown]> = [];
    registry.register(
      "grand",
      makeCaptureRef(() => undefined),
      makeRestoreRef((v) => calls.push(["grand", v])),
      [0, 0],
    );
    registry.register(
      "root",
      makeCaptureRef(() => undefined),
      makeRestoreRef((v) => calls.push(["root", v])),
      [],
    );
    registry.register(
      "child",
      makeCaptureRef(() => undefined),
      makeRestoreRef((v) => calls.push(["child", v])),
      [0],
    );

    const orchestrator = makeOrchestrator(registries);
    orchestrator.restoreCardState("card-a", {
      components: { root: "R", child: "C", grand: "G" },
    });

    expect(calls).toEqual([
      ["root", "R"],
      ["child", "C"],
      ["grand", "G"],
    ]);
  });

  test("is a no-op when bag.components is absent", () => {
    const orchestrator = makeOrchestrator(new Map());
    // Does not throw even though no registry is present for this card.
    orchestrator.restoreCardState("card-a", { scroll: { x: 0, y: 0 } });
  });

  test("orphan persistKeys are dropped with a dev-warn", () => {
    const registries = new Map<string, ComponentPersistenceRegistry>();
    const registry = new ComponentPersistenceRegistry();
    registries.set("card-a", registry);

    const restored: string[] = [];
    registry.register(
      "present",
      makeCaptureRef(() => undefined),
      makeRestoreRef((v) => restored.push(`${v}`)),
      [],
    );

    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args);
    };
    try {
      const orchestrator = makeOrchestrator(registries);
      orchestrator.restoreCardState("card-a", {
        components: { present: "hello", gone: "ignored" },
      });
      expect(restored).toEqual(["hello"]);
      const orphanWarn = warnings.find(
        (args) =>
          typeof args[0] === "string" &&
          args[0].includes("orphan persistKeys dropped"),
      );
      expect(orphanWarn).toBeDefined();
      expect(orphanWarn![1]).toEqual(["gone"]);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("component without a registry warns and drops bag.components", () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args);
    };
    try {
      const orchestrator = makeOrchestrator(new Map());
      orchestrator.restoreCardState("unknown-card", {
        components: { a: 1, b: 2 },
      });
      const warn = warnings.find(
        (args) =>
          typeof args[0] === "string" &&
          args[0].includes('card "unknown-card" has no component registry'),
      );
      expect(warn).toBeDefined();
    } finally {
      console.warn = originalWarn;
    }
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
    const registries = new Map<string, ComponentPersistenceRegistry>();
    const registry = new ComponentPersistenceRegistry();
    registries.set("card-a", registry);

    registry.register(
      "ok-before",
      makeCaptureRef(() => "A"),
      makeRestoreRef(() => undefined),
      [0],
    );
    registry.register(
      "broken",
      makeCaptureRef(() => {
        throw new Error("boom");
      }),
      makeRestoreRef(() => undefined),
      [1],
    );
    registry.register(
      "ok-after",
      makeCaptureRef(() => "B"),
      makeRestoreRef(() => undefined),
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

  test("throwing restoreState is skipped; other components still restore", () => {
    const registries = new Map<string, ComponentPersistenceRegistry>();
    const registry = new ComponentPersistenceRegistry();
    registries.set("card-a", registry);

    const restored: string[] = [];
    registry.register(
      "ok-before",
      makeCaptureRef(() => undefined),
      makeRestoreRef((v) => restored.push(`before:${v}`)),
      [0],
    );
    registry.register(
      "broken",
      makeCaptureRef(() => undefined),
      makeRestoreRef(() => {
        throw new Error("boom");
      }),
      [1],
    );
    registry.register(
      "ok-after",
      makeCaptureRef(() => undefined),
      makeRestoreRef((v) => restored.push(`after:${v}`)),
      [2],
    );

    const orchestrator = makeOrchestrator(registries);
    orchestrator.restoreCardState("card-a", {
      components: { "ok-before": "X", broken: "Y", "ok-after": "Z" },
    });
    expect(restored).toEqual(["before:X", "after:Z"]);
    const restoreWarn = warns.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes('restoreState threw for "broken"'),
    );
    expect(restoreWarn).toBeDefined();
  });
});

describe("CardStateOrchestrator — saveState RPC parity", () => {
  test("bag includes every framework axis the assembler emits plus bag.components", () => {
    // Simulate what CardHost's assembler would emit after Step 18:
    // the pre-refactor framework bag verbatim, with components layered
    // on top by the orchestrator. The `saveState` RPC calls
    // `saveAndFlushSync` → each card's save callback →
    // `captureCardState`, so the RPC now returns this exact shape by
    // construction (closes [M17]).
    const registries = new Map<string, ComponentPersistenceRegistry>();
    const registry = new ComponentPersistenceRegistry();
    registries.set("card-a", registry);
    registry.register(
      "checkbox",
      makeCaptureRef(() => true),
      makeRestoreRef(() => undefined),
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
      focus: { kind: "form-control", persistKey: "name" },
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
    expect(bag.focus).toEqual({ kind: "form-control", persistKey: "name" });
    // Component harvest layered on top.
    expect(bag.components).toEqual({ checkbox: true });
  });
});
