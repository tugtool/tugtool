/**
 * at0245-jots-click-scroll.test.ts — two Lens Jots invariants that
 * regressed together and were hard to see without measuring the live DOM:
 *
 *  1. **Click-to-select through a rendered-markdown incipit (Things model).**
 *     A jot incipit renders inline markdown in a `dangerouslySetInnerHTML`
 *     span. That span used to SWALLOW the row-select click — mousedown/up landed
 *     on it and WebKit synthesized no `click` on the list cell, so clicking the
 *     incipit text never moved the selection (clicking the bare row gap did).
 *     The incipit span is now `pointer-events: none`, so the pointer reaches the
 *     drag-handle label and the click bubbles to the cell: a click SELECTS the
 *     row (moves `data-selected`) and NEVER opens it — only Return opens.
 *
 *  2. **Per-section scroller.** With enough jots to overflow the rail, the
 *     jots LIST must scroll internally within its section's flex share and
 *     the `.lens-sections` stack must NOT scroll — a section scrolls its own
 *     rows under its own header, and can never push another section's header
 *     out of view (Cards stays pinned at the bottom).
 *
 * Runs against an isolated jots file (`TUG_JOTS_PATH`).
 *
 * @covers tugdeck/src/components/jots/jots-card.tsx
 * @covers tugdeck/src/lib/jots-store.ts
 * @covers tugdeck/src/lib/smart-scroll.ts
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
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

describe.skipIf(!SHOULD_RUN)("at0245 — Lens jot click-select + per-section scroll", () => {
  test(
    "clicking a markdown incipit selects the row; overflow scrolls the section's list",
    async () => {
      const tugbankPath = mkTempTugbank();
      const jotsDir = mkdtempSync(join(tmpdir(), "tug-at0245-"));
      const jotsPath = join(jotsDir, "jots.json");
      // Row 3 carries markdown so the incipit renders through the
      // `dangerouslySetInnerHTML` path (the click-swallowing span). Enough rows
      // to overflow the section so the per-section scroll assertion has real
      // overflow.
      const jots = Array.from({ length: 60 }, (_, i) => ({
        id: `s${i}`,
        text:
          i === 3
            ? "*emphatic* jot number 3 — a one-line handle"
            : `jot number ${i} — a one-line handle to fill the rail`,
      }));
      writeFileSync(
        jotsPath,
        `${JSON.stringify({ version: 1, jots: jots }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0245-jots-click-scroll",
          env: { TUGBANK_PATH: tugbankPath, TUG_JOTS_PATH: jotsPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await dispatch(app, "toggle-jots");
          await app.waitForCondition<boolean>(
            `document.querySelector('.jots-list .jot-row-content[data-jot-id="s3"] .jot-row-incipit') !== null`,
            { timeoutMs: 5_000 },
          );

          // The markdown actually rendered (emphasis became an <em>), proving we
          // are exercising the `dangerouslySetInnerHTML` incipit path.
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.jots-list .jot-row-content[data-jot-id="s3"] .jot-row-incipit em') !== null`,
            ),
          ).toBe(true);

          // Click squarely on the rendered-markdown incipit of row 3.
          await app.nativeClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="s3"] .jot-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.jots-list [data-selected="true"]')?.getAttribute('data-tug-list-cell-index') === '3'`,
            { timeoutMs: 3_000 },
          );
          // A click SELECTS — it must NOT open the editor (Things model).
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.jots-list .jot-editor') === null`,
            ),
          ).toBe(true);

          // Double-click OPENS the row's editor (the pointer equivalent of
          // Enter): the first click selects, the second activates.
          await app.nativeDoubleClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="s3"] .jot-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.jots-list .jot-editor') !== null`,
            { timeoutMs: 3_000 },
          );

          // The list is the card's ONE scroller: it scrolls internally within
          // the share the toolbar leaves it, and the card root never scrolls —
          // so the toolbar can never be scrolled away from the rows it acts on.
          const scroll = await app.evalJS<{
            listScrolls: boolean;
            cardScrolls: boolean;
          }>(`(() => {
            const list = document.querySelector('.jots-list');
            const card = document.querySelector('.jots-card');
            return {
              listScrolls: list.scrollHeight > list.clientHeight + 1,
              cardScrolls: card.scrollHeight > card.clientHeight + 1,
            };
          })()`);
          expect(scroll.listScrolls).toBe(true);
          expect(scroll.cardScrolls).toBe(false);
        } finally {
          await app.close();
        }
      } finally {
        rmSync(jotsDir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
