/**
 * chord-format — the two key alphabets, and the one place they meet.
 *
 * The conversion's failure mode is not a crash: it is a chord that renders
 * one way in the menu bar and fires another way, or never. So the round trip
 * is checked against every code the shipped table actually binds, and the
 * shifted-punctuation rule — the one genuine ambiguity — is checked against
 * the byte the shipped Zoom In item carries.
 */

import { describe, expect, test } from "bun:test";

import {
  chordFromEvent,
  chordHasKeyEquivalent,
  chordKey,
  chordMatchesEvent,
  codeToKeyEquivalent,
  eventChordKey,
  formatChord,
} from "../chord-format";
import { COMMANDS, type Chord } from "../command-registry";

function keyEvent(code: string, mods: Partial<Record<"ctrl" | "meta" | "shift" | "alt", boolean>> = {}) {
  return {
    code,
    key: code,
    ctrlKey: mods.ctrl === true,
    metaKey: mods.meta === true,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
  } as KeyboardEvent;
}

describe("chord identity", () => {
  test("a chord and an event agree on their key", () => {
    const chord: Chord = { key: "KeyC", meta: true, shift: true, alt: true };
    expect(eventChordKey(keyEvent("KeyC", { meta: true, shift: true, alt: true }))).toBe(
      chordKey(chord),
    );
  });

  test("modifier state is exact, so a superset is a different chord", () => {
    const copy: Chord = { key: "KeyC", meta: true };
    expect(chordMatchesEvent(keyEvent("KeyC", { meta: true }), copy)).toBe(true);
    // ⌥⇧⌘C is Copy as Plain Text, a different command entirely.
    expect(
      chordMatchesEvent(keyEvent("KeyC", { meta: true, shift: true, alt: true }), copy),
    ).toBe(false);
  });

  test("a captured chord records the layout's own character as its label", () => {
    const event = { ...keyEvent("Slash", { meta: true }), key: "/" } as KeyboardEvent;
    expect(chordFromEvent(event)).toEqual({ key: "Slash", meta: true, label: "/" });
  });
});

describe("codeToKeyEquivalent", () => {
  test("a letter is lowercase; AppKit renders shift from the mask", () => {
    expect(codeToKeyEquivalent({ key: "KeyS", meta: true })).toEqual({
      keyEquivalent: "s",
      command: true,
    });
    expect(codeToKeyEquivalent({ key: "KeyG", meta: true, shift: true })).toEqual({
      keyEquivalent: "g",
      command: true,
      shift: true,
    });
  });

  test("shifted punctuation spends the shift on the character, not the mask", () => {
    // The shipped Zoom In item is NSMenuItem(keyEquivalent: "+") with a bare
    // .command mask. A naive "=" plus ⇧⌘ would still match at runtime, but
    // the menu would render ⇧⌘= instead of ⌘+.
    expect(codeToKeyEquivalent({ key: "Equal", meta: true, shift: true })).toEqual({
      keyEquivalent: "+",
      command: true,
    });
    // ⌘= is a second binding on the unshifted code, which is what the
    // shipped hidden alias item models.
    expect(codeToKeyEquivalent({ key: "Equal", meta: true })).toEqual({
      keyEquivalent: "=",
      command: true,
    });
    expect(codeToKeyEquivalent({ key: "Slash", meta: true, shift: true })).toEqual({
      keyEquivalent: "?",
      command: true,
    });
  });

  test("the function keys use AppKit's private-use characters", () => {
    expect(codeToKeyEquivalent({ key: "ArrowUp", meta: true, alt: true })).toEqual({
      keyEquivalent: "\u{F700}",
      command: true,
      option: true,
    });
    expect(codeToKeyEquivalent({ key: "Escape" })).toEqual({ keyEquivalent: "\u{1B}" });
    expect(codeToKeyEquivalent({ key: "Tab", alt: true })).toEqual({
      keyEquivalent: "\t",
      option: true,
    });
    expect(codeToKeyEquivalent({ key: "F5" })?.keyEquivalent).toBe("\u{F708}");
  });

  test("every code the shipped table binds converts", () => {
    // The table is the only list of codes that matter; adding rows for
    // codes nothing binds would test the table against itself.
    const codes = new Set(
      COMMANDS.flatMap((e) => (e.bindings ?? []).map((b) => b.chord.key)),
    );
    expect(codes.size).toBeGreaterThan(10);
    for (const key of codes) {
      expect(codeToKeyEquivalent({ key }), `${key} converts`).not.toBeNull();
    }
  });

  test("an untabled code throws rather than mis-assigning a chord", () => {
    // A binding nothing can render is a mistake to see immediately, not one
    // to discover as a chord that never fires.
    expect(() => codeToKeyEquivalent({ key: "MediaPlayPause" })).toThrow(
      /no key equivalent/,
    );
  });

  test("chordHasKeyEquivalent answers without throwing", () => {
    // The capture surface's probe: a user-pressed code that the menu bar
    // cannot represent is a fact to note, never an exception to hit.
    expect(chordHasKeyEquivalent({ key: "KeyA", meta: true })).toBe(true);
    expect(chordHasKeyEquivalent({ key: "Equal", meta: true, shift: true })).toBe(true);
    expect(chordHasKeyEquivalent({ key: "IntlBackslash", meta: true })).toBe(false);
    expect(chordHasKeyEquivalent({ key: "NumpadAdd", meta: true })).toBe(false);
    expect(chordHasKeyEquivalent({ key: "MediaPlayPause" })).toBe(false);
  });
});

describe("formatChord", () => {
  test("modifiers render in macOS order", () => {
    expect(formatChord({ key: "KeyC", meta: true })).toBe("⌘C");
    expect(formatChord({ key: "KeyC", meta: true, shift: true, alt: true })).toBe("⌥⇧⌘C");
    expect(formatChord({ key: "KeyV", meta: true, shift: true, alt: true })).toBe("⌥⇧⌘V");
    expect(formatChord({ key: "KeyP", ctrl: true, meta: true })).toBe("⌃⌘P");
  });

  test("named keys render as glyphs, not as their code", () => {
    expect(formatChord({ key: "ArrowUp", meta: true, alt: true })).toBe("⌥⌘↑");
    expect(formatChord({ key: "ArrowDown", meta: true, alt: true, shift: true })).toBe(
      "⌥⇧⌘↓",
    );
    expect(formatChord({ key: "Escape" })).toBe("⎋");
    expect(formatChord({ key: "Tab", alt: true })).toBe("⌥⇥");
  });

  test("a shifted character carries its own shift, matching the menu bar", () => {
    expect(formatChord({ key: "Equal", meta: true, shift: true })).toBe("⌘+");
    expect(formatChord({ key: "Equal", meta: true })).toBe("⌘=");
    expect(formatChord({ key: "BracketLeft", meta: true, shift: true })).toBe("⌘{");
  });

  test("every shipped binding renders to something a user could press", () => {
    for (const entry of COMMANDS) {
      for (const binding of entry.bindings ?? []) {
        const rendered = formatChord(binding.chord);
        expect(rendered.length, `${entry.id} renders`).toBeGreaterThan(0);
        expect(rendered, `${entry.id} does not render a raw code`).not.toContain("Key");
        expect(rendered, `${entry.id} does not render a raw code`).not.toContain("Arrow");
      }
    }
  });
});
