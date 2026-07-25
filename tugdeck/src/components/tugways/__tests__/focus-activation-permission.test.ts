/**
 * FocusManager.mayClaimActivationFocus -- pure-logic tests for the activation
 * permission query (Spec S03), the replacement for the retired
 * `focus-theft-gate` module.
 *
 * The DOM-dependent half of the query (which element holds the register, and
 * whether the engine governs it) belongs to the real app and is pinned by the
 * activation app-tests: at0003, at0201, at0100, at0148, at0203. What is
 * testable here without a document is the deck-state half -- the two rules that
 * refuse before any element is ever consulted -- and the no-engine degradation.
 *
 * No fake-DOM, no mock stores.
 */

import { describe, expect, test } from "bun:test";

import { FocusManager, mayClaimActivationFocus } from "../focus-manager";
import type { DeckState } from "@/layout-tree";

function deckState(over: Partial<DeckState> = {}): DeckState {
  return {
    cards: [
      { id: "A", componentId: "test", title: "A", closable: true },
      { id: "B", componentId: "test", title: "B", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 0, y: 0 },
        size: { width: 400, height: 300 },
        cardIds: ["A", "B"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
    ...over,
  } as DeckState;
}

describe("activation permission — deck-state rules", () => {
  test("refuses while the app is backgrounded", () => {
    const m = new FocusManager();
    expect(m.mayClaimActivationFocus("A", deckState({ hasFocus: false }))).toBe(
      false,
    );
  });

  test("refuses a target that is not the focus destination", () => {
    const m = new FocusManager();
    // B is in the pane but is not its active card, so the caller's model of
    // "the active card" is stale — refuse rather than race it.
    expect(m.mayClaimActivationFocus("B", deckState())).toBe(false);
  });

  test("permits the focus destination of a foreground app", () => {
    const m = new FocusManager();
    expect(m.mayClaimActivationFocus("A", deckState())).toBe(true);
  });

  test("the deck-state half is the same predicate the wrapper falls back to", () => {
    expect(FocusManager.deckStatePermits("A", deckState())).toBe(true);
    expect(FocusManager.deckStatePermits("B", deckState())).toBe(false);
    expect(
      FocusManager.deckStatePermits("A", deckState({ hasFocus: false })),
    ).toBe(false);
  });
});

describe("activation permission — no engine mounted", () => {
  test("degrades to the deck-state rules, not to a blanket permit", () => {
    // A gallery preview or headless bootstrap: no engine, so there is no
    // engine-routed keyboard to protect and no activation channel to strand.
    // Ownership is not a question anyone can ask — but the deck-state rules
    // still apply.
    expect(mayClaimActivationFocus("A", deckState())).toBe(true);
    expect(mayClaimActivationFocus("A", deckState({ hasFocus: false }))).toBe(
      false,
    );
    expect(mayClaimActivationFocus("B", deckState())).toBe(false);
  });
});
