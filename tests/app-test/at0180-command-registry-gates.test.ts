/**
 * at0180-command-registry-gates.test.ts — the registry's join to the native
 * menu, and the gates it pushes across it.
 *
 * A registry entry names the `NSUserInterfaceItemIdentifier` of the item it
 * drives, and the host's validator reads the pushed gate block keyed by that
 * identifier. Nothing type-checks that join: the identifier is a string on
 * one side and a literal stamped at menu-build time on the other, so a
 * renamed item silently strands its command's gate and the item falls back
 * to whatever tier still happens to cover it.
 *
 * This walks the real menu bar and asserts every `menuItemId` in the table
 * resolves to a real item — the hand-maintained join, machine-checked.
 *
 * Items compiled out of this bundle are exempt by identifier, not by
 * skipping the check: the app-test bundle's profile is "apptest", so the
 * debug-only Maker card creators never exist here.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/command-registry.ts
 * @covers tugdeck/src/lib/host-menu-state.ts
 * @covers tugapp/Sources/AppDelegate.swift
 * @covers tugdeck/src/contexts/theme-provider.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import { COMMANDS } from "../../tugdeck/src/components/tugways/command-registry";
import { BASE_THEME_NAME } from "../../tugdeck/src/theme-constants";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/**
 * Identifiers whose items are compiled out of a non-debug bundle
 * (`BuildInfo.profile == "debug"` in `buildMenuBar`). They are real items in
 * the debug app and absent here; naming them is what keeps this test from
 * either failing on a correct table or going quiet about a real drift.
 */
const DEBUG_ONLY_ITEMS: ReadonlySet<string> = new Set([
  "maker.galleryCard",
  "maker.helloCard",
  "maker.newCardInPane",
]);

/**
 * Identifiers constructed inside a `menuNeedsUpdate` rebuild and only in
 * some deck states — Clear Menu exists only once Open Recent has recents to
 * clear, and this deck has none. Their join is exercised by the tests that
 * put the deck in the state that builds them.
 */
const STATE_BUILT_ITEMS: ReadonlySet<string> = new Set(["file.openRecent.clear"]);

/**
 * The live theme, read the way the page itself carries it: production
 * activates a theme by swapping the `#tug-theme-override` stylesheet link,
 * and the base theme is the absence of one.
 */
const LIVE_THEME_JS = `(function () {
  var link = document.getElementById("tug-theme-override");
  if (!link) return ${JSON.stringify(BASE_THEME_NAME)};
  return link.href.split("/").pop().replace(/\\.css.*$/, "");
})()`;

interface FlatItem {
  identifier?: string;
  keyEquivalent: string;
  modifierMask: number;
  hidden: boolean;
  /** Raw `NSControl.StateValue` — 1 = checked. */
  state: number;
}

describe.skipIf(!SHOULD_RUN)("AT0180: command registry gates", () => {
  test(
    "every menuItemId in the table resolves to a real menu item",
    async () => {
      const app = await launchTugApp({ testName: "at0180-registry-join" });
      try {
        const tree = await app.menuSnapshot();
        const flat: FlatItem[] = [];
        const walk = (items: typeof tree): void => {
          for (const it of items) {
            flat.push(it);
            if (it.submenu) walk(it.submenu);
          }
        };
        walk(tree);
        const present = new Set(
          flat
            .map((i) => i.identifier)
            .filter((id): id is string => id !== undefined),
        );

        const expected = COMMANDS.map((entry) => entry.menuItemId).filter(
          (id): id is string =>
            id !== undefined &&
            !DEBUG_ONLY_ITEMS.has(id) &&
            !STATE_BUILT_ITEMS.has(id),
        );
        // A table with no menu-driving entries would pass every assertion
        // below vacuously.
        expect(expected.length, "the table drives menu items at all").toBeGreaterThan(20);

        const missing = expected.filter((id) => !present.has(id));
        expect(missing, "every registry menuItemId names a real menu item").toEqual([]);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the Theme submenu's checkmark follows a theme change made from the web side",
    async () => {
      // The host used to read the active theme from tugbank on every menu
      // open, because the frontend changes it by paths the host never sees.
      // It now rides the push. The proof is a change made entirely web-side:
      // if the checkmark still follows it, nothing was cached and no read
      // was needed.
      const app = await launchTugApp({ testName: "at0180-theme-checkmark" });
      try {
        const checkedTheme = async (): Promise<string | undefined> => {
          const tree = await app.menuSnapshot();
          const flat: FlatItem[] = [];
          const walk = (items: typeof tree): void => {
            for (const it of items) {
              flat.push(it);
              if (it.submenu) walk(it.submenu);
            }
          };
          walk(tree);
          return flat
            .filter((i) => i.identifier?.startsWith("view.theme.") === true)
            .find((i) => i.state === 1)
            ?.identifier?.slice("view.theme.".length);
        };

        const before = await checkedTheme();
        expect(before, "some theme is checked at rest").toBe(BASE_THEME_NAME);

        await app.evalJS(`window.__tug.dispatchControlAction("next-theme", {})`);
        await app.waitForCondition<boolean>(
          `${LIVE_THEME_JS} !== ${JSON.stringify(BASE_THEME_NAME)}`,
          { timeoutMs: 8_000 },
        );
        const nowActive = await app.evalJS<string>(LIVE_THEME_JS);

        // Poll: the push is microtask-coalesced and the menu is rebuilt on
        // the next snapshot, so the move is not instantaneous.
        const deadline = Date.now() + 8_000;
        let after = await checkedTheme();
        while (after !== nowActive && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
          after = await checkedTheme();
        }
        expect(after, "the checkmark moved to the newly active theme").toBe(nowActive);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
