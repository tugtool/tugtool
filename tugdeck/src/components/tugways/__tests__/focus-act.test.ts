/**
 * focus-act -- pure-logic tests for the act-dispatch resolver ([P01]).
 *
 * Data-in / data-out over `resolveFocusAct`: (key, declaration) → abstract act.
 * No DOM, no mock stores — the resolver is the implementation and these pin its
 * decision table directly. The wiring that carries each act out against the
 * manager is exercised in the real app via app-test.
 */

import { describe, expect, test } from "bun:test";

import {
  captureSet,
  isMovementKey,
  resolveFocusAct,
  type ComponentKeyDeclaration,
  type FocusKey,
} from "../focus-act";

const k = (key: string, mods: Partial<FocusKey> = {}): FocusKey => ({ key, ...mods });

describe("resolveFocusAct — act tier", () => {
  test("Space selects in an item container, acts on a leaf", () => {
    expect(resolveFocusAct(k(" "), { container: "item" })).toBe("select");
    expect(resolveFocusAct(k(" "), { container: "none" })).toBe("act");
    // legacy "Spacebar" spelling is treated the same
    expect(resolveFocusAct(k("Spacebar"), { container: "item" })).toBe("select");
  });

  test("Enter acts by default, descends when the current item is navigable", () => {
    expect(resolveFocusAct(k("Enter"), { container: "item" })).toBe("act");
    expect(
      resolveFocusAct(k("Enter"), { container: "item", currentItemDescendable: true }),
    ).toBe("descend");
    expect(resolveFocusAct(k("Enter"), { container: "none" })).toBe("act");
  });

  test("a single-select item container passes Enter through to the default", () => {
    // Selection follows the cursor, so Return is not consumed — it bubbles to
    // the scope default action ([P12]).
    expect(
      resolveFocusAct(k("Enter"), { container: "item", singleSelect: true }),
    ).toBe("passthrough");
    // descendable is moot under single-select — passthrough still wins.
    expect(
      resolveFocusAct(k("Enter"), {
        container: "item",
        singleSelect: true,
        currentItemDescendable: true,
      }),
    ).toBe("passthrough");
    // The flag is item-container-only: a leaf still acts.
    expect(
      resolveFocusAct(k("Enter"), { container: "none", singleSelect: true }),
    ).toBe("act");
    // Space still selects the cursor row (harmless — already selected).
    expect(
      resolveFocusAct(k(" "), { container: "item", singleSelect: true }),
    ).toBe("select");
  });

  test("Escape ascends, cancels at a modal scope", () => {
    expect(resolveFocusAct(k("Escape"), { container: "component" })).toBe("ascend");
    expect(resolveFocusAct(k("Escape"), { container: "component", modal: true })).toBe(
      "cancel",
    );
  });
});

describe("resolveFocusAct — movement tier", () => {
  test("movement keys move the cursor only in an item container", () => {
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) {
      expect(isMovementKey(key)).toBe(true);
      expect(resolveFocusAct(k(key), { container: "item" })).toBe("move");
      expect(resolveFocusAct(k(key), { container: "none" })).toBe("passthrough");
      expect(resolveFocusAct(k(key), { container: "component" })).toBe("passthrough");
    }
  });

  test("unknown keys pass through", () => {
    expect(resolveFocusAct(k("a"), { container: "item" })).toBe("passthrough");
    expect(isMovementKey("a")).toBe(false);
  });
});

describe("resolveFocusAct — capture precedence", () => {
  const editor: ComponentKeyDeclaration = {
    container: "none",
    captures: captureSet([" ", "a", "ArrowLeft", "ArrowRight", "Enter"]),
  };

  test("a captured key is the component's, regardless of tier", () => {
    expect(resolveFocusAct(k("a"), editor)).toBe("capture");
    expect(resolveFocusAct(k(" "), editor)).toBe("capture"); // Space types, not select
    expect(resolveFocusAct(k("ArrowLeft"), editor)).toBe("capture"); // caret, not move
    expect(resolveFocusAct(k("Enter"), editor)).toBe("capture"); // editor policy
  });

  test("an uncaptured key falls through to the engine as navigation", () => {
    // Tab is resolved before this runs; Escape is not captured here → ascend.
    expect(resolveFocusAct(k("Escape"), editor)).toBe("ascend");
  });
});

describe("captureSet", () => {
  test("matches by key, ignores modifiers", () => {
    const set = captureSet(["x"]);
    expect(set(k("x"))).toBe(true);
    expect(set(k("x", { metaKey: true }))).toBe(true);
    expect(set(k("y"))).toBe(false);
  });
});
