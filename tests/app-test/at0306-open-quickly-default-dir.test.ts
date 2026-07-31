/**
 * at0306-open-quickly-default-dir.test.ts — Open Quickly with nothing open
 * falls back to the default project directory ([AT0306]).
 *
 * Scenario:
 *
 *   Point `dev.tugtool.app / default-project-path` at a temp directory holding
 *   known files, then — with an empty deck and no session binding anywhere —
 *   send the `open-quickly` control the ⇧⌘O menu item dispatches. The popup
 *   must name that directory in its placeholder, list its files as the query
 *   narrows, and open the committed one in a fresh Text card.
 *
 *   This is the end-to-end proof of the whole fallback path: the frontend
 *   resolves the setting, `POST /api/workspace/acquire` registers the
 *   directory as a browse hold on tugcast's WorkspaceRegistry, the FILETREE
 *   feed routes queries by that workspace's root, and `openFileInCard` creates
 *   a card on a deck that has none. at0213 covers the same popup with no
 *   workspace at all; this one covers it with a workspace nothing bound.
 *
 *   A second test drives the in-bar directory switcher: with the default
 *   directory and a recent project both on offer, picking the recent one must
 *   swap the search root — and the popup must survive its own menu opening,
 *   which portals outside the panel and so looks like focus leaving.
 *
 *   A third covers what the bar owes the user about the places it offers: two
 *   spellings of one directory are one entry, two different directories that
 *   share a leaf name are told apart, and an empty directory says so instead
 *   of showing a blank panel.
 *
 *   A fourth drives the switcher with REAL key events, asserting against the
 *   ENGINE's marks rather than `document.activeElement`: Tab moves the ring
 *   from the field to the switcher, Space opens its menu, arrows move the
 *   highlight, Return commits, and Tab returns the ring to the field with the
 *   keyboard really in it. Real keys and engine marks because every failure
 *   here was invisible to synthetic events watching DOM focus — macOS omits
 *   buttons from the native Tab order, and an engine-routed stop parks the
 *   key sink rather than holding focus itself.
 *
 * Gating
 * ------
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs without
 * `TUGAPP_APP_TEST=1` skip every test.
 *
 * @covers tugdeck/src/components/chrome/open-quickly-overlay.tsx
 * @covers tugdeck/src/lib/default-workspace-store.ts
 * @covers tugdeck/src/lib/host-menu-state.ts
 * @covers tugdeck/src/lib/open-file-in-card.ts
 * @covers tugdeck/src/components/tugways/tug-completion-popup.tsx
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const POPUP = '[data-slot="tug-completion-popup"]';
const INPUT = ".tug-completion-popup .tug-completion-popup-input";
const ROWS = '[data-slot="tug-completion-popup-list"] .tug-completion-popup-row';
const OVERLAY_ROOT = '[data-slot="tug-canvas-overlay-root"]';

/** The marker file the query narrows to — distinctive enough to be the only hit. */
const MARKER = "at0306-marker.txt";

/** The switcher's trigger, its portalled menu, and that menu's items. */
const SWITCHER = '[data-slot="tug-completion-popup-accessory"] button';
const SWITCHER_MENU = '[data-testid="open-quickly-switcher-menu"]';
const SWITCHER_ITEMS = `${SWITCHER_MENU} .tug-menu-item`;

/** The marker file in the *second* directory, reached through the switcher. */
const OTHER_MARKER = "at0306-elsewhere.txt";

/** Set the input's value the way a React controlled input accepts it. */
async function typeIntoField(app: App, text: string): Promise<void> {
  await app.evalJS<null>(
    `(function(){
       var input = document.querySelector(${JSON.stringify(INPUT)});
       var setter = Object.getOwnPropertyDescriptor(
         window.HTMLInputElement.prototype, "value").set;
       setter.call(input, ${JSON.stringify(text)});
       input.dispatchEvent(new Event("input", { bubbles: true }));
       return null;
     })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0306: Open Quickly falls back to the default project directory",
  () => {
    test(
      "with zero cards open, ⇧⌘O searches the default directory and opens a file",
      async () => {
        const dir = mkdtempSync(`${tmpdir()}/at0306-projects-`);
        const leaf = dir.split("/").pop() ?? "";
        mkdirSync(`${dir}/nested`, { recursive: true });
        writeFileSync(`${dir}/${MARKER}`, "hello from the default directory\n");
        writeFileSync(`${dir}/nested/other.txt`, "unrelated\n");

        const app = await launchTugApp({
          testName: "at0306-open-quickly-default-dir",
        });
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(OVERLAY_ROOT)}) !== null`,
            { timeoutMs: 20000 },
          );

          // The deck is empty and nothing is bound — the state that used to
          // grey the menu item out.
          expect(
            await app.evalJS<number>(
              `window.tugdeck.diag.getDeckState().cards.length`,
            ),
          ).toBe(0);

          // …and File ▸ Open Quickly is enabled anyway. This is the gate that
          // used to read `frontmostProjectBinding()?.projectDir`.
          const menuItem = await app.menuItemState("file.openQuickly");
          expect(menuItem.found).toBe(true);
          expect(menuItem.found && menuItem.enabled).toBe(true);

          await app.evalJS<null>(
            `(window.__tug.setTugbankValue("dev.tugtool.app", "default-project-path", { kind: "string", value: ${JSON.stringify(dir)} }), null)`,
          );

          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("open-quickly"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
            { timeoutMs: 8000 },
          );

          // The placeholder names the fallback root's leaf directory.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(INPUT)})
               .getAttribute("placeholder") === ${JSON.stringify(`Open Quickly in ${leaf}`)}`,
            { timeoutMs: 8000 },
          );

          // The acquisition + index round trip lands and the marker shows up.
          await typeIntoField(app, "at0306-marker");
          await app.waitForCondition<boolean>(
            `Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}))
               .some((el) => (el.textContent || "").indexOf(${JSON.stringify(MARKER)}) !== -1)`,
            { timeoutMs: 15000 },
          );

          // Enter commits the highlighted row, which opens a Text card on a
          // deck that had none.
          await app.evalJS<null>(
            `(function(){
               document.querySelector(${JSON.stringify(INPUT)}).dispatchEvent(
                 new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
               return null;
             })()`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(POPUP)}) === null`,
            { timeoutMs: 8000 },
          );
          await app.waitForCondition<boolean>(
            `window.tugdeck.diag.getDeckState().cards.filter(
               (c) => c.componentId === "text").length === 1`,
            { timeoutMs: 15000 },
          );

          // The card is bound to the file the row named. Asserting the bound
          // path (not the card title, which is the registration's) pins the
          // whole chain: FILETREE answered a project-relative result, the
          // overlay resolved it against the acquired workspace's root, and
          // the Text card mounted on that absolute path. macOS canonicalizes
          // the temp dir (`/var` → `/private/var`), so the tail is what's
          // stable to compare.
          const boundPath = await app.waitForCondition<string>(
            `(function(){
               var card = window.tugdeck.diag.getDeckState().cards.find(
                 (c) => c.componentId === "text");
               if (card === undefined) return false;
               var state = window.tugdeck.diag.getCardState(card.id);
               var path = state && state.content ? state.content.path : null;
               return typeof path === "string" && path !== "" ? path : false;
             })()`,
            { timeoutMs: 15000 },
          );
          expect(boundPath.endsWith(`/${leaf}/${MARKER}`)).toBe(true);
        } finally {
          await app.close();
          rmSync(dir, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "the in-bar switcher retargets the search to another directory",
      async () => {
        // Two directories with disjoint contents: the default, and a recent
        // project. The switcher offers both, so picking the second must swap
        // the search root — placeholder, result list, and all.
        const dir = mkdtempSync(`${tmpdir()}/at0306-default-`);
        const other = mkdtempSync(`${tmpdir()}/at0306-other-`);
        const otherLeaf = other.split("/").pop() ?? "";
        writeFileSync(`${dir}/${MARKER}`, "in the default directory\n");
        writeFileSync(`${other}/${OTHER_MARKER}`, "somewhere else\n");

        const app = await launchTugApp({
          testName: "at0306-open-quickly-switcher",
        });
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(OVERLAY_ROOT)}) !== null`,
            { timeoutMs: 20000 },
          );
          await app.evalJS<null>(
            `(window.__tug.setTugbankValue("dev.tugtool.app", "default-project-path", { kind: "string", value: ${JSON.stringify(dir)} }),
              window.__tug.setTugbankValue("dev.tugtool.dev", "recent-projects", { kind: "json", value: { paths: [${JSON.stringify(other)}] } }),
              null)`,
          );

          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("open-quickly"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SWITCHER)}) !== null`,
            { timeoutMs: 8000 },
          );

          // The accessory sits inside the panel, after the field — so Tab
          // reaches it without any hand-rolled focus management, and focus
          // landing on it is not "focus left the popup".
          expect(
            await app.evalJS<boolean>(
              `(function(){
                 var panel = document.querySelector('[data-slot="tug-completion-popup"]');
                 var input = document.querySelector(${JSON.stringify(INPUT)});
                 var acc = document.querySelector('[data-slot="tug-completion-popup-accessory"]');
                 return panel !== null && acc !== null && panel.contains(acc) &&
                   (input.compareDocumentPosition(acc) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
               })()`,
            ),
          ).toBe(true);

          // Open the switcher. The popup must NOT dismiss while its menu is
          // up, even though focus moves into a menu portalled outside the
          // panel — that is what the dismiss guard is for.
          await app.click(SWITCHER);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SWITCHER_MENU)}) !== null`,
            { timeoutMs: 8000 },
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
            ),
          ).toBe(true);

          // Pick the recent project.
          await app.evalJS<null>(
            `(function(){
               var rows = Array.from(document.querySelectorAll(${JSON.stringify(SWITCHER_ITEMS)}));
               var row = rows.find((el) => (el.textContent || "").trim() === ${JSON.stringify(otherLeaf)});
               if (!row) throw new Error("switcher item not found: " + rows.map((e) => e.textContent).join(","));
               row.click();
               return null;
             })()`,
          );

          // The bar renames itself to the picked directory…
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(INPUT)})
               .getAttribute("placeholder") === ${JSON.stringify(`Open Quickly in ${otherLeaf}`)}`,
            { timeoutMs: 8000 },
          );

          // …and the results come from it, not from the default directory.
          await typeIntoField(app, "at0306-");
          await app.waitForCondition<boolean>(
            `(function(){
               var rows = Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}))
                 .map((el) => el.textContent || "");
               return rows.length > 0 &&
                 rows.some((t) => t.indexOf(${JSON.stringify(OTHER_MARKER)}) !== -1) &&
                 !rows.some((t) => t.indexOf(${JSON.stringify(MARKER)}) !== -1);
             })()`,
            { timeoutMs: 15000 },
          );

          // Escape still dismisses — the guard holds the popup open for the
          // menu, it never takes Escape away from the user.
          await app.evalJS<null>(
            `(function(){
               document.querySelector(${JSON.stringify(INPUT)}).dispatchEvent(
                 new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
               return null;
             })()`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(POPUP)}) === null`,
            { timeoutMs: 8000 },
          );
        } finally {
          await app.close();
          rmSync(dir, { recursive: true, force: true });
          rmSync(other, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "the switcher names each place once, and an empty directory says so",
      async () => {
        // Three recents that exercise the two ways a menu of leaf names lies:
        // `b/proj` is a symlink to `a/proj` — one directory, two spellings,
        // and only the server can tell; `c/proj` is a different directory
        // that happens to share the leaf. The default directory is empty.
        const base = mkdtempSync(`${tmpdir()}/at0306-places-`);
        mkdirSync(`${base}/tug`);
        mkdirSync(`${base}/a/proj`, { recursive: true });
        writeFileSync(`${base}/a/proj/alpha.txt`, "x\n");
        mkdirSync(`${base}/b`);
        symlinkSync(`${base}/a/proj`, `${base}/b/proj`);
        mkdirSync(`${base}/c/proj`, { recursive: true });

        const app = await launchTugApp({
          testName: "at0306-open-quickly-places",
        });
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(OVERLAY_ROOT)}) !== null`,
            { timeoutMs: 20000 },
          );
          await app.evalJS<null>(
            `(window.__tug.setTugbankValue("dev.tugtool.app", "default-project-path", { kind: "string", value: ${JSON.stringify(`${base}/tug`)} }),
              window.__tug.setTugbankValue("dev.tugtool.dev", "recent-projects", { kind: "json", value: { paths: [
                ${JSON.stringify(`${base}/a/proj`)},
                ${JSON.stringify(`${base}/b/proj`)},
                ${JSON.stringify(`${base}/c/proj`)}
              ] } }), null)`,
          );

          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("open-quickly"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SWITCHER)}) !== null`,
            { timeoutMs: 8000 },
          );

          // The default directory is empty — say so rather than showing a
          // blank panel that reads as a hang.
          await app.waitForCondition<boolean>(
            `(document.querySelector('[data-slot="tug-completion-popup-empty"]')
               || {}).textContent === "No files in tug"`,
            { timeoutMs: 15000 },
          );

          await app.click(SWITCHER);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SWITCHER_MENU)}) !== null`,
            { timeoutMs: 8000 },
          );
          const items = JSON.parse(
            await app.evalJS<string>(
              `JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(SWITCHER_ITEMS)}))
                 .map(function (el) { return (el.textContent || "").trim(); }))`,
            ),
          ) as string[];

          // The symlink collapsed into its target: three recents, two places.
          // The two real `proj` directories are told apart by their parents.
          expect(items).toEqual(["tug", "a/proj", "c/proj"]);
        } finally {
          await app.close();
          rmSync(base, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "the switcher is reachable and operable from the keyboard alone",
      async () => {
        // Driven with REAL key events and asserted against the ENGINE's own
        // marks, because every failure this pins was invisible otherwise. The
        // popup's two stops are authored into one focus group
        // (`focus-language.md`, Authoring contract): the field is a text
        // surface the engine grants real DOM focus, the switcher is
        // engine-routed so the engine parks its key sink while the ring rests
        // there. Watching `activeElement` alone would call that park "focus
        // left the popup" — which is exactly the bug that made Tab dismiss it.
        const base = mkdtempSync(`${tmpdir()}/at0306-keys-`);
        mkdirSync(`${base}/tug`);
        writeFileSync(`${base}/tug/${MARKER}`, "in the default\n");
        mkdirSync(`${base}/other`);
        writeFileSync(`${base}/other/${OTHER_MARKER}`, "elsewhere\n");

        const app = await launchTugApp({ testName: "at0306-open-quickly-keys" });
        /** The `data-slot` of whatever currently wears the keyboard ring. */
        const ring = `(function () {
          var el = document.querySelector("[data-key-view-kbd]");
          return el === null ? "(none)" : (el.getAttribute("data-slot") || el.tagName);
        })()`;
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(OVERLAY_ROOT)}) !== null`,
            { timeoutMs: 20000 },
          );
          await app.evalJS<null>(
            `(window.__tug.setTugbankValue("dev.tugtool.app", "default-project-path", { kind: "string", value: ${JSON.stringify(`${base}/tug`)} }),
              window.__tug.setTugbankValue("dev.tugtool.dev", "recent-projects", { kind: "json", value: { paths: [${JSON.stringify(`${base}/other`)}] } }),
              null)`,
          );
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("open-quickly"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SWITCHER)}) !== null`,
            { timeoutMs: 10000 },
          );

          // The popup seeds the key view onto its field, and the field being a
          // text surface means the engine grants it real DOM focus.
          await app.waitForCondition<boolean>(`${ring} === "tug-input"`, {
            timeoutMs: 8000,
          });
          expect(
            await app.evalJS<boolean>(
              `document.activeElement === document.querySelector(${JSON.stringify(INPUT)})`,
            ),
          ).toBe(true);

          // Tab advances the engine's walk to the switcher. The popup must
          // survive the park that comes with an engine-routed stop.
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(`${ring} === "tug-button"`, {
            timeoutMs: 8000,
          });
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
            ),
          ).toBe(true);

          // Space opens the menu, and the menu is LIVE to the keyboard: the
          // engine must not synthesize the act onto the trigger underneath it,
          // or Return re-toggles the trigger instead of picking a row.
          await app.nativeKey(" ");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SWITCHER_MENU)}) !== null`,
            { timeoutMs: 8000 },
          );
          const highlighted = `(function () {
            var el = document.querySelector(${JSON.stringify(SWITCHER_MENU)} + " .tug-menu-item[data-highlighted]");
            return el === null ? "(none)" : (el.textContent || "").trim();
          })()`;
          await app.waitForCondition<boolean>(`${highlighted} === "tug"`, {
            timeoutMs: 8000,
          });
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(`${highlighted} === "other"`, {
            timeoutMs: 8000,
          });

          // Return commits the highlighted row: the root swaps.
          await app.nativeKey("Enter");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(INPUT)})
               .getAttribute("placeholder") === "Open Quickly in other"`,
            { timeoutMs: 10000 },
          );

          // Tab returns the ring to the field, which gets real DOM focus back
          // — and it really is the keyboard: typing narrows the new root.
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(`${ring} === "tug-input"`, {
            timeoutMs: 8000,
          });
          await typeIntoField(app, "at0306-");
          await app.waitForCondition<boolean>(
            `(function () {
               var rows = Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}))
                 .map(function (el) { return el.textContent || ""; });
               return rows.length > 0 &&
                 rows.some(function (t) { return t.indexOf(${JSON.stringify(OTHER_MARKER)}) !== -1; });
             })()`,
            { timeoutMs: 15000 },
          );
        } finally {
          await app.close();
          rmSync(base, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
