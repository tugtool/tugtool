/**
 * keymap-override-store — the user's keyboard, and what happens to it.
 *
 * The store's whole job is the three-way distinction between "no opinion",
 * "this list", and "deliberately nothing", and to keep a bad value from
 * stranding a command. Every case below drives the real store against the
 * real keymap registry and asks the registry what a command is now bound to —
 * an override that did not reach the registry has not done anything.
 *
 * Writes go through `putKeymapOverride` / `deleteDefault`, which are fetches;
 * these cases pass `persist: false` or exercise the parse layer directly, so
 * nothing here needs a network.
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
  keymapOverrideStore,
  parseOverride,
} from "../keymap-override-store";
import { keymapRegistry } from "../components/tugways/keymap-registry";
import { formatChord } from "../components/tugways/chord-format";
import { TUG_ACTIONS } from "../components/tugways/action-vocabulary";
import type { CommandBinding } from "../components/tugways/command-registry";

const CTRL_ALT_K: CommandBinding = {
  chord: { key: "KeyK", ctrl: true, alt: true, label: "k" },
  scope: { kind: "global" },
  source: "user",
};

/** Put every command this file touches back on its table default. */
afterEach(() => {
  for (const id of keymapOverrideStore.overriddenCommands()) {
    keymapOverrideStore.reset(id, { persist: false });
  }
});

function chordsOf(commandId: string): string[] {
  return keymapRegistry.bindingsOf(commandId).map((b) => formatChord(b.chord));
}

describe("setting an override", () => {
  test("the registry answers with the new chord", () => {
    expect(chordsOf(TUG_ACTIONS.FOCUS_PROMPT)).toEqual(["⌘K"]);
    keymapOverrideStore.set(TUG_ACTIONS.FOCUS_PROMPT, [CTRL_ALT_K], { persist: false });
    expect(chordsOf(TUG_ACTIONS.FOCUS_PROMPT)).toEqual(["⌃⌥K"]);
  });

  test("the new chord is what the key pipeline resolves", () => {
    // The point of the store reaching the registry rather than sitting beside
    // it: a rebind that only the pane could see would be a setting that does
    // nothing.
    keymapOverrideStore.set(TUG_ACTIONS.FOCUS_PROMPT, [CTRL_ALT_K], { persist: false });
    const event = {
      code: "KeyK",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent;
    expect(keymapRegistry.matchChord(event)?.commandId).toBe(TUG_ACTIONS.FOCUS_PROMPT);
  });

  test("the old chord stops firing the command", () => {
    keymapOverrideStore.set(TUG_ACTIONS.FOCUS_PROMPT, [CTRL_ALT_K], { persist: false });
    const old = {
      code: "KeyK",
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent;
    expect(keymapRegistry.matchChord(old)).toBeNull();
  });

  test("an empty list is a real answer, not an absent one", () => {
    // "I deliberately have no chord for this" has to be expressible and has
    // to survive; otherwise the only way to unbind something is to bind it to
    // a chord you will never press.
    keymapOverrideStore.set(TUG_ACTIONS.FOCUS_PROMPT, [], { persist: false });
    expect(chordsOf(TUG_ACTIONS.FOCUS_PROMPT)).toEqual([]);
    expect(keymapOverrideStore.overrideFor(TUG_ACTIONS.FOCUS_PROMPT)).toEqual([]);
  });
});

describe("an override on a menu-driving command takes the menu item too", () => {
  test("the rebound chord is what the host is told to apply", () => {
    // A user rebinding Zoom Out has said what the chord is, not which layer
    // should carry it. Asking them to also mark the binding menu-eligible
    // would be asking them to understand AppKit's key-equivalent scan in
    // order to change a shortcut — so the first global binding takes the item.
    keymapOverrideStore.set(
      TUG_ACTIONS.ZOOM_OUT,
      [{ chord: { key: "KeyJ", meta: true, label: "j" }, scope: { kind: "global" }, source: "user" }],
      { persist: false },
    );
    expect(keymapRegistry.menuChords()["view.zoomOut"]).toEqual({
      keyEquivalent: "j",
      command: true,
    });
  });

  test("an empty override releases the key equivalent rather than restoring it", () => {
    keymapOverrideStore.set(TUG_ACTIONS.ZOOM_OUT, [], { persist: false });
    // `null`, not absent: absent would leave the host's constructed ⌘- in
    // place, which is the opposite of what the user asked for.
    expect(keymapRegistry.menuChords()["view.zoomOut"]).toBeNull();
  });

  test("reset hands the item back to the table's chord", () => {
    keymapOverrideStore.set(
      TUG_ACTIONS.ZOOM_OUT,
      [{ chord: { key: "KeyJ", meta: true }, scope: { kind: "global" }, source: "user" }],
      { persist: false },
    );
    keymapOverrideStore.reset(TUG_ACTIONS.ZOOM_OUT, { persist: false });
    expect(keymapRegistry.menuChords()["view.zoomOut"]).toEqual({
      keyEquivalent: "-",
      command: true,
    });
  });
});

describe("reset", () => {
  test("restores the table's default", () => {
    keymapOverrideStore.set(TUG_ACTIONS.FOCUS_PROMPT, [CTRL_ALT_K], { persist: false });
    keymapOverrideStore.reset(TUG_ACTIONS.FOCUS_PROMPT, { persist: false });
    expect(chordsOf(TUG_ACTIONS.FOCUS_PROMPT)).toEqual(["⌘K"]);
    expect(keymapOverrideStore.overrideFor(TUG_ACTIONS.FOCUS_PROMPT)).toBeUndefined();
  });

  test("resetAll clears every override at once", () => {
    keymapOverrideStore.set(TUG_ACTIONS.FOCUS_PROMPT, [CTRL_ALT_K], { persist: false });
    keymapOverrideStore.set(TUG_ACTIONS.FIND, [], { persist: false });
    keymapOverrideStore.resetAll();
    expect(keymapOverrideStore.overriddenCommands()).toEqual([]);
    expect(chordsOf(TUG_ACTIONS.FOCUS_PROMPT)).toEqual(["⌘K"]);
    expect(chordsOf(TUG_ACTIONS.FIND)).toEqual(["⌘F"]);
  });
});

describe("locked commands ([P12])", () => {
  test("a write against a locked id is refused and changes nothing", () => {
    keymapOverrideStore.set(TUG_ACTIONS.SELECT_ALL, [CTRL_ALT_K], { persist: false });
    expect(keymapOverrideStore.overrideFor(TUG_ACTIONS.SELECT_ALL)).toBeUndefined();
    expect(chordsOf(TUG_ACTIONS.SELECT_ALL)).toEqual(["⌘A"]);
  });

  test("a hand-written tugbank value for a locked id is ignored too", () => {
    // Policy is enforced on read as well as on write, or `tugbank write`
    // would be a way around it — and unbinding ⌘Q is not a mistake anyone
    // should be able to make from a shell.
    keymapOverrideStore.initialize({
      [TUG_ACTIONS.SELECT_ALL]: {
        kind: "string",
        value: JSON.stringify([{ chord: { key: "KeyK" }, scope: { kind: "global" } }]),
      },
    });
    expect(chordsOf(TUG_ACTIONS.SELECT_ALL)).toEqual(["⌘A"]);
  });
});

describe("parsing a persisted value", () => {
  test("a well-formed list round-trips, stamped as the user's", () => {
    const parsed = parseOverride([
      { chord: { key: "KeyK", ctrl: true }, scope: { kind: "global" }, preventDefault: true },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].source).toBe("user");
    expect(parsed?.[0].preventDefault).toBe(true);
  });

  test("a scoped binding survives", () => {
    const parsed = parseOverride([
      { chord: { key: "KeyM", meta: true, shift: true }, scope: { kind: "responder", responderId: "x" } },
    ]);
    expect(parsed?.[0].scope).toEqual({ kind: "responder", responderId: "x" });
  });

  test("anything unreadable answers null rather than half a keymap", () => {
    expect(parseOverride("nonsense")).toBeNull();
    expect(parseOverride([{ scope: { kind: "global" } }])).toBeNull();
    expect(parseOverride([{ chord: { key: "KeyK" } }])).toBeNull();
    expect(parseOverride([{ chord: { key: "" }, scope: { kind: "global" } }])).toBeNull();
    expect(parseOverride([{ chord: { key: "KeyK" }, scope: { kind: "elsewhere" } }])).toBeNull();
    // One bad element spoils the list: a half-applied keymap is harder to
    // reason about than a defaulted one.
    expect(
      parseOverride([
        { chord: { key: "KeyK" }, scope: { kind: "global" } },
        { chord: 7, scope: { kind: "global" } },
      ]),
    ).toBeNull();
  });

  test("a corrupt entry degrades to the default rather than stranding a command", () => {
    keymapOverrideStore.initialize({
      [TUG_ACTIONS.FOCUS_PROMPT]: { kind: "string", value: "{not json" },
    });
    expect(chordsOf(TUG_ACTIONS.FOCUS_PROMPT)).toEqual(["⌘K"]);
    expect(keymapOverrideStore.overrideFor(TUG_ACTIONS.FOCUS_PROMPT)).toBeUndefined();
  });
});

describe("a remote push", () => {
  test("applies an override written by another process", () => {
    keymapOverrideStore.applyRemote({
      [TUG_ACTIONS.FOCUS_PROMPT]: {
        kind: "string",
        value: JSON.stringify([
          { chord: { key: "KeyK", ctrl: true, alt: true }, scope: { kind: "global" } },
        ]),
      },
    });
    expect(chordsOf(TUG_ACTIONS.FOCUS_PROMPT)).toEqual(["⌃⌥K"]);
  });

  test("a key gone from the push is an override somebody deleted", () => {
    // The push carries the whole domain, so absence is information. Keeping a
    // value tugbank no longer holds would leave this window on a chord that
    // exists nowhere else.
    keymapOverrideStore.set(TUG_ACTIONS.FOCUS_PROMPT, [CTRL_ALT_K], { persist: false });
    keymapOverrideStore.applyRemote({});
    expect(chordsOf(TUG_ACTIONS.FOCUS_PROMPT)).toEqual(["⌘K"]);
  });
});
