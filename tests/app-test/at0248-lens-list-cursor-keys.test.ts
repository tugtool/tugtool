/**
 * at0248-lens-list-cursor-keys.test.ts — list movement keys through the
 * engine's key-view delegation channel.
 *
 * TugListView's movement keys (arrows, Home/End, PageUp/PageDown) now ride
 * `KeyViewBehavior.onKey` (the keyboard-as-engine-state delegation channel)
 * instead of an element keydown listener. This pins the full movement set on
 * a real Lens snippets list with the ring held by keyboard: the cursor
 * (`data-key-cursor`) must move row-by-row on arrows, jump on Home/End, and
 * page on PageDown/PageUp — proving delegated delivery end-to-end.
 *
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/lens/
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
const CURSOR = `${SNIPPETS_LIST} [data-key-cursor]`;

const ROWS = 8;

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

/**
 * Walk the keyboard from wherever ⌘L seeds it to the Snippets list. The seed
 * lands on the first expanded section that has navigable content — the Cards
 * section, since this test opens a card — so getting to Snippets is a Tab walk,
 * not an assumption. Tab is used deliberately: it is orthogonal to the arrow
 * behavior under test here.
 */
async function tabToSnippetsList(app: App): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    const there = await app.evalJS<boolean>(
      `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
    );
    if (there) return;
    await app.nativeKey("Tab");
  }
  throw new Error("the Tab walk never reached the Lens Snippets list");
}

async function cursorText(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(CURSOR)});
      return el === null ? null : (el.textContent || "");
    })()`,
  );
}

async function waitCursorText(
  app: App,
  predicate: string,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(CURSOR)});
      if (el === null) return false;
      var t = el.textContent || "";
      return (${predicate})(t);
    })()`,
    { timeoutMs: 3_000 },
  );
}

describe.skipIf(!SHOULD_RUN)("at0248 — Lens list movement keys via onKey delegation", () => {
  test(
    "arrows / Home / End / Page keys move the cursor on the ringed snippets list",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0248-"));
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
          testName: "at0248-lens-list-cursor-keys",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.dispatchControlAction("focus-lens");
          await tabToSnippetsList(app);
          // The keyboard entry seeds the cursor on the first row.
          await waitCursorText(app, `function(t){ return t.indexOf("row-0") !== -1; }`);

          // ArrowDown ×2 → row-2.
          await app.nativeKey("ArrowDown");
          await waitCursorText(app, `function(t){ return t.indexOf("row-1") !== -1; }`);
          await app.nativeKey("ArrowDown");
          await waitCursorText(app, `function(t){ return t.indexOf("row-2") !== -1; }`);

          // ArrowUp → row-1.
          await app.nativeKey("ArrowUp");
          await waitCursorText(app, `function(t){ return t.indexOf("row-1") !== -1; }`);

          // End → last row.
          await app.nativeKey("End");
          await waitCursorText(app, `function(t){ return t.indexOf("row-${ROWS - 1}") !== -1; }`);

          // Home → first row.
          await app.nativeKey("Home");
          await waitCursorText(app, `function(t){ return t.indexOf("row-0") !== -1; }`);

          // PageDown moves the cursor forward (a viewport of rows, clamped);
          // PageUp returns toward the top.
          const beforePage = await cursorText(app);
          await app.nativeKey("PageDown");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CURSOR)});
              return el !== null && (el.textContent || "") !== ${JSON.stringify(beforePage ?? "")};
            })()`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("PageUp");
          await waitCursorText(app, `function(t){ return t.indexOf("row-0") !== -1; }`);

          // The ring stayed on the list the whole tour.
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            ),
          ).toBe(true);

          // Steal budget: a pure keyboard tour involves no raw focus write,
          // so the watchdog's attributed steal ledger must stay flat — and
          // the engine never lied (zero violations).
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
