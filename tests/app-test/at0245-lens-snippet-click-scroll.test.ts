/**
 * at0245-lens-snippet-click-scroll.test.ts — two Lens Snippets invariants that
 * regressed together and were hard to see without measuring the live DOM:
 *
 *  1. **Click-to-select through a rendered-markdown incipit (Things model).**
 *     A snippet incipit renders inline markdown in a `dangerouslySetInnerHTML`
 *     span. That span used to SWALLOW the row-select click — mousedown/up landed
 *     on it and WebKit synthesized no `click` on the list cell, so clicking the
 *     incipit text never moved the selection (clicking the bare row gap did).
 *     The incipit span is now `pointer-events: none`, so the pointer reaches the
 *     drag-handle label and the click bubbles to the cell: a click SELECTS the
 *     row (moves `data-selected`) and NEVER opens it — only Return opens.
 *
 *  2. **One-scroll rail.** With enough snippets to overflow the rail, the
 *     snippets list must GROW to its full content height (no internal scrollbar)
 *     and the single `.lens-sections` stack must be the one that scrolls — the
 *     whole rail scrolls as a unit, pushing Text Files down, rather than the
 *     snippets box scrolling inside a fixed frame.
 *
 * Runs against an isolated snippets file (`TUG_SNIPPETS_PATH`).
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

describe.skipIf(!SHOULD_RUN)("at0245 — Lens snippet click-select + one-scroll", () => {
  test(
    "clicking a markdown incipit selects the row; overflow scrolls the rail as one",
    async () => {
      const tugbankPath = mkTempTugbank();
      const snippetsDir = mkdtempSync(join(tmpdir(), "tug-at0245-"));
      const snippetsPath = join(snippetsDir, "snippets.json");
      // Row 3 carries markdown so the incipit renders through the
      // `dangerouslySetInnerHTML` path (the click-swallowing span). Enough rows
      // to overflow the rail so the one-scroll assertion has real overflow.
      const snippets = Array.from({ length: 60 }, (_, i) => ({
        id: `s${i}`,
        text:
          i === 3
            ? "*emphatic* snippet number 3 — a one-line handle"
            : `snippet number ${i} — a one-line handle to fill the rail`,
      }));
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0245-lens-snippet-click-scroll",
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

          await dispatch(app, "toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-snippets-list .snippet-row-content[data-snippet-id="s3"] .snippet-row-incipit') !== null`,
            { timeoutMs: 5_000 },
          );

          // The markdown actually rendered (emphasis became an <em>), proving we
          // are exercising the `dangerouslySetInnerHTML` incipit path.
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.lens-snippets-list .snippet-row-content[data-snippet-id="s3"] .snippet-row-incipit em') !== null`,
            ),
          ).toBe(true);

          // Click squarely on the rendered-markdown incipit of row 3.
          await app.nativeClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s3"] .snippet-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-snippets-list [data-selected="true"]')?.getAttribute('data-tug-list-cell-index') === '3'`,
            { timeoutMs: 3_000 },
          );
          // A click SELECTS — it must NOT open the editor (Things model).
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.lens-snippets-list .snippet-editor') === null`,
            ),
          ).toBe(true);

          // Double-click OPENS the row's editor (the pointer equivalent of
          // Enter): the first click selects, the second activates.
          await app.nativeDoubleClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s3"] .snippet-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-snippets-list .snippet-editor') !== null`,
            { timeoutMs: 3_000 },
          );

          // One-scroll: the list grew to full content height (no internal
          // scroll), and `.lens-sections` is the single scroller.
          const scroll = await app.evalJS<{
            listScrolls: boolean;
            sectionsScrolls: boolean;
          }>(`(() => {
            const list = document.querySelector('.lens-snippets-list');
            const sections = document.querySelector('.lens-sections');
            return {
              listScrolls: list.scrollHeight > list.clientHeight + 1,
              sectionsScrolls: sections.scrollHeight > sections.clientHeight + 1,
            };
          })()`);
          expect(scroll.listScrolls).toBe(false);
          expect(scroll.sectionsScrolls).toBe(true);
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
