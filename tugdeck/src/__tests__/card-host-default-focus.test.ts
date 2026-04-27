/**
 * `resolveDefaultFocusTarget` + `traceApplyDefaultFocus` tests —
 * pin the bag-less activation fallback path so a card without a
 * saved focus snapshot still receives the caret on activation
 * (otherwise tab-switch-to-fresh-card or close-handoff to a never-
 * activated neighbor would strand focus on the outgoing card).
 *
 * These tests pin the priority chain (focus-key="primary" →
 * any focus-key → persist-value → generic focusable) and the
 * respect-existing-focus contract. The production caller is `focus-transfer.ts`'s
 * "default-focus" target branch (site `"focus-transfer-default"`).
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  resolveDefaultFocusTarget,
  traceApplyDefaultFocus,
  DEFAULT_FOCUS_SELECTORS,
} from "@/default-focus";
import { deckTrace, type DeckTraceEvent } from "@/deck-trace";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardRoot(id: string = "card-test"): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-card-host", "");
  el.setAttribute("data-card-id", id);
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = "";
  deckTrace.clear();
  deckTrace.enable(true);
});

afterEach(() => {
  document.body.innerHTML = "";
  deckTrace.enable(false);
});

// ---------------------------------------------------------------------------
// DEFAULT_FOCUS_SELECTORS shape
// ---------------------------------------------------------------------------

describe("DEFAULT_FOCUS_SELECTORS", () => {
  it("priority order: primary focus-key first, then any focus-key, then persist-value, then generic", () => {
    expect(DEFAULT_FOCUS_SELECTORS[0]).toBe('[data-tug-focus-key="primary"]');
    expect(DEFAULT_FOCUS_SELECTORS[1]).toBe("[data-tug-focus-key]");
    expect(DEFAULT_FOCUS_SELECTORS[2]).toBe("[data-tug-state-key]");
    // Generic focusable selector at the end — catch-all for cards
    // with no tug-specific metadata.
    expect(DEFAULT_FOCUS_SELECTORS[3]).toContain("input:not");
    expect(DEFAULT_FOCUS_SELECTORS).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// resolveDefaultFocusTarget
// ---------------------------------------------------------------------------

describe("resolveDefaultFocusTarget — priority chain", () => {
  it("prefers [data-tug-focus-key=primary] over any other match", () => {
    const root = makeCardRoot();
    // Add three candidates in DOM order; primary sits last so
    // querySelector-by-document-order wouldn't pick it without the
    // priority chain driving the selector choice.
    const primaryInput = document.createElement("input");
    primaryInput.type = "text";
    primaryInput.setAttribute("data-tug-state-key", "not-primary");
    root.appendChild(primaryInput);

    const plainKeyed = document.createElement("button");
    plainKeyed.setAttribute("data-tug-focus-key", "save");
    plainKeyed.type = "button";
    root.appendChild(plainKeyed);

    const primary = document.createElement("button");
    primary.setAttribute("data-tug-focus-key", "primary");
    primary.type = "button";
    root.appendChild(primary);

    const { el, selector } = resolveDefaultFocusTarget(root);
    expect(el).toBe(primary);
    expect(selector).toBe('[data-tug-focus-key="primary"]');
  });

  it('falls back to [data-tug-focus-key] with any value when "primary" is absent', () => {
    const root = makeCardRoot();
    const persistInput = document.createElement("input");
    persistInput.type = "text";
    persistInput.setAttribute("data-tug-state-key", "x");
    root.appendChild(persistInput);

    const keyed = document.createElement("button");
    keyed.setAttribute("data-tug-focus-key", "save");
    keyed.type = "button";
    root.appendChild(keyed);

    const { el, selector } = resolveDefaultFocusTarget(root);
    expect(el).toBe(keyed);
    expect(selector).toBe("[data-tug-focus-key]");
  });

  it("falls back to [data-tug-state-key] when no focus-key marker exists", () => {
    const root = makeCardRoot();
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-tug-state-key", "size/sm");
    root.appendChild(input);

    const { el, selector } = resolveDefaultFocusTarget(root);
    expect(el).toBe(input);
    expect(selector).toBe("[data-tug-state-key]");
  });

  it("falls back to generic focusable (plain input) when no tug-specific metadata present", () => {
    const root = makeCardRoot();
    const input = document.createElement("input");
    input.type = "text";
    root.appendChild(input);

    const { el, selector } = resolveDefaultFocusTarget(root);
    expect(el).toBe(input);
    expect(selector).toContain("input:not");
  });

  it("returns null + empty selector when the card root has no focusable descendants", () => {
    const root = makeCardRoot();
    const div = document.createElement("div");
    root.appendChild(div);

    const { el, selector } = resolveDefaultFocusTarget(root);
    expect(el).toBeNull();
    expect(selector).toBe("");
  });

  // Note: a "skip hidden elements" behavior is wired through
  // `isElementHidden` (offsetParent check), but happy-dom does not
  // compute layout for inline styles, so this branch is covered by
  // in-app integration tests rather than a happy-dom unit test.
});

// ---------------------------------------------------------------------------
// traceApplyDefaultFocus
// ---------------------------------------------------------------------------

describe("traceApplyDefaultFocus — focuses target and records focus-call", () => {
  it("focuses the resolved target and emits focus-call with the selector", () => {
    const root = makeCardRoot("card-A");
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-tug-state-key", "size/sm");
    root.appendChild(input);

    traceApplyDefaultFocus("a3-default-focus", "card-A", root);

    expect(document.activeElement).toBe(input);

    const events = deckTrace.dump() as DeckTraceEvent[];
    const focusCall = events.find(
      (e): e is Extract<DeckTraceEvent, { kind: "focus-call" }> =>
        e.kind === "focus-call",
    );
    expect(focusCall).toBeDefined();
    if (focusCall === undefined) return;
    expect(focusCall.cardId).toBe("card-A");
    expect(focusCall.site).toBe("a3-default-focus");
    expect(focusCall.targetSelector).toBe("[data-tug-state-key]");
  });

  it("respects focus already inside the card root (click-in-progress wins)", () => {
    const root = makeCardRoot();
    const first = document.createElement("input");
    first.type = "text";
    root.appendChild(first);
    const second = document.createElement("input");
    second.type = "text";
    root.appendChild(second);

    // Simulate a click landing on `second` right before activation.
    second.focus();
    expect(document.activeElement).toBe(second);

    traceApplyDefaultFocus("a3-default-focus", "card-A", root);

    // Default-focus must NOT steal from `second` to `first`.
    expect(document.activeElement).toBe(second);

    const focusCall = deckTrace
      .dump()
      .find(
        (e): e is Extract<DeckTraceEvent, { kind: "focus-call" }> =>
          e.kind === "focus-call",
      );
    expect(focusCall).toBeDefined();
    if (focusCall === undefined) return;
    expect(focusCall.targetSelector).toBe("already-inside-card");
  });

  it("records focus-call with targetSelector='none' when no focusable descendant exists", () => {
    const root = makeCardRoot();
    // No focusable children.
    const span = document.createElement("span");
    span.textContent = "label only";
    root.appendChild(span);

    traceApplyDefaultFocus("a3-default-focus", "card-A", root);

    const focusCall = deckTrace
      .dump()
      .find(
        (e): e is Extract<DeckTraceEvent, { kind: "focus-call" }> =>
          e.kind === "focus-call",
      );
    expect(focusCall).toBeDefined();
    if (focusCall === undefined) return;
    expect(focusCall.targetSelector).toBe("none");
  });
});
