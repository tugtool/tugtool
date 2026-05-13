/**
 * ComponentStatePreservationRegistry — registry semantics under the
 * Component State Preservation Protocol ([D13], [A9]).
 *
 * These tests pin the primitives the framework relies on without
 * exercising the React hook layer above it:
 *
 *   1. Parent-first tree-order iteration — harvesting must visit
 *      ancestors before descendants (per [D13] / Q3 resolution) so a
 *      composite's capture sees a consistent subtree.
 *   2. Duplicate scopedKey throws in dev — the dev-only invariant that
 *      catches componentStatePreservationKey collisions at registration
 *      time rather than silently overwriting state at capture time.
 *   3. Unregister removes an entry cleanly and frees the key.
 *   4. clear() empties the registry in one shot (called from the deck
 *      manager's card-destruction path).
 *
 * The refs carried through the registry hold the component's latest
 * captureState / restoreState closures; these tests use simple `.current`
 * slots that never change, because registry semantics are independent of
 * ref sync.
 */

import { describe, test, expect } from "bun:test";
import type { RefObject } from "react";
import { ComponentStatePreservationRegistry } from "../component-state-preservation-registry";

function makeCaptureRef<T>(fn: () => T): RefObject<() => unknown> {
  return { current: fn as () => unknown };
}

function makeRestoreRef<T>(
  fn: (saved: T) => void,
): RefObject<(saved: unknown) => void> {
  return { current: fn as (saved: unknown) => void };
}

describe("ComponentStatePreservationRegistry — tree-order iteration", () => {
  test("entriesInTreeOrder returns parents before descendants", () => {
    const registry = new ComponentStatePreservationRegistry();
    // Deliberate mixed registration order — iteration order must come
    // from treePath, not insertion order.
    registry.register(
      "child-deep",
      makeCaptureRef(() => "deep"),
      makeRestoreRef(() => undefined),
      [0, 1, 0],
    );
    registry.register(
      "root",
      makeCaptureRef(() => "root"),
      makeRestoreRef(() => undefined),
      [],
    );
    registry.register(
      "child-a",
      makeCaptureRef(() => "a"),
      makeRestoreRef(() => undefined),
      [0],
    );
    registry.register(
      "child-b",
      makeCaptureRef(() => "b"),
      makeRestoreRef(() => undefined),
      [1],
    );
    registry.register(
      "grandchild",
      makeCaptureRef(() => "gc"),
      makeRestoreRef(() => undefined),
      [0, 1],
    );

    const keysInOrder = registry.entriesInTreeOrder().map(([k]) => k);
    expect(keysInOrder).toEqual([
      "root",
      "child-a",
      "grandchild",
      "child-deep",
      "child-b",
    ]);
  });

  test("sibling order follows tree-path index", () => {
    const registry = new ComponentStatePreservationRegistry();
    registry.register(
      "s2",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [2],
    );
    registry.register(
      "s0",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [0],
    );
    registry.register(
      "s1",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [1],
    );

    expect(registry.entriesInTreeOrder().map(([k]) => k)).toEqual([
      "s0",
      "s1",
      "s2",
    ]);
  });

  test("entries with identical treePath fall back to insertion order", () => {
    const registry = new ComponentStatePreservationRegistry();
    registry.register(
      "first",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [0],
    );
    registry.register(
      "second",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [0],
    );
    registry.register(
      "third",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [0],
    );

    expect(registry.entriesInTreeOrder().map(([k]) => k)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("ComponentStatePreservationRegistry — uniqueness", () => {
  test("duplicate scopedKey throws in dev", () => {
    const registry = new ComponentStatePreservationRegistry();
    registry.register(
      "dup",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [0],
    );
    expect(() => {
      registry.register(
        "dup",
        makeCaptureRef(() => 0),
        makeRestoreRef(() => undefined),
        [1],
      );
    }).toThrow(/duplicate componentStatePreservationKey within card scope: "dup"/);
  });
});

describe("ComponentStatePreservationRegistry — unregister", () => {
  test("unregister removes the entry and frees the key", () => {
    const registry = new ComponentStatePreservationRegistry();
    registry.register(
      "one",
      makeCaptureRef(() => "A"),
      makeRestoreRef(() => undefined),
      [0],
    );
    expect(registry.keys()).toEqual(new Set(["one"]));

    registry.unregister("one");
    expect(registry.keys().size).toBe(0);
    expect(registry.entriesInTreeOrder()).toEqual([]);

    // Same key can be re-registered after unregister.
    registry.register(
      "one",
      makeCaptureRef(() => "B"),
      makeRestoreRef(() => undefined),
      [0],
    );
    const [[, entry]] = registry.entriesInTreeOrder();
    expect(entry.captureRef.current!()).toBe("B");
  });

  test("unregister on unknown key is a no-op", () => {
    const registry = new ComponentStatePreservationRegistry();
    registry.register(
      "present",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [],
    );
    expect(() => registry.unregister("ghost")).not.toThrow();
    expect(registry.keys()).toEqual(new Set(["present"]));
  });
});

describe("ComponentStatePreservationRegistry — observeRegister", () => {
  test("fires synchronously on register with scopedKey + entry", () => {
    const registry = new ComponentStatePreservationRegistry();
    const calls: Array<[string, () => unknown]> = [];
    registry.observeRegister((scopedKey, entry) => {
      // Capture both the key and the entry's capture closure so we can
      // assert the observer received the freshly-installed entry, not
      // a stale read.
      calls.push([scopedKey, entry.captureRef.current!]);
    });

    const cap = () => "hello";
    registry.register("k", makeCaptureRef(cap), makeRestoreRef(() => undefined), [0]);

    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("k");
    expect(calls[0][1]()).toBe("hello");
  });

  test("multiple subscribers all fire in subscription order", () => {
    const registry = new ComponentStatePreservationRegistry();
    const order: string[] = [];
    registry.observeRegister(() => order.push("a"));
    registry.observeRegister(() => order.push("b"));
    registry.observeRegister(() => order.push("c"));

    registry.register("k", makeCaptureRef(() => 0), makeRestoreRef(() => undefined), []);
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("unsubscribe stops further notifications", () => {
    const registry = new ComponentStatePreservationRegistry();
    let fired = 0;
    const unsubscribe = registry.observeRegister(() => {
      fired++;
    });

    registry.register("first", makeCaptureRef(() => 0), makeRestoreRef(() => undefined), [0]);
    expect(fired).toBe(1);
    unsubscribe();
    registry.register("second", makeCaptureRef(() => 0), makeRestoreRef(() => undefined), [1]);
    expect(fired).toBe(1);
  });

  test("throwing observer does not prevent registration nor stop later observers", () => {
    const registry = new ComponentStatePreservationRegistry();
    let laterFired = false;

    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      registry.observeRegister(() => {
        throw new Error("boom");
      });
      registry.observeRegister(() => {
        laterFired = true;
      });

      expect(() => {
        registry.register(
          "k",
          makeCaptureRef(() => 1),
          makeRestoreRef(() => undefined),
          [],
        );
      }).not.toThrow();
      // Both that the registration landed and that the later observer
      // still got called.
      expect(registry.keys().has("k")).toBe(true);
      expect(laterFired).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("clear() drops observers — no notifications after clear", () => {
    const registry = new ComponentStatePreservationRegistry();
    let fired = 0;
    registry.observeRegister(() => {
      fired++;
    });
    registry.register("a", makeCaptureRef(() => 0), makeRestoreRef(() => undefined), [0]);
    expect(fired).toBe(1);

    registry.clear();
    registry.register("b", makeCaptureRef(() => 0), makeRestoreRef(() => undefined), [0]);
    expect(fired).toBe(1);
  });
});

describe("ComponentStatePreservationRegistry — clear", () => {
  test("clear empties the registry", () => {
    const registry = new ComponentStatePreservationRegistry();
    registry.register(
      "a",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [0],
    );
    registry.register(
      "b",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [1],
    );
    registry.clear();
    expect(registry.keys().size).toBe(0);
    expect(registry.entriesInTreeOrder()).toEqual([]);

    // Registering after clear starts fresh.
    registry.register(
      "a",
      makeCaptureRef(() => 0),
      makeRestoreRef(() => undefined),
      [0],
    );
    expect(registry.keys()).toEqual(new Set(["a"]));
  });
});
