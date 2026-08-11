/**
 * FocusManager -- pure-logic tests for the state-driven projection record.
 *
 * The projection is one derivation of engine state: every focus DOM mark and
 * the one legal `activeElement`, computed together. These tests pin the half of
 * it that is pure state -- `projectionState()` and the `*Id` fields of
 * `computeProjection()` -- as data-in / data-out against a bare manager.
 *
 * The DOM half (which element receives which attribute, and the reconciler's
 * mark-heal) is exercised in the real app via app-test: bun:test has no
 * document, so element resolution here always answers `null`, and that is the
 * boundary these tests deliberately stop at. No fake-DOM, no mock stores.
 *
 * The property that matters most is round-trip identity: the projection is
 * derived from STATE, not from the transition that produced it, so a key card
 * that goes away and comes back must derive the same record it started with.
 * That is what makes a transient key-card change recoverable instead of a wipe
 * nothing restamps.
 */

import { describe, expect, test } from "bun:test";

import { FocusManager } from "../focus-manager";
import type { FocusProjectionState } from "../focus-manager";

function stateOf(m: FocusManager): FocusProjectionState {
  const p = m.computeProjection();
  return {
    keyViewId: p.keyViewId,
    keyViewKeyboard: p.keyViewKeyboard,
    keyWithinId: p.keyWithinId,
    focusMode: p.focusMode,
    route: p.route,
  };
}

/** A manager with card A active and a keyboard key view placed on it. */
function managerWithKeyViewOnA(): FocusManager {
  const m = new FocusManager();
  const ctx = m.contextFor("A");
  ctx.registerFocusable({ id: "row0", group: "list", order: 0 });
  ctx.registerFocusable({ id: "row1", group: "list", order: 1 });
  m.setKeyCard("A");
  m.place("A", { kind: "focusable", id: "row0" }, { modality: "keyboard" });
  return m;
}

describe("projection record", () => {
  test("derives the placed key view and its modality", () => {
    const m = managerWithKeyViewOnA();
    expect(stateOf(m)).toEqual({
      keyViewId: "row0",
      keyViewKeyboard: true,
      keyWithinId: null,
      focusMode: null,
      route: "engine-routed",
    });
  });

  test("two consecutive computations are equal (no-op stability)", () => {
    const m = managerWithKeyViewOnA();
    expect(stateOf(m)).toEqual(stateOf(m));
  });

  test("survives a transient key-card round trip unchanged", () => {
    const m = managerWithKeyViewOnA();
    const before = stateOf(m);

    // The transient: the key card goes away (a deselect, a store blip) and
    // comes back. Under a transition-driven projection the marks were cleared
    // on the way out and nothing restamped them on the way back; a state-driven
    // derivation cannot lose them, because it never consults the transition.
    m.setKeyCard(null);
    expect(stateOf(m).keyViewId).toBeNull();

    m.setKeyCard("A");
    expect(stateOf(m)).toEqual(before);
  });

  test("survives a round trip through a DIFFERENT key card", () => {
    const m = managerWithKeyViewOnA();
    const before = stateOf(m);

    const b = m.contextFor("B");
    b.registerFocusable({ id: "field", group: "form", order: 0 });
    m.setKeyCard("B");
    m.place("B", { kind: "focusable", id: "field" }, { modality: "keyboard" });
    expect(stateOf(m).keyViewId).toBe("field");

    m.setKeyCard("A");
    expect(stateOf(m)).toEqual(before);
  });

  test("a background context's mutations never reach the active projection", () => {
    const m = managerWithKeyViewOnA();
    const before = stateOf(m);

    // Card B is not the key card. A dialog mounting inside it pushes a mode and
    // places a key view on B's own context; none of that is the deck's
    // projection while A holds the key card.
    const b = m.contextFor("B");
    b.registerFocusable({ id: "confirm", group: "dialog", order: 0 });
    b.pushFocusMode("b-dialog", { trapped: true });
    b.setKeyView("confirm", true);

    expect(stateOf(m)).toEqual(before);
  });

  test("a descended scope projects its container as key-within; a trap does not", () => {
    const m = managerWithKeyViewOnA();
    const ctx = m.contextFor("A");

    // A descend scope (`trapped: false`) — an accordion section, a list row:
    // the container we descended FROM stays a DOM ancestor, so marking it
    // "contains the active component" is true. The mark needs the key view to
    // have actually moved INSIDE: while it still rests on the container, the
    // container is not "containing the active component", it IS it, and the
    // faint within outline would override that node's own ring.
    ctx.pushFocusMode("row0-scope", { trapped: false });
    expect(stateOf(m).keyWithinId).toBeNull();
    ctx.setKeyView("row1", true);
    expect(stateOf(m).keyWithinId).toBe("row0");
    expect(stateOf(m).focusMode).toBe("row0-scope");

    ctx.popFocusMode("row0-scope");
    expect(stateOf(m).keyWithinId).toBeNull();
    expect(stateOf(m).focusMode).toBeNull();

    // A trapped surface is portaled OUT of its trigger, so the captured
    // container does not contain it and must not be marked.
    ctx.pushFocusMode("sheet", { trapped: true });
    expect(stateOf(m).keyWithinId).toBeNull();
    expect(stateOf(m).focusMode).toBe("sheet");
  });

  test("the ring-follows-pointer policy is a deck global, applied at derivation", () => {
    const m = managerWithKeyViewOnA();
    // KBF mode is the outer gate on the paint flavor ([P04]): rings exist iff
    // the mode is engaged, so a ring-modality test has to engage to see one.
    m.setKbfManual(true);
    m.place("A", { kind: "focusable", id: "row1" }, { modality: "pointer" });
    expect(m.computeProjection().keyViewKbd).toBe(false);

    m.setRingFollowsPointer(true);
    expect(m.computeProjection().keyViewKbd).toBe(true);
    // The context's own modality is untouched — the policy widens the ring, it
    // does not rewrite how the key view was reached.
    expect(m.computeProjection().keyViewKeyboard).toBe(false);
  });

  test("mode OFF withholds the ring flavor but not the key view itself", () => {
    const m = managerWithKeyViewOnA();
    m.place("A", { kind: "focusable", id: "row1" }, { modality: "keyboard" });
    // Reached by keyboard, so the ring WOULD paint — except the mode is off.
    expect(m.computeProjection().keyViewKeyboard).toBe(true);
    expect(m.computeProjection().keyViewKbd).toBe(false);
    // The unflavored key view is untouched in both modes: it is a position
    // record every behavioral reader depends on, not a paint signal.
    expect(m.computeProjection().keyViewId).toBe("row1");

    m.setKbfManual(true);
    expect(m.computeProjection().keyViewKbd).toBe(true);
    expect(m.computeProjection().keyViewId).toBe("row1");
  });

  test("element resolution is null with no document, ids are not", () => {
    const m = managerWithKeyViewOnA();
    const p = m.computeProjection();
    expect(p.keyViewId).toBe("row0");
    expect(p.keyViewEl).toBeNull();
    expect(p.defaultRingEl).toBeNull();
    expect(p.legalActive).toBeNull();
  });
});
