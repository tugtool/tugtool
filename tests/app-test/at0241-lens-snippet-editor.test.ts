/**
 * at0241-lens-snippet-editor.test.ts — the Lens snippet editor round-trip on
 * the CM6 substrate: Enter on the cursor row opens the in-place editor
 * (descend into the row's focusable wrapper, DOM focus forwarded into the
 * CM6 caret), typing lands in the document, and Escape ascends back to the
 * list with the edit committed (blur-commit).
 *
 * Also covers the band-click focus route: clicking the Snippets band lands
 * the keyboard key view on the snippets list.
 *
 * Runs against an isolated snippets file (`TUG_SNIPPETS_PATH`) so the user's
 * machine-global snippets.json is never touched.
 *
 * Scenario:
 *   1. Seed one snippet; open the Lens; click the Snippets band — the
 *      snippets list takes the keyboard key view.
 *   2. Enter → the row's editor mounts and the CM6 content holds DOM focus.
 *   3. Type — the text lands in the editor document.
 *   4. Escape → the editor closes, the list regains the key view, and the
 *      committed row shows the updated incipit.
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

const SNIPPETS_KBD = `.lens-content .lens-snippets-list[data-key-view-kbd]`;
const EDITOR = `.lens-snippets-list .snippet-editor`;

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

describe.skipIf(!SHOULD_RUN)("at0241 — Lens snippet editor round-trip", () => {
  test(
    "band-click focuses the list; Enter opens the CM6 editor; Escape commits back",
    async () => {
      const tugbankPath = mkTempTugbank();
      const snippetsDir = mkdtempSync(join(tmpdir(), "tug-at0241-"));
      const snippetsPath = join(snippetsDir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify(
          { version: 1, snippets: [{ id: "s1", text: "There is a tide" }] },
          null,
          2,
        )}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0241-lens-snippet-editor",
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

          // 1. Open the Lens; the seeded snippet row renders; click the
          //    Snippets band → the snippets list takes the keyboard key view.
          await dispatch(app, "toggle-lens");
          await app.waitForCondition<boolean>(
            `Array.from(document.querySelectorAll('.snippet-row-label'))
               .some((el) => el.textContent === 'There is a tide')`,
            { timeoutMs: 5_000 },
          );
          await app.nativeClickAtElement(
            `.lens-section[data-lens-section="snippets"] [data-testid="lens-section-band"] .tool-call-header-name`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // 2. Enter on the cursor row → the editor mounts and the CM6
          //    content receives DOM focus (the wrapper forwards it).
          await app.nativeKey("Return");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(EDITOR)}) !== null`,
            { timeoutMs: 3_000 },
          );
          await app.waitForCondition<boolean>(
            `document.activeElement !== null &&
             document.activeElement.closest(${JSON.stringify(EDITOR)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // 3. Type at the caret — the keystrokes land in the CM6 document.
          await app.nativeType(" in the affairs");
          await app.waitForCondition<boolean>(
            `(() => {
               const content = document.querySelector('${EDITOR} .cm-content');
               return content !== null &&
                 (content.textContent ?? '').includes('in the affairs');
             })()`,
            { timeoutMs: 3_000 },
          );

          // 4. Escape → ascend to the list (key view back on the container),
          //    editor unmounts, and the committed incipit reflects the edit.
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(EDITOR)}) === null`,
            { timeoutMs: 3_000 },
          );
          expect(await exists(app, SNIPPETS_KBD)).toBe(true);
          await app.waitForCondition<boolean>(
            `Array.from(document.querySelectorAll('.snippet-row-label'))
               .some((el) => (el.textContent ?? '').includes('in the affairs'))`,
            { timeoutMs: 3_000 },
          );
        } finally {
          await app.close();
        }
      } finally {
        rmSync(snippetsDir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
