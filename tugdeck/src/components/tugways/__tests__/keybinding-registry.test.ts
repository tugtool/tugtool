/**
 * Dynamic context-scoped keybinding registry -- pure-logic tests for
 * `ResponderChainManager.resolveKeybinding` ([P11], #keybinding-registry).
 *
 * Resolution is exercised directly on the manager: register responders with a
 * `parentId` chain, set the first responder, register keybindings at scopes,
 * and assert which binding a chord resolves to. No DOM — the resolution walks
 * `parentId` through the node registry plus the caller-supplied focus-mode
 * scopes, neither of which needs a document.
 */

import { describe, expect, test } from "bun:test";

import { ResponderChainManager } from "../responder-chain";
import type { KeyBinding } from "../keybinding-map";
import { TUG_ACTIONS } from "../action-vocabulary";

function keyEvent(
  code: string,
  mods: { meta?: boolean; shift?: boolean; ctrl?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  return {
    code,
    metaKey: mods.meta ?? false,
    shiftKey: mods.shift ?? false,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
  } as KeyboardEvent;
}

// A child responder nested under a parent, with the child as first responder.
function chainWithChildFirstResponder(): ResponderChainManager {
  const m = new ResponderChainManager();
  m.register({ id: "parent", parentId: null, actions: {} });
  m.register({ id: "child", parentId: "parent", actions: {} });
  m.makeFirstResponder("child");
  return m;
}

const CHORD_B: Omit<KeyBinding, "action"> = { key: "KeyB", meta: true };

describe("resolveKeybinding precedence", () => {
  test("innermost-in-context beats an ancestor on the same chord", () => {
    const m = chainWithChildFirstResponder();
    m.registerKeybinding("parent", () => [{ ...CHORD_B, action: TUG_ACTIONS.CLOSE }]);
    m.registerKeybinding("child", () => [{ ...CHORD_B, action: TUG_ACTIONS.SUBMIT }]);
    const hit = m.resolveKeybinding(keyEvent("KeyB", { meta: true }));
    expect(hit?.action).toBe(TUG_ACTIONS.SUBMIT); // child wins
  });

  test("an ancestor binding matches when the child has none", () => {
    const m = chainWithChildFirstResponder();
    m.registerKeybinding("parent", () => [{ ...CHORD_B, action: TUG_ACTIONS.CLOSE }]);
    const hit = m.resolveKeybinding(keyEvent("KeyB", { meta: true }));
    expect(hit?.action).toBe(TUG_ACTIONS.CLOSE);
  });

  test("a binding registered off the walk path does not match", () => {
    const m = chainWithChildFirstResponder();
    m.registerKeybinding("elsewhere", () => [{ ...CHORD_B, action: TUG_ACTIONS.SUBMIT }]);
    expect(m.resolveKeybinding(keyEvent("KeyB", { meta: true }))).toBeNull();
  });

  test("no dynamic match returns null (caller falls back to the static map)", () => {
    const m = chainWithChildFirstResponder();
    m.registerKeybinding("child", () => [{ ...CHORD_B, action: TUG_ACTIONS.SUBMIT }]);
    expect(m.resolveKeybinding(keyEvent("KeyA", { meta: true }))).toBeNull();
  });

  test("modifier match is exact (⌘B does not fire a ⇧⌘B binding)", () => {
    const m = chainWithChildFirstResponder();
    m.registerKeybinding("child", () => [
      { key: "KeyB", meta: true, shift: true, action: TUG_ACTIONS.SUBMIT },
    ]);
    expect(m.resolveKeybinding(keyEvent("KeyB", { meta: true }))).toBeNull();
    expect(
      m.resolveKeybinding(keyEvent("KeyB", { meta: true, shift: true }))?.action,
    ).toBe(TUG_ACTIONS.SUBMIT);
  });
});

describe("resolveKeybinding focus-mode (extraScopes)", () => {
  test("an active mode binding wins over the responder walk (innermost)", () => {
    const m = chainWithChildFirstResponder();
    m.registerKeybinding("child", () => [{ ...CHORD_B, action: TUG_ACTIONS.CLOSE }]);
    m.registerKeybinding("sheet-mode", () => [{ ...CHORD_B, action: TUG_ACTIONS.SUBMIT }]);
    // Without the mode in context, the responder walk wins.
    expect(m.resolveKeybinding(keyEvent("KeyB", { meta: true }))?.action).toBe(
      TUG_ACTIONS.CLOSE,
    );
    // With the mode current, its binding is innermost and wins.
    expect(
      m.resolveKeybinding(keyEvent("KeyB", { meta: true }), ["sheet-mode"])?.action,
    ).toBe(TUG_ACTIONS.SUBMIT);
  });

  test("a mode binding resolves even when DOM focus is elsewhere (inline-dialog case)", () => {
    const m = chainWithChildFirstResponder(); // first responder is the 'prompt' (child)
    m.registerKeybinding("dialog-mode", () => [
      { key: "ArrowRight", action: TUG_ACTIONS.NEXT_TAB },
    ]);
    // The dialog's accelerator is reachable via the active mode though the
    // dialog is not on the first responder's walk path.
    expect(
      m.resolveKeybinding(keyEvent("ArrowRight"), ["dialog-mode"])?.action,
    ).toBe(TUG_ACTIONS.NEXT_TAB);
  });
});

describe("registry lifecycle", () => {
  test("unregister removes the binding", () => {
    const m = chainWithChildFirstResponder();
    const unregister = m.registerKeybinding("child", () => [
      { ...CHORD_B, action: TUG_ACTIONS.SUBMIT },
    ]);
    expect(m.resolveKeybinding(keyEvent("KeyB", { meta: true }))).not.toBeNull();
    unregister();
    expect(m.resolveKeybinding(keyEvent("KeyB", { meta: true }))).toBeNull();
  });

  test("the source is read live — current bindings resolve without re-register", () => {
    const m = chainWithChildFirstResponder();
    let bindings: KeyBinding[] = [];
    m.registerKeybinding("child", () => bindings);
    expect(m.resolveKeybinding(keyEvent("KeyB", { meta: true }))).toBeNull();
    bindings = [{ ...CHORD_B, action: TUG_ACTIONS.SUBMIT }];
    expect(m.resolveKeybinding(keyEvent("KeyB", { meta: true }))?.action).toBe(
      TUG_ACTIONS.SUBMIT,
    );
  });

  test("activeKeybindings reports bindings by scope and in aggregate", () => {
    const m = chainWithChildFirstResponder();
    m.registerKeybinding("child", () => [{ ...CHORD_B, action: TUG_ACTIONS.SUBMIT }]);
    m.registerKeybinding("parent", () => [
      { key: "KeyW", meta: true, action: TUG_ACTIONS.CLOSE },
    ]);
    expect(m.activeKeybindings("child").map((b) => b.action)).toEqual([
      TUG_ACTIONS.SUBMIT,
    ]);
    expect(m.activeKeybindings().length).toBe(2);
    expect(m.activeKeybindings("nobody")).toEqual([]);
  });

  test("the matched binding keeps its dispatch-routing scope field", () => {
    const m = chainWithChildFirstResponder();
    m.registerKeybinding("child", () => [
      { ...CHORD_B, action: TUG_ACTIONS.SUBMIT, scope: "key-card" },
    ]);
    expect(m.resolveKeybinding(keyEvent("KeyB", { meta: true }))?.scope).toBe(
      "key-card",
    );
  });
});
