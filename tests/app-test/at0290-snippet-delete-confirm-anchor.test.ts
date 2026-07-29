/**
 * at0290-snippet-delete-confirm-anchor.test.ts — the delete confirm holds still.
 *
 * ## What this gates
 *
 * The Snippets row ✕ is a hover reveal, and the confirm popover it raises
 * covers the row it came from — so the pointer leaves, the ✕ unmounts, and a
 * popover anchored to that ✕ loses its anchor while it is open. It then
 * re-resolves against whatever remains and visibly HOPS, which reads as the
 * dialog dodging the cursor about to answer it.
 *
 * The anchor is therefore the ROW, which is present for exactly as long as the
 * question the popover is asking. Two assertions, both read off the live app:
 *
 *  - **It does not move.** The popover's own rect is sampled repeatedly across
 *    the window where the reveal collapses; every sample matches the first.
 *  - **It is placed over the row it names, pointing down at it.** Centered on
 *    the row's horizontal midpoint and sitting above it (`data-side="top"`) —
 *    not beside a button that may not be there. And sized by its question
 *    rather than by its anchor: a confirm reached through the controlled
 *    (anchor-to-any-element) API drops the trigger-width floor, which would
 *    otherwise stretch the box to the full width of the row.
 *
 * @covers tugdeck/src/components/lens/sections/snippets-section.tsx
 * @covers tugdeck/src/components/tugways/tug-confirm-popover.tsx
 * @covers tugdeck/src/components/tugways/tug-confirm-popover.css
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const LIST = ".lens-content .lens-snippets-list";
const POPOVER = ".tug-confirm-popover";

/** Enough rows that a row in the MIDDLE has room above and below it. */
const SNIPPETS = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`,
  text: `row-${i} snippet handle`,
}));

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

/** The popover's box, rounded to whole pixels — a hop is pixels, not subpixels. */
const POPOVER_RECT = `(function(){
  var el = document.querySelector(${JSON.stringify(POPOVER)});
  if (el === null) return null;
  var r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top),
           w: Math.round(r.width), h: Math.round(r.height) };
})()`;

describe.skipIf(!SHOULD_RUN)("at0290 — snippet delete confirm anchor", () => {
  test(
    "the confirm popover is anchored to the row and never hops",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0290-"));
      const snippetsPath = join(filesDir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets: SNIPPETS }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0290-snippet-delete-confirm-anchor",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });
          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('${LIST} .tug-list-view-cell').length >= ${SNIPPETS.length}`,
            { timeoutMs: 8_000 },
          );

          // Select the target row so its trailing accessories are revealed,
          // then click its ✕ for real — the reveal collapsing is the whole
          // mechanism under test, so a synthetic `click()` would prove nothing.
          await app.nativeClickAtElement(
            `${LIST} .snippet-row-content[data-snippet-id="${TARGET}"] .snippet-row-label`,
          );
          await app.nativeClickAtElement(
            `${LIST} .snippet-row-content[data-snippet-id="${TARGET}"] .snippet-row-delete`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('${POPOVER}') !== null`,
            { timeoutMs: 4_000 },
          );

          type Rect = { x: number; y: number; w: number; h: number };
          // Let the open finish before the baseline is taken. The popover
          // animates in, and a fractional width/height settling by a pixel is
          // not a hop — sampling against a mid-animation box would fail on
          // that instead of on the thing under test.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(POPOVER)})
               .getAnimations({ subtree: true }).length === 0`,
            { timeoutMs: 4_000 },
          );
          const first = await app.evalJS<Rect | null>(POPOVER_RECT);
          expect(first).not.toBeNull();

          // Sample across the window in which a ✕-anchored popover loses its
          // anchor and re-resolves. Each sample is its own round trip, so the
          // wait is the harness's, not a banned `setTimeout` in the page.
          for (let i = 0; i < 8; i += 1) {
            await app.waitForCondition<boolean>(
              `document.querySelector('${POPOVER}') !== null`,
              { timeoutMs: 2_000 },
            );
            const sample = await app.evalJS<Rect | null>(POPOVER_RECT);
            // Within a pixel: the box's height resolves fractionally and its
            // rounding settles late, which moves a `side="top"` popover's top
            // edge by one device pixel. The hop this gates is a RE-ANCHOR —
            // tens of pixels, to beside a control that just unmounted.
            expect(Math.abs(sample!.x - first!.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(sample!.y - first!.y)).toBeLessThanOrEqual(1);
            expect(Math.abs(sample!.w - first!.w)).toBeLessThanOrEqual(1);
            expect(Math.abs(sample!.h - first!.h)).toBeLessThanOrEqual(1);
          }

          // Placed over the row it names: centered on the row and above it.
          const placement = await app.evalJS<{
            side: string | null;
            rowCenter: number;
            popCenter: number;
            popBottom: number;
            rowTop: number;
          }>(
            `(function(){
               var row = document.querySelector(
                 '${LIST} .snippet-row-content[data-snippet-id="${TARGET}"]'
               ).closest('.tug-list-view-cell');
               var pop = document.querySelector(${JSON.stringify(POPOVER)});
               var rr = row.getBoundingClientRect(), pr = pop.getBoundingClientRect();
               return {
                 side: pop.closest('[data-side]')
                   ? pop.closest('[data-side]').getAttribute('data-side')
                   : pop.getAttribute('data-side'),
                 rowCenter: rr.left + rr.width / 2,
                 popCenter: pr.left + pr.width / 2,
                 popBottom: pr.bottom,
                 rowTop: rr.top
               };
             })()`,
          );
          expect(placement.side).toBe("top");
          // Centered on the row — a couple of pixels of shift-into-view slack.
          expect(Math.abs(placement.popCenter - placement.rowCenter)).toBeLessThan(4);
          // Sitting above the row, so its arrow points down at it.
          expect(placement.popBottom).toBeLessThanOrEqual(placement.rowTop + 1);

          // Not the ✕: that button lives at the row's trailing edge, so a
          // button-anchored popover centers nowhere near the row's middle.
          // This is the assertion that fails if the anchor regresses — the
          // stability sampling above cannot carry it alone, because the
          // harness leaves the clicked row SELECTED and a selected row keeps
          // its accessories revealed, so the collapse that produces the hop
          // does not occur here.
          const closeCenter = await app.evalJS<number>(
            `(function(){
               var b = document.querySelector(
                 '${LIST} .snippet-row-content[data-snippet-id="${TARGET}"] .snippet-row-delete');
               var r = b.getBoundingClientRect();
               return r.left + r.width / 2;
             })()`,
          );
          expect(Math.abs(placement.popCenter - closeCenter)).toBeGreaterThan(40);

          // The box is sized by its question, not by the row it is anchored to.
          expect(first!.w).toBeLessThan(
            await app.evalJS<number>(
              `Math.round(document.querySelector(
                 '${LIST} .snippet-row-content[data-snippet-id="${TARGET}"]'
               ).closest('.tug-list-view-cell').getBoundingClientRect().width)`,
            ),
          );

          await app.nativeKey("Escape", []);
          await app.waitForCondition<boolean>(
            `document.querySelector('${POPOVER}') === null`,
            { timeoutMs: 4_000 },
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
