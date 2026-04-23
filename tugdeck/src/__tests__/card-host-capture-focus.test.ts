/**
 * `captureFocus` serializer tests — Step 7.
 *
 * Pins the four-variant discriminated-union classifier that CardHost
 * uses to snapshot `document.activeElement` relative to a card's
 * boundary. See `captureFocus` in `card-host.tsx` and the
 * `FocusSnapshot` type in `layout-tree.ts`.
 *
 *   - `[data-tug-persist-value]` focused → `{ kind: "form-control" }`.
 *     Precedence: the form-control marker wins over the other two.
 *   - `[data-tug-focus-key]` focused → `{ kind: "dom" }`.
 *   - Focus inside a component-owned marker subtree (initially
 *     `[data-tug-prompt-input-root]`) → `{ kind: "component-owned" }`.
 *   - `document.body`, focus outside the card root, or no matching
 *     marker → `{ kind: "none" }`.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { captureFocus } from "@/components/chrome/card-host";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardRoot(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-card-host", "");
  el.setAttribute("data-card-id", "card-test");
  document.body.appendChild(el);
  return el;
}

function makeInput(persistKey: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.setAttribute("data-tug-persist-value", persistKey);
  return el;
}

function makeButton(focusKey: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("data-tug-focus-key", focusKey);
  return el;
}

function makePromptInputRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-tug-prompt-input-root", "");
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("tabindex", "0");
  root.appendChild(editor);
  return root;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("captureFocus – four-variant classifier", () => {
  it("focused [data-tug-persist-value] input → form-control with persistKey", () => {
    const cardRoot = makeCardRoot();
    const input = makeInput("email");
    cardRoot.appendChild(input);

    input.focus();
    expect(document.activeElement).toBe(input);

    expect(captureFocus(cardRoot)).toEqual({
      kind: "form-control",
      persistKey: "email",
    });
  });

  it("focused [data-tug-focus-key] button → dom with focusKey", () => {
    const cardRoot = makeCardRoot();
    const btn = makeButton("save");
    cardRoot.appendChild(btn);

    btn.focus();
    expect(document.activeElement).toBe(btn);

    expect(captureFocus(cardRoot)).toEqual({
      kind: "dom",
      focusKey: "save",
    });
  });

  it("focus inside [data-tug-prompt-input-root] contenteditable → component-owned", () => {
    const cardRoot = makeCardRoot();
    const promptInput = makePromptInputRoot();
    cardRoot.appendChild(promptInput);
    const editor = promptInput.querySelector<HTMLElement>("[contenteditable]");
    expect(editor).not.toBeNull();
    if (editor === null) return;

    editor.focus();
    expect(document.activeElement).toBe(editor);

    expect(captureFocus(cardRoot)).toEqual({ kind: "component-owned" });
  });

  it("document.body focused → none", () => {
    const cardRoot = makeCardRoot();
    cardRoot.appendChild(makeInput("email"));

    document.body.focus();
    // happy-dom may or may not move activeElement to body — either way the
    // helper should see body (or null) as "not inside cardRoot" and report none.
    expect(captureFocus(cardRoot)).toEqual({ kind: "none" });
  });

  it("focus on an element outside the card root → none", () => {
    const cardRoot = makeCardRoot();
    cardRoot.appendChild(makeInput("inside-key"));

    const outside = makeInput("outside-key");
    document.body.appendChild(outside);

    outside.focus();
    expect(document.activeElement).toBe(outside);

    expect(captureFocus(cardRoot)).toEqual({ kind: "none" });
  });

  it("focusable element inside card root without any marker → none", () => {
    const cardRoot = makeCardRoot();
    const plainInput = document.createElement("input");
    plainInput.type = "text";
    cardRoot.appendChild(plainInput);

    plainInput.focus();
    expect(document.activeElement).toBe(plainInput);

    expect(captureFocus(cardRoot)).toEqual({ kind: "none" });
  });

  it("form-control marker wins when both attributes are present on one element", () => {
    const cardRoot = makeCardRoot();
    const el = document.createElement("input");
    el.type = "text";
    el.setAttribute("data-tug-persist-value", "query");
    el.setAttribute("data-tug-focus-key", "also-here");
    cardRoot.appendChild(el);

    el.focus();
    expect(captureFocus(cardRoot)).toEqual({
      kind: "form-control",
      persistKey: "query",
    });
  });

  it("empty attribute values are treated as absent", () => {
    const cardRoot = makeCardRoot();
    const el = document.createElement("input");
    el.type = "text";
    el.setAttribute("data-tug-persist-value", "");
    el.setAttribute("data-tug-focus-key", "");
    cardRoot.appendChild(el);

    el.focus();
    // Neither marker carries a key, and no component-owned selector
    // matches, so the helper falls through to none.
    expect(captureFocus(cardRoot)).toEqual({ kind: "none" });
  });
});
