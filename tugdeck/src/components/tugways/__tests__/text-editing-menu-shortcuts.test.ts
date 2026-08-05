/**
 * The text-editing context menu's shortcut hints must name the chords that
 * actually fire the commands.
 *
 * Two of them didn't. Copy as Plain Text advertised ⇧⌘C — which is Session ▸
 * Show Changes, a different command entirely — and Paste as Plain Text
 * advertised ⇧⌘V. The real chords carry Option, as both the Swift Edit menu's
 * modifier masks and the keybinding map have always said.
 *
 * The hints are authored strings, so nothing structurally prevents them from
 * drifting again; this is the expectation table that catches it. When the
 * hints are derived from the keymap registry instead, this test is replaced
 * by one that compares against the live binding rather than a literal.
 */

import { describe, expect, test } from "bun:test";

import { buildTextEditingMenuItems } from "../text-editing-menu";
import { KEYBINDINGS } from "../keybinding-map";
import { TUG_ACTIONS } from "../action-vocabulary";
import type { TugAction } from "../action-vocabulary";

/** action → the hint the menu renders. */
const EXPECTED_SHORTCUTS: ReadonlyArray<readonly [TugAction, string]> = [
  [TUG_ACTIONS.CUT, "⌘X"],
  [TUG_ACTIONS.COPY, "⌘C"],
  [TUG_ACTIONS.COPY_AS_PLAIN_TEXT, "⌥⇧⌘C"],
  [TUG_ACTIONS.PASTE, "⌘V"],
  [TUG_ACTIONS.PASTE_AS_QUOTE, "⌥⌘V"],
  [TUG_ACTIONS.PASTE_AS_PLAIN_TEXT, "⌥⇧⌘V"],
  [TUG_ACTIONS.SELECT_ALL, "⌘A"],
];

/** Render a chord the way the menu spells it: ⌃⌥⇧⌘ in Apple's order. */
function formatBinding(b: {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  key: string;
}): string {
  const mods =
    (b.ctrl ? "⌃" : "") + (b.alt ? "⌥" : "") + (b.shift ? "⇧" : "") + (b.meta ? "⌘" : "");
  const letter = b.key.startsWith("Key") ? b.key.slice(3) : b.key;
  return `${mods}${letter}`;
}

describe("text-editing menu shortcut hints", () => {
  const entries = buildTextEditingMenuItems({ hasSelection: true });

  test("every hint matches its expectation", () => {
    for (const [action, want] of EXPECTED_SHORTCUTS) {
      const entry = entries.find((e) => "action" in e && e.action === action);
      expect(entry, `${action} is in the menu`).toBeDefined();
      expect(
        (entry as { shortcut?: string }).shortcut,
        `${action} shortcut hint`,
      ).toBe(want);
    }
  });

  test("every hint agrees with the binding that actually fires the command", () => {
    // The point of the repair: the hint and the binding are two spellings of
    // one fact, and they disagreed. Compare them directly.
    for (const [action, want] of EXPECTED_SHORTCUTS) {
      const binding = KEYBINDINGS.find((b) => b.action === action);
      expect(binding, `${action} has a binding`).toBeDefined();
      expect(formatBinding(binding!), `${action} hint vs binding`).toBe(want);
    }
  });

  test("Copy as Plain Text does not claim Show Changes' chord", () => {
    const entry = entries.find(
      (e) => "action" in e && e.action === TUG_ACTIONS.COPY_AS_PLAIN_TEXT,
    ) as { shortcut?: string };
    expect(entry.shortcut).not.toBe("⇧⌘C");
  });
});
