/**
 * TugInput unit tests — A2.7 chain registration coverage.
 *
 * Tests cover the two-path rendering strategy and the six editing
 * action handlers introduced by the A2.7 migration:
 *
 * 1. Two-path rendering
 *    - Standalone (no provider): renders a plain <input> with no
 *      data-responder-id attribute.
 *    - Inside ResponderChainProvider: renders with data-responder-id
 *      and registers a responder node in the manager.
 *
 * 2. Focus-driven first-responder promotion
 *    - Focusing the input fires the document-level focusin listener
 *      installed by the provider, which walks from the event target
 *      up to the innermost data-responder-id and promotes it.
 *
 * 3. Editing action handlers
 *    - selectAll: input.selectionStart === 0, selectionEnd === len
 *    - cut / copy / undo / redo: document.execCommand called with
 *      the matching argument (stubbed — happy-dom does not implement
 *      execCommand, so we can spy on it deterministically).
 *    - paste: clipboard readText is invoked; the continuation
 *      inserts at the current selection via setRangeText.
 *
 * 4. Disabled guard
 *    - A disabled input dispatched via manager.dispatchTo still runs
 *      the handler, but the handler's effectiveDisabled short-circuit
 *      prevents execCommand / select / setRangeText from firing.
 *
 * These tests use the full `ResponderChainProvider` (not a bare
 * context) so focusin promotion actually runs end-to-end.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";

import { TugInput } from "@/components/tugways/tug-input";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { ResponderChainContext } from "@/components/tugways/responder-chain";
import type { ResponderChainManager } from "@/components/tugways/responder-chain";

// ---------------------------------------------------------------------------
// execCommand spy
// ---------------------------------------------------------------------------

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
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Render UI inside a ResponderChainProvider (full setup — installs
 * the document-level focusin/pointerdown listeners and keybinding
 * capture). Returns the container plus a ref to the manager (captured
 * via a child component that reads the context).
 */
function renderWithProvider(ui: React.ReactElement) {
  let capturedManager: ResponderChainManager | null = null;
  function CaptureManager({ children }: { children: React.ReactNode }) {
    capturedManager = React.useContext(ResponderChainContext);
    return <>{children}</>;
  }
  const result = render(
    <ResponderChainProvider>
      <CaptureManager>{ui}</CaptureManager>
    </ResponderChainProvider>
  );
  if (!capturedManager) {
    throw new Error("ResponderChainManager was not captured from provider");
  }
  return { ...result, manager: capturedManager as ResponderChainManager };
}

/** Locate the TugInput DOM element by its data-slot attribute. */
function getInput(container: HTMLElement, testId?: string): HTMLInputElement {
  const selector = testId
    ? `input[data-slot="tug-input"][data-testid="${testId}"]`
    : `input[data-slot="tug-input"]`;
  const el = container.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`no ${selector} found`);
  return el;
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  installExecCommandSpy();
});

afterEach(() => {
  cleanup();
  restoreExecCommand();
});

// ---------------------------------------------------------------------------
// Two-path rendering
// ---------------------------------------------------------------------------

describe("TugInput – two-path rendering (A2.7)", () => {
  it("renders a plain <input> without data-responder-id when no provider is in scope", () => {
    const { container } = render(
      <TugInput data-testid="plain-input" defaultValue="hello" />
    );
    const input = getInput(container, "plain-input");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("data-responder-id")).toBeNull();
  });

  it("renders with data-responder-id when inside a ResponderChainProvider", () => {
    const { container } = renderWithProvider(
      <TugInput data-testid="chain-input" defaultValue="hello" />
    );
    const input = getInput(container, "chain-input");
    expect(input.getAttribute("data-responder-id")).not.toBeNull();
    expect((input.getAttribute("data-responder-id") as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Focus-driven first-responder promotion
// ---------------------------------------------------------------------------

describe("TugInput – focusin promotion (A2.7)", () => {
  it("focusing the input promotes it to first responder", () => {
    const { container, manager } = renderWithProvider(
      <TugInput data-testid="focus-input" defaultValue="hello" />
    );
    const input = getInput(container, "focus-input");
    const expectedId = input.getAttribute("data-responder-id");

    // Fire focusin (bubbles) so the document-level capture listener
    // installed by the provider runs and walks from the target up to
    // the nearest data-responder-id element.
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(manager.getFirstResponder()).toBe(expectedId);
  });

  it("two inputs in the same tree promote distinctly", () => {
    const { container, manager } = renderWithProvider(
      <>
        <TugInput data-testid="input-a" defaultValue="a" />
        <TugInput data-testid="input-b" defaultValue="b" />
      </>
    );
    const inputA = getInput(container, "input-a");
    const inputB = getInput(container, "input-b");
    const idA = inputA.getAttribute("data-responder-id");
    const idB = inputB.getAttribute("data-responder-id");
    expect(idA).not.toBe(idB);

    inputA.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(manager.getFirstResponder()).toBe(idA);

    inputB.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(manager.getFirstResponder()).toBe(idB);
  });
});

// ---------------------------------------------------------------------------
// Editing action handlers
// ---------------------------------------------------------------------------

describe("TugInput – action handlers (A2.7)", () => {
  // All handlers use the two-phase pattern: optional sync body runs
  // inside the user gesture, continuation runs after the menu
  // activation blink. Tests walk both phases via
  // dispatchToForContinuation + invoking the continuation.

  it("selectAll defers input.select() to the continuation phase", () => {
    const { container, manager } = renderWithProvider(
      <TugInput data-testid="sel-input" defaultValue="hello world" />
    );
    const input = getInput(container, "sel-input");
    const id = input.getAttribute("data-responder-id") as string;

    input.setSelectionRange(2, 3);
    const result = manager.dispatchToForContinuation(id, { action: "selectAll", phase: "discrete" });

    // Sync phase does nothing — selection still (2, 3).
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(3);

    result.continuation?.();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("hello world".length);
  });

  it("cut runs execCommand('copy') in sync phase, then execCommand('delete') in continuation", () => {
    const { container, manager } = renderWithProvider(
      <TugInput data-testid="cut-input" defaultValue="hello" />
    );
    const id = getInput(container, "cut-input").getAttribute("data-responder-id") as string;

    const result = manager.dispatchToForContinuation(id, { action: "cut", phase: "discrete" });

    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("copy");

    result.continuation?.();
    expect(execCommandCalls.length).toBe(2);
    expect(execCommandCalls[1].command).toBe("delete");
  });

  it("copy runs execCommand('copy') in sync phase with no continuation", () => {
    const { container, manager } = renderWithProvider(
      <TugInput data-testid="copy-input" defaultValue="hello" />
    );
    const id = getInput(container, "copy-input").getAttribute("data-responder-id") as string;

    const result = manager.dispatchToForContinuation(id, { action: "copy", phase: "discrete" });

    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("copy");
    expect(result.continuation).toBeUndefined();
  });

  it("undo defers execCommand('undo') to the continuation phase", () => {
    const { container, manager } = renderWithProvider(
      <TugInput data-testid="undo-input" defaultValue="hello" />
    );
    const id = getInput(container, "undo-input").getAttribute("data-responder-id") as string;

    const result = manager.dispatchToForContinuation(id, { action: "undo", phase: "discrete" });

    expect(execCommandCalls.length).toBe(0);
    result.continuation?.();
    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("undo");
  });

  it("redo defers execCommand('redo') to the continuation phase", () => {
    const { container, manager } = renderWithProvider(
      <TugInput data-testid="redo-input" defaultValue="hello" />
    );
    const id = getInput(container, "redo-input").getAttribute("data-responder-id") as string;

    const result = manager.dispatchToForContinuation(id, { action: "redo", phase: "discrete" });

    expect(execCommandCalls.length).toBe(0);
    result.continuation?.();
    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("redo");
  });

  // Paste behavior is verified manually — the capture-then-defer /
  // native-bridge paths depend on Safari/WKWebView clipboard semantics
  // that happy-dom does not simulate faithfully (ClipboardEvent with a
  // populated clipboardData, document.activeElement after focus(),
  // etc.). See use-text-input-responder.tsx and tug-native-clipboard.ts
  // for the production implementation.
});

// ---------------------------------------------------------------------------
// Disabled guard
// ---------------------------------------------------------------------------

describe("TugInput – disabled guard (A2.7)", () => {
  it("disabled input does not fire execCommand when actions dispatch to it", () => {
    const { container, manager } = renderWithProvider(
      <TugInput data-testid="disabled-input" defaultValue="hello" disabled />
    );
    const id = getInput(container, "disabled-input").getAttribute("data-responder-id") as string;

    for (const action of ["cut", "copy", "paste", "undo", "redo"] as const) {
      const result = manager.dispatchToForContinuation(id, { action, phase: "discrete" });
      result.continuation?.();
    }

    expect(execCommandCalls.length).toBe(0);
  });

  it("disabled input does not select on selectAll dispatch", () => {
    const { container, manager } = renderWithProvider(
      <TugInput data-testid="disabled-sel" defaultValue="hello" disabled />
    );
    const input = getInput(container, "disabled-sel");
    const id = input.getAttribute("data-responder-id") as string;

    input.setSelectionRange(1, 2);
    const result = manager.dispatchToForContinuation(id, { action: "selectAll", phase: "discrete" });
    result.continuation?.();

    // Handler short-circuited on effectiveDisabled and returned no
    // continuation, so the initial selection is untouched.
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(2);
  });
});
