/**
 * `applyFocusSnapshot` tests — Step 11.
 *
 * Pins the cold-boot / cross-pane-move counterpart of
 * {@link captureFocus} in `card-host.tsx`:
 *
 *   - Each of the three focus-bearing variants lands focus on the
 *     correct keyed descendant of the card root.
 *   - `{ kind: "none" }` never mutates focus.
 *   - Pre-check: focus already inside the card is respected — the
 *     helper does NOT steal focus out from under a click-in-progress.
 *   - Missing keyed element (late-mount case) → silent no-op, no throw.
 *
 * The active-card gate lives one layer up (inside `CardHost`'s mount
 * effect, not the helper). These tests focus on the helper's own
 * contract; integration-level gate behaviour is covered by the full
 * test suite via the existing card-host composition tests.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { applyFocusSnapshot } from "@/components/chrome/card-host";
import type { FocusSnapshot } from "@/layout-tree";

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

describe("applyFocusSnapshot – form-control variant", () => {
  it("focuses the keyed <input> when kind = form-control", () => {
    const cardRoot = makeCardRoot();
    const email = makeInput("email");
    cardRoot.appendChild(email);

    const snap: FocusSnapshot = { kind: "form-control", persistKey: "email" };
    applyFocusSnapshot(cardRoot, snap);

    expect(document.activeElement).toBe(email);
  });

  it("no-op when the keyed input is not in the DOM (late-mount case)", () => {
    const cardRoot = makeCardRoot();
    const prior = document.createElement("input");
    prior.type = "text";
    document.body.appendChild(prior);
    prior.focus();
    expect(document.activeElement).toBe(prior);

    const snap: FocusSnapshot = { kind: "form-control", persistKey: "not-yet" };
    expect(() => applyFocusSnapshot(cardRoot, snap)).not.toThrow();

    // prior is outside the cardRoot, so the pre-check doesn't fire;
    // but the querySelector finds nothing, so focus stays on `prior`.
    expect(document.activeElement).toBe(prior);
  });
});

describe("applyFocusSnapshot – dom variant", () => {
  it("focuses the keyed focus-key element when kind = dom", () => {
    const cardRoot = makeCardRoot();
    const save = makeButton("save");
    cardRoot.appendChild(save);

    const snap: FocusSnapshot = { kind: "dom", focusKey: "save" };
    applyFocusSnapshot(cardRoot, snap);

    expect(document.activeElement).toBe(save);
  });
});

describe("applyFocusSnapshot – component-owned variant", () => {
  it("focuses the contenteditable inside [data-tug-prompt-input-root]", () => {
    const cardRoot = makeCardRoot();
    cardRoot.appendChild(makePromptInputRoot());
    const editor = cardRoot.querySelector<HTMLElement>("[contenteditable]");
    expect(editor).not.toBeNull();

    const snap: FocusSnapshot = { kind: "component-owned" };
    applyFocusSnapshot(cardRoot, snap);

    expect(document.activeElement).toBe(editor);
  });
});

describe("applyFocusSnapshot – none variant", () => {
  it("never mutates focus when kind = none", () => {
    const cardRoot = makeCardRoot();
    const input = makeInput("ignored");
    cardRoot.appendChild(input);

    const before = document.activeElement;
    applyFocusSnapshot(cardRoot, { kind: "none" });
    expect(document.activeElement).toBe(before);
  });
});

describe("applyFocusSnapshot – pre-check (focus already inside card)", () => {
  it("does NOT move focus when the card already contains document.activeElement", () => {
    const cardRoot = makeCardRoot();
    const target = makeInput("email"); // matches the snapshot
    const other = document.createElement("input");
    other.type = "text";
    cardRoot.appendChild(target);
    cardRoot.appendChild(other);

    // User has already clicked into `other` mid-restore.
    other.focus();
    expect(document.activeElement).toBe(other);

    const snap: FocusSnapshot = { kind: "form-control", persistKey: "email" };
    applyFocusSnapshot(cardRoot, snap);

    // Focus stays on `other`; restore does not fight the user.
    expect(document.activeElement).toBe(other);
  });

  it("DOES move focus when document.activeElement is outside the card", () => {
    const cardRoot = makeCardRoot();
    const target = makeInput("email");
    cardRoot.appendChild(target);

    // Focus is outside the card (body or a sibling input).
    const outside = document.createElement("input");
    outside.type = "text";
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    applyFocusSnapshot(cardRoot, { kind: "form-control", persistKey: "email" });
    expect(document.activeElement).toBe(target);
  });
});

describe("applyFocusSnapshot – unknown key", () => {
  it("silently no-ops when the persistKey does not match any element", () => {
    const cardRoot = makeCardRoot();
    const input = makeInput("email");
    cardRoot.appendChild(input);

    const snap: FocusSnapshot = { kind: "form-control", persistKey: "other" };
    expect(() => applyFocusSnapshot(cardRoot, snap)).not.toThrow();
    // Focus did not move onto the matching-but-wrong-key input.
    expect(document.activeElement).not.toBe(input);
  });
});
