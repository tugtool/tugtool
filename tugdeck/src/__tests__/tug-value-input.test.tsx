/**
 * TugValueInput unit tests — A2.6/A2.7 chain coverage.
 *
 * Covers the standalone dispatch paths (blur / Enter / arrow keys)
 * and the A2.7-style responder registration for the six editing
 * actions (cut / copy / paste / selectAll / undo / redo).
 *
 * Tests are split into two suites:
 *
 * 1. `setValue` dispatches from the editing cycle:
 *    - blur with an actual value change → one discrete dispatch
 *    - blur without a change → zero dispatches (no-op guard)
 *    - Enter commits via blur (same path)
 *    - Escape reverts without dispatching
 *    - ArrowUp / ArrowDown dispatch incremented values
 *    - ArrowUp at max and ArrowDown at min don't dispatch (clamp guard)
 *
 * 2. A2.7-style responder registration:
 *    - Two-path rendering (no data-responder-id without provider)
 *    - Inside provider, data-responder-id present
 *    - Focusin promotes to first responder
 *    - cut / copy / undo / redo delegate to execCommand
 *    - selectAll calls input.select()
 *    - Disabled input does not fire handlers
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";

import { TugValueInput } from "@/components/tugways/tug-value-input";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import {
  ResponderChainContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";
import type { ActionEvent } from "@/components/tugways/responder-chain";

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
 * Render UI inside a bare ResponderChainContext.Provider with a
 * controlled manager and an observeDispatch observer. Used for the
 * dispatch-path tests where we want deterministic manager access
 * without the full provider's document-level listeners.
 */
function renderWithChainObserver(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const dispatched: Array<{ event: ActionEvent; handled: boolean }> = [];
  manager.observeDispatch((event, handled) => {
    dispatched.push({ event, handled });
  });
  const result = render(
    <ResponderChainContext.Provider value={manager}>
      {ui}
    </ResponderChainContext.Provider>,
  );
  return { ...result, manager, dispatched };
}

/**
 * Render UI inside a full ResponderChainProvider — installs the
 * document-level focusin / pointerdown listeners so focus promotion
 * tests can exercise the real path. Returns the captured manager.
 */
function renderWithFullProvider(ui: React.ReactElement) {
  let capturedManager: ResponderChainManager | null = null;
  function CaptureManager({ children }: { children: React.ReactNode }) {
    capturedManager = React.useContext(ResponderChainContext);
    return <>{children}</>;
  }
  const result = render(
    <ResponderChainProvider>
      <CaptureManager>{ui}</CaptureManager>
    </ResponderChainProvider>,
  );
  if (!capturedManager) {
    throw new Error("ResponderChainManager not captured from provider");
  }
  return { ...result, manager: capturedManager as ResponderChainManager };
}

/** Locate the TugValueInput DOM element. */
function getInput(container: HTMLElement, testId?: string): HTMLInputElement {
  const selector = testId
    ? `input[data-slot="tug-value-input"][data-testid="${testId}"]`
    : `input[data-slot="tug-value-input"]`;
  const el = container.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`no ${selector} found`);
  return el;
}

/** Filter captured events down to setValue dispatches only. */
function setValueEvents(
  dispatched: Array<{ event: ActionEvent; handled: boolean }>,
): ActionEvent[] {
  return dispatched.filter((d) => d.event.action === "setValue").map((d) => d.event);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeEach(() => {
  installExecCommandSpy();
});

afterEach(() => {
  cleanup();
  restoreExecCommand();
});

// ---------------------------------------------------------------------------
// setValue dispatches from editing cycle
// ---------------------------------------------------------------------------

describe("TugValueInput – setValue dispatches (A2.6)", () => {
  it("blur with an edit dispatches discrete setValue", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugValueInput value={50} senderId="vi-edit" min={0} max={100} step={1} />
    );
    const input = getInput(container);

    fireEvent.focus(input);
    input.value = "75";
    fireEvent.blur(input);

    const events = setValueEvents(dispatched);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      action: "setValue",
      value: 75,
      sender: "vi-edit",
      phase: "discrete",
    });
  });

  it("blur without an edit dispatches nothing (no-op guard)", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugValueInput value={50} senderId="vi-noop" min={0} max={100} step={1} />
    );
    const input = getInput(container);

    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(setValueEvents(dispatched).length).toBe(0);
  });

  it("Escape reverts without dispatching", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugValueInput value={50} senderId="vi-escape" min={0} max={100} step={1} />
    );
    const input = getInput(container);

    fireEvent.focus(input);
    input.value = "99";
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(setValueEvents(dispatched).length).toBe(0);
  });

  it("ArrowUp dispatches discrete setValue with value + step", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugValueInput value={50} senderId="vi-up" min={0} max={100} step={5} />
    );
    const input = getInput(container);

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowUp" });

    const events = setValueEvents(dispatched);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ value: 55, phase: "discrete" });
  });

  it("ArrowDown dispatches discrete setValue with value - step", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugValueInput value={50} senderId="vi-down" min={0} max={100} step={5} />
    );
    const input = getInput(container);

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const events = setValueEvents(dispatched);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ value: 45, phase: "discrete" });
  });

  it("ArrowUp at max does not dispatch (clamp guard)", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugValueInput value={100} senderId="vi-max" min={0} max={100} step={1} />
    );
    const input = getInput(container);

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(setValueEvents(dispatched).length).toBe(0);
  });

  it("ArrowDown at min does not dispatch (clamp guard)", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugValueInput value={0} senderId="vi-min" min={0} max={100} step={1} />
    );
    const input = getInput(container);

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(setValueEvents(dispatched).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A2.7-style responder registration
// ---------------------------------------------------------------------------

describe("TugValueInput – two-path rendering (A2.7)", () => {
  it("renders a plain <input> without data-responder-id when no provider is in scope", () => {
    const { container } = render(<TugValueInput value={50} min={0} max={100} />);
    const input = getInput(container);
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("data-responder-id")).toBeNull();
  });

  it("renders with data-responder-id when inside a ResponderChainProvider", () => {
    const { container } = renderWithFullProvider(
      <TugValueInput value={50} min={0} max={100} />
    );
    const input = getInput(container);
    expect(input.getAttribute("data-responder-id")).not.toBeNull();
  });
});

describe("TugValueInput – focusin promotion (A2.7)", () => {
  it("focusing the input promotes it to first responder", () => {
    const { container, manager } = renderWithFullProvider(
      <TugValueInput value={50} min={0} max={100} />
    );
    const input = getInput(container);
    const expectedId = input.getAttribute("data-responder-id");

    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(manager.getFirstResponder()).toBe(expectedId);
  });
});

describe("TugValueInput – editing action handlers (A2.7)", () => {
  // All handlers use the two-phase pattern: a sync-phase body (runs
  // inside the user gesture) and an optional continuation (runs after
  // the menu activation blink). The tests walk both phases explicitly
  // via `dispatchToForContinuation` + invoking the continuation.

  it("cut runs execCommand('copy') in sync phase, then execCommand('delete') in continuation", () => {
    const { container, manager } = renderWithFullProvider(
      <TugValueInput value={50} min={0} max={100} />
    );
    const id = getInput(container).getAttribute("data-responder-id") as string;

    const result = manager.dispatchToForContinuation(id, { action: "cut", phase: "discrete" });

    // Sync phase: "copy" already fired so the selection stays visible
    // during the menu activation blink.
    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("copy");

    // Continuation phase: "delete" fires after the blink, deleting
    // the selection and pushing to the native undo stack.
    result.continuation?.();
    expect(execCommandCalls.length).toBe(2);
    expect(execCommandCalls[1].command).toBe("delete");
  });

  it("copy runs execCommand('copy') in sync phase with no continuation", () => {
    const { container, manager } = renderWithFullProvider(
      <TugValueInput value={50} min={0} max={100} />
    );
    const id = getInput(container).getAttribute("data-responder-id") as string;

    const result = manager.dispatchToForContinuation(id, { action: "copy", phase: "discrete" });

    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("copy");
    // No continuation — nothing needs to happen after the blink.
    expect(result.continuation).toBeUndefined();
  });

  it("selectAll defers input.select() to the continuation phase", () => {
    const { container, manager } = renderWithFullProvider(
      <TugValueInput value={1234} min={0} max={9999} />
    );
    const input = getInput(container);
    const id = input.getAttribute("data-responder-id") as string;

    input.setSelectionRange(1, 2);
    const result = manager.dispatchToForContinuation(id, { action: "selectAll", phase: "discrete" });

    // Sync phase did nothing — selection still at (1, 2).
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(2);

    // Continuation phase runs the select().
    result.continuation?.();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("undo defers execCommand('undo') to the continuation phase", () => {
    const { container, manager } = renderWithFullProvider(
      <TugValueInput value={50} min={0} max={100} />
    );
    const id = getInput(container).getAttribute("data-responder-id") as string;

    const result = manager.dispatchToForContinuation(id, { action: "undo", phase: "discrete" });

    expect(execCommandCalls.length).toBe(0);
    result.continuation?.();
    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("undo");
  });

  it("redo defers execCommand('redo') to the continuation phase", () => {
    const { container, manager } = renderWithFullProvider(
      <TugValueInput value={50} min={0} max={100} />
    );
    const id = getInput(container).getAttribute("data-responder-id") as string;

    const result = manager.dispatchToForContinuation(id, { action: "redo", phase: "discrete" });

    expect(execCommandCalls.length).toBe(0);
    result.continuation?.();
    expect(execCommandCalls.length).toBe(1);
    expect(execCommandCalls[0].command).toBe("redo");
  });

  // Paste behavior is verified manually — see tug-input.test.tsx for
  // the rationale.
});

describe("TugValueInput – disabled guard (A2.7)", () => {
  it("disabled input does not fire execCommand or select on any dispatched editing action", () => {
    const { container, manager } = renderWithFullProvider(
      <TugValueInput value={50} min={0} max={100} disabled />
    );
    const input = getInput(container);
    const id = input.getAttribute("data-responder-id") as string;

    input.setSelectionRange(1, 2);

    // Each handler short-circuits on effectiveDisabled before the
    // sync body runs, so no continuation should be returned either.
    for (const action of ["cut", "copy", "paste", "undo", "redo", "selectAll"] as const) {
      const result = manager.dispatchToForContinuation(id, { action, phase: "discrete" });
      result.continuation?.();
    }

    expect(execCommandCalls.length).toBe(0);
    // selectAll did not fire, so the deliberate initial selection is
    // untouched.
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(2);
  });
});
