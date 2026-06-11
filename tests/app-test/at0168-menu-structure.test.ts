/**
 * at0168-menu-structure.test.ts — the menu bar's structure contract.
 *
 * Asserts the full static menu structure through the harness's
 * `menuSnapshot`: every identifier present with its expected key
 * equivalent and modifier mask, the dead NSTextView find-panel items
 * gone, the flattened File menu (no New submenu shell), the Session
 * menu present, and the Maker menu hidden under default app-test
 * prefs (empty per-instance tugbank → maker mode reads false under
 * the harness).
 *
 * Assertions are by identifier only — titles localize and identity
 * never rides the title. Dynamic items
 * (View menu body, theme list, `window.pane.*`) are rebuilt in
 * `menuNeedsUpdate` on open and deliberately NOT asserted here — the
 * snapshot walks the menu tree without a tracking session.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

// NSEvent.ModifierFlags raw bits.
const MOD = {
  shift: 1 << 17,
  control: 1 << 18,
  option: 1 << 19,
  command: 1 << 20,
} as const;

/**
 * The static structure contract: identifier → expected key equivalent
 * (+ exact modifier mask where the item carries a promoted chord).
 * Items with `key: ""` are mouse-only; their default mask is not
 * asserted.
 */
const STATIC_ITEMS: ReadonlyArray<{ id: string; key?: string; mods?: number }> = [
  // Tug (app) menu
  { id: "app.about" },
  { id: "app.settings", key: ",", mods: MOD.command },
  // File
  { id: "file.newDevCard", key: "n", mods: MOD.command },
  { id: "file.newGitCard", key: "n", mods: MOD.command | MOD.shift },
  { id: "file.closeCard", key: "w", mods: MOD.command },
  { id: "file.closeAllCards", key: "w", mods: MOD.command | MOD.option },
  { id: "file.exportTranscript", key: "" },
  // Edit
  { id: "edit.undo", key: "z", mods: MOD.command },
  { id: "edit.redo", key: "z", mods: MOD.command | MOD.shift },
  { id: "edit.cut" },
  { id: "edit.copy" },
  { id: "edit.paste" },
  { id: "edit.delete" },
  { id: "edit.selectAll" },
  { id: "edit.copyLastResponse", key: "" },
  { id: "edit.find", key: "f", mods: MOD.command },
  { id: "edit.findNext", key: "g", mods: MOD.command },
  { id: "edit.findPrevious", key: "g", mods: MOD.command | MOD.shift },
  // Session
  { id: "session.focusPrompt", key: "k", mods: MOD.command },
  { id: "session.stop", key: "" },
  { id: "session.new" },
  { id: "session.resume" },
  { id: "session.rename" },
  { id: "session.model" },
  { id: "session.effort" },
  { id: "session.permissionMode" },
  { id: "session.permissionMode.default" },
  { id: "session.permissionMode.acceptEdits" },
  { id: "session.permissionMode.plan" },
  { id: "session.permissionMode.auto" },
  { id: "session.permissionMode.cycle", key: "p", mods: MOD.command | MOD.shift },
  { id: "session.permissionRules" },
  { id: "session.rewind" },
  { id: "session.compact" },
  { id: "session.addDir" },
  { id: "session.diff" },
  { id: "session.context" },
  { id: "session.skills" },
  { id: "session.agents" },
  { id: "session.hooks" },
  { id: "session.memory" },
  // Window (static slice; window.pane.* is dynamic)
  { id: "window.minimize", key: "m", mods: MOD.command },
  { id: "window.zoom" },
  { id: "window.cascade", key: "c", mods: MOD.control | MOD.option },
  { id: "window.tile", key: "t", mods: MOD.control | MOD.option },
  { id: "window.previousCard", key: "[", mods: MOD.command | MOD.shift },
  { id: "window.nextCard", key: "]", mods: MOD.command | MOD.shift },
  { id: "window.cyclePanes", key: "`", mods: MOD.control },
  { id: "window.enterFullScreen", key: "f", mods: MOD.command | MOD.control },
  { id: "window.bringAllToFront" },
  // Maker (items exist in the hidden menu). The gallery / hello-world
  // / active-pane creators are gated on BuildInfo.profile == "debug";
  // the app-test bundle's profile is "apptest", so they are absent here
  // and not asserted.
  { id: "maker.reload", key: "r", mods: MOD.command },
  { id: "maker.jsConsole", key: "c", mods: MOD.command | MOD.option },
  { id: "maker.devPanel", key: "/", mods: MOD.command | MOD.option },
  { id: "maker.sourceTree" },
  // Help
  { id: "help.shortcuts", key: "" },
  { id: "help.projectHome" },
  { id: "help.github" },
];

interface FlatItem {
  identifier?: string;
  action?: string;
  keyEquivalent: string;
  modifierMask: number;
  hidden: boolean;
  depth: number;
}

describe.skipIf(!SHOULD_RUN)("AT0168: menu structure contract", () => {
  test(
    "menuSnapshot matches the structure contract",
    async () => {
      const app = await launchTugApp({ testName: "at0168-structure" });
      try {
        const tree = await app.menuSnapshot();

        const flat: FlatItem[] = [];
        const walk = (items: typeof tree, depth: number) => {
          for (const it of items) {
            flat.push({ ...it, depth });
            if (it.submenu) walk(it.submenu, depth + 1);
          }
        };
        walk(tree, 0);
        const byId = new Map(
          flat.filter((i) => i.identifier !== undefined).map((i) => [i.identifier!, i]),
        );

        // Every contract item present, with its chord where promoted.
        for (const want of STATIC_ITEMS) {
          const got = byId.get(want.id);
          expect(got, `${want.id} present in snapshot`).toBeDefined();
          if (want.key !== undefined) {
            expect(got!.keyEquivalent, `${want.id} key equivalent`).toBe(want.key);
          }
          if (want.mods !== undefined) {
            expect(got!.modifierMask, `${want.id} modifier mask`).toBe(want.mods);
          }
        }

        // The dead NSTextView find-panel items are gone.
        const findPanel = flat.filter(
          (i) => i.action === "performFindPanelAction:",
        );
        expect(findPanel.length, "no NSTextView find-panel items remain").toBe(0);

        // File is flat: New Dev Card sits directly inside a top-level
        // menu (bar item depth 0 → menu item depth 1), not behind a
        // New submenu shell.
        expect(byId.get("file.newDevCard")!.depth, "File menu is flattened").toBe(1);

        // Maker is hidden under default app-test prefs (empty tugbank
        // → maker mode off under the harness). The gate lives on the
        // top-level bar item, located by its submenu's content.
        const makerBarItem = tree.find((it) =>
          it.submenu?.some((sub) => sub.identifier === "maker.reload"),
        );
        expect(makerBarItem, "Maker bar item exists").toBeDefined();
        expect(makerBarItem!.hidden, "Maker menu hidden by default").toBe(true);

        // Identifier uniqueness within our namespaces —
        // findByIdentifier addressing relies on it. AppKit injects its
        // own identified items (Start Dictation, Emoji & Symbols) and,
        // on modern macOS, clones the fullscreen item into its managed
        // window-tiling section — both outside our control, so the
        // check scopes to our `<menu>.` namespaces and tolerates
        // exactly the fullscreen clone.
        const OUR_ID = /^(app|file|edit|session|view|window|maker|help)\./;
        const ids = flat
          .filter((i) => i.identifier !== undefined)
          .map((i) => i.identifier!)
          .filter((id) => OUR_ID.test(id));
        const seen = new Set<string>();
        const dupes = ids
          .filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
          .filter((id) => id !== "window.enterFullScreen");
        expect(dupes, "our identifiers are unique").toEqual([]);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0168-structure] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
