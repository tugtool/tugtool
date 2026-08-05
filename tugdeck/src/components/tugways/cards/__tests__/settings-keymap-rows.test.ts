/**
 * The Keyboard pane's row model.
 *
 * The pane's rendering is not asserted here — the app-test drives a rebind
 * end to end and watches the native menu follow, which is the claim that
 * matters. What is asserted is everything the pane *decides*: which commands
 * get a row, which group each lands in, whether a binding is live or shadowed
 * and by what, and which rows the user may change.
 *
 * Real registry, real table. A row model tested against a fixture would pass
 * while the shipped pane showed the wrong thing.
 */

import { describe, expect, test } from "bun:test";

import {
  buildKeymapListItems,
  buildKeymapRows,
  groupForEntry,
  rowMatches,
  UNGROUPED,
} from "../settings-keymap-rows";
import { COMMANDS, COMMANDS_BY_ID, GLOBAL_SCOPE } from "../../command-registry";
import type { CommandEntry } from "../../command-registry";
import {
  KeymapRegistry,
  type NativeChordClaim,
  type ScopedBinding,
} from "../../keymap-registry";

const NONE = new Set<string>();

function rowFor(commandId: string, overridden: ReadonlySet<string> = NONE) {
  return buildKeymapRows(overridden).find((r) => r.commandId === commandId);
}

describe("which commands get a row", () => {
  test("a parameterized family does not", () => {
    // "Theme" is not a command, it is however many themes are on disk, so
    // there is no fixed row to rebind.
    expect(rowFor("set-theme")).toBeUndefined();
    expect(rowFor("focus-pane")).toBeUndefined();
  });

  test("a native command does, locked", () => {
    // A keyboard pane that hid Quit would be answering "what does ⌘Q do"
    // with silence. It is shown, and shown as not the user's to change.
    const quit = rowFor("quit-application");
    expect(quit?.locked).toBe(true);
    expect(quit?.bindings.map((b) => b.label)).toEqual(["⌘Q"]);
  });

  test("an ordinary command does, unlocked", () => {
    const focus = rowFor("focus-prompt");
    expect(focus?.locked).toBe(false);
    expect(focus?.bindings.map((b) => b.label)).toEqual(["⌘K"]);
  });

  test("a command with no chord at all still gets a row", () => {
    // The pane is the place you go to give something a chord, so the ones
    // that have none are exactly the rows that need to be there.
    const saveACopy = rowFor("save-a-copy");
    expect(saveACopy).toBeDefined();
    expect(saveACopy?.bindings).toEqual([]);
  });
});

describe("grouping", () => {
  test("a command's group is the menu its item lives in", () => {
    expect(rowFor("save")?.group).toBe("File");
    expect(rowFor("cut")?.group).toBe("Edit");
    expect(rowFor("cycle-stack")?.group).toBe("Window");
    expect(rowFor("quit-application")?.group).toBe("Tug");
  });

  test("a command with no menu item groups under the catch-all", () => {
    const entry = COMMANDS_BY_ID.get("cancel-dialog") as CommandEntry;
    expect(entry.menuItemId).toBeUndefined();
    expect(groupForEntry(entry)).toBe(UNGROUPED);
  });

  test("rows come out grouped, in menu-bar order", () => {
    const groups = buildKeymapRows(NONE).map((r) => r.group);
    const firstSeen = [...new Set(groups)];
    // Each group appears as one contiguous run, or the list's headings would
    // stand over the wrong rows.
    expect(groups.length).toBeGreaterThan(firstSeen.length);
    let seen = "";
    const runs: string[] = [];
    for (const g of groups) {
      if (g !== seen) {
        runs.push(g);
        seen = g;
      }
    }
    expect(runs).toEqual(firstSeen);
    expect(runs[0]).toBe("Tug");
    expect(runs[runs.length - 1]).toBe(UNGROUPED);
  });
});

describe("a binding's standing", () => {
  const DIGIT_1 = { key: "Digit1", meta: true, label: "1" };
  const FIXTURE: readonly CommandEntry[] = [
    {
      id: "deck.slot1",
      title: "Move Card to Slot 1",
      routing: "first-responder",
      bindings: [{ chord: DIGIT_1, scope: GLOBAL_SCOPE, source: "default" }],
    },
  ];
  const pdfBinding: ScopedBinding = {
    commandId: "pdf.firstPage",
    chord: DIGIT_1,
    scope: { kind: "responder", responderId: "pdf-view" },
    depth: 1,
  };
  const menuClaim: NativeChordClaim = {
    menuItemId: "window.slot1",
    commandId: "other.command",
    chord: DIGIT_1,
    enabled: true,
    claims: true,
  };

  function rowsWith(scoped: ScopedBinding[], native: NativeChordClaim[]) {
    const registry = new KeymapRegistry(FIXTURE);
    registry.setEnvironment({
      scopedBindings: () => scoped,
      nativeChords: () => native,
    });
    return buildKeymapRows(NONE, registry, FIXTURE);
  }

  test("an unshadowed binding reads live", () => {
    const [row] = rowsWith([], []);
    expect(row.bindings[0].active).toBe(true);
    expect(row.bindings[0].shadowedBy).toBeUndefined();
  });

  test("a shadowed binding names its shadower", () => {
    // The row that printed "⌘1" without saying who takes it first is the lie
    // this pane exists to retire.
    const [row] = rowsWith([pdfBinding], []);
    expect(row.bindings[0].active).toBe(false);
    expect(row.bindings[0].shadowedBy?.commandId).toBe("pdf.firstPage");
  });

  test("a menu item takes the chord from a scoped binding that has focus", () => {
    const [row] = rowsWith([pdfBinding], [menuClaim]);
    expect(row.bindings[0].active).toBe(false);
    expect(row.bindings[0].shadowedBy?.layer.kind).toBe("native");
  });
});

describe("filtering", () => {
  const rows = buildKeymapRows(NONE);

  test("matches on the command's name", () => {
    const save = rows.find((r) => r.commandId === "save")!;
    expect(rowMatches(save, "sav")).toBe(true);
    expect(rowMatches(save, "quit")).toBe(false);
  });

  test("matches on the chord, because that is the other way in", () => {
    // "What has ⌘K" is as real a question as "what is Focus Prompt bound to".
    const focus = rows.find((r) => r.commandId === "focus-prompt")!;
    expect(rowMatches(focus, "⌘K")).toBe(true);
  });

  test("an empty query matches everything", () => {
    expect(rows.every((r) => rowMatches(r, "   "))).toBe(true);
  });

  test("a heading whose group the filter emptied does not appear", () => {
    // A heading over nothing is a lie about what the list holds, and under a
    // narrow query most of them would be empty.
    const items = buildKeymapListItems(rows, "quit");
    const groups = items.filter((i) => i.kind === "group");
    expect(groups).toHaveLength(1);
    expect(items.filter((i) => i.kind === "command").length).toBeGreaterThan(0);
    // Every heading is followed by at least one command.
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== "group") continue;
      expect(items[i + 1]?.kind, "a heading has rows under it").toBe("command");
    }
  });

  test("a query that matches nothing yields no items at all", () => {
    expect(buildKeymapListItems(rows, "zzzznothing")).toEqual([]);
  });
});

describe("overrides", () => {
  test("a row knows the user has changed it", () => {
    const rows = buildKeymapRows(new Set(["focus-prompt"]));
    expect(rows.find((r) => r.commandId === "focus-prompt")?.overridden).toBe(true);
    expect(rows.find((r) => r.commandId === "save")?.overridden).toBe(false);
  });
});

describe("the shipped table", () => {
  test("every listed command has a title worth showing", () => {
    // The pane is a reading surface first. A row whose label is its wire name
    // would be a command the user cannot look up.
    for (const row of buildKeymapRows(NONE)) {
      expect(row.title.length, `${row.commandId} has a title`).toBeGreaterThan(0);
      expect(row.title, `${row.commandId}'s title is not its id`).not.toBe(row.commandId);
    }
  });

  test("every non-parameterized command in the table gets exactly one row", () => {
    const listed = COMMANDS.filter((e) => e.parameterized !== true);
    const rows = buildKeymapRows(NONE);
    expect(rows).toHaveLength(listed.length);
    expect(new Set(rows.map((r) => r.commandId)).size).toBe(rows.length);
  });
});
