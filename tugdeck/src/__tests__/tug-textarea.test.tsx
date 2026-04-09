/**
 * TugTextarea unit tests — A2.7 chain registration coverage.
 *
 * Mirrors `tug-input.test.tsx` for the textarea variant. Same two-
 * path rendering, same six editing handlers, same disabled guard —
 * plus verification that the wrapper div from `maxLength` does not
 * break the `data-responder-id` placement (the attribute lives on
 * the textarea, not the wrapper).
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { TugTextarea } from "@/components/tugways/tug-textarea";
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

function getTextarea(container: HTMLElement, testId?: string): HTMLTextAreaElement {
  const selector = testId
    ? `textarea[data-slot="tug-textarea"][data-testid="${testId}"]`
    : `textarea[data-slot="tug-textarea"]`;
  const el = container.querySelector<HTMLTextAreaElement>(selector);
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

describe("TugTextarea – two-path rendering (A2.7)", () => {
  it("renders a plain <textarea> without data-responder-id when no provider is in scope", () => {
    const { container } = render(
      <TugTextarea data-testid="plain-ta" defaultValue="hello" />
    );
    const textarea = getTextarea(container, "plain-ta");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.getAttribute("data-responder-id")).toBeNull();
  });

  it("renders with data-responder-id when inside a ResponderChainProvider", () => {
    const { container } = renderWithProvider(
      <TugTextarea data-testid="chain-ta" defaultValue="hello" />
    );
    const textarea = getTextarea(container, "chain-ta");
    expect(textarea.getAttribute("data-responder-id")).not.toBeNull();
  });

  it("data-responder-id lives on the textarea, not the maxLength wrapper div", () => {
    const { container } = renderWithProvider(
      <TugTextarea data-testid="maxlen-ta" defaultValue="hi" maxLength={100} />
    );
    const textarea = getTextarea(container, "maxlen-ta");
    expect(textarea.getAttribute("data-responder-id")).not.toBeNull();

    // The wrapper div must NOT have the attribute.
    const wrapper = container.querySelector<HTMLDivElement>(".tug-textarea-wrapper");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("data-responder-id")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Focus-driven first-responder promotion
// ---------------------------------------------------------------------------

describe("TugTextarea – focusin promotion (A2.7)", () => {
  it("focusing the textarea promotes it to first responder", () => {
    const { container, manager } = renderWithProvider(
      <TugTextarea data-testid="focus-ta" defaultValue="hello" />
    );
    const textarea = getTextarea(container, "focus-ta");
    const expectedId = textarea.getAttribute("data-responder-id");

    textarea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(manager.getFirstResponder()).toBe(expectedId);
  });
});

// ---------------------------------------------------------------------------
// Editing action handlers
// ---------------------------------------------------------------------------

describe("TugTextarea – action handlers (A2.7)", () => {
  it("selectAll selects the entire textarea content", () => {
    const { container, manager } = renderWithProvider(
      <TugTextarea data-testid="sel-ta" defaultValue="hello world" />
    );
    const textarea = getTextarea(container, "sel-ta");
    const id = textarea.getAttribute("data-responder-id") as string;

    textarea.setSelectionRange(2, 3);
    manager.dispatchTo(id, { action: "selectAll", phase: "discrete" });

    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe("hello world".length);
  });

  it("cut delegates to document.execCommand('cut')", () => {
    const { container, manager } = renderWithProvider(
      <TugTextarea data-testid="cut-ta" defaultValue="hello" />
    );
    const id = getTextarea(container, "cut-ta").getAttribute("data-responder-id") as string;

    manager.dispatchTo(id, { action: "cut", phase: "discrete" });

    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("cut");
  });

  it("copy delegates to document.execCommand('copy')", () => {
    const { container, manager } = renderWithProvider(
      <TugTextarea data-testid="copy-ta" defaultValue="hello" />
    );
    const id = getTextarea(container, "copy-ta").getAttribute("data-responder-id") as string;

    manager.dispatchTo(id, { action: "copy", phase: "discrete" });

    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("copy");
  });

  it("undo delegates to document.execCommand('undo')", () => {
    const { container, manager } = renderWithProvider(
      <TugTextarea data-testid="undo-ta" defaultValue="hello" />
    );
    const id = getTextarea(container, "undo-ta").getAttribute("data-responder-id") as string;

    manager.dispatchTo(id, { action: "undo", phase: "discrete" });

    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("undo");
  });

  it("redo delegates to document.execCommand('redo')", () => {
    const { container, manager } = renderWithProvider(
      <TugTextarea data-testid="redo-ta" defaultValue="hello" />
    );
    const id = getTextarea(container, "redo-ta").getAttribute("data-responder-id") as string;

    manager.dispatchTo(id, { action: "redo", phase: "discrete" });

    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("redo");
  });
});

// ---------------------------------------------------------------------------
// Disabled guard
// ---------------------------------------------------------------------------

describe("TugTextarea – disabled guard (A2.7)", () => {
  it("disabled textarea does not fire execCommand or select when dispatched", () => {
    const { container, manager } = renderWithProvider(
      <TugTextarea data-testid="disabled-ta" defaultValue="hello" disabled />
    );
    const textarea = getTextarea(container, "disabled-ta");
    const id = textarea.getAttribute("data-responder-id") as string;

    textarea.setSelectionRange(1, 2);
    manager.dispatchTo(id, { action: "cut", phase: "discrete" });
    manager.dispatchTo(id, { action: "copy", phase: "discrete" });
    manager.dispatchTo(id, { action: "undo", phase: "discrete" });
    manager.dispatchTo(id, { action: "redo", phase: "discrete" });
    manager.dispatchTo(id, { action: "selectAll", phase: "discrete" });

    expect(execCommandCalls.length).toBe(0);
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(2);
  });
});
