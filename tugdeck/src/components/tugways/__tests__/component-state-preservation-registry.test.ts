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
 * The registry is capture-only: there is no `restoreState` and no
 * `observeRegister` channel. The hook layer feeds saved
 * state into consumers via `useSavedComponentState` /
 * `useSavedRegionScroll` at render time, not via a post-mount
 * registry-observer apply pass.
 *
 * The capture closure carried through the registry holds the
 * component's latest `captureState`; these tests use simple `.current`
 * slots that never change, because registry semantics are independent
 * of ref sync.
 */

import { describe, test, expect } from "bun:test";
import type { RefObject } from "react";
import { ComponentStatePreservationRegistry } from "../component-state-preservation-registry";

function makeCaptureRef<T>(fn: () => T): RefObject<() => unknown> {
  return { current: fn as () => unknown };
}

describe("ComponentStatePreservationRegistry — tree-order iteration", () => {
  test("entriesInTreeOrder returns parents before descendants", () => {
    const registry = new ComponentStatePreservationRegistry();
    // Deliberate mixed registration order — iteration order must come
    // from treePath, not insertion order.
    registry.register(
      "child-deep",
      makeCaptureRef(() => "deep"),
      [0, 1, 0],
    );
    registry.register(
      "root",
      makeCaptureRef(() => "root"),
      [],
    );
    registry.register(
      "child-a",
      makeCaptureRef(() => "a"),
      [0],
    );
    registry.register(
      "child-b",
      makeCaptureRef(() => "b"),
      [1],
    );
    registry.register(
      "grandchild",
      makeCaptureRef(() => "gc"),
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
      [2],
    );
    registry.register(
      "s0",
      makeCaptureRef(() => 0),
      [0],
    );
    registry.register(
      "s1",
      makeCaptureRef(() => 0),
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
      [0],
    );
    registry.register(
      "second",
      makeCaptureRef(() => 0),
      [0],
    );
    registry.register(
      "third",
      makeCaptureRef(() => 0),
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
      [0],
    );
    expect(() => {
      registry.register(
        "dup",
        makeCaptureRef(() => 0),
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
      [],
    );
    expect(() => registry.unregister("ghost")).not.toThrow();
    expect(registry.keys()).toEqual(new Set(["present"]));
  });
});

describe("ComponentStatePreservationRegistry — clear", () => {
  test("clear empties the registry", () => {
    const registry = new ComponentStatePreservationRegistry();
    registry.register(
      "a",
      makeCaptureRef(() => 0),
      [0],
    );
    registry.register(
      "b",
      makeCaptureRef(() => 0),
      [1],
    );
    registry.clear();
    expect(registry.keys().size).toBe(0);
    expect(registry.entriesInTreeOrder()).toEqual([]);

    // Registering after clear starts fresh.
    registry.register(
      "a",
      makeCaptureRef(() => 0),
      [0],
    );
    expect(registry.keys()).toEqual(new Set(["a"]));
  });
});
