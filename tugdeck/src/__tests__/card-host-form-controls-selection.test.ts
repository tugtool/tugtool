/**
 * `captureFormControls` / `applyFormControlSnapshot` selection-field
 * tests — Step 8.
 *
 * Pins the save/restore contract for `<input>` / `<textarea>` selection
 * carried in `FormControlSnapshot.selectionStart/End/Direction`:
 *
 *   - A selection on a `<input type="text">` round-trips through the
 *     capture + apply path: value, offsets, direction all survive.
 *   - A `<textarea>` with a backward selection round-trips.
 *   - An `<input type="checkbox">` that carries `data-tug-persist-value`
 *     is captured (so its value still persists) but without selection
 *     fields — and neither capture nor apply throws.
 *   - Value restore precedes `setSelectionRange`, so offsets land
 *     against the restored string.
 *   - Scroll restore runs last, so `setSelectionRange`'s scroll-into-
 *     view side effect cannot override the saved scroll position.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  applyFormControlSnapshot,
  captureFormControls,
} from "@/components/chrome/card-host";
import type { FormControlSnapshot } from "@/layout-tree";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardRoot(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-card-host", "");
  document.body.appendChild(el);
  return el;
}

function makeInput(
  persistKey: string,
  {
    type = "text",
    value = "",
  }: { type?: string; value?: string } = {},
): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  if (value !== "") el.value = value;
  el.setAttribute("data-tug-persist-value", persistKey);
  return el;
}

function makeTextarea(persistKey: string, value: string = ""): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  if (value !== "") el.value = value;
  el.setAttribute("data-tug-persist-value", persistKey);
  return el;
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

describe("captureFormControls – selection capture", () => {
  it("captures selectionStart/End/Direction on <input type='text'>", () => {
    const cardRoot = makeCardRoot();
    const inp = makeInput("greeting", { value: "hello world" });
    cardRoot.appendChild(inp);
    inp.setSelectionRange(6, 11, "forward");

    const snapshot = captureFormControls(cardRoot);
    expect(snapshot).not.toBeUndefined();
    if (!snapshot) return;

    expect(snapshot["greeting"]).toEqual({
      value: "hello world",
      scrollTop: 0,
      scrollLeft: 0,
      selectionStart: 6,
      selectionEnd: 11,
      selectionDirection: "forward",
    });
  });

  it("captures a backward selection on <textarea>", () => {
    const cardRoot = makeCardRoot();
    const ta = makeTextarea("notes", "alpha beta gamma");
    cardRoot.appendChild(ta);
    ta.setSelectionRange(6, 10, "backward");

    const snapshot = captureFormControls(cardRoot);
    expect(snapshot?.["notes"].selectionStart).toBe(6);
    expect(snapshot?.["notes"].selectionEnd).toBe(10);
    expect(snapshot?.["notes"].selectionDirection).toBe("backward");
  });

  it("<input type='checkbox'> with persistKey captures value but no selection fields (and does not throw)", () => {
    const cardRoot = makeCardRoot();
    const cb = makeInput("agree", { type: "checkbox" });
    cardRoot.appendChild(cb);

    let snapshot: Record<string, FormControlSnapshot> | undefined;
    expect(() => {
      snapshot = captureFormControls(cardRoot);
    }).not.toThrow();

    expect(snapshot?.["agree"].selectionStart).toBeUndefined();
    expect(snapshot?.["agree"].selectionEnd).toBeUndefined();
    expect(snapshot?.["agree"].selectionDirection).toBeUndefined();
    // Value is still captured — the other axes do not depend on selection.
    expect(typeof snapshot?.["agree"].value).toBe("string");
  });
});

describe("applyFormControlSnapshot – selection restore", () => {
  it("round-trips value, selection offsets, and direction via capture → apply", () => {
    const cardRoot = makeCardRoot();
    const inp = makeInput("greeting", { value: "hello world" });
    cardRoot.appendChild(inp);
    inp.setSelectionRange(6, 11, "forward");

    const snapshot = captureFormControls(cardRoot);
    expect(snapshot).not.toBeUndefined();
    if (!snapshot) return;

    const restored = makeInput("greeting", { value: "" });
    cardRoot.appendChild(restored);

    applyFormControlSnapshot(restored, snapshot["greeting"]);

    expect(restored.value).toBe("hello world");
    expect(restored.selectionStart).toBe(6);
    expect(restored.selectionEnd).toBe(11);
    expect(restored.selectionDirection).toBe("forward");
  });

  it("applies value before selectionStart/End so offsets land against the restored string", () => {
    const cardRoot = makeCardRoot();
    const inp = makeInput("x", { value: "" });
    cardRoot.appendChild(inp);

    // Snapshot claims a range of [0, 5] but the current value is "".
    // If apply wrote the selection first, `setSelectionRange(0, 5)` on
    // an empty string would clamp to [0, 0] in strict browsers. After
    // value restore, the [0, 5] range is valid.
    const snap: FormControlSnapshot = {
      value: "abcdef",
      selectionStart: 0,
      selectionEnd: 5,
      selectionDirection: "forward",
    };

    applyFormControlSnapshot(inp, snap);

    expect(inp.value).toBe("abcdef");
    expect(inp.selectionStart).toBe(0);
    expect(inp.selectionEnd).toBe(5);
  });

  it("restoring a snapshot without selection fields does not throw or clobber existing selection", () => {
    const cardRoot = makeCardRoot();
    const inp = makeInput("x", { value: "present" });
    cardRoot.appendChild(inp);
    inp.setSelectionRange(2, 4, "forward");

    const snap: FormControlSnapshot = { value: "present" };
    expect(() => applyFormControlSnapshot(inp, snap)).not.toThrow();

    // No selection fields in the snapshot → the existing selection is
    // left alone.
    expect(inp.selectionStart).toBe(2);
    expect(inp.selectionEnd).toBe(4);
  });

  it("checkbox with a value-only snapshot restores cleanly (no selection attempt)", () => {
    const cardRoot = makeCardRoot();
    const cb = makeInput("agree", { type: "checkbox" });
    cardRoot.appendChild(cb);

    const snap: FormControlSnapshot = { value: "on" };
    expect(() => applyFormControlSnapshot(cb, snap)).not.toThrow();
  });

  it("writes scroll after selection so scroll-into-view side effects do not override saved scroll", () => {
    const cardRoot = makeCardRoot();
    const ta = makeTextarea("notes", "abc");
    cardRoot.appendChild(ta);

    const snap: FormControlSnapshot = {
      value: "abc",
      selectionStart: 1,
      selectionEnd: 2,
      scrollTop: 42,
      scrollLeft: 7,
    };

    applyFormControlSnapshot(ta, snap);

    // scrollTop/Left write happened last, so any internal scroll-to-
    // selection that setSelectionRange may trigger does not win.
    expect(ta.scrollTop).toBe(42);
    expect(ta.scrollLeft).toBe(7);
    expect(ta.selectionStart).toBe(1);
    expect(ta.selectionEnd).toBe(2);
  });
});
