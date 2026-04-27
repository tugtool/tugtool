/**
 * focus-theft-gate.test.ts — one test per decision branch of
 * {@link canProgrammaticallyFocus} ([A8]).
 *
 * The gate is a pure function of `DeckState` + `document.activeElement`
 * + an optional target-host element. These tests pin the branch
 * semantics by setting up real DOM focus in happy-dom, building a
 * `DeckState` fixture, and asserting the boolean the gate returns.
 */

import "./setup-rtl";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import type { CardState, DeckState, TugPaneState } from "../layout-tree";
import {
  canProgrammaticallyFocus,
  isNonFocusCapturingChrome,
} from "../focus-theft-gate";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCard(id: string): CardState {
  return { id, componentId: "probe", title: id, closable: true };
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

/**
 * Build a deck where `card-target` is the active card of the active
 * pane and the app is foreground. Branches 1–2 pass unless a test
 * overrides a specific field.
 */
function makeDestinationState(): DeckState {
  return {
    cards: [makeCard("card-target"), makeCard("card-other")],
    panes: [
      makePane("pane-1", ["card-target"], "card-target"),
      makePane("pane-2", ["card-other"], "card-other"),
    ],
    activePaneId: "pane-1",
    hasFocus: true,
  };
}

function makeHostEl(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-card-host", "");
  el.setAttribute("data-card-id", "card-target");
  document.body.appendChild(el);
  return el;
}

function makeInputOutside(): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  document.body.appendChild(el);
  return el;
}

function makeNonFocusCapturingChromeButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("data-tug-chrome", "non-focus-capturing");
  document.body.appendChild(btn);
  return btn;
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// canProgrammaticallyFocus — decision-tree branches
// ---------------------------------------------------------------------------

describe("canProgrammaticallyFocus — decision branches", () => {
  test("branch 1: hasFocus === false → false", () => {
    const state: DeckState = { ...makeDestinationState(), hasFocus: false };
    const hostEl = makeHostEl();
    // Even with everything else favorable, the gate must refuse.
    expect(
      canProgrammaticallyFocus("card-target", state, {
        targetCardHostEl: hostEl,
      }),
    ).toBe(false);
  });

  test("branch 2: target is not the focus destination → false", () => {
    // card-other lives in pane-2; activePaneId is "pane-1" — so
    // card-other is NOT the focus destination even though the app is
    // foreground and activeElement is body.
    const state = makeDestinationState();
    expect(canProgrammaticallyFocus("card-other", state)).toBe(false);
  });

  test("branch 3: activeElement === document.body → true", () => {
    const state = makeDestinationState();
    // Sanity: nothing focused, so activeElement defaults to body.
    expect(document.activeElement === document.body).toBe(true);
    expect(canProgrammaticallyFocus("card-target", state)).toBe(true);
  });

  test("branch 4: activeElement is inside the target card host → true", () => {
    const state = makeDestinationState();
    const hostEl = makeHostEl();
    const input = document.createElement("input");
    hostEl.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    expect(
      canProgrammaticallyFocus("card-target", state, {
        targetCardHostEl: hostEl,
      }),
    ).toBe(true);
  });

  test("branch 5: activeElement is inside non-focus-capturing chrome → true", () => {
    const state = makeDestinationState();
    const btn = makeNonFocusCapturingChromeButton();
    btn.focus();
    expect(document.activeElement).toBe(btn);

    expect(canProgrammaticallyFocus("card-target", state)).toBe(true);
  });

  test("branch 5 ancestor match: focused descendant of non-focus-capturing chrome → true", () => {
    const state = makeDestinationState();
    // A wrapping chrome region with the marker; the actual focused
    // element is a plain descendant. The gate should still allow.
    const chrome = document.createElement("div");
    chrome.setAttribute("data-tug-chrome", "non-focus-capturing");
    document.body.appendChild(chrome);
    const inner = document.createElement("button");
    inner.type = "button";
    chrome.appendChild(inner);
    inner.focus();
    expect(document.activeElement).toBe(inner);

    expect(canProgrammaticallyFocus("card-target", state)).toBe(true);
  });

  test("branch 6: focus is inside a different deck card → true", () => {
    // AT0001/AT0003 scenario: the user has focus in card A's input, then
    // clicks tab B (or pane 2's title) to navigate. The gate must
    // permit moving focus to B even though activeElement is a "real"
    // element — card-to-card navigation is a deliberate user gesture,
    // not focus theft.
    const state = makeDestinationState();
    const targetHost = makeHostEl(); // data-card-id="card-target"
    // Build a second card host whose descendant input is focused.
    const otherHost = document.createElement("div");
    otherHost.setAttribute("data-card-host", "");
    otherHost.setAttribute("data-card-id", "card-other");
    const otherInput = document.createElement("input");
    otherInput.type = "text";
    otherHost.appendChild(otherInput);
    document.body.appendChild(otherHost);
    otherInput.focus();
    expect(document.activeElement).toBe(otherInput);

    expect(
      canProgrammaticallyFocus("card-target", state, {
        targetCardHostEl: targetHost,
      }),
    ).toBe(true);
  });

  test("branch 6: focus inside a [data-card-id] whose id is NOT in the deck → false", () => {
    // Defensive: if some rogue DOM has a data-card-id attribute that
    // doesn't correspond to a real card in state, do NOT treat it as
    // "another card." Fall through to branch 7 and refuse.
    const state = makeDestinationState();
    const targetHost = makeHostEl();
    const strayHost = document.createElement("div");
    strayHost.setAttribute("data-card-id", "some-id-not-in-deck");
    const strayInput = document.createElement("input");
    strayInput.type = "text";
    strayHost.appendChild(strayInput);
    document.body.appendChild(strayHost);
    strayInput.focus();

    expect(
      canProgrammaticallyFocus("card-target", state, {
        targetCardHostEl: targetHost,
      }),
    ).toBe(false);
  });

  test("branch 7: real input outside any deck card → false", () => {
    const state = makeDestinationState();
    const hostEl = makeHostEl();
    const outside = makeInputOutside();
    outside.focus();
    expect(document.activeElement).toBe(outside);

    expect(
      canProgrammaticallyFocus("card-target", state, {
        targetCardHostEl: hostEl,
      }),
    ).toBe(false);
  });

  test("missing targetCardHostEl falls through to later checks (body → true)", () => {
    const state = makeDestinationState();
    // activeElement is still body; without a host, branch 4 cannot
    // apply, but branch 3 does.
    expect(canProgrammaticallyFocus("card-target", state)).toBe(true);
  });

  test("missing targetCardHostEl does not turn real outside focus into a true", () => {
    const state = makeDestinationState();
    const outside = makeInputOutside();
    outside.focus();
    // No host provided, no chrome marker — must refuse.
    expect(canProgrammaticallyFocus("card-target", state)).toBe(false);
  });

  test("null targetCardHostEl is equivalent to missing", () => {
    const state = makeDestinationState();
    const outside = makeInputOutside();
    outside.focus();
    expect(
      canProgrammaticallyFocus("card-target", state, {
        targetCardHostEl: null,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isNonFocusCapturingChrome — predicate edges
// ---------------------------------------------------------------------------

describe("isNonFocusCapturingChrome", () => {
  test("returns false for null", () => {
    expect(isNonFocusCapturingChrome(null)).toBe(false);
  });

  test("returns false for a plain element", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(isNonFocusCapturingChrome(el)).toBe(false);
  });

  test("returns true for an element with the chrome marker on itself", () => {
    const el = document.createElement("button");
    el.setAttribute("data-tug-chrome", "non-focus-capturing");
    document.body.appendChild(el);
    expect(isNonFocusCapturingChrome(el)).toBe(true);
  });

  test("returns true for a descendant of a marked ancestor", () => {
    const outer = document.createElement("div");
    outer.setAttribute("data-tug-chrome", "non-focus-capturing");
    const inner = document.createElement("span");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(isNonFocusCapturingChrome(inner)).toBe(true);
  });

  test("returns false when the data attribute value is different", () => {
    const el = document.createElement("div");
    el.setAttribute("data-tug-chrome", "other-value");
    document.body.appendChild(el);
    expect(isNonFocusCapturingChrome(el)).toBe(false);
  });
});
