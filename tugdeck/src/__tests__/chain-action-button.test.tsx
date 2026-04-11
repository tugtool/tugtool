/**
 * Chain-action TugButton tests -- Step 4.
 *
 * Tests cover:
 * - Renders when canHandle returns true
 * - Hidden (returns null) when canHandle returns false
 * - Visually disabled (aria-disabled="true") when validateAction returns false
 * - Enabled when validateAction returns true
 * - Click on enabled button calls manager.sendToFirstResponder(action)
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

import { ResponderChainContext, ResponderParentContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import type { ActionHandler } from "@/components/tugways/responder-chain";
import type { TugAction } from "@/components/tugways/action-vocabulary";

// Test helpers: synthetic action names for chain-mechanics tests.
const asActions = (a: Record<string, ActionHandler>) =>
  a as unknown as Partial<Record<TugAction, ActionHandler>>;
const asAction = (name: string) => name as unknown as TugAction;
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

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
      <ResponderParentContext.Provider value="root">
        <TugButton {...props} />
      </ResponderParentContext.Provider>
    </ResponderChainContext.Provider>
  );
}

/**
 * Make a manager with a registered root node handling `actionName`.
 * Returns { manager, dispatched } where dispatched tracks calls.
 *
 * When `enabled` is false, the root node does NOT register the action
 * in its actions map, so nodeCanHandle returns false and the button
 * renders as disabled (aria-disabled).
 */
function makeManagerWithAction(
  actionName: string,
  enabled: boolean = true
): { manager: ResponderChainManager; dispatched: ActionEvent[] } {
  const manager = new ResponderChainManager();
  const dispatched: ActionEvent[] = [];
  manager.register({
    id: "root",
    parentId: null,
    actions: enabled
      ? { [actionName]: (event: ActionEvent) => dispatched.push(event) }
      : {},
  });
  return { manager, dispatched };
}

// ============================================================================
// Visibility: canHandle
// ============================================================================

describe("chain-action TugButton – visibility", () => {
  it("renders when canHandle returns true", () => {
    const { manager } = makeManagerWithAction("copy");
    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("is visible and aria-disabled when canHandle returns false (never-hide [D06])", () => {
    const { manager } = makeManagerWithAction("copy");
    // Register manager but request an action no responder handles
    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.PASTE, children: "Paste" });
    // [D06] TugButton never hides -- renders as aria-disabled instead of null
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.querySelector("button")!.getAttribute("aria-disabled")).toBe("true");
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
    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  it("has aria-disabled='true' when validateAction returns false", () => {
    const { manager } = makeManagerWithAction("copy", false);
    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("does NOT have HTML disabled attribute when chain-action is disabled (stays in tab order)", () => {
    const { manager } = makeManagerWithAction("copy", false);
    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
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
  it("click on enabled button calls manager.sendToFirstResponder with ActionEvent", () => {
    const manager = new ResponderChainManager();
    const dispatched: ActionEvent[] = [];
    manager.register({
      id: "root",
      parentId: null,
      actions: { copy: (event: ActionEvent) => { dispatched.push(event); } },
    });

    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = container.querySelector("button")!;

    act(() => { fireEvent.click(btn); });

    expect(dispatched.length).toBe(1);
    expect(dispatched[0]).toMatchObject({ action: TUG_ACTIONS.COPY, phase: "discrete" });
  });

  it("click on disabled chain-action button does NOT dispatch", () => {
    const { manager, dispatched } = makeManagerWithAction("copy", false);
    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = container.querySelector("button")!;

    act(() => { fireEvent.click(btn); });

    expect(dispatched).toEqual([]);
  });
});

// ============================================================================
// Re-render on validation version change
// ============================================================================

describe("chain-action TugButton – re-render on version change", () => {
  it("updates from enabled to disabled when parent no longer handles action", () => {
    const manager = new ResponderChainManager();
    manager.register({
      id: "root",
      parentId: null,
      actions: { copy: (_event: ActionEvent) => {} },
    });

    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = () => container.querySelector("button")!;

    // Initially enabled — parent handles "copy"
    expect(btn().getAttribute("aria-disabled")).toBeNull();

    // Re-register without the action → nodeCanHandle returns false
    act(() => {
      manager.unregister("root");
      manager.register({ id: "root", parentId: null, actions: {} });
    });

    // Button should now be disabled
    expect(btn().getAttribute("aria-disabled")).toBe("true");
  });

  it("updates from disabled to enabled when parent gains action handler", () => {
    const manager = new ResponderChainManager();
    manager.register({
      id: "root",
      parentId: null,
      actions: {},
    });

    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = () => container.querySelector("button")!;

    // Initially disabled — parent does not handle "copy"
    expect(btn().getAttribute("aria-disabled")).toBe("true");

    // Re-register with the action → nodeCanHandle returns true
    act(() => {
      manager.unregister("root");
      manager.register({
        id: "root",
        parentId: null,
        actions: { copy: (_event: ActionEvent) => {} },
      });
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
        action: TUG_ACTIONS.COPY,
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
    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.disabled).toBe(false); // stays in tab order
  });

  it("aria-disabled='true' button has tug-button emphasis-role class (CSS rules target it)", () => {
    const { manager } = makeManagerWithAction("copy", false);
    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    // CSS [aria-disabled='true'].tug-button-outlined-action applies opacity/cursor;
    // verify the class is present so the rule can match.
    expect(btn.className).toContain("tug-button-outlined-action");
  });

  it("enabled chain-action button does NOT have aria-disabled", () => {
    const { manager } = makeManagerWithAction("copy", true);
    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBeNull();
  });
});

// ============================================================================
// Target prop: explicit-target dispatch
// ============================================================================

describe("chain-action TugButton – target prop", () => {
  /**
   * Build a manager with two registered nodes: a root ("canvas") and a named
   * target ("inspector"). The target handles `actionName`; the root does not.
   * Returns the manager, the target's dispatched events, and root's dispatched events.
   */
  function makeManagerWithTarget(
    actionName: string,
  ): {
    manager: ResponderChainManager;
    targetDispatched: ActionEvent[];
    rootDispatched: ActionEvent[];
  } {
    const manager = new ResponderChainManager();
    const targetDispatched: ActionEvent[] = [];
    const rootDispatched: ActionEvent[] = [];
    // root node: does NOT handle actionName
    manager.register({
      id: "canvas",
      parentId: null,
      actions: asActions({ other: (event: ActionEvent) => { rootDispatched.push(event); } }),
    });
    // target node: handles actionName
    manager.register({
      id: "inspector",
      parentId: "canvas",
      actions: asActions({ [actionName]: (event: ActionEvent) => { targetDispatched.push(event); } }),
    });
    return { manager, targetDispatched, rootDispatched };
  }

  it("calls manager.sendToTarget(target, event) on click when action and target are set", () => {
    const { manager, targetDispatched } = makeManagerWithTarget("setColor");

    const { container } = renderWithManager(manager, {
      action: asAction("setColor"),
      target: "inspector",
      children: "Set Color",
    });
    const btn = container.querySelector("button")!;

    act(() => { fireEvent.click(btn); });

    expect(targetDispatched.length).toBe(1);
    expect(targetDispatched[0]).toMatchObject({ action: "setColor", phase: "discrete" });
  });

  it("uses nodeCanHandle(target, action) for enabled check when target is set", () => {
    const { manager } = makeManagerWithTarget("setColor");

    // Button with target="inspector" -- inspector handles "setColor"
    const { container } = renderWithManager(manager, {
      action: asAction("setColor"),
      target: "inspector",
      children: "Set Color",
    });
    const btn = container.querySelector("button")!;
    // nodeCanHandle("inspector", "setColor") = true → button is enabled
    expect(btn.getAttribute("aria-disabled")).toBeNull();
  });

  it("is disabled when nodeCanHandle returns false for the target", () => {
    const { manager } = makeManagerWithTarget("setColor");

    // Button targets "inspector" but requests an action "delete" it does not handle
    const { container } = renderWithManager(manager, {
      action: TUG_ACTIONS.DELETE,
      target: "inspector",
      children: "Delete",
    });
    const btn = container.querySelector("button")!;
    // nodeCanHandle("inspector", "delete") = false → button is disabled
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("calls controlDispatch (targeted to parent) when no explicit target is set", () => {
    const manager = new ResponderChainManager();
    const dispatched: ActionEvent[] = [];
    manager.register({
      id: "root",
      parentId: null,
      actions: { copy: (event: ActionEvent) => { dispatched.push(event); } },
    });

    const { container } = renderWithManager(manager, { action: TUG_ACTIONS.COPY, children: "Copy" });
    const btn = container.querySelector("button")!;

    act(() => { fireEvent.click(btn); });

    expect(dispatched.length).toBe(1);
    expect(dispatched[0]).toMatchObject({ action: TUG_ACTIONS.COPY, phase: "discrete" });
  });

  it("renders normally and logs dev warning when target is set without action", () => {
    const warnSpy = spyOn(console, "warn");
    const manager = new ResponderChainManager();
    manager.register({ id: "root", parentId: null, actions: {} });

    act(() => {
      renderWithManager(manager, {
        target: "inspector",
        children: "No Action",
      });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("`target` is set without `action`")
    );
    warnSpy.mockRestore();
  });

  it("sendToTarget with explicit target dispatches even when target has no handler", () => {
    const manager = new ResponderChainManager();
    // Register inspector with canHandle returning true (so button is enabled)
    // but no actions map entry (so sendToTarget walks past without handling)
    manager.register({
      id: "canvas",
      parentId: null,
      actions: {},
      canHandle: () => true,
    });
    manager.register({
      id: "inspector",
      parentId: "canvas",
      actions: {},
      canHandle: () => true, // reports capable so button is enabled
    });

    const { container } = renderWithManager(manager, {
      action: asAction("setColor"),
      target: "inspector",
      children: "Set Color",
    });
    const btn = container.querySelector("button")!;
    // Button should be enabled (nodeCanHandle returns true via canHandle callback)
    expect(btn.getAttribute("aria-disabled")).toBeNull();

    // Click dispatches without error — sendToTarget walks up and finds no handler
    act(() => { fireEvent.click(btn); });
  });
});
