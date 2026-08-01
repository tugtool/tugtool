/**
 * at0283-list-row-striping.test.ts — alternating row tint bands the DATA, and
 * the list governs its own text measure.
 *
 * ## What this gates
 *
 * Two `TugListView` presentation contracts, on the real Lens lists that use
 * them (Snippets and Cards, both configured from
 * `lens-list-presentation.ts`):
 *
 *  - **The band follows the row's absolute index, not its position in the
 *    rendered window.** `:nth-child` is the obvious way to write a zebra rule
 *    and it is wrong here: `TugListView` windows, so child order is not row
 *    order, and the bands would crawl as the window slides under a scroll. The
 *    primitive publishes `data-row-parity` from the data index instead. Pinned
 *    by asserting every rendered cell's parity against its own
 *    `data-tug-list-cell-index` — which is what fails if the attribute is ever
 *    dropped and the CSS falls back to child order. (The list here renders all
 *    its rows, so this pins the SOURCE of the parity, not a scrolled window.)
 *  - **Both parities paint, and differently.** Washing only every other row and
 *    leaving the rest on the host surface puts ONE step between neighbours,
 *    which the eye resolves only when it repeats — a long list looks banded
 *    while a two-row list looks like two identical rows. This is the assertion
 *    that a two-row Lens section depends on.
 *  - **A row that PAINTS a selection fill drops its band.** The fill is
 *    translucent; a band beneath it would tint it, so the same selection would
 *    paint two different colors depending on which row the user landed on. The
 *    condition is the fill and not the selected-ness: a list that tracks a
 *    selected index it never renders would otherwise show a hole in its
 *    banding, which is why this waits for the ROW's `data-selected` before it
 *    reads the background.
 *  - **One measure per list.** `rowTextSize` outranks each `TugLabel`'s own
 *    `size`, so every row in the list reads at the list's size — asserted
 *    against the list's own token rather than a literal, so tuning the measure
 *    does not fail the test. What is pinned is that the LIST governs.
 *  - **Line or band, never both.** A striped list draws no hairlines.
 *
 * The assertions are all read off the live app's computed styles and engine
 * attributes; nothing here is a mock.
 *
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/tug-list-view.css
 * @covers tugdeck/src/components/tugways/internal/list-view-striping.ts
 * @covers tugdeck/src/components/lens/lens-list-presentation.ts
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

const SNIPPETS_LIST = ".lens-content .lens-snippets-list";
const ROWS = `${SNIPPETS_LIST} .tug-list-view-cell`;

/** Enough rows that the bands are a pattern rather than a coincidence. */
const SNIPPETS = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`,
  text: `row-${i} snippet handle`,
}));

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

/** Whether a computed background is a real paint rather than "nothing". */
function isPainted(background: string): boolean {
  return (
    background !== "" &&
    background !== "transparent" &&
    background !== "rgba(0, 0, 0, 0)"
  );
}

describe.skipIf(!SHOULD_RUN)("at0283 — list row striping + text measure", () => {
  test(
    "the band follows the data index, yields to selection, and the list sets its measure",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0283-"));
      const snippetsPath = join(filesDir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets: SNIPPETS }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0283-list-row-striping",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });
          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROWS)}).length >= ${SNIPPETS.length}`,
            { timeoutMs: 8_000 },
          );

          // Striping is a tunable, and the Lens may be tuned to "none". Read
          // the list's own mode and assert the contract that applies — the
          // test pins the BEHAVIOR of each mode, not the current choice.
          const striping = await app.evalJS<string | null>(
            `document.querySelector(${JSON.stringify(SNIPPETS_LIST)})
               .getAttribute("data-row-striping")`,
          );

          // ---- A. The band follows the data index.
          const rows = await app.evalJS<
            Array<{ index: number; parity: string; bg: string }>
          >(
            `Array.from(document.querySelectorAll(${JSON.stringify(ROWS)})).map(function(el){
               return {
                 index: Number(el.getAttribute("data-tug-list-cell-index")),
                 parity: el.getAttribute("data-row-parity") || "",
                 bg: getComputedStyle(el).backgroundColor,
               };
             })`,
          );
          expect(rows.length).toBeGreaterThanOrEqual(SNIPPETS.length);
          // Parity is the DATA index's parity — the property an `:nth-child`
          // rule cannot hold once the rendered window starts past row 0.
          for (const row of rows) {
            expect(row.parity).toBe(row.index % 2 === 0 ? "even" : "odd");
          }

          if (striping === "on") {
            // BOTH parities paint, and they paint DIFFERENTLY. This is the
            // half that a two-row list depends on: washing only the odd rows
            // puts one step between neighbours, and one step of a few percent
            // is invisible without repetition to compare it against — a long
            // list would look banded while a two-row list looked like two
            // identical rows. The selected row is excluded, since it drops its
            // band for its own fill.
            const unselected = rows.filter((r) => isPainted(r.bg));
            const odd = unselected.filter((r) => r.parity === "odd");
            const even = unselected.filter((r) => r.parity === "even");
            expect(odd.length).toBeGreaterThan(0);
            expect(even.length).toBeGreaterThan(0);
            expect(new Set(odd.map((r) => r.bg)).size).toBe(1);
            expect(new Set(even.map((r) => r.bg)).size).toBe(1);
            expect(odd[0]!.bg).not.toBe(even[0]!.bg);

            // ---- B. Line OR band, never both: a striped list draws no
            // hairline between its rows.
            const borders = await app.evalJS<string[]>(
              `Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}))
                 .map(function(el){ return getComputedStyle(el).borderBottomStyle; })`,
            );
            for (const style of borders) {
              expect(style).toBe("none");
            }

            // ---- C. A selected row drops its band. Move the cursor onto an
            // ODD row — the Snippets list carries selection with the cursor —
            // and the band under the selection fill goes away.
            const firstOdd = rows.find((r) => r.parity === "odd")!.index;
            for (let i = 0; i < firstOdd; i += 1) {
              await app.nativeKey("ArrowDown");
            }
            await app.waitForCondition<boolean>(
              `(function(){
                 var el = document.querySelector(
                   '${SNIPPETS_LIST} .tug-list-view-cell[data-tug-list-cell-index="${firstOdd}"]');
                 return el !== null && el.querySelector('.tug-list-row[data-selected="true"]') !== null;
               })()`,
              { timeoutMs: 3_000 },
            );
            const selectedBg = await app.evalJS<string>(
              `getComputedStyle(document.querySelector(
                 '${SNIPPETS_LIST} .tug-list-view-cell[data-tug-list-cell-index="${firstOdd}"]'
               )).backgroundColor`,
            );
            expect(isPainted(selectedBg)).toBe(false);
          } else {
            // Striping off ⇒ the hairlines are back; that is the whole of the
            // "line OR band" contract in the other direction.
            const anyBorder = await app.evalJS<boolean>(
              `Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}))
                 .some(function(el){ return getComputedStyle(el).borderBottomStyle !== "none"; })`,
            );
            expect(anyBorder).toBe(true);
          }

          // ---- D. One measure per list: every row's text reads at the size
          // the LIST set, not at whatever size its own label asked for.
          const measure = await app.evalJS<string>(
            `getComputedStyle(document.querySelector(${JSON.stringify(SNIPPETS_LIST)}))
               .getPropertyValue("--tugx-list-row-font-size").trim()`,
          );
          expect(measure).not.toBe("");
          const sizes = await app.evalJS<string[]>(
            `Array.from(document.querySelectorAll(
               '${SNIPPETS_LIST} .tug-list-row-content'
             )).map(function(el){ return getComputedStyle(el).fontSize; })`,
          );
          expect(sizes.length).toBeGreaterThan(0);
          for (const size of sizes) {
            expect(size).toBe(measure);
          }
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
