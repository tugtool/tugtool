/**
 * at0296-lens-row-is-the-handle.test.ts — a Lens row is carried by its own
 * surface, and one surface answers to two drags.
 *
 * ## What this gates
 *
 * There is no reorder grip anywhere in the Lens. A press on a row that is not
 * one of its controls arms a carry, and travel past the threshold engages it
 * (`block-reorder`). That makes the Snippets row the hard case, because its
 * incipit is ALSO a native HTML5 drag source — a snippet is dragged out into a
 * session prompt — so ONE surface has to answer to two different drags. The
 * axis is what tells them apart: the list is a column, so a vertical act is the
 * carry and a horizontal one is the drag-out.
 *
 * Three assertions, all read off the live app:
 *
 *  - **No grips.** Nothing in the Lens renders a reorder handle. Stated
 *    directly, because every other assertion here would still pass with one.
 *  - **A vertical drag reorders.** Dragging a row's own text upward past two
 *    neighbours moves it in the DOM and commits the new order to the store.
 *  - **A horizontal drag does not.** The same press, dragged sideways by more
 *    than the threshold, leaves the order exactly as it was — the gesture was
 *    handed to the drag-out rather than swallowed by the carry.
 *
 * @foreground
 * @covers tugdeck/src/components/lens/block-reorder.ts
 * @covers tugdeck/src/components/lens/sections/snippets-section.tsx
 * @covers tugdeck/src/components/lens/lens-section-band.tsx
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const LIST = ".lens-content .lens-snippets-list";
const ROWS = `${LIST} .snippet-row-content[data-snippet-id]`;
const rowSel = (id: string): string =>
  `${LIST} .snippet-row-content[data-snippet-id="${id}"] .snippet-row-label`;

const SNIPPETS = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i}`,
  text: `row-${i} snippet handle`,
}));

/** The row that gets carried — far enough down to have room above it. */
const TARGET = "s4";

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
    imposition: { kind: "one-up", lens: "right" },
    hasFocus: true,
  };
}

async function domOrder(app: App): Promise<string[]> {
  return app.evalJS<string[]>(
    `Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}))
      .map(function(el){ return el.getAttribute("data-snippet-id"); })`,
  );
}

/** The snippets document's own order, read off the file the store writes. */
function docOrder(path: string): string[] {
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    snippets: { id: string }[];
  };
  return doc.snippets.map((s) => s.id);
}

describe.skipIf(!SHOULD_RUN)("at0296 — the Lens row is the handle", () => {
  test(
    "no grips; a vertical drag carries a snippet, a horizontal one does not",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0296-"));
      const snippetsPath = join(filesDir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets: SNIPPETS }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0296-lens-row-is-the-handle",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
          // `document.hasFocus()` — which this test waits on — is tied by
          // WebKit to application activation, so this one launches
          // foreground.
          foreground: true,
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });
          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROWS)}).length === ${SNIPPETS.length}`,
            { timeoutMs: 8_000 },
          );

          // Nothing in the Lens wears a reorder handle any more — not a band,
          // not a row. Every other assertion below passes with or without one,
          // so the absence is stated on its own.
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll('.lens-content [data-slot="block-grip"], .lens-content .block-grip').length`,
            ),
          ).toBe(0);

          expect(await domOrder(app)).toEqual(SNIPPETS.map((s) => s.id));

          // (1) VERTICAL — the carry. Grab the row's own text (no handle) and
          // drag it up to the top row's upper edge.
          const top = await app.getElementBounds(rowSel("s0"));
          await app.nativeDragElement(rowSel(TARGET), {
            x: Math.round(top.x + top.width / 2),
            y: Math.round(top.y + 2),
          });
          await app.waitForCondition<boolean>(
            `(function(){
               var els = Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}));
               return els.length === ${SNIPPETS.length} &&
                 els[0].getAttribute("data-snippet-id") === ${JSON.stringify(TARGET)};
             })()`,
            { timeoutMs: 5_000 },
          );
          const carried = await domOrder(app);
          expect(carried.indexOf(TARGET)).toBeLessThan(carried.indexOf("s0"));
          // …and it is the document that moved, not just the view.
          expect(docOrder(snippetsPath)).toEqual(carried);

          // (2) HORIZONTAL — not the carry. The same grab, dragged sideways
          // well past the threshold, leaves the order untouched: that gesture
          // belongs to the incipit's drag-out into a prompt.
          const row = await app.getElementBounds(rowSel(TARGET));
          await app.nativeDragElement(rowSel(TARGET), {
            x: Math.round(row.x - 120),
            y: Math.round(row.y + row.height / 2),
          });
          expect(await domOrder(app)).toEqual(carried);
          expect(docOrder(snippetsPath)).toEqual(carried);
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
