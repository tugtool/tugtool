/**
 * focus-transfer.test.ts — unit tests for the side-effect-free
 * resolver `resolveActivationTarget`.
 *
 * The resolver returns one of four variants
 * (`focus-element` / `dispatch-activated` / `default-focus` /
 * `none`) per the module's documented decision tree. Each test
 * sets up a small `FocusTransferStore` stub + a detached DOM
 * subtree, calls the resolver, and asserts the resulting
 * `ActivationTarget`.
 *
 * Behavior coverage for `transferFocusForActivation`,
 * `captureFocusForDragStart`, and `transferFocusAfterMove` lives
 * in the in-app harness (m01/m03/m16 + m06/m07/m21) — those
 * helpers drive real WebKit focus calls, real selection-range
 * restores, and real React commit timing. Per the project's
 * happy-dom scoping rule, this unit file does not stand up a fake
 * DOM with focus semantics to retest those helpers here.
 */

import "./setup-rtl";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import type { CardStateBag } from "../layout-tree";
import {
  resolveActivationTarget,
  type FocusTransferStore,
} from "../focus-transfer";

// ---------------------------------------------------------------------------
// Minimal FocusTransferStore stub — implements only what the resolver reads.
// ---------------------------------------------------------------------------

interface Fixture {
  store: FocusTransferStore;
  setBag(cardId: string, bag: CardStateBag): void;
  setHostRoot(cardId: string, el: HTMLElement | null): void;
}

function makeFixture(): Fixture {
  const bags = new Map<string, CardStateBag>();
  const roots = new Map<string, HTMLElement>();
  const store: FocusTransferStore = {
    getCardState: (cardId) => bags.get(cardId),
    peekCardHostRoot: (cardId) => roots.get(cardId) ?? null,
  };
  return {
    store,
    setBag(cardId, bag) {
      bags.set(cardId, bag);
    },
    setHostRoot(cardId, el) {
      if (el === null) roots.delete(cardId);
      else roots.set(cardId, el);
    },
  };
}

// Helper — build a card-host subtree with a focus-keyed <input>, a
// persist-valued <input>, and a component-owned contenteditable.
// Each is identified by unique keys so resolver lookups are exact.
function makeCardHost(cardId: string): {
  host: HTMLElement;
  focusKeyInput: HTMLInputElement;
  persistKeyInput: HTMLInputElement;
  prompt: HTMLElement;
} {
  const host = document.createElement("div");
  host.setAttribute("data-card-host", "");
  host.setAttribute("data-card-id", cardId);

  const focusKeyInput = document.createElement("input");
  focusKeyInput.type = "text";
  focusKeyInput.setAttribute("data-tug-focus-key", `fk-${cardId}`);
  host.appendChild(focusKeyInput);

  const persistKeyInput = document.createElement("input");
  persistKeyInput.type = "text";
  persistKeyInput.setAttribute("data-tug-persist-value", `pv-${cardId}`);
  host.appendChild(persistKeyInput);

  const promptRoot = document.createElement("div");
  promptRoot.setAttribute("data-tug-prompt-input-root", "");
  const prompt = document.createElement("div");
  prompt.setAttribute("contenteditable", "true");
  promptRoot.appendChild(prompt);
  host.appendChild(promptRoot);

  document.body.appendChild(host);
  return { host, focusKeyInput, persistKeyInput, prompt };
}

let fixture!: Fixture;

beforeEach(() => {
  fixture = makeFixture();
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// resolveActivationTarget
// ---------------------------------------------------------------------------

describe("resolveActivationTarget", () => {
  test("returns { kind: 'none' } when no host root is registered (unknown card)", () => {
    // Without a registered host root the resolver has nothing to
    // scope a default-focus walk to, so even bag-less cards return
    // `none` until their `CardHost` registration completes.
    const result = resolveActivationTarget("unknown-card", fixture.store);
    expect(result).toEqual({ kind: "none" });
  });

  test("returns { kind: 'default-focus', cardRoot } when the card has no bag but a host is registered", () => {
    // Covers the m16 close-handoff scenario: a never-saved neighbor
    // (no bag) becomes the activation destination. The helper should
    // route through the default-focus path so the caret lands on a
    // sensible default rather than stranding on the outgoing card.
    const { host } = makeCardHost("c1");
    fixture.setHostRoot("c1", host);
    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "default-focus", cardRoot: host });
  });

  test("returns { kind: 'dispatch-activated' } when bag.content !== undefined", () => {
    fixture.setBag("c1", { content: { whatever: true } });
    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "dispatch-activated" });
  });

  test("returns { kind: 'default-focus', cardRoot } when bag.focus.kind === 'none'", () => {
    // A card may have a bag (it's been saved at least once) but no
    // usable focus snapshot. The default-focus path applies.
    const { host } = makeCardHost("c1");
    fixture.setBag("c1", { focus: { kind: "none" } });
    fixture.setHostRoot("c1", host);
    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "default-focus", cardRoot: host });
  });

  test("returns { kind: 'none' } when no host root is registered (with bag)", () => {
    fixture.setBag("c1", { focus: { kind: "dom", focusKey: "fk-c1" } });
    // No setHostRoot call — registry is empty.
    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "none" });
  });

  test("resolves focus.kind === 'dom' to the keyed element", () => {
    const { host, focusKeyInput } = makeCardHost("c1");
    fixture.setBag("c1", { focus: { kind: "dom", focusKey: "fk-c1" } });
    fixture.setHostRoot("c1", host);

    const result = resolveActivationTarget("c1", fixture.store);
    expect(result.kind).toBe("focus-element");
    if (result.kind === "focus-element") {
      expect(result.el).toBe(focusKeyInput);
    }
  });

  test("resolves focus.kind === 'form-control' to the persist-keyed element", () => {
    const { host, persistKeyInput } = makeCardHost("c1");
    fixture.setBag("c1", {
      focus: { kind: "form-control", persistKey: "pv-c1" },
    });
    fixture.setHostRoot("c1", host);

    const result = resolveActivationTarget("c1", fixture.store);
    expect(result.kind).toBe("focus-element");
    if (result.kind === "focus-element") {
      expect(result.el).toBe(persistKeyInput);
    }
  });

  test("resolves focus.kind === 'component-owned' to the prompt input's contenteditable", () => {
    const { host, prompt } = makeCardHost("c1");
    fixture.setBag("c1", { focus: { kind: "component-owned" } });
    fixture.setHostRoot("c1", host);

    const result = resolveActivationTarget("c1", fixture.store);
    expect(result.kind).toBe("focus-element");
    if (result.kind === "focus-element") {
      expect(result.el).toBe(prompt);
    }
  });

  test("falls through to default-focus when the keyed element is absent", () => {
    // A stale snapshot pointing at a missing element should not
    // strand the user's caret. The resolver returns the host root
    // for a default-focus walk (L23: preserve user-visible state by
    // landing the caret somewhere sensible inside the activated
    // card).
    const { host } = makeCardHost("c1");
    host.querySelector("[data-tug-focus-key]")?.remove();

    fixture.setBag("c1", { focus: { kind: "dom", focusKey: "fk-c1" } });
    fixture.setHostRoot("c1", host);

    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "default-focus", cardRoot: host });
  });

  test("returns { kind: 'none' } when the registered host root is detached", () => {
    const { host } = makeCardHost("c1");
    fixture.setBag("c1", { focus: { kind: "dom", focusKey: "fk-c1" } });
    fixture.setHostRoot("c1", host);

    // Detach the host root. The resolver's `isConnected` check on
    // the host short-circuits before any querySelector walk so a
    // stale registration cannot produce a default-focus target
    // outside the document.
    host.remove();

    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "none" });
  });

  test("content-owning card short-circuits before reading focus / host root", () => {
    // Even with no host root registered, a content-owning card
    // returns dispatch-activated.
    fixture.setBag("c1", {
      content: { anything: true },
      focus: { kind: "dom", focusKey: "fk-c1" },
    });
    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "dispatch-activated" });
  });
});

// `captureFocusForDragStart` and `transferFocusAfterMove` shipped
// in selection plan #step-23c. The stub-assertion tests that
// previously lived here (asserting the throws) are gone — behavior
// coverage for these helpers lives in the in-app drag harness
// (m06-cross-pane-drag, m07-card-detach, m21-drag-aborted).
