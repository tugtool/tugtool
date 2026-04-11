/**
 * apply-pasted-text unit tests — paste "insert the text" tail coverage.
 *
 * `applyPastedText` is the pure helper extracted from the paste-handler
 * cascade in `use-text-input-responder.tsx`. It inserts text via
 * `document.execCommand("insertText")` so the edit routes through the
 * browser's native editing pipeline and pushes onto the undo stack.
 *
 * Since `execCommand("insertText")` does not mutate the DOM in
 * happy-dom, insertion tests verify the execCommand call was made with
 * the correct arguments rather than asserting `input.value`.
 */

// happy-dom setup must be imported first so `document`, `Event`, and
// `HTMLInputElement` exist in the test environment. setup-rtl is the
// project's canonical entry point for DOM globals — the other
// `.test.tsx` files also import it first.
import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
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
  document.body.appendChild(el);
  return el;
}

// ---- execCommand spy ----

interface ExecCommandCall {
  command: string;
  showUI: boolean | undefined;
  value: string | undefined;
}

let execCommandCalls: ExecCommandCall[] = [];
let originalExecCommand: Document["execCommand"] | undefined;

function installExecCommandSpy() {
  execCommandCalls = [];
  originalExecCommand = document.execCommand;
  document.execCommand = function (
    command: string,
    showUI?: boolean,
    value?: string,
  ): boolean {
    execCommandCalls.push({ command, showUI, value });
    return true;
  } as Document["execCommand"];
}

function restoreExecCommand() {
  if (originalExecCommand) {
    document.execCommand = originalExecCommand;
    originalExecCommand = undefined;
  }
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("applyPastedText", () => {
  beforeEach(() => installExecCommandSpy());
  afterEach(() => restoreExecCommand());

  it("is a no-op when the component is unmounted", () => {
    const el = makeInput("before");
    const unmounted = mountedRef(false);

    applyPastedText(inputRef(el), unmounted, "new");

    expect(el.value).toBe("before");
    expect(execCommandCalls.length).toBe(0);
    el.remove();
  });

  it("is a no-op when the inputRef is null", () => {
    // No element to mutate; the function must not throw.
    expect(() =>
      applyPastedText(inputRef(null), mountedRef(true), "new"),
    ).not.toThrow();
    expect(execCommandCalls.length).toBe(0);
  });

  it("is a no-op when the text is empty", () => {
    const el = makeInput("before");

    applyPastedText(inputRef(el), mountedRef(true), "");

    expect(el.value).toBe("before");
    expect(execCommandCalls.length).toBe(0);
    el.remove();
  });

  it("calls execCommand('insertText') with the pasted text", () => {
    const el = makeInput("abcdef");
    el.setSelectionRange(3, 3);

    applyPastedText(inputRef(el), mountedRef(true), "XYZ");

    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("insertText");
    expect(execCommandCalls[0].value).toBe("XYZ");
    el.remove();
  });

  it("focuses the element before calling execCommand", () => {
    const el = makeInput("abc");
    // Blur so we can verify focus is called.
    el.blur();

    applyPastedText(inputRef(el), mountedRef(true), "XYZ");

    expect(document.activeElement).toBe(el);
    el.remove();
  });
});
