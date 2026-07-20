/**
 * at0243-lens-focus-follows-open.test.ts — the Lens must not let keyboard focus
 * wander across an open. Keyboard-focus a Text Files row, Enter to open it
 * (focus transfers into the new card's editor — correct), then Cmd-L back into
 * the Lens: the movement cursor must land on the file you just interacted with,
 * not a lost position (issue: "focus can't wander around the Lens").
 *
 * Runs against an isolated recents MRU + real temp files.
 *
 * Scenario:
 *   1. Seed two real recent files; open + focus the Text Files list.
 *   2. Arrow onto the first recent, Enter to open it — focus lands in the new
 *      Text card's editor.
 *   3. Cmd-L back into the Lens → the Text Files list holds the key view and its
 *      movement cursor sits on the just-opened file's row.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";


import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankWrite,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const TEXT_FILES_KBD = `.lens-content .lens-text-files-list[data-key-view-kbd]`;

async function dispatch(app: App, action: string): Promise<void> {
  await app.dispatchControlAction(action);
}

function priorCardDeck() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 60, y: 60 },
        size: { width: 520, height: 420 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pA",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("at0243 — Lens focus follows the opened file", () => {
  test(
    "Cmd-L after opening a recent lands the cursor on that file's open row",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0243-"));
      const fileA = join(filesDir, "alpha.md");
      const fileB = join(filesDir, "beta.md");
      writeFileSync(fileA, "# alpha\n");
      writeFileSync(fileB, "# beta\n");
      const nameA = basename(fileA);
      try {
        seedTugbankForLaunch(tugbankPath);
        tugbankWrite(
          tugbankPath,
          "dev.tugtool.text-card",
          "recent-documents",
          "json",
          JSON.stringify([fileA, fileB]),
        );
        // Isolate snippets to an empty file so Text Files is the only
        // content-bearing section (the machine-global snippets.json must never
        // leak in and change which section the seed lands on).
        const snippetsPath = join(filesDir, "snippets.json");
        writeFileSync(
          snippetsPath,
          `${JSON.stringify({ version: 1, snippets: [] }, null, 2)}\n`,
        );
        const app = await launchTugApp({
          testName: "at0243-lens-focus-follows-open",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          // 1. Open + focus the Text Files list (Sessions + Snippets empty).
          await dispatch(app, "toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('.lens-text-files-list .text-files-row[data-recent="true"]').length === 2`,
            { timeoutMs: 5_000 },
          );
          await app.nativeClickAtElement(
            `.lens-section[data-lens-section="text-files"] [data-testid="lens-section-band"] .tool-call-header-name`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(TEXT_FILES_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // 2. Enter opens the seeded first recent (alpha); focus transfers into
          //    the new Text card's editor.
          await app.nativeKey("Return");
          await app.waitForCondition<boolean>(
            `document.activeElement !== null &&
             document.activeElement.closest('.cm-content') !== null`,
            { timeoutMs: 6_000 },
          );

          // 3. Cmd-L back into the Lens → the Text Files list re-lights (the
          //    keyboard ring restores) and its movement cursor sits on the
          //    just-opened file's open row.
          await dispatch(app, "focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(TEXT_FILES_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );
          expect(
            await app.evalJS<boolean>(
              `(() => {
                 const cell = document.querySelector('.lens-text-files-list [data-key-cursor]');
                 if (cell === null) return false;
                 const title = cell.querySelector('.tug-list-row-title');
                 return title !== null && (title.textContent ?? '').includes(${JSON.stringify(nameA)});
               })()`,
            ),
          ).toBe(true);
        } finally {
          await app.close();
        }
      } finally {
        rmSync(filesDir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
