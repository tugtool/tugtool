/**
 * text-editing-keybindings unit tests — pure-logic coverage for
 * `matchEditingKeybinding` and the default registry.
 *
 * happy-dom is fine here per the project rule: this is pure DOM-helper
 * logic with no React renders, no focus, no event ordering across
 * renders. We only need `KeyboardEvent` to exist as a global, which
 * `setup-rtl` provides via happy-dom.
 *
 * Coverage:
 *   - Each registry entry matches its own keystroke (positive cases).
 *   - Modifier mismatches reject (Cmd-on-Ctrl, Ctrl-on-Alt, mismatched
 *     `code`).
 *   - `shiftExtends` semantics: Shift-Alt-F matches MOVE_WORD_FORWARD
 *     because the entry sets `shiftExtends: true`; Shift-Ctrl-U does
 *     NOT match DELETE_TO_LINE_START because the entry has no
 *     `shiftExtends` flag.
 *   - `setEditingKeybindings` swap takes effect on the next match call
 *     without any caller refresh, and the original registry can be
 *     restored.
 */

import "../../../__tests__/setup-rtl";

import { describe, it, expect, afterEach } from "bun:test";
import { TUG_ACTIONS } from "../action-vocabulary";
import {
  getEditingKeybindings,
  matchEditingKeybinding,
  setEditingKeybindings,
  type EditingKeybinding,
} from "../text-editing-keybindings";

// ---- Helpers ----

function key(
  code: string,
  modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    code,
    ctrlKey: !!modifiers.ctrl,
    metaKey: !!modifiers.meta,
    altKey: !!modifiers.alt,
    shiftKey: !!modifiers.shift,
  });
}

// ---- Registry-positive coverage ----

describe("matchEditingKeybinding — registry positives", () => {
  it("matches Ctrl-U → DELETE_TO_LINE_START", () => {
    const match = matchEditingKeybinding(key("KeyU", { ctrl: true }));
    expect(match).not.toBeNull();
    expect(match?.action).toBe(TUG_ACTIONS.DELETE_TO_LINE_START);
  });

  it("matches Ctrl-W → DELETE_WORD_BACKWARD", () => {
    const match = matchEditingKeybinding(key("KeyW", { ctrl: true }));
    expect(match).not.toBeNull();
    expect(match?.action).toBe(TUG_ACTIONS.DELETE_WORD_BACKWARD);
  });

  it("matches Alt-F → MOVE_WORD_FORWARD with shiftExtends:true", () => {
    const match = matchEditingKeybinding(key("KeyF", { alt: true }));
    expect(match).not.toBeNull();
    expect(match?.action).toBe(TUG_ACTIONS.MOVE_WORD_FORWARD);
    expect(match?.shiftExtends).toBe(true);
  });

  it("matches Alt-B → MOVE_WORD_BACKWARD with shiftExtends:true", () => {
    const match = matchEditingKeybinding(key("KeyB", { alt: true }));
    expect(match).not.toBeNull();
    expect(match?.action).toBe(TUG_ACTIONS.MOVE_WORD_BACKWARD);
    expect(match?.shiftExtends).toBe(true);
  });
});

// ---- Modifier-mismatch coverage ----

describe("matchEditingKeybinding — modifier mismatches reject", () => {
  it("Cmd-U does NOT match (registry uses ctrl, not meta)", () => {
    expect(matchEditingKeybinding(key("KeyU", { meta: true }))).toBeNull();
  });

  it("Cmd-W does NOT match (registry uses ctrl, not meta)", () => {
    expect(matchEditingKeybinding(key("KeyW", { meta: true }))).toBeNull();
  });

  it("Ctrl-F does NOT match (registry uses alt for KeyF, not ctrl)", () => {
    expect(matchEditingKeybinding(key("KeyF", { ctrl: true }))).toBeNull();
  });

  it("Cmd-F does NOT match (registry uses alt for KeyF, not meta)", () => {
    expect(matchEditingKeybinding(key("KeyF", { meta: true }))).toBeNull();
  });

  it("bare KeyU does NOT match (registry requires ctrl)", () => {
    expect(matchEditingKeybinding(key("KeyU"))).toBeNull();
  });

  it("Ctrl-Alt-U does NOT match (registry has only ctrl, no alt)", () => {
    expect(matchEditingKeybinding(key("KeyU", { ctrl: true, alt: true }))).toBeNull();
  });

  it("Alt-G does NOT match (no entry for KeyG)", () => {
    expect(matchEditingKeybinding(key("KeyG", { alt: true }))).toBeNull();
  });
});

// ---- shiftExtends semantics ----

describe("matchEditingKeybinding — shiftExtends semantics", () => {
  it("Shift-Alt-F matches MOVE_WORD_FORWARD (shiftExtends:true ignores shift)", () => {
    const match = matchEditingKeybinding(key("KeyF", { alt: true, shift: true }));
    expect(match).not.toBeNull();
    expect(match?.action).toBe(TUG_ACTIONS.MOVE_WORD_FORWARD);
  });

  it("Shift-Alt-B matches MOVE_WORD_BACKWARD (shiftExtends:true ignores shift)", () => {
    const match = matchEditingKeybinding(key("KeyB", { alt: true, shift: true }));
    expect(match).not.toBeNull();
    expect(match?.action).toBe(TUG_ACTIONS.MOVE_WORD_BACKWARD);
  });

  it("Shift-Ctrl-U does NOT match DELETE_TO_LINE_START (no shiftExtends)", () => {
    expect(matchEditingKeybinding(key("KeyU", { ctrl: true, shift: true }))).toBeNull();
  });

  it("Shift-Ctrl-W does NOT match DELETE_WORD_BACKWARD (no shiftExtends)", () => {
    expect(matchEditingKeybinding(key("KeyW", { ctrl: true, shift: true }))).toBeNull();
  });
});

// ---- Setter / runtime remap ----

describe("setEditingKeybindings — runtime remap", () => {
  const original = getEditingKeybindings();
  const originalCopy: EditingKeybinding[] = original.map((b) => ({ ...b }));

  afterEach(() => {
    setEditingKeybindings(originalCopy.map((b) => ({ ...b })));
  });

  it("a swapped registry takes effect on the next match call", () => {
    setEditingKeybindings([
      { key: "KeyQ", meta: true, action: TUG_ACTIONS.DELETE_TO_LINE_START },
    ]);
    // Old binding no longer matches.
    expect(matchEditingKeybinding(key("KeyU", { ctrl: true }))).toBeNull();
    // New binding matches.
    const match = matchEditingKeybinding(key("KeyQ", { meta: true }));
    expect(match).not.toBeNull();
    expect(match?.action).toBe(TUG_ACTIONS.DELETE_TO_LINE_START);
  });

  it("restoring the registry restores the default behavior", () => {
    setEditingKeybindings([]);
    expect(matchEditingKeybinding(key("KeyU", { ctrl: true }))).toBeNull();
    setEditingKeybindings(originalCopy.map((b) => ({ ...b })));
    const match = matchEditingKeybinding(key("KeyU", { ctrl: true }));
    expect(match).not.toBeNull();
    expect(match?.action).toBe(TUG_ACTIONS.DELETE_TO_LINE_START);
  });
});

// ---- Default registry shape ----

describe("default registry", () => {
  it("contains exactly the four gap bindings", () => {
    const registry = getEditingKeybindings();
    expect(registry.length).toBe(4);
    const actions = registry.map((b) => b.action).sort();
    expect(actions).toEqual(
      [
        TUG_ACTIONS.DELETE_TO_LINE_START,
        TUG_ACTIONS.DELETE_WORD_BACKWARD,
        TUG_ACTIONS.MOVE_WORD_FORWARD,
        TUG_ACTIONS.MOVE_WORD_BACKWARD,
      ].sort(),
    );
  });
});
