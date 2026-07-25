/**
 * FocusManager -- pure-logic tests for registry-first default focus.
 *
 * "What gets focus when a card activates with no saved target" is answered by
 * the card's own focus context: the head of the authored walk order. The walk
 * already encodes authored group order, mode participation, and (in the app)
 * rendered-ness and interactivity, so these tests pin the selection RULE --
 * order, mode containment, skipping, empty-registry fall-through -- with the
 * skip predicate injected so nothing here reads the DOM.
 *
 * Element resolution is the DOM half and stops at this boundary: bun:test has
 * no document. Which element the id resolves to, and the fall-through to the
 * selector chain when a card's focusables have not registered yet, are covered
 * in the real app by app-test. No fake-DOM, no mock stores.
 */

import { describe, expect, test } from "bun:test";

import { FocusManager } from "../focus-manager";

/** Every stop resolves. */
const skipNone = () => false;

function managerWithCard(): FocusManager {
  const m = new FocusManager();
  const ctx = m.contextFor("A");
  ctx.registerFocusable({ id: "toolbar-button", group: "toolbar", order: 0 });
  ctx.registerFocusable({ id: "editor", group: "body", order: 0 });
  ctx.registerFocusable({ id: "footer-button", group: "footer", order: 0 });
  return m;
}

describe("registry-first default focus", () => {
  test("resolves the head of the authored walk order", () => {
    const m = managerWithCard();
    expect(m.defaultFocusableIdForCard("A", skipNone)).toBe(
      m.contextFor("A").walkOrder()[0]?.id,
    );
  });

  test("passes over stops that do not resolve", () => {
    const m = managerWithCard();
    const head = m.contextFor("A").walkOrder()[0]?.id;
    expect(head).not.toBeUndefined();
    const resolved = m.defaultFocusableIdForCard("A", (id) => id === head);
    expect(resolved).not.toBe(head);
    expect(resolved).toBe(m.contextFor("A").walkOrder()[1]?.id ?? null);
  });

  test("a card with no context resolves nothing", () => {
    const m = new FocusManager();
    expect(m.defaultFocusableIdForCard("nonexistent", skipNone)).toBeNull();
  });

  test("a registry whose every stop is skipped resolves nothing", () => {
    const m = managerWithCard();
    expect(m.defaultFocusableIdForCard("A", () => true)).toBeNull();
  });

  test("a card that has registered no focusables yet resolves nothing", () => {
    // The addCard / cold-boot shape: the context exists (the card is known) but
    // its children have not run their registration effects. The DOM selector
    // chain covers this window.
    const m = new FocusManager();
    m.contextFor("A");
    expect(m.defaultFocusableIdForCard("A", skipNone)).toBeNull();
  });

  test("a pushed mode contains the default to that mode's stops", () => {
    const m = managerWithCard();
    const ctx = m.contextFor("A");
    ctx.registerFocusable({
      id: "dialog-confirm",
      group: "dialog",
      order: 0,
      modes: ["dialog"],
    });
    ctx.pushFocusMode("dialog", { trapped: true });
    expect(m.defaultFocusableIdForCard("A", skipNone)).toBe("dialog-confirm");
  });
});
