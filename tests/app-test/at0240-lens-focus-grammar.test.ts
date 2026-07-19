/**
 * at0240-lens-focus-grammar.test.ts — the Lens focus grammar round-trip after
 * the three-list rework: Cmd-L seeds a key view onto the first section that has
 * content, Tab moves the key view between section lists, a Cmd-L toggle-out-and-
 * back restores it (the `adoptKeyCard` re-entry, watch-item #3), and Escape
 * leaves the Lens.
 *
 * An EMPTY section is not a focus stop (its list registers no `focusGroup`), so
 * the Cmd-L seed skips it. This test seeds Snippets + a recent Text File so the
 * first two content-bearing sections are Snippets then Text Files — Sessions is
 * empty (no open session cards in a seeded deck) and is correctly skipped. The
 * finer within-list behaviors (cursor on a row, Enter opening a snippet editor,
 * Escape/⌘Return closing it) are covered by at0241 and the store/data-source
 * suites.
 *
 * Scenario:
 *   1. Seed snippets + a recent, a prior card, then open/focus the Lens. The
 *      first content-bearing section (Snippets) list holds the keyboard key view.
 *   2. Tab → the key view moves to the next content section (Text Files);
 *      Snippets no longer holds it.
 *   3. Cmd-L (focus-lens) out → the prior card is active again; Cmd-L back in →
 *      the Text Files list (the last key view) re-lights (watch-item #3).
 *   4. Escape → the prior card is restored (the CANCEL_DIALOG focus-out).
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

const SNIPPETS_KBD = `.lens-content .lens-snippets-list[data-key-view-kbd]`;
const TEXT_FILES_KBD = `.lens-content .lens-text-files-list[data-key-view-kbd]`;

async function dispatch(app: App, action: string): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction(${JSON.stringify(action)})`,
  );
}

async function exists(app: App, selector: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.querySelector(${JSON.stringify(selector)}) !== null`,
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

describe.skipIf(!SHOULD_RUN)("at0240 — Lens focus grammar round-trip", () => {
  test(
    "Cmd-L seeds a section list; Tab moves it; re-entry restores it; Escape exits",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0240-"));
      const snippetsPath = join(filesDir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify(
          {
            version: 1,
            snippets: [
              { id: "s1", text: "There is a tide" },
              { id: "s2", text: "When in the Course of human events" },
            ],
          },
          null,
          2,
        )}\n`,
      );
      const recentPath = join(filesDir, "recent.md");
      writeFileSync(recentPath, "# recent\n");
      try {
        seedTugbankForLaunch(tugbankPath);
        tugbankWrite(
          tugbankPath,
          "dev.tugtool.text-card",
          "recent-documents",
          "json",
          JSON.stringify([recentPath]),
        );
        const app = await launchTugApp({
          testName: "at0240-lens-focus-grammar",
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

          // 1. Open + focus the Lens; the first content-bearing section
          //    (Snippets — Sessions is empty and skipped) takes the key view.
          await dispatch(app, "focus-lens");
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() !== "A"`,
            { timeoutMs: 3_000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // 2. Tab → the key view moves to the next content section (Text Files).
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(TEXT_FILES_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );
          expect(await exists(app, SNIPPETS_KBD)).toBe(false);

          // 2b. Tab off the LAST content section wraps back to the FIRST
          //     (Snippets) — with its keyboard ring, never landing on nothing.
          //     (An empty Sessions band between them is skipped.)
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );
          expect(await exists(app, TEXT_FILES_KBD)).toBe(false);
          // Return to Text Files so the re-entry step below restores it.
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(TEXT_FILES_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // 3. Cmd-L out → prior card active; Cmd-L back in → the last key view
          //    (Text Files) re-lights via adoptKeyCard (watch-item #3).
          await dispatch(app, "focus-lens");
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() === "A"`,
            { timeoutMs: 3_000 },
          );
          await dispatch(app, "focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(TEXT_FILES_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // 4. Escape leaves the Lens → the prior card is restored.
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() === "A"`,
            { timeoutMs: 3_000 },
          );
          expect(await app.getActiveCardId()).toBe("A");
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
