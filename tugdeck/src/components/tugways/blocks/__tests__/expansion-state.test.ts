/**
 * Pure-logic coverage for `ToolBlockExpansionState` — the sparse
 * per-card expansion overrides behind history-collapsed tool blocks.
 */

import { describe, expect, test } from "bun:test";

import {
  ToolBlockExpansionState,
  type PersistedExpansionState,
} from "../expansion-state";

describe("ToolBlockExpansionState", () => {
  test("resolves to the default when untouched", () => {
    const state = new ToolBlockExpansionState();
    expect(state.resolve("t1", true)).toBe(true);
    expect(state.resolve("t1", false)).toBe(false);
    expect(state.size).toBe(0);
  });

  test("stores only values that differ from the default", () => {
    const state = new ToolBlockExpansionState();
    state.set("t1", false, true); // expand a default-collapsed block
    expect(state.resolve("t1", true)).toBe(false);
    expect(state.size).toBe(1);

    state.set("t1", true, true); // collapse it again — back to default
    expect(state.resolve("t1", true)).toBe(true);
    expect(state.size).toBe(0);
  });

  test("persists nothing when no overrides exist", () => {
    const state = new ToolBlockExpansionState();
    expect(state.toPersisted()).toBeUndefined();
    state.set("t1", true, true);
    expect(state.toPersisted()).toBeUndefined();
  });

  test("round-trips overrides through the persisted shape", () => {
    const state = new ToolBlockExpansionState();
    state.set("t1", false, true);
    state.set("t2", false, true);
    const persisted = state.toPersisted();
    expect(persisted).toEqual({ overrides: { t1: false, t2: false } });

    const restored = new ToolBlockExpansionState();
    restored.seed(persisted);
    expect(restored.resolve("t1", true)).toBe(false);
    expect(restored.resolve("t2", true)).toBe(false);
    expect(restored.resolve("t3", true)).toBe(true);
  });

  test("notifies (and bumps version) only on a resolved-value change", () => {
    const state = new ToolBlockExpansionState();
    let calls = 0;
    const unsubscribe = state.subscribe(() => {
      calls += 1;
    });

    expect(state.version).toBe(0);
    state.set("t1", false, true); // expand: resolved true -> false
    expect(calls).toBe(1);
    expect(state.version).toBe(1);

    state.set("t1", false, true); // same resolved value - silent
    expect(calls).toBe(1);
    expect(state.version).toBe(1);

    state.set("t1", true, true); // collapse back to default - a real change
    expect(calls).toBe(2);
    expect(state.version).toBe(2);

    state.set("t2", true, true); // already the default - silent
    expect(calls).toBe(2);

    unsubscribe();
    state.set("t1", false, true);
    expect(calls).toBe(2); // unsubscribed - no further notifications
    expect(state.version).toBe(3); // version still tracks the change
  });

  test("seed does not notify", () => {
    const state = new ToolBlockExpansionState();
    let calls = 0;
    state.subscribe(() => {
      calls += 1;
    });
    state.seed({ overrides: { t1: false } });
    expect(calls).toBe(0);
    expect(state.version).toBe(0);
    expect(state.resolve("t1", true)).toBe(false);
  });

  test("seed tolerates malformed saved values", () => {
    const state = new ToolBlockExpansionState();
    state.seed(undefined);
    state.seed({} as PersistedExpansionState);
    state.seed({ overrides: null } as unknown as PersistedExpansionState);
    state.seed({
      overrides: { good: false, bad: "nope" },
    } as unknown as PersistedExpansionState);
    expect(state.resolve("good", true)).toBe(false);
    expect(state.resolve("bad", true)).toBe(true);
    expect(state.size).toBe(1);
  });
});
