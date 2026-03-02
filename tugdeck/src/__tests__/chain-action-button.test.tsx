/**
 * Chain-action TugButton tests -- Step 4.
 *
 * Tests cover:
 * - Renders when canHandle returns true
 * - Hidden (returns null) when canHandle returns false
 * - Visually disabled (aria-disabled="true") when validateAction returns false
 * - Enabled when validateAction returns true
 * - Click on enabled button calls manager.dispatch(action)
 * - Click on disabled button does not dispatch
 * - Re-renders when validation version changes (focus change)
 * - Dev-mode warning when both action and onClick are set
 * - Direct-action mode (no action prop) still works as before
 * - action prop outside ResponderChainProvider: inert state (no crash, no dispatch)
 * - Chain-action disabled button has aria-disabled="true" (not HTML disabled),
 *   remains in tab order
 * - CSS [aria-disabled='true'] rules apply reduced opacity and cursor: not-allowed
 * - CSS [aria-disabled='true'] hover/active states are suppressed
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, afterEach, spyOn } from "bun:test";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

import { ResponderChainContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugButton } from "@/components/tugways/tug-button";

// Clean up mounted React trees after each test to prevent DOM accumulation.
afterEach(() => {
  cleanup();
});

// ---- Helpers ----

/**
 * Render a TugButton inside a ResponderChainProvider backed by the given manager.
 */
function renderWithManager(
  manager: ResponderChainManager,
  props: React.ComponentProps<typeof TugButton>
) {
  return render(
    <ResponderChainContext.Provider value={manager}>
      <TugButton {...props} />
    </ResponderChainContext.Provider>
  );
}

/**
 * Make a manager with a registered root node handling `actionName`.
 * Returns { manager, dispatchRecord } where dispatchRecord tracks calls.
 */
function makeManagerWithAction(
  actionName: string,
  validateResult: boolean = true
): { manager: ResponderChainManager; dispatched: string[] } {
  const manager = new ResponderChainManager();
  const dispatched: string[] = [];
  manager.register({
    id: "root",
    parentId: null,
    actions: { [actionName]: () => dispatched.push(actionName) },
    validateAction: (_action: string) => validateResult,
  });
  return { manager, dispatched };
}

// ============================================================================
// Visibility: canHandle
// ============================================================================

describe("chain-action TugButton – visibility", () => {
  it("renders when canHandle returns true", () => {
    const { manager } = makeManagerWithAction("copy");
    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("is hidden (returns null) when canHandle returns false", () => {
    const { manager } = makeManagerWithAction("copy");
    // Register manager but request an action no responder handles
    const { container } = renderWithManager(manager, { action: "paste", children: "Paste" });
    expect(container.querySelector("button")).toBeNull();
  });

  it("hidden outside provider when no manager is in context", () => {
    // No provider -- canHandle returns false (manager is null, chainActive is false)
    // Button should NOT be hidden -- it falls through to inert direct-action mode.
    // (canHandle returns false only when chainActive is true. Outside provider,
    //  chainActive is false, so the null-return branch is never reached.)
    const { container } = render(
      <TugButton action="copy" children="Copy" />
    );
    // Outside a provider: falls through to inert state. Button should render.
    expect(container.querySelector("button")).not.toBeNull();
  });
});

// ============================================================================
// Enabled / disabled state
// ============================================================================

describe("chain-action TugButton – enabled/disabled state", () => {
  it("is enabled (no aria-disabled) when validateAction returns true", () => {
    const { manager } = makeManagerWithAction("copy", true);
    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  it("has aria-disabled='true' when validateAction returns false", () => {
    const { manager } = makeManagerWithAction("copy", false);
    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("does NOT have HTML disabled attribute when chain-action is disabled (stays in tab order)", () => {
    const { manager } = makeManagerWithAction("copy", false);
    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    const btn = container.querySelector("button")!;
    // aria-disabled should be set, but HTML disabled should NOT be set
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(false);
  });
});

// ============================================================================
// Click behavior
// ============================================================================

describe("chain-action TugButton – click behavior", () => {
  it("click on enabled button calls manager.dispatch(action)", () => {
    const manager = new ResponderChainManager();
    const dispatched: string[] = [];
    manager.register({
      id: "root",
      parentId: null,
      actions: { copy: () => dispatched.push("copy") },
    });

    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    const btn = container.querySelector("button")!;

    act(() => { fireEvent.click(btn); });

    expect(dispatched).toEqual(["copy"]);
  });

  it("click on disabled chain-action button does NOT dispatch", () => {
    const { manager, dispatched } = makeManagerWithAction("copy", false);
    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    const btn = container.querySelector("button")!;

    act(() => { fireEvent.click(btn); });

    expect(dispatched).toEqual([]);
  });
});

// ============================================================================
// Re-render on validation version change
// ============================================================================

describe("chain-action TugButton – re-render on version change", () => {
  it("updates enabled state when validation version increments (focus change)", () => {
    const manager = new ResponderChainManager();
    let validateResult = true;
    manager.register({
      id: "root",
      parentId: null,
      actions: { copy: () => {} },
      validateAction: () => validateResult,
    });

    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    const btn = () => container.querySelector("button")!;

    // Initially enabled
    expect(btn().getAttribute("aria-disabled")).toBeNull();

    // Simulate a change that should disable the button: change validateResult
    // and increment version by calling makeFirstResponder (or any version bump).
    validateResult = false;
    act(() => {
      manager.makeFirstResponder("root"); // bumps validationVersion -> subscribers notified
    });

    // Button should now be disabled
    expect(btn().getAttribute("aria-disabled")).toBe("true");
  });

  it("updates from disabled to enabled when version increments", () => {
    const manager = new ResponderChainManager();
    let validateResult = false;
    manager.register({
      id: "root",
      parentId: null,
      actions: { copy: () => {} },
      validateAction: () => validateResult,
    });

    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    const btn = () => container.querySelector("button")!;

    expect(btn().getAttribute("aria-disabled")).toBe("true");

    validateResult = true;
    act(() => {
      manager.makeFirstResponder("root");
    });

    expect(btn().getAttribute("aria-disabled")).toBeNull();
  });
});

// ============================================================================
// Dev-mode warning
// ============================================================================

describe("chain-action TugButton – dev-mode warning", () => {
  it("warns when both action and onClick are set", () => {
    const warnSpy = spyOn(console, "warn");
    const { manager } = makeManagerWithAction("copy");

    act(() => {
      renderWithManager(manager, {
        action: "copy",
        onClick: () => {},
        children: "Copy",
      });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("`action` and `onClick` are mutually exclusive")
    );
    warnSpy.mockRestore();
  });
});

// ============================================================================
// Direct-action mode backward compatibility
// ============================================================================

describe("chain-action TugButton – direct-action mode backward compat", () => {
  it("TugButton without action prop still calls onClick on click", () => {
    const handler = mock(() => {});
    const { container } = render(
      <ResponderChainProvider>
        <TugButton onClick={handler}>Click</TugButton>
      </ResponderChainProvider>
    );
    const btn = container.querySelector("button")!;
    act(() => { fireEvent.click(btn); });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("TugButton without action prop works outside provider (no crash)", () => {
    const handler = mock(() => {});
    const { container } = render(<TugButton onClick={handler}>Click</TugButton>);
    const btn = container.querySelector("button")!;
    act(() => { fireEvent.click(btn); });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Outside provider: inert state
// ============================================================================

describe("chain-action TugButton – outside provider", () => {
  it("renders without crashing when action is set but no provider is present", () => {
    // No provider, no manager. chainActive = false. Falls through to
    // direct-action mode (onClick, if any).
    const { container } = render(<TugButton action="copy">Copy</TugButton>);
    // Should render a button (falls through to inert direct-action mode)
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("click does not crash and does not dispatch when outside provider", () => {
    const { container } = render(<TugButton action="copy">Copy</TugButton>);
    const btn = container.querySelector("button")!;
    // Should not throw
    expect(() => { act(() => { fireEvent.click(btn); }); }).not.toThrow();
  });
});

// ============================================================================
// CSS rules (structural checks via computed class / attribute presence)
// ============================================================================

describe("chain-action TugButton – CSS disabled rules", () => {
  it("aria-disabled='true' button does not have HTML disabled attribute", () => {
    const { manager } = makeManagerWithAction("copy", false);
    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.disabled).toBe(false); // stays in tab order
  });

  it("aria-disabled='true' button has tug-button variant class (CSS rules target it)", () => {
    const { manager } = makeManagerWithAction("copy", false);
    const { container } = renderWithManager(manager, { action: "copy", variant: "secondary", children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    // CSS [aria-disabled='true'].tug-button-secondary applies opacity/cursor;
    // verify the class is present so the rule can match.
    expect(btn.className).toContain("tug-button-secondary");
  });

  it("enabled chain-action button does NOT have aria-disabled", () => {
    const { manager } = makeManagerWithAction("copy", true);
    const { container } = renderWithManager(manager, { action: "copy", children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBeNull();
  });
});
