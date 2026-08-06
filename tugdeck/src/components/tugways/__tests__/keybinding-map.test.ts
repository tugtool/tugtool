/**
 * The global chord layer, now resolved through the command registry.
 *
 * These pins used to read a static map; the map is gone, and the same facts
 * are asserted against `keymapRegistry.matchChord`, which resolves a chord to
 * a *command id* rather than to an action-plus-payload. Every chord the map
 * held has to resolve to the same behavior it did — that is the whole
 * contract of moving it — so the cases are unchanged in substance and only
 * changed in what they ask.
 *
 * The boundary case is still the interesting one. Tug departs from the Claude
 * Code TUI: the terminal cycles the permission mode on Shift+Tab, but in a GUI
 * Shift+Tab must be reverse-focus navigation. So permission cycling lives on
 * ⌃⌥⌘P — ⌃⌘P is the composer's Prompt route — and Tab / Shift-Tab belong to
 * the focus-walk stage in `responder-chain-provider.tsx`, deliberately bound
 * nowhere in the table.
 */

import { describe, expect, test } from "bun:test";

import { keymapRegistry } from "../keymap-registry";
import { COMMANDS, COMMANDS_BY_ID } from "../command-registry";
import { chordKey, chordMatchesEvent } from "../chord-format";
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

describe("the two P chords", () => {
  test("⌃⌘P selects the Prompt route, key-card routed, preventDefault", () => {
    const match = keymapRegistry.matchChord(keyEvent("KeyP", { meta: true, ctrl: true }));
    expect(match).not.toBeNull();
    const entry = COMMANDS_BY_ID.get(match?.commandId ?? "");
    expect(entry?.action).toBe(TUG_ACTIONS.SELECT_COMPOSER_ROUTE);
    expect(entry?.payload).toBe("prompt");
    expect(entry?.routing).toBe("key-card");
    expect(match?.binding.preventDefault).toBe(true);
  });

  test("⌃⌥⌘P cycles the permission mode, key-card routed, preventDefault", () => {
    const match = keymapRegistry.matchChord(keyEvent("KeyP", { meta: true, ctrl: true, alt: true }));
    expect(match?.commandId).toBe(TUG_ACTIONS.CYCLE_PERMISSION_MODE);
    expect(COMMANDS_BY_ID.get(TUG_ACTIONS.CYCLE_PERMISSION_MODE)?.routing).toBe("key-card");
    expect(match?.binding.preventDefault).toBe(true);
  });

  test("bare ⌘P matches neither (exact modifier match)", () => {
    expect(keymapRegistry.matchChord(keyEvent("KeyP", { meta: true }))).toBeNull();
  });

  test("⇧P without Cmd matches neither", () => {
    expect(keymapRegistry.matchChord(keyEvent("KeyP", { shift: true }))).toBeNull();
  });
});

describe("Tab belongs to the focus-walk stage, not to any binding", () => {
  test("plain Tab and Shift-Tab resolve to no command", () => {
    expect(keymapRegistry.matchChord(keyEvent("Tab"))).toBeNull();
    expect(keymapRegistry.matchChord(keyEvent("Tab", { shift: true }))).toBeNull();
  });

  test("⌥⇥ is a chord, because the focus walk bails on any modifier", () => {
    expect(keymapRegistry.matchChord(keyEvent("Tab", { alt: true }))?.commandId).toBe(
      TUG_ACTIONS.CYCLE_FOCUS_MODE,
    );
  });
});

describe("index invariants", () => {
  const globalBindings = COMMANDS.flatMap((entry) =>
    (entry.bindings ?? [])
      .filter((b) => b.scope.kind === "global")
      .map((binding) => ({ id: entry.id, binding })),
  );

  test("no two commands share a chord", () => {
    // The index is first-writer-wins on a duplicate, which is correct only
    // while duplicates do not exist. A duplicate added mid-table would
    // silently shadow the later command; fail loudly here instead.
    const seen = new Map<string, string>();
    for (const { id, binding } of globalBindings) {
      const key = chordKey(binding.chord);
      const holder = seen.get(key);
      expect(holder, `chord ${key} bound to both "${holder}" and "${id}"`).toBeUndefined();
      seen.set(key, id);
    }
  });

  test("the index agrees with a linear scan for every binding's own chord", () => {
    for (const { id, binding } of globalBindings) {
      const event = keyEvent(binding.chord.key, {
        ctrl: binding.chord.ctrl,
        meta: binding.chord.meta,
        shift: binding.chord.shift,
        alt: binding.chord.alt,
      });
      const scanned = globalBindings.find((b) =>
        chordMatchesEvent(event, b.binding.chord),
      )?.id;
      expect(scanned).toBe(id);
      expect(keymapRegistry.matchChord(event)?.commandId).toBe(id);
    }
  });

  test("a chord with one extra modifier never matches", () => {
    for (const { binding } of globalBindings) {
      const extra = keyEvent(binding.chord.key, {
        ctrl: binding.chord.ctrl,
        meta: binding.chord.meta,
        shift: binding.chord.shift,
        alt: !(binding.chord.alt ?? false),
      });
      const scanned =
        globalBindings.find((b) => chordMatchesEvent(extra, b.binding.chord))?.id ?? null;
      expect(keymapRegistry.matchChord(extra)?.commandId ?? null).toBe(scanned);
    }
  });
});

describe("the digit row is move-to-slot, whole", () => {
  test("⌘1..⌘9 each resolve to their own slot command", () => {
    for (let n = 1; n <= 9; n++) {
      const match = keymapRegistry.matchChord(keyEvent(`Digit${n}`, { meta: true }));
      expect(match?.commandId).toBe(`${TUG_ACTIONS.MOVE_TO_SLOT}:${n}`);
      expect(COMMANDS_BY_ID.get(match?.commandId ?? "")?.payload).toBe(n);
    }
  });

  test("all nine digits are bound, though six-up is the largest arrangement", () => {
    // The out-of-range numbers are bound on purpose: an unbound chord falls
    // through to a macOS beep, and a slot the arrangement does not have
    // should be silent. The range gate lives in DeckCanvas's handler.
    for (let n = 7; n <= 9; n++) {
      expect(keymapRegistry.matchChord(keyEvent(`Digit${n}`, { meta: true }))).not.toBeNull();
    }
  });

  test("a bare digit is not a chord", () => {
    expect(keymapRegistry.matchChord(keyEvent("Digit1"))).toBeNull();
  });

  test("⌘0 is Actual Size, not a tenth slot", () => {
    // The host still owns the chord in the shipped app — its View menu item
    // resolves it before the web view sees a keydown — but the chord is
    // stated here now, which is what lets the menu item be swept from the
    // table and what gives browser dev the same gesture.
    expect(keymapRegistry.matchChord(keyEvent("Digit0", { meta: true }))?.commandId).toBe(
      TUG_ACTIONS.ZOOM_ACTUAL,
    );
  });
});
