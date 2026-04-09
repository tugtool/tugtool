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
import {
  ResponderChainContext,
  ResponderChainManager as ResponderChainManagerCtor,
} from "@/components/tugways/responder-chain";
import type { ResponderChainManager } from "@/components/tugways/responder-chain";
import {
  installFakeNativeClipboardBridge,
  uninstallFakeNativeClipboardBridge,
  installFakeClipboardReadText,
  uninstallFakeClipboardReadText,
} from "./helpers/paste-shims";

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
// State preservation across context-value transitions
// ---------------------------------------------------------------------------
//
// The old two-path render used two React component types — TugInputPlain
// when no chain manager was in scope, TugInputWithResponder when one
// was — and the public TugInput branched between them at the
// component-type level. A context-value transition (manager null ↔
// non-null) therefore switched component types at TugInput's tree
// position, which React reconciles as an unmount + remount of the
// subtree, destroying the underlying <input> DOM element and losing
// caret, focus, uncontrolled text state, and similar.
//
// The current design is a single TugInput component that adapts via
// useOptionalResponder (inside useTextInputResponder), so
// context-value transitions never flip the component type — React
// reconciles the same <input> element across them. These tests pin
// that invariant to the element-identity level:
// `elementBefore === elementAfter` after toggling the chain context
// value around the same tree.
//
// Test setup: a stable ancestor (`ContextToggleHarness`) always
// renders `ResponderChainContext.Provider` at the root and toggles
// its `value` prop between a real manager and null. The tree
// structure is stable; only the context value changes. Under the
// old two-path render, TugInput's internal component-type branch
// would still unmount the input; under the new design, the <input>
// element survives. We use the bare context (not
// ResponderChainProvider) because we're verifying React
// reconciliation at TugInput's tree position, not provider-level
// end-to-end behavior like focusin promotion — those are covered
// by other tests in this file.

describe("TugInput – state preservation across context-value transitions", () => {
  it("preserves the underlying <input> element when the chain context value toggles null → manager", () => {
    function CaptureAndChild({ manager }: { manager: ResponderChainManager | null }) {
      return (
        <ResponderChainContext.Provider value={manager}>
          <TugInput data-testid="toggle-input" defaultValue="initial" />
        </ResponderChainContext.Provider>
      );
    }

    const { container, rerender } = render(<CaptureAndChild manager={null} />);
    const inputBefore = getInput(container, "toggle-input");
    expect(inputBefore.getAttribute("data-responder-id")).toBeNull();

    inputBefore.value = "typed-text";

    // Install a real manager via the stable context provider.
    const managerInstance = new ResponderChainManagerCtor();
    rerender(<CaptureAndChild manager={managerInstance} />);

    const inputAfter = getInput(container, "toggle-input");
    // Same DOM element instance — this is the critical assertion.
    expect(inputAfter).toBe(inputBefore);
    // Uncontrolled text value survived.
    expect(inputAfter.value).toBe("typed-text");
    // data-responder-id now present because a manager is in scope.
    expect(inputAfter.getAttribute("data-responder-id")).not.toBeNull();
  });

  it("preserves the underlying <input> element when the chain context value toggles manager → null", () => {
    const manager = new ResponderChainManagerCtor();
    function CaptureAndChild({ m }: { m: ResponderChainManager | null }) {
      return (
        <ResponderChainContext.Provider value={m}>
          <TugInput data-testid="toggle-input-2" defaultValue="initial" />
        </ResponderChainContext.Provider>
      );
    }

    const { container, rerender } = render(<CaptureAndChild m={manager} />);
    const inputBefore = getInput(container, "toggle-input-2");
    expect(inputBefore.getAttribute("data-responder-id")).not.toBeNull();

    inputBefore.value = "typed-text";

    rerender(<CaptureAndChild m={null} />);

    const inputAfter = getInput(container, "toggle-input-2");
    expect(inputAfter).toBe(inputBefore);
    expect(inputAfter.value).toBe("typed-text");
    // Attribute removed as part of the manager-leave transition.
    expect(inputAfter.getAttribute("data-responder-id")).toBeNull();
  });

  it("survives a full null → manager → null → manager round-trip on the same element", () => {
    function CaptureAndChild({ m }: { m: ResponderChainManager | null }) {
      return (
        <ResponderChainContext.Provider value={m}>
          <TugInput data-testid="rt-input" defaultValue="initial" />
        </ResponderChainContext.Provider>
      );
    }

    const { container, rerender } = render(<CaptureAndChild m={null} />);
    const elementRef = getInput(container, "rt-input");
    elementRef.value = "round-trip-text";

    // null → manager
    const manager1 = new ResponderChainManagerCtor();
    rerender(<CaptureAndChild m={manager1} />);
    expect(getInput(container, "rt-input")).toBe(elementRef);
    expect(elementRef.value).toBe("round-trip-text");

    // manager → null
    rerender(<CaptureAndChild m={null} />);
    expect(getInput(container, "rt-input")).toBe(elementRef);
    expect(elementRef.value).toBe("round-trip-text");

    // null → different manager
    const manager2 = new ResponderChainManagerCtor();
    rerender(<CaptureAndChild m={manager2} />);
    expect(getInput(container, "rt-input")).toBe(elementRef);
    expect(elementRef.value).toBe("round-trip-text");
    expect(elementRef.getAttribute("data-responder-id")).not.toBeNull();
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

  // Paste's three-branch reader cascade is tested in two targeted
  // smoke tests below. The execCommand-success branch (branch 2) is
  // deliberately not tested — shimming a synthetic ClipboardEvent
  // with populated DataTransfer dispatched synchronously by
  // execCommand is too fragile in happy-dom to be maintainable, and
  // a full polyfill would grow into a happy-dom clone. That branch
  // is verified manually in real browsers. Branch 1 (native bridge)
  // and branch 3 (Clipboard API fallback) are production code paths
  // in Tug.app and in dev browsers respectively, so they get real
  // tests here. The insertion tail — the bug-prone half shared
  // across all three branches — is exhaustively covered by
  // `apply-pasted-text.test.ts`.
});

// ---------------------------------------------------------------------------
// Paste cascade — focused branch integration tests
// ---------------------------------------------------------------------------

describe("TugInput – paste cascade", () => {
  it("paste via native bridge: reads from Swift-side NSPasteboard and inserts on continuation", async () => {
    // Install a fake window.webkit.messageHandlers.clipboardRead
    // that synchronously calls the __tugNativeClipboardCallback on
    // the next microtask with our test text. This is the production
    // code path in Tug.app.
    installFakeNativeClipboardBridge({ returnText: "pasted-native" });
    try {
      const { container, manager } = renderWithProvider(
        <TugInput data-testid="paste-native" defaultValue="before" />
      );
      const input = getInput(container, "paste-native");
      const id = input.getAttribute("data-responder-id") as string;
      // Caret at end so the inserted text appends.
      input.setSelectionRange(input.value.length, input.value.length);

      const result = manager.dispatchToForContinuation(id, {
        action: "paste",
        phase: "discrete",
      });
      // Paste handler returns a continuation even on the native path
      // — the actual insert is deferred until after the menu blink.
      expect(result.continuation).toBeDefined();

      // Run the continuation. It awaits the microtask-delivered
      // native callback via the promise chain inside the handler.
      result.continuation?.();

      // Flush microtasks so the promise chain (queueMicrotask →
      // callback resolves promise → promise.then calls applyPastedText)
      // completes before assertion.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(input.value).toBe("beforepasted-native");
    } finally {
      uninstallFakeNativeClipboardBridge();
    }
  });

  it("paste via Clipboard API fallback: reads navigator.clipboard.readText and inserts on continuation", async () => {
    // happy-dom's default `document.execCommand("paste")` does not
    // fire a paste event, so the execCommand branch naturally falls
    // through to the Clipboard API branch. Stub
    // `navigator.clipboard.readText` to return our test text. This
    // is the production code path in dev browsers (Chrome, Firefox).
    installFakeClipboardReadText("pasted-api");
    try {
      const { container, manager } = renderWithProvider(
        <TugInput data-testid="paste-api" defaultValue="before" />
      );
      const input = getInput(container, "paste-api");
      const id = input.getAttribute("data-responder-id") as string;
      input.setSelectionRange(input.value.length, input.value.length);

      const result = manager.dispatchToForContinuation(id, {
        action: "paste",
        phase: "discrete",
      });
      expect(result.continuation).toBeDefined();

      result.continuation?.();

      // Flush microtasks so the clipboard.readText promise resolves
      // and the continuation's .then runs applyPastedText.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(input.value).toBe("beforepasted-api");
    } finally {
      uninstallFakeClipboardReadText();
    }
  });
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
