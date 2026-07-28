/**
 * at0282-lens-row-arrow-escape.test.ts — a descended list row is a position,
 * not a jail: the vertical arrows carry the keyboard down the SAME accessory in
 * the next row, and Home/End ascend and mean what they mean on the list.
 *
 * Before this, a key view descended onto a row accessory answered ArrowDown /
 * ArrowUp / Home / End with `false` — unhandled, so the key fell through to
 * WebKit and macOS beeped. The user's read of that is "the arrows lock me into
 * a row and beep."
 *
 * Drives the real Lens Snippets list (each row carries a Copy and a Delete, so
 * the ordinal is observable) with real native keystrokes. The assertion is on
 * the ENGINE key view (`data-key-view-kbd`), not on a mock: after each arrow
 * the ring must be on the expected accessory of the expected row.
 *
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/lens/sections/snippets-section.tsx
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const SNIPPETS_LIST = ".lens-content .lens-snippets-list";
const SNIPPETS_KBD = `${SNIPPETS_LIST}[data-key-view-kbd]`;

const ROWS = 5;

function priorCardDeck() {
  return {
    cards: [
      {
        id: "A",
        componentId: "gallery-accordion",
        title: "Accordion",
        closable: true,
      },
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

/**
 * The ring's current address inside the list: the accessory's own label and the
 * text of the row holding it. `null` when the ring is not on a row accessory.
 */
async function ringAddress(app: App): Promise<{ label: string; row: string } | null> {
  return app.evalJS<{ label: string; row: string } | null>(
    `(function(){
      var el = document.querySelector('[data-key-view-kbd]');
      if (el === null) return null;
      var cell = el.closest('.tug-list-view-cell');
      if (cell === null) return null;
      return {
        label: el.getAttribute("aria-label") || "",
        row: cell.textContent || "",
      };
    })()`,
  );
}

async function waitRing(
  app: App,
  label: string,
  row: string,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector('[data-key-view-kbd]');
      if (el === null) return false;
      var cell = el.closest('.tug-list-view-cell');
      if (cell === null) return false;
      return (el.getAttribute("aria-label") || "") === ${JSON.stringify(label)}
        && (cell.textContent || "").indexOf(${JSON.stringify(row)}) !== -1;
    })()`,
    { timeoutMs: 3_000 },
  );
}

describe.skipIf(!SHOULD_RUN)("at0282 — Lens row arrows never dead-end", () => {
  test(
    "vertical arrows carry the ring down a column of row accessories",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0282-"));
      const snippetsPath = join(filesDir, "snippets.json");
      const snippets = Array.from({ length: ROWS }, (_, i) => ({
        id: `s${i}`,
        text: `row-${i} snippet handle`,
      }));
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0282-lens-row-arrow-escape",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 5_000 },
          );

          // Right descends onto the row's first accessory; Right again walks to
          // the second. This is the pre-existing horizontal contract — it is
          // the starting position for what follows.
          await app.nativeKey("ArrowRight");
          await waitRing(app, "Copy snippet", "row-0");
          await app.nativeKey("ArrowRight");
          await waitRing(app, "Delete snippet", "row-0");

          // Down from inside the row: the SAME accessory, one row on. The
          // keyboard is not ejected to the container and nothing beeps.
          await app.nativeKey("ArrowDown");
          await waitRing(app, "Delete snippet", "row-1");
          await app.nativeKey("ArrowDown");
          await waitRing(app, "Delete snippet", "row-2");

          // Up walks back the same way.
          await app.nativeKey("ArrowUp");
          await waitRing(app, "Delete snippet", "row-1");

          // A ragged neighbour never refuses the move: Left back to Copy, then
          // Down keeps the ordinal it can honour.
          await app.nativeKey("ArrowLeft");
          await waitRing(app, "Copy snippet", "row-1");
          await app.nativeKey("ArrowDown");
          await waitRing(app, "Copy snippet", "row-2");

          // End is a LIST gesture from inside a row: it ascends and jumps.
          await app.nativeKey("End");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );
          expect(await ringAddress(app)).toBeNull();
          expect(
            await app.evalJS<string>(
              `(document.querySelector('${SNIPPETS_LIST} [data-key-cursor]')?.textContent || "")`,
            ),
          ).toContain(`row-${ROWS - 1}`);

          // The whole tour is keyboard-only: no raw focus write, no engine lie.
          const report = await app.evalJS<{
            violations: number;
            steals: Record<string, number>;
          } | null>(`window.__tug.getFocusInvariantReport()`);
          expect(report).not.toBeNull();
          expect(report!.violations).toBe(0);
          expect(Object.keys(report!.steals)).toEqual([]);
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
