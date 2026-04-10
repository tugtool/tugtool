/**
 * ResponderChainManager unit tests -- Step 1.
 *
 * Tests cover:
 * - register: node appears in the manager
 * - unregister: node is removed
 * - dispatch: correct handler is called
 * - chain walk: walk-up to parent when child doesn't handle
 * - canHandle: returns true for registered action, false for unknown
 * - validateAction: returns handler's validate result
 * - validateAction: defaults to true when handler has no validate function
 * - makeFirstResponder / resignFirstResponder increment validation version
 * - subscription callback fires on version increment
 * - dispatch returns false when no handler found
 * - unregister first responder auto-promotes parent
 * - unregister first responder with no parent sets firstResponderId to null
 * - register root node auto-promotes to first responder when firstResponderId is null
 * - register root node does NOT change firstResponderId when already set
 * - register non-root node does NOT auto-promote when firstResponderId is null
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ResponderChainManager } from "../components/tugways/responder-chain";
import type { ActionEvent, ActionHandler } from "../components/tugways/responder-chain";
import type { TugAction } from "../components/tugways/action-vocabulary";

// ---- Helpers ----

function makeManager(): ResponderChainManager {
  return new ResponderChainManager();
}

// Tests below use synthetic action names (e.g. "foo", "bar", "ping",
// "dynamic-action") to exercise ResponderChainManager's dispatch
// mechanics independent of the production `TugAction` vocabulary. The
// chain must work for any action name — the vocabulary is a separate
// layer. These two helpers cast string literals and action-keyed
// records so the synthetic names type-check without widening the
// production signatures.
const asActions = (a: Record<string, ActionHandler>) =>
  a as unknown as Partial<Record<TugAction, ActionHandler>>;
const asAction = (name: string) => name as unknown as TugAction;

// ---- register ----

describe("register", () => {
  it("node appears in the manager (dispatch reaches it)", () => {
    const mgr = makeManager();
    let called = false;
    mgr.register({ id: "root", parentId: null, actions: asActions({ foo: (_event: ActionEvent) => { called = true; } }) });
    mgr.dispatch({ action: asAction("foo"), phase: "discrete" });
    expect(called).toBe(true);
  });

  it("auto-promotes root node to first responder when firstResponderId is null", () => {
    const mgr = makeManager();
    expect(mgr.getFirstResponder()).toBe(null);
    mgr.register({ id: "root", parentId: null, actions: {} });
    expect(mgr.getFirstResponder()).toBe("root");
  });

  it("increments validationVersion when auto-promoting root", () => {
    const mgr = makeManager();
    const v0 = mgr.getValidationVersion();
    mgr.register({ id: "root", parentId: null, actions: {} });
    expect(mgr.getValidationVersion()).toBe(v0 + 1);
  });

  it("does NOT change firstResponderId when already set (root node)", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    expect(mgr.getFirstResponder()).toBe("root");
    mgr.register({ id: "root2", parentId: null, actions: {} });
    expect(mgr.getFirstResponder()).toBe("root");
  });

  it("does NOT auto-promote non-root node when firstResponderId is null", () => {
    const mgr = makeManager();
    // Register parent first so the child's parentId exists
    mgr.register({ id: "root", parentId: null, actions: {} });
    // Reset so firstResponderId is null but root exists
    // Use makeFirstResponder then resignFirstResponder to clear it
    mgr.resignFirstResponder();
    expect(mgr.getFirstResponder()).toBe(null);

    const vBefore = mgr.getValidationVersion();
    mgr.register({ id: "child", parentId: "root", actions: {} });
    // firstResponderId should still be null
    expect(mgr.getFirstResponder()).toBe(null);
    // No auto-promote so version should not change from register
    expect(mgr.getValidationVersion()).toBe(vBefore);
  });
});

// ---- unregister ----

describe("unregister", () => {
  it("removes node from the manager (dispatch no longer reaches it)", () => {
    const mgr = makeManager();
    let called = false;
    mgr.register({ id: "root", parentId: null, actions: asActions({ bar: (_event: ActionEvent) => { called = true; } }) });
    mgr.unregister("root");
    mgr.dispatch({ action: asAction("bar"), phase: "discrete" });
    expect(called).toBe(false);
  });

  it("auto-promotes parent when unregistered node was first responder", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    mgr.register({ id: "child", parentId: "root", actions: {} });
    mgr.makeFirstResponder("child");
    expect(mgr.getFirstResponder()).toBe("child");

    mgr.unregister("child");
    expect(mgr.getFirstResponder()).toBe("root");
  });

  it("sets firstResponderId to null when unregistered node has no parent", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    expect(mgr.getFirstResponder()).toBe("root");
    mgr.unregister("root");
    expect(mgr.getFirstResponder()).toBe(null);
  });

  it("increments validationVersion when first responder is removed", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    const v0 = mgr.getValidationVersion();
    mgr.unregister("root");
    expect(mgr.getValidationVersion()).toBeGreaterThan(v0);
  });

  // Note: the DOM-walk recovery path (when the captured parentId has
  // already unregistered earlier in the same cleanup pass) is exercised
  // in `responder-chain-unregister-recovery.test.tsx`, which has the
  // happy-dom Window globals it needs. This file stays pure-JS so the
  // existing tests don't pay for a DOM environment they don't use.
});

// ---- dispatch ----

describe("dispatch", () => {
  it("calls the correct handler", () => {
    const mgr = makeManager();
    const calls: string[] = [];
    mgr.register({ id: "root", parentId: null, actions: asActions({ ping: (_event: ActionEvent) => { calls.push("ping"); } }) });
    const result = mgr.dispatch({ action: asAction("ping"), phase: "discrete" });
    expect(result).toBe(true);
    expect(calls).toEqual(["ping"]);
  });

  it("walks up to parent when child does not handle the action", () => {
    const mgr = makeManager();
    let parentHandled = false;
    mgr.register({ id: "root", parentId: null, actions: asActions({ bubbled: (_event: ActionEvent) => { parentHandled = true; } }) });
    mgr.register({ id: "child", parentId: "root", actions: {} });
    mgr.makeFirstResponder("child");

    const result = mgr.dispatch({ action: asAction("bubbled"), phase: "discrete" });
    expect(result).toBe(true);
    expect(parentHandled).toBe(true);
  });

  it("returns false when no handler found in chain", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    const result = mgr.dispatch({ action: asAction("no-such-action"), phase: "discrete" });
    expect(result).toBe(false);
  });

  it("does not consult canHandle function -- only actions map", () => {
    const mgr = makeManager();
    let canHandleCalled = false;
    mgr.register({
      id: "root",
      parentId: null,
      actions: {}, // action NOT in map
      canHandle: (_action: string) => {
        canHandleCalled = true;
        return true; // claims it can handle everything
      },
    });
    const result = mgr.dispatch({ action: asAction("anything"), phase: "discrete" });
    expect(result).toBe(false);
    expect(canHandleCalled).toBe(false);
  });
});

// ---- canHandle ----

describe("canHandle", () => {
  it("returns true for an action in the actions map", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: { copy: (_event: ActionEvent) => {} } });
    expect(mgr.canHandle("copy")).toBe(true);
  });

  it("returns false for an unknown action", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: { copy: (_event: ActionEvent) => {} } });
    expect(mgr.canHandle("paste")).toBe(false);
  });

  it("returns true for action reported by canHandle function (dynamic override)", () => {
    const mgr = makeManager();
    mgr.register({
      id: "root",
      parentId: null,
      actions: {},
      canHandle: (action: string) => action === "dynamic-action",
    });
    expect(mgr.canHandle(asAction("dynamic-action"))).toBe(true);
  });

  it("walks up to parent when child doesn't handle", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: asActions({ "root-action": (_event: ActionEvent) => {} }) });
    mgr.register({ id: "child", parentId: "root", actions: {} });
    mgr.makeFirstResponder("child");
    expect(mgr.canHandle(asAction("root-action"))).toBe(true);
  });

  it("returns false when firstResponderId is null", () => {
    const mgr = makeManager();
    expect(mgr.canHandle(asAction("anything"))).toBe(false);
  });
});

// ---- validateAction ----

describe("validateAction", () => {
  it("returns the handler's validateAction result (false)", () => {
    const mgr = makeManager();
    mgr.register({
      id: "root",
      parentId: null,
      actions: { cut: (_event: ActionEvent) => {} },
      validateAction: (_action: string) => false,
    });
    expect(mgr.validateAction("cut")).toBe(false);
  });

  it("returns the handler's validateAction result (true)", () => {
    const mgr = makeManager();
    mgr.register({
      id: "root",
      parentId: null,
      actions: { cut: (_event: ActionEvent) => {} },
      validateAction: (_action: string) => true,
    });
    expect(mgr.validateAction("cut")).toBe(true);
  });

  it("defaults to true when handler has no validateAction function", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: { paste: (_event: ActionEvent) => {} } });
    expect(mgr.validateAction("paste")).toBe(true);
  });

  it("returns false when no responder can handle the action", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    expect(mgr.validateAction(asAction("nonexistent"))).toBe(false);
  });
});

// ---- makeFirstResponder / resignFirstResponder ----

describe("makeFirstResponder and resignFirstResponder", () => {
  it("makeFirstResponder increments validationVersion", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    mgr.register({ id: "child", parentId: "root", actions: {} });
    const v0 = mgr.getValidationVersion();
    mgr.makeFirstResponder("child");
    expect(mgr.getValidationVersion()).toBe(v0 + 1);
  });

  it("resignFirstResponder increments validationVersion", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    const v0 = mgr.getValidationVersion();
    mgr.resignFirstResponder();
    expect(mgr.getValidationVersion()).toBe(v0 + 1);
  });

  it("resignFirstResponder clears first responder", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    expect(mgr.getFirstResponder()).toBe("root");
    mgr.resignFirstResponder();
    expect(mgr.getFirstResponder()).toBe(null);
  });
});

// ---- subscribe ----

describe("subscribe", () => {
  it("subscription callback fires on validationVersion increment (makeFirstResponder)", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    mgr.register({ id: "child", parentId: "root", actions: {} });

    let callCount = 0;
    mgr.subscribe(() => { callCount++; });
    mgr.makeFirstResponder("child");
    expect(callCount).toBe(1);
  });

  it("subscription callback fires on resignFirstResponder", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    let callCount = 0;
    mgr.subscribe(() => { callCount++; });
    mgr.resignFirstResponder();
    expect(callCount).toBe(1);
  });

  it("unsubscribe stops callback from firing", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    mgr.register({ id: "child", parentId: "root", actions: {} });

    let callCount = 0;
    const unsubscribe = mgr.subscribe(() => { callCount++; });
    unsubscribe();
    mgr.makeFirstResponder("child");
    expect(callCount).toBe(0);
  });

  it("multiple subscribers all receive notifications", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });

    let count1 = 0;
    let count2 = 0;
    mgr.subscribe(() => { count1++; });
    mgr.subscribe(() => { count2++; });
    mgr.resignFirstResponder();
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });
});

// ---- dispatchTo ----

describe("dispatchTo", () => {
  it("delivers action to registered target and returns true", () => {
    const mgr = makeManager();
    let handled = false;
    mgr.register({ id: "root", parentId: null, actions: {} });
    mgr.register({ id: "target", parentId: "root", actions: asActions({ save: (_event: ActionEvent) => { handled = true; } }) });
    const result = mgr.dispatchTo("target", { action: asAction("save"), phase: "discrete" });
    expect(result).toBe(true);
    expect(handled).toBe(true);
  });

  it("returns false when target exists but does not handle the action", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    mgr.register({ id: "target", parentId: "root", actions: asActions({ save: (_event: ActionEvent) => {} }) });
    const result = mgr.dispatchTo("target", { action: asAction("delete"), phase: "discrete" });
    expect(result).toBe(false);
  });

  it("throws Error with descriptive message when target is not registered", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    expect(() => mgr.dispatchTo("ghost", { action: asAction("save"), phase: "discrete" })).toThrow(
      'dispatchTo: target "ghost" is not registered'
    );
  });

  it("bypasses chain walk -- action goes directly to target, not first responder", () => {
    const mgr = makeManager();
    const calls: string[] = [];
    mgr.register({ id: "root", parentId: null, actions: asActions({ save: (_event: ActionEvent) => { calls.push("root"); } }) });
    mgr.register({ id: "target", parentId: "root", actions: asActions({ save: (_event: ActionEvent) => { calls.push("target"); } }) });
    // First responder is root (auto-promoted), but we dispatch directly to target
    expect(mgr.getFirstResponder()).toBe("root");
    mgr.dispatchTo("target", { action: asAction("save"), phase: "discrete" });
    expect(calls).toEqual(["target"]);
  });
});

// ---- nodeCanHandle ----

describe("nodeCanHandle", () => {
  it("returns true when node has action in actions map", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: { copy: (_event: ActionEvent) => {} } });
    expect(mgr.nodeCanHandle("root", "copy")).toBe(true);
  });

  it("returns true when node's canHandle callback returns true", () => {
    const mgr = makeManager();
    mgr.register({
      id: "root",
      parentId: null,
      actions: {},
      canHandle: (action: string) => action === "dynamic-action",
    });
    expect(mgr.nodeCanHandle("root", asAction("dynamic-action"))).toBe(true);
  });

  it("returns false when node does not handle action", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: { copy: (_event: ActionEvent) => {} } });
    expect(mgr.nodeCanHandle("root", "paste")).toBe(false);
  });

  it("returns false when node is not registered", () => {
    const mgr = makeManager();
    expect(mgr.nodeCanHandle("ghost", "copy")).toBe(false);
  });
});

// ---- Edge cases ----

describe("edge cases", () => {
  it("dispatch returns false when firstResponderId is null", () => {
    const mgr = makeManager();
    expect(mgr.dispatch({ action: asAction("foo"), phase: "discrete" })).toBe(false);
  });

  it("unregister non-first-responder does not change firstResponderId", () => {
    const mgr = makeManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    mgr.register({ id: "child", parentId: "root", actions: {} });
    // root is first responder (auto-promoted)
    expect(mgr.getFirstResponder()).toBe("root");
    mgr.unregister("child");
    expect(mgr.getFirstResponder()).toBe("root");
  });

  it("dispatch only calls handler for matching action, not all actions", () => {
    const mgr = makeManager();
    const calls: string[] = [];
    mgr.register({
      id: "root",
      parentId: null,
      actions: asActions({
        a: (_event: ActionEvent) => { calls.push("a"); },
        b: (_event: ActionEvent) => { calls.push("b"); },
      }),
    });
    mgr.dispatch({ action: asAction("a"), phase: "discrete" });
    expect(calls).toEqual(["a"]);
  });
});
