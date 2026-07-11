/**
 * at0217-sheet-default-ring-click-back.test.ts — clicking away from a pane
 * with an open pane-modal sheet and clicking back re-establishes the
 * sheet's default button as the key view with the keyboard ring.
 *
 * ## Why this exists
 *
 * at0203 pins click-away / click-back for card-modal dialogs (question /
 * permission): the dialog's default re-holds the ring because the chain
 * provider redirects stray in-card clicks to the dialog island as a
 * PROGRAMMATIC promotion, which yields to the finer trapped key view.
 * Pane-modal sheets sat outside that protection: the activation click's
 * pointer-marked promotion coarsened the key view out of the sheet's trap,
 * killing the seeded default button's ring ([P16]/[P20]).
 *
 * The text card's close sheet is the probe — its Save default is seeded
 * via `useSeedKeyView` (keyboard ring on from the drop). Both click-back
 * targets are pinned: the pane title bar and the sheet panel itself.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD_A = '[data-card-id="A"]';
const EDITOR_A = `${CARD_A} [data-slot="tug-text-card-editor"] .cm-content`;
const SAVE_BUTTON = '[data-testid="file-save-sheet-save"]';
const SHEET_PANEL = '[data-pane-id="p1"] [data-slot="tug-sheet"]';

function paneTitleSelectorFor(paneId: string): string {
  return `[data-pane-id="${paneId}"] [data-testid="tug-pane-title"]`;
}

const ORIGINAL = "alpha\nbeta\ngamma\n";

function mkFixture(): { dir: string; fileA: string; fileB: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0217-"));
  const fileA = path.join(dir, "a.txt");
  const fileB = path.join(dir, "b.txt");
  fs.writeFileSync(fileA, ORIGINAL, "utf8");
  fs.writeFileSync(fileB, ORIGINAL, "utf8");
  return { dir, fileA, fileB };
}

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "text", title: "File A", closable: true },
      { id: "B", componentId: "text", title: "File B", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 520 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["standard"],
      },
      {
        id: "p2",
        position: { x: 640, y: 40 },
        size: { width: 560, height: 520 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function hasAttr(app: App, selector: string, attr: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el!==null && el.hasAttribute(${JSON.stringify(attr)});})()`,
  );
}

const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));

async function launchWithDirtyCloseSheet(
  testName: string,
): Promise<{ app: App; dir: string }> {
  const { dir, fileA, fileB } = mkFixture();
  const app = await launchTugApp({ testName });
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {
      A: { content: { path: fileA, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
      B: { content: { path: fileB, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
    },
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector('${EDITOR_A}');
      return el !== null && el.innerText.indexOf("alpha") !== -1;
    })()`,
    { timeoutMs: 15000 },
  );
  const ok = await app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector('${EDITOR_A}');
      if (!el) return false;
      el.focus();
      return document.execCommand("insertText", false, "UNSAVED ");
    })()`,
  );
  if (!ok) throw new Error("[at0217] typeIntoEditor: insertText not handled");
  await settle();
  // The pane close X on the dirty card raises the close sheet.
  await app.click(`[data-pane-id="p1"] [data-testid="tug-pane-close-button"]`);
  await app.waitForCondition<boolean>(
    `document.querySelector('${SAVE_BUTTON}') !== null`,
    { timeoutMs: 15000 },
  );
  return { app, dir };
}

/** Save (the seeded default) wears the keyboard ring. */
async function awaitDefaultRing(app: App, when: string): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){var el=document.querySelector('${SAVE_BUTTON}');return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
    { timeoutMs: 4000 },
  );
  expect(
    await hasAttr(app, SAVE_BUTTON, "data-key-view-kbd"),
    `${when}: the sheet's default button holds the keyboard ring`,
  ).toBe(true);
}

async function clickAwayToB(app: App): Promise<void> {
  await app.nativeClickAtElement(paneTitleSelectorFor("p2"));
  await settle();
}

describe.skipIf(!SHOULD_RUN)(
  "AT0217: pane-modal sheet click-away / click-back restores the default ring",
  () => {
    test(
      "TITLE BAR click-back re-seeds the default button ring",
      async () => {
        const { app, dir } = await launchWithDirtyCloseSheet("at0217-title");
        try {
          await awaitDefaultRing(app, "on open");

          await clickAwayToB(app);
          await app.nativeClickAtElement(paneTitleSelectorFor("p1"));
          await settle();
          await awaitDefaultRing(app, "after title-bar click-back");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0217] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "SHEET PANEL click-back re-seeds the default button ring",
      async () => {
        const { app, dir } = await launchWithDirtyCloseSheet("at0217-panel");
        try {
          await awaitDefaultRing(app, "on open");

          await clickAwayToB(app);
          // Click the sheet panel's top edge — inside the sheet surface but
          // on no control — a bare "bring this pane back" click.
          const pt = await app.evalJS<{ x: number; y: number }>(
            `(function(){
              var el = document.querySelector('${SHEET_PANEL}');
              var r = el.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + 10 };
            })()`,
          );
          await app.nativeClick(pt);
          await settle();
          await awaitDefaultRing(app, "after sheet-panel click-back");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0217] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
