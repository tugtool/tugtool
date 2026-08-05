/**
 * The command table's own invariants.
 *
 * The table is hand-maintained and joined to the native menu by item
 * identifier, so the things that can silently rot are structural: two
 * entries claiming one id, two entries claiming one menu item, an entry
 * with no way to invoke it at all. `lintCommandTable` answers all of them
 * at once; this suite is what makes it a gate rather than a courtesy.
 */

import { describe, expect, test } from "bun:test";

import {
  COMMANDS,
  COMMANDS_BY_ID,
  COMMANDS_BY_MENU_ITEM_ID,
  GLOBAL_SCOPE,
  commandAction,
  isCommandId,
  isCommandLocked,
  lintActionCoverage,
  lintCommandTable,
  lintNativeLocked,
  type CommandEntry,
} from "../command-registry";
import { TUG_ACTIONS } from "../action-vocabulary";

describe("the shipped table", () => {
  test("holds no violations", () => {
    expect(lintCommandTable()).toEqual([]);
  });

  test("indexes every entry by id", () => {
    expect(COMMANDS_BY_ID.size).toBe(COMMANDS.length);
    for (const entry of COMMANDS) {
      expect(COMMANDS_BY_ID.get(entry.id)).toBe(entry);
    }
  });

  test("indexes exactly the entries that drive a menu item", () => {
    const withMenuItem = COMMANDS.filter((e) => e.menuItemId !== undefined);
    expect(COMMANDS_BY_MENU_ITEM_ID.size).toBe(withMenuItem.length);
    for (const entry of withMenuItem) {
      expect(COMMANDS_BY_MENU_ITEM_ID.get(entry.menuItemId as string)).toBe(entry);
    }
  });

  test("every chain-routed entry resolves a chain action", () => {
    for (const entry of COMMANDS) {
      if (entry.routing === "registry" || entry.routing === "native") continue;
      expect(commandAction(entry)).not.toBeNull();
    }
  });

  test("isCommandId separates commands from data-frame wires", () => {
    expect(isCommandId(TUG_ACTIONS.CLOSE)).toBe(true);
    expect(isCommandId("session_updated")).toBe(false);
  });
});

describe("commandAction", () => {
  test("defaults to the id when the id is itself an action", () => {
    expect(commandAction({ id: TUG_ACTIONS.CLOSE, title: "Close", routing: "first-responder" }))
      .toBe(TUG_ACTIONS.CLOSE);
  });

  test("prefers an explicit action, which is what a parameterized id needs", () => {
    expect(
      commandAction({
        id: "move-to-slot:3",
        title: "Slot 3",
        routing: "first-responder",
        action: TUG_ACTIONS.MOVE_TO_SLOT,
        payload: 3,
      }),
    ).toBe(TUG_ACTIONS.MOVE_TO_SLOT);
  });

  test("answers null when the id names no action and none is declared", () => {
    expect(commandAction({ id: "quit-application", title: "Quit", routing: "native" }))
      .toBeNull();
  });
});

describe("lintCommandTable", () => {
  const door: Pick<CommandEntry, "menuItemId"> = { menuItemId: "some.item" };

  test("catches a duplicate id", () => {
    const problems = lintCommandTable([
      { id: "a", title: "A", routing: "registry", ...door },
      { id: "a", title: "A again", routing: "registry", menuItemId: "other.item" },
    ]);
    expect(problems).toEqual(["duplicate command id: a"]);
  });

  test("catches two commands claiming one menu item", () => {
    const problems = lintCommandTable([
      { id: "a", title: "A", routing: "registry", menuItemId: "file.save" },
      { id: "b", title: "B", routing: "registry", menuItemId: "file.save" },
    ]);
    expect(problems).toEqual([
      "menu item file.save is claimed by both a and b",
    ]);
  });

  test("catches a chain-routed entry with no resolvable action", () => {
    const problems = lintCommandTable([
      { id: "not-an-action", title: "Nope", routing: "first-responder", ...door },
    ]);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("needs a chain action");
  });

  test("catches a command with no door at all", () => {
    const problems = lintCommandTable([
      { id: TUG_ACTIONS.CLOSE, title: "Close", routing: "first-responder" },
    ]);
    expect(problems).toEqual([
      "close: no menu item and no binding — no way to invoke it",
    ]);
  });

  test("a binding is a door", () => {
    const problems = lintCommandTable([
      {
        id: TUG_ACTIONS.CLOSE,
        title: "Close",
        routing: "first-responder",
        bindings: [
          { chord: { key: "KeyW", meta: true }, scope: GLOBAL_SCOPE, source: "default" },
        ],
      },
    ]);
    expect(problems).toEqual([]);
  });

  test("internal and parameterized entries are exempt from door coverage", () => {
    expect(
      lintCommandTable([
        { id: TUG_ACTIONS.CLOSE_PANE, title: "Close Pane", routing: "target", internal: true },
        { id: TUG_ACTIONS.MOVE_TO_SLOT, title: "Move to Slot", routing: "first-responder", parameterized: true },
      ]),
    ).toEqual([]);
  });
});

describe("the locked policy", () => {
  test("names only real commands", () => {
    expect(lintNativeLocked()).toEqual([]);
  });

  test("covers the macOS conventions a user needs to get out of trouble", () => {
    for (const id of ["quit-application", "hide-application", TUG_ACTIONS.COPY]) {
      expect(isCommandLocked(id)).toBe(true);
    }
  });

  test("leaves everything else the user's to change", () => {
    for (const id of [TUG_ACTIONS.CLOSE, TUG_ACTIONS.FIND, "next-theme"]) {
      expect(isCommandLocked(id)).toBe(false);
    }
  });

  test("catches a lock left pointing at a deleted command", () => {
    expect(lintNativeLocked([])).toContain(
      "NATIVE_LOCKED names quit-application, which is not a command",
    );
  });
});

describe("Settings has one command", () => {
  test("the menu item and the chord are two doors on one entry", () => {
    const settings = COMMANDS_BY_ID.get(TUG_ACTIONS.SHOW_SETTINGS);
    expect(settings?.menuItemId).toBe("app.settings");
    expect(settings?.routing).toBe("first-responder");
    expect(settings?.bindings?.length).toBe(1);
  });

  test("no other command claims the Settings item", () => {
    expect(COMMANDS_BY_MENU_ITEM_ID.get("app.settings")?.id).toBe(
      TUG_ACTIONS.SHOW_SETTINGS,
    );
  });
});

describe("the vocabulary is fully accounted for", () => {
  test("every action name is a command or declared outside the table", () => {
    expect(lintActionCoverage()).toEqual([]);
  });

  test("catches a name that is neither", () => {
    // With no entries at all, every non-excluded action is unaccounted for.
    const problems = lintActionCoverage([]);
    expect(problems).toContain(
      "close is neither a command nor declared outside the table",
    );
    for (const excluded of [TUG_ACTIONS.SET_VALUE, TUG_ACTIONS.MOVE_WORD_FORWARD]) {
      expect(problems.join("\n")).not.toContain(`${excluded} is neither`);
    }
  });

  test("the newly named verbs are in the table", () => {
    for (const id of [
      TUG_ACTIONS.CENTER_PANE,
      TUG_ACTIONS.PIN_LENS,
      TUG_ACTIONS.SHOW_LENS_PANE,
      TUG_ACTIONS.HIDE_LENS_PANE,
      TUG_ACTIONS.MOVE_PANE,
      TUG_ACTIONS.EXIT_COMMIT_MODE,
      TUG_ACTIONS.LAND_COMMIT,
    ]) {
      expect(COMMANDS_BY_ID.has(id)).toBe(true);
    }
  });

  test("the PDF verbs are one command per value", () => {
    const fits = COMMANDS.filter((e) => e.action === TUG_ACTIONS.ZOOM_TO_FIT);
    const modes = COMMANDS.filter((e) => e.action === TUG_ACTIONS.SET_PAGE_MODE);
    expect(fits.map((e) => e.payload)).toEqual(["width", "page"]);
    expect(modes.map((e) => e.payload)).toEqual(["continuous", "single", "two"]);
  });

  test("every doorless entry says so rather than failing the door lint", () => {
    // The lint is only honest if `internal` is a declaration, not a
    // catch-all: each one has to be a deliberate row.
    const doorless = COMMANDS.filter(
      (e) =>
        e.menuItemId === undefined &&
        (e.bindings === undefined || e.bindings.length === 0) &&
        !e.parameterized,
    );
    for (const entry of doorless) {
      expect(entry.internal).toBe(true);
    }
  });
});
