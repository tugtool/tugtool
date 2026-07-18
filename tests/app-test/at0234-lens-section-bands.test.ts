/**
 * at0234-lens-section-bands.test.ts — the always-visible Lens stack.
 *
 * The Lens has no section-visibility menu: every registered section renders,
 * always, and the pane contributes no title-bar `…` items. The stack itself
 * does not scroll — each section is a flex band whose body scrolls
 * internally — so a long Text Files recents list can never push a sibling
 * band off-screen. Recents are reachability-filtered through
 * `POST /api/fs/stat`: a stored MRU path that no longer exists on disk is
 * not listed.
 *
 * Scenario:
 *   1. Seed a long recent-documents MRU: many REAL temp files plus a few
 *      paths that do not exist.
 *   2. Open the Lens. All three section bands are present and each is fully
 *      inside the pane's viewport (nothing ran off the bottom).
 *   3. No `…` menu button renders anywhere.
 *   4. The Text Files list shows rows for the real files only — the missing
 *      paths are filtered out by the existence probe.
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
  tugbankWrite,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const REAL_FILE_COUNT = 12;
const MISSING_PATHS = [
  "/tmp/tug-at0234-gone-a.md",
  "/tmp/tug-at0234-gone-b.md",
  "/tmp/tug-at0234-gone-c.md",
];

async function dispatch(app: App, action: string): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction(${JSON.stringify(action)})`,
  );
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

describe.skipIf(!SHOULD_RUN)("at0234 — Lens section bands always visible", () => {
  test(
    "all bands on-screen with a long recents list; no … menu; missing files filtered",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0234-"));
      const realPaths: string[] = [];
      for (let i = 0; i < REAL_FILE_COUNT; i += 1) {
        const p = join(filesDir, `recent-${String(i).padStart(2, "0")}.md`);
        writeFileSync(p, `# recent ${i}\n`);
        realPaths.push(p);
      }
      try {
        seedTugbankForLaunch(tugbankPath);
        tugbankWrite(
          tugbankPath,
          "dev.tugtool.text-card",
          "recent-documents",
          "json",
          JSON.stringify([...realPaths, ...MISSING_PATHS]),
        );
        const app = await launchTugApp({
          testName: "at0234-lens-section-bands",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );

          await dispatch(app, "toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('.lens-section').length >= 3`,
            { timeoutMs: 3_000 },
          );

          // Recents rows arrive after the existence probe round-trips; the
          // reachable projection then lists exactly the real files.
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('.lens-text-files-list .text-files-row-recent').length === ${REAL_FILE_COUNT}`,
            { timeoutMs: 5_000 },
          );
          const missingListed = await app.evalJS<number>(
            `Array.from(document.querySelectorAll('.lens-text-files-list .text-files-row .text-files-name'))
               .filter((el) => el.textContent !== null && el.textContent.startsWith('tug-at0234-gone')).length`,
          );
          expect(missingListed).toBe(0);

          // Every section band sits fully inside the Lens content viewport —
          // the stack cannot scroll a band away.
          const allBandsVisible = await app.evalJS<boolean>(
            `(() => {
               const content = document.querySelector('.lens-content');
               if (content === null) return false;
               const box = content.getBoundingClientRect();
               const bands = Array.from(
                 document.querySelectorAll('.lens-section [data-testid="lens-section-band"]'),
               );
               if (bands.length < 3) return false;
               return bands.every((band) => {
                 const r = band.getBoundingClientRect();
                 return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
               });
             })()`,
          );
          expect(allBandsVisible).toBe(true);

          // The visibility menu is retired: no pane renders a … button.
          const menuButtons = await app.evalJS<number>(
            `document.querySelectorAll('[data-testid="tug-pane-title-bar-menu-button"]').length`,
          );
          expect(menuButtons).toBe(0);
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
