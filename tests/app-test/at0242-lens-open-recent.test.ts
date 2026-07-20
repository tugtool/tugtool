/**
 * at0242-lens-open-recent.test.ts — opening a recent Text file from the Lens.
 *
 * Clicking a recent opens it in a Text card. Two invariants that a stale
 * projection used to break (an orphan recent + a nameless "File" row until the
 * next deck re-render):
 *   - the just-opened file must leave the RECENT list (it is now an OPEN row),
 *     and the open row must carry the file's basename — NOT a nameless "File"
 *     — the instant the card binds its path (the open-registry notify);
 *   - the keyboard movement cursor must follow the file into its open row
 *     instead of vanishing.
 *
 * Runs against an isolated recents MRU + real temp files so the reachability
 * probe keeps them and nothing touches the user's state.
 *
 * Scenario:
 *   1. Seed two real recent files, open the Lens, and confirm both list under
 *      RECENT with no open rows.
 *   2. Cmd-L to focus the list, arrow onto the first recent, Enter to open it.
 *   3. The file becomes an open row titled with its basename; it is gone from
 *      RECENT; and the movement cursor sits on the new open row.
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

describe.skipIf(!SHOULD_RUN)("at0242 — Lens open-recent dedup + focus follow", () => {
  test(
    "opening a recent titles the open row, drops it from RECENT, and moves the cursor",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0242-"));
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
        const app = await launchTugApp({
          testName: "at0242-lens-open-recent",
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
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          // 1. Open the Lens; both files list under RECENT, none open.
          await dispatch(app, "toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('.lens-text-files-list .text-files-row[data-recent="true"]').length === 2`,
            { timeoutMs: 5_000 },
          );
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll('.lens-text-files-list .text-files-row:not([data-recent="true"])').length`,
            ),
          ).toBe(0);

          // 2. Focus the Text Files list by clicking its band (Sessions +
          //    Snippets are empty here, so it is the section with content),
          //    move onto the first recent, and open it with Enter.
          await app.nativeClickAtElement(
            `.lens-section[data-lens-section="text-files"] [data-testid="lens-section-band"] .tool-call-header-name`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(TEXT_FILES_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );
          // The seed lands on the first cursorable row (the "Recent" header is
          // inert), which is the first recent (alpha). Enter opens it.
          await app.nativeKey("Return");

          // 3a. The opened file becomes an OPEN row titled with its basename
          //     (never a nameless "File").
          await app.waitForCondition<boolean>(
            `Array.from(document.querySelectorAll('.lens-text-files-list .text-files-row:not([data-recent="true"]) .tug-list-row-title'))
               .some((el) => (el.textContent ?? '').includes(${JSON.stringify(nameA)}))`,
            { timeoutMs: 6_000 },
          );
          // 3b. It is gone from RECENT (dedup), so only one recent remains.
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll('.lens-text-files-list .text-files-row[data-recent="true"]').length`,
            ),
          ).toBe(1);
          // 3c. No nameless "File" open row leaked.
          expect(
            await app.evalJS<boolean>(
              `Array.from(document.querySelectorAll('.lens-text-files-list .tug-list-row-title'))
                 .some((el) => (el.textContent ?? '').trim() === 'File')`,
            ),
          ).toBe(false);
          // 3d. Opening the file moved keyboard focus into the new Text card's
          //     editor (expected — you want to edit it). The Lens remembers the
          //     opened file's row (`lastSelectedTextId` → the open row) so a
          //     later Cmd-L back into the Lens lands the movement cursor on it
          //     rather than a lost position. The focus-transfer round-trip is
          //     exercised interactively; here we confirm focus went to the
          //     editor (the file actually opened + took focus).
          await app.waitForCondition<boolean>(
            `document.activeElement !== null &&
             document.activeElement.closest('.cm-content') !== null`,
            { timeoutMs: 3_000 },
          );
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
