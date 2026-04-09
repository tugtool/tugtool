/**
 * apply-pasted-text unit tests — paste "insert the text" tail coverage.
 *
 * `applyPastedText` is the pure helper extracted from the paste-handler
 * cascade in `use-text-input-responder.tsx`. Before extraction, the
 * same "insert pasted text at the current selection and fire an input
 * event" logic was triplicated across three reader branches (native
 * bridge, execCommand capture, Clipboard API fallback), making the
 * bug-prone half of paste structurally untestable without a full
 * clipboard polyfill. Since extraction, the tail is a pure function
 * that operates on a concrete `<input>` / `<textarea>` element and a
 * string — zero clipboard APIs involved — which runs cleanly in
 * happy-dom without any shimming at all.
 *
 * The three reader branches themselves are tested elsewhere:
 * - Native bridge: `tug-input.test.tsx` / "paste via native bridge"
 * - Clipboard API fallback: `tug-input.test.tsx` / "paste via Clipboard API"
 * - execCommand success: deliberately not tested — shimming
 *   `ClipboardEvent` + `DataTransfer` + synchronous execCommand is
 *   too fragile to be maintainable; the happy-dom environment does
 *   not simulate the native browser paste event faithfully. The
 *   branch is verified manually in real browsers.
 *
 * The eight tests below exercise every observable branch of
 * `applyPastedText`: mounted guard, null-input guard, empty-text
 * no-op, selection replacement, caret-only insertion, append-at-end
 * fallback when selection is null, setRangeText call shape, and
 * synthetic input event dispatch.
 */

// happy-dom setup must be imported first so `document`, `Event`, and
// `HTMLInputElement` exist in the test environment. setup-rtl is the
// project's canonical entry point for DOM globals — the other
// `.test.tsx` files also import it first.
import "./setup-rtl";

import { describe, it, expect } from "bun:test";
import { applyPastedText } from "@/components/tugways/use-text-input-responder";

// Tiny ref-factory — this test file doesn't need React, so we build
// plain `{ current }` objects that match the MutableRefObject shape.
function mountedRef(value: boolean = true): { current: boolean } {
  return { current: value };
}

function inputRef(el: HTMLInputElement | null): { current: HTMLInputElement | null } {
  return { current: el };
}

function makeInput(initial: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.value = initial;
  // Attach to the document so setRangeText's DOM bookkeeping runs
  // against a connected element. happy-dom generally tolerates
  // detached elements here, but real browsers are pickier — keep
  // the tests honest.
  document.body.appendChild(el);
  return el;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("applyPastedText", () => {
  it("is a no-op when the component is unmounted", () => {
    const el = makeInput("before");
    const unmounted = mountedRef(false);
    let inputEvents = 0;
    el.addEventListener("input", () => inputEvents++);

    applyPastedText(inputRef(el), unmounted, "new");

    expect(el.value).toBe("before");
    expect(inputEvents).toBe(0);
    el.remove();
  });

  it("is a no-op when the inputRef is null", () => {
    // No element to mutate; the function must not throw.
    expect(() =>
      applyPastedText(inputRef(null), mountedRef(true), "new"),
    ).not.toThrow();
  });

  it("is a no-op when the text is empty", () => {
    const el = makeInput("before");
    let inputEvents = 0;
    el.addEventListener("input", () => inputEvents++);

    applyPastedText(inputRef(el), mountedRef(true), "");

    expect(el.value).toBe("before");
    expect(inputEvents).toBe(0);
    el.remove();
  });

  it("inserts text at the caret when there is no selection range", () => {
    const el = makeInput("abcdef");
    // Place caret between "abc" and "def" — no selection range.
    el.setSelectionRange(3, 3);

    applyPastedText(inputRef(el), mountedRef(true), "XYZ");

    expect(el.value).toBe("abcXYZdef");
    el.remove();
  });

  it("replaces a ranged selection with the pasted text", () => {
    const el = makeInput("abcdef");
    // Select "bcd"
    el.setSelectionRange(1, 4);

    applyPastedText(inputRef(el), mountedRef(true), "XYZ");

    expect(el.value).toBe("aXYZef");
    el.remove();
  });

  it("appends at the end when selectionStart/End are null", () => {
    const el = makeInput("start");
    // Force selection to null — happy-dom allows setting these
    // directly on some element shapes. If it doesn't, the
    // `?? node.value.length` fallback in applyPastedText covers the
    // native `<input type="number">` case where selection is null
    // by spec. We simulate that here by deleting the properties.
    Object.defineProperty(el, "selectionStart", { value: null, configurable: true });
    Object.defineProperty(el, "selectionEnd", { value: null, configurable: true });

    applyPastedText(inputRef(el), mountedRef(true), " end");

    expect(el.value).toBe("start end");
    el.remove();
  });

  it("dispatches a bubbling synthetic input event after the insertion", () => {
    const el = makeInput("abc");
    let inputEvents = 0;
    let lastEventBubbled = false;
    el.addEventListener("input", (e) => {
      inputEvents++;
      lastEventBubbled = e.bubbles;
    });

    applyPastedText(inputRef(el), mountedRef(true), "XYZ");

    expect(inputEvents).toBe(1);
    expect(lastEventBubbled).toBe(true);
    el.remove();
  });

  it("calls setRangeText with the 'end' selection mode", () => {
    // `setRangeText(text, start, end, selectMode)` has four selection
    // modes: "select", "start", "end", "preserve". applyPastedText
    // deliberately uses "end" so the caret lands after the inserted
    // text (spec-compliant behavior matching every native paste).
    // We spy on the call directly instead of asserting caret
    // position, because happy-dom's `setRangeText` implementation
    // diverges from the WHATWG spec for the `"end"` mode — it
    // places the caret at the end of the value instead of the end
    // of the inserted text. Spying on the argument lets this test
    // pin the contract at our call site without depending on
    // happy-dom fidelity.
    const el = makeInput("abcdef");
    el.setSelectionRange(3, 3);

    const calls: Array<{
      text: string;
      start: number;
      end: number;
      mode: string | undefined;
    }> = [];
    const originalSetRangeText = el.setRangeText.bind(el);
    // Spy: record the call shape, then delegate so the DOM still
    // reflects the insertion (other assertions in this file rely on
    // the value being correct).
    el.setRangeText = function spy(
      ...args: Parameters<HTMLInputElement["setRangeText"]>
    ): ReturnType<HTMLInputElement["setRangeText"]> {
      if (args.length >= 4) {
        calls.push({
          text: args[0] as string,
          start: args[1] as number,
          end: args[2] as number,
          mode: args[3] as string | undefined,
        });
      }
      return originalSetRangeText(...args);
    } as HTMLInputElement["setRangeText"];

    applyPastedText(inputRef(el), mountedRef(true), "XYZ");

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe("XYZ");
    expect(calls[0].start).toBe(3);
    expect(calls[0].end).toBe(3);
    expect(calls[0].mode).toBe("end");
    el.remove();
  });
});
