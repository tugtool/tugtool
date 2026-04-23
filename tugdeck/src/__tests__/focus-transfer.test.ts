/**
 * focus-transfer.test.ts — unit tests for the one fully-implemented
 * entry of the Step 23A focus-transfer scaffold: `resolveActivationTarget`.
 *
 * The resolver is side-effect-free and returns one of three variants
 * per the module's documented decision tree. Each test sets up a
 * small `FocusTransferStore` stub + a detached DOM subtree, calls the
 * resolver, and asserts the resulting `ActivationTarget`.
 *
 * The three side-effecting entries (`transferFocusForActivation`,
 * `captureFocusForDragStart`, `transferFocusAfterMove`) ship as
 * throwing signatures at Step 23A. A single smoke test confirms each
 * throws an informative message.
 */

import "./setup-rtl";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import type { CardStateBag } from "../layout-tree";
import {
  captureFocusForDragStart,
  resolveActivationTarget,
  transferFocusAfterMove,
  transferFocusForActivation,
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
  test("returns { kind: 'none' } when the card has no bag", () => {
    const result = resolveActivationTarget("unknown-card", fixture.store);
    expect(result).toEqual({ kind: "none" });
  });

  test("returns { kind: 'dispatch-activated' } when bag.content !== undefined", () => {
    fixture.setBag("c1", { content: { whatever: true } });
    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "dispatch-activated" });
  });

  test("returns { kind: 'none' } when bag has focus.kind === 'none'", () => {
    fixture.setBag("c1", { focus: { kind: "none" } });
    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "none" });
  });

  test("returns { kind: 'none' } when no host root is registered", () => {
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

  test("returns { kind: 'none' } when the keyed element is absent", () => {
    const { host } = makeCardHost("c1");
    // Remove the focus-keyed input so the lookup misses.
    host.querySelector("[data-tug-focus-key]")?.remove();

    fixture.setBag("c1", { focus: { kind: "dom", focusKey: "fk-c1" } });
    fixture.setHostRoot("c1", host);

    const result = resolveActivationTarget("c1", fixture.store);
    expect(result).toEqual({ kind: "none" });
  });

  test("returns { kind: 'none' } when the registered host root is detached", () => {
    const { host } = makeCardHost("c1");
    fixture.setBag("c1", { focus: { kind: "dom", focusKey: "fk-c1" } });
    fixture.setHostRoot("c1", host);

    // Detach the host root from the document. The focus-keyed element
    // is still inside `host` so `querySelector` still finds it, but
    // it is no longer `isConnected`.
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

// ---------------------------------------------------------------------------
// Side-effecting entries — throw until Step 23B/C land wiring.
// ---------------------------------------------------------------------------

describe("side-effecting entries (Step 23A: throw with step pointer)", () => {
  test("transferFocusForActivation throws with Step 23B pointer", () => {
    expect(() =>
      transferFocusForActivation({
        outgoingCardId: "a",
        incomingCardId: "b",
        // The store parameter is fully-typed IDeckManagerStore in the
        // real signature; tests only need to confirm the throw.
        store: {} as unknown as Parameters<
          typeof transferFocusForActivation
        >[0]["store"],
      }),
    ).toThrow(/Step 23B/);
  });

  test("captureFocusForDragStart throws with Step 23C pointer", () => {
    expect(() =>
      captureFocusForDragStart({
        sourceCardId: "a",
        store: {} as unknown as Parameters<
          typeof captureFocusForDragStart
        >[0]["store"],
      }),
    ).toThrow(/Step 23C/);
  });

  test("transferFocusAfterMove throws with Step 23C pointer", () => {
    expect(() =>
      transferFocusAfterMove({
        sourceCardId: "a",
        store: {} as unknown as Parameters<
          typeof transferFocusAfterMove
        >[0]["store"],
      }),
    ).toThrow(/Step 23C/);
  });
});
