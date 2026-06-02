/**
 * keybinding-map — pure-logic tests for the static chord map, focused on the
 * permission-cycle / focus-walk boundary.
 *
 * Tug departs from the Claude Code TUI: the terminal cycles the permission mode
 * on Shift+Tab, but in a GUI Shift+Tab must be reverse-focus navigation. So
 * permission cycling lives on ⇧⌘P (a key-card-scoped chord), and Tab /
 * Shift-Tab are owned by the focus-walk stage in `responder-chain-provider.tsx`
 * — deliberately absent from this static map. These tests pin that contract
 * against `matchKeybinding`, which reads only `code` + the four modifier flags,
 * so a plain object stands in for a `KeyboardEvent` with no DOM.
 */

import { describe, expect, test } from "bun:test";

import { matchKeybinding } from "../keybinding-map";
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

describe("keybinding-map: permission cycle on ⇧⌘P", () => {
  test("⇧⌘P maps to cycle-permission-mode, key-card scope, preventDefault", () => {
    const binding = matchKeybinding(keyEvent("KeyP", { meta: true, shift: true }));
    expect(binding).not.toBeNull();
    expect(binding?.action).toBe(TUG_ACTIONS.CYCLE_PERMISSION_MODE);
    expect(binding?.scope).toBe("key-card");
    expect(binding?.preventDefaultOnMatch).toBe(true);
  });

  test("⌘P without Shift does not match the cycle (exact modifier match)", () => {
    expect(matchKeybinding(keyEvent("KeyP", { meta: true }))).toBeNull();
  });

  test("⇧P without Cmd does not match the cycle", () => {
    expect(matchKeybinding(keyEvent("KeyP", { shift: true }))).toBeNull();
  });
});

describe("keybinding-map: Tab is owned by the focus-walk stage, not this map", () => {
  test("Tab and Shift-Tab are absent from the static map", () => {
    expect(matchKeybinding(keyEvent("Tab"))).toBeNull();
    expect(matchKeybinding(keyEvent("Tab", { shift: true }))).toBeNull();
  });
});
