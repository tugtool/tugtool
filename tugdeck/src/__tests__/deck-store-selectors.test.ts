/**
 * deck-store-selectors.test.ts — unit tests for the pure predicates
 * in `deck-store-selectors.ts` ([A1]).
 *
 * These tests operate on hand-built `DeckState` fixtures rather than
 * spinning up a DeckManager, because the selector is pure by design.
 * Hook-level / subscription-level coverage lives next door in
 * `use-focus-destination.test.tsx`.
 */

import { describe, test, expect } from "bun:test";
import type { CardState, DeckState, TugPaneState } from "../layout-tree";
import {
  bullseyePaneIdOf,
  isFocusDestination,
  slotStackOf,
} from "../deck-store-selectors";

function makeCard(id: string, componentId = "probe"): CardState {
  return { id, componentId, title: id, closable: true };
}

function makePane(
  id: string,
  cardIds: string[],
  activeCardId: string,
): TugPaneState {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    cardIds,
    activeCardId,
    title: "",
    acceptsFamilies: ["standard"],
  };
}

function baseState(): DeckState {
  return {
    cards: [makeCard("card-a"), makeCard("card-b"), makeCard("card-c")],
    panes: [
      makePane("pane-1", ["card-a", "card-b"], "card-a"),
      makePane("pane-2", ["card-c"], "card-c"),
    ],
    activePaneId: "pane-1",
    imposition: { sidebars: { lens: { side: "right" } } },
    hasFocus: true,
  };
}

describe("isFocusDestination", () => {
  test("returns true when all three conditions hold (active pane, active card, foreground)", () => {
    expect(isFocusDestination("card-a", baseState())).toBe(true);
  });

  test("returns false when the app is not foreground (hasFocus === false)", () => {
    const state: DeckState = { ...baseState(), hasFocus: false };
    expect(isFocusDestination("card-a", state)).toBe(false);
  });

  test("returns false when the card's pane is not the active pane", () => {
    // card-c lives in pane-2, but activePaneId === "pane-1".
    expect(isFocusDestination("card-c", baseState())).toBe(false);
  });

  test("returns false when the pane is active but the card is not the pane's active card", () => {
    // card-b lives in pane-1 (active) but pane-1.activeCardId === "card-a".
    expect(isFocusDestination("card-b", baseState())).toBe(false);
  });

  test("returns false for an unknown cardId", () => {
    expect(isFocusDestination("not-a-card", baseState())).toBe(false);
  });

  test("returns false when activePaneId is undefined", () => {
    const state: DeckState = { ...baseState(), activePaneId: undefined };
    expect(isFocusDestination("card-a", state)).toBe(false);
  });

  test("is pure — the same inputs produce the same output", () => {
    const s = baseState();
    const a = isFocusDestination("card-a", s);
    const b = isFocusDestination("card-a", s);
    expect(a).toBe(b);
    expect(a).toBe(true);
  });

  test("flipping the active pane shifts the focus destination", () => {
    const s1 = baseState();
    expect(isFocusDestination("card-a", s1)).toBe(true);
    expect(isFocusDestination("card-c", s1)).toBe(false);

    const s2: DeckState = { ...s1, activePaneId: "pane-2" };
    expect(isFocusDestination("card-a", s2)).toBe(false);
    expect(isFocusDestination("card-c", s2)).toBe(true);
  });

  test("flipping pane.activeCardId within the active pane shifts the destination", () => {
    const s1 = baseState();
    expect(isFocusDestination("card-a", s1)).toBe(true);
    expect(isFocusDestination("card-b", s1)).toBe(false);

    const s2: DeckState = {
      ...s1,
      panes: s1.panes.map((p) =>
        p.id === "pane-1" ? { ...p, activeCardId: "card-b" } : p,
      ),
    };
    expect(isFocusDestination("card-a", s2)).toBe(false);
    expect(isFocusDestination("card-b", s2)).toBe(true);
  });
});

describe("slotStackOf", () => {
  function slottedState(): DeckState {
    const s = baseState();
    return {
      ...s,
      cards: [...s.cards, makeCard("card-d")],
      panes: [
        { ...makePane("pane-1", ["card-a", "card-b"], "card-a"), slot: 0 },
        { ...makePane("pane-2", ["card-c"], "card-c"), slot: 2 },
        { ...makePane("pane-3", ["card-d"], "card-d"), slot: 0 },
        makePane("pane-free", ["card-a"], "card-a"),
      ],
    };
  }

  test("returns the panes of a slot in array order (last topmost)", () => {
    const stack = slotStackOf(slottedState(), 0);
    expect(stack.map((p) => p.id)).toEqual(["pane-1", "pane-3"]);
  });

  test("returns a single-element stack for a slot one pane holds alone", () => {
    expect(slotStackOf(slottedState(), 2).map((p) => p.id)).toEqual(["pane-2"]);
  });

  test("returns [] for an unoccupied slot", () => {
    expect(slotStackOf(slottedState(), 1)).toEqual([]);
  });

  test("returns [] for an undefined slot — a free pane stands in no stack", () => {
    expect(slotStackOf(slottedState(), undefined)).toEqual([]);
  });

  test("excludes panes holding other slots and panes holding none", () => {
    const stack = slotStackOf(slottedState(), 0);
    expect(stack.some((p) => p.id === "pane-2")).toBe(false);
    expect(stack.some((p) => p.id === "pane-free")).toBe(false);
  });
});

describe("bullseyePaneIdOf", () => {
  function bullseyed(paneId: string): DeckState {
    return { ...baseState(), bullseyePaneId: paneId };
  }

  test("returns the id when the pane exists and hosts the first responder", () => {
    expect(bullseyePaneIdOf(bullseyed("pane-1"))).toBe("pane-1");
  });

  test("returns null when nothing is bullseyed", () => {
    expect(bullseyePaneIdOf(baseState())).toBeNull();
  });

  test("returns null when the pane was removed from the deck", () => {
    const state: DeckState = {
      ...bullseyed("pane-1"),
      cards: [makeCard("card-c")],
      panes: [makePane("pane-2", ["card-c"], "card-c")],
      activePaneId: "pane-2",
    };
    expect(bullseyePaneIdOf(state)).toBeNull();
  });

  test("returns null when activePaneId is undefined — the canvas-background deselect", () => {
    const state: DeckState = { ...bullseyed("pane-1"), activePaneId: undefined };
    expect(bullseyePaneIdOf(state)).toBeNull();
  });

  test("returns null when focus moved to another pane, leaving the raw id stale", () => {
    const state: DeckState = { ...bullseyed("pane-1"), activePaneId: "pane-2" };
    expect(bullseyePaneIdOf(state)).toBeNull();
    // The raw field is untouched — it is unreadable, not cleared.
    expect(state.bullseyePaneId).toBe("pane-1");
  });

  test("holds across a tab switch inside the bullseyed pane — the pane hosts the responder, not one card", () => {
    const state = bullseyed("pane-1");
    const switched: DeckState = {
      ...state,
      panes: state.panes.map((p) =>
        p.id === "pane-1" ? { ...p, activeCardId: "card-b" } : p,
      ),
    };
    expect(bullseyePaneIdOf(switched)).toBe("pane-1");
  });

  test("is pure — the same snapshot answers the same way twice", () => {
    const s = bullseyed("pane-1");
    expect(bullseyePaneIdOf(s)).toBe(bullseyePaneIdOf(s));
    expect(s.bullseyePaneId).toBe("pane-1");
  });
});
