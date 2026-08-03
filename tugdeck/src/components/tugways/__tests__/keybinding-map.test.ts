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

import {
  KEYBINDINGS,
  keyBindingMatchesEvent,
  matchKeybinding,
} from "../keybinding-map";
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

describe("keybinding-map: precompiled index invariants", () => {
  // The chord identity: exact `code` + exact state of all four modifier
  // flags — the same tuple `keyBindingMatchesEvent` compares.
  const chordOf = (b: (typeof KEYBINDINGS)[number]): string =>
    `${b.key}|${b.ctrl ?? false}|${b.meta ?? false}|${b.shift ?? false}|${b.alt ?? false}`;

  test("no two bindings share a chord", () => {
    // The precompiled map is first-writer-wins on a duplicate chord —
    // correct only while duplicates don't exist. A duplicate added
    // mid-table would silently shadow the later binding; fail loudly
    // here instead.
    const seen = new Map<string, string>();
    for (const binding of KEYBINDINGS) {
      const chord = chordOf(binding);
      const holder = seen.get(chord);
      expect(
        holder,
        `chord ${chord} bound to both "${holder}" and "${binding.action}"`,
      ).toBeUndefined();
      seen.set(chord, binding.action);
    }
  });

  test("map lookup agrees with a linear keyBindingMatchesEvent scan for every binding", () => {
    // Full parity: for each binding's own chord, the O(1) map must
    // return exactly what the old first-match scan returned.
    for (const binding of KEYBINDINGS) {
      const event = keyEvent(binding.key, {
        ctrl: binding.ctrl,
        meta: binding.meta,
        shift: binding.shift,
        alt: binding.alt,
      });
      const scanned = KEYBINDINGS.find((b) => keyBindingMatchesEvent(event, b)) ?? null;
      expect(matchKeybinding(event)).toBe(scanned);
    }
  });

  test("a chord with one extra modifier never matches", () => {
    // Exact-modifier discipline survives the map conversion: adding a
    // modifier a binding didn't declare must miss.
    for (const binding of KEYBINDINGS) {
      const extra = keyEvent(binding.key, {
        ctrl: binding.ctrl,
        meta: binding.meta,
        shift: binding.shift,
        alt: !(binding.alt ?? false),
      });
      const scanned = KEYBINDINGS.find((b) => keyBindingMatchesEvent(extra, b)) ?? null;
      expect(matchKeybinding(extra)).toBe(scanned);
    }
  });
});

describe("keybinding-map: the digit row is move-to-slot, whole", () => {
  test("⌘1..⌘9 each carry their own 1-based slot number", () => {
    for (let n = 1; n <= 9; n++) {
      const binding = matchKeybinding(keyEvent(`Digit${n}`, { meta: true }));
      expect(binding).not.toBeNull();
      expect(binding?.action).toBe(TUG_ACTIONS.MOVE_TO_SLOT);
      expect(binding?.value).toBe(n);
    }
  });

  test("all nine digits are bound, though six-up is the largest arrangement", () => {
    // The out-of-range numbers are bound on purpose: an unbound chord falls
    // through to a macOS beep, and a slot the arrangement doesn't have should
    // be silent. The range gate lives in DeckCanvas's handler, not here.
    for (let n = 7; n <= 9; n++) {
      expect(matchKeybinding(keyEvent(`Digit${n}`, { meta: true }))).not.toBeNull();
    }
  });

  test("a bare digit is not a chord", () => {
    expect(matchKeybinding(keyEvent("Digit1"))).toBeNull();
  });

  test("⌘0 is the host's Actual Size and is absent from this map", () => {
    expect(matchKeybinding(keyEvent("Digit0", { meta: true }))).toBeNull();
  });
});
