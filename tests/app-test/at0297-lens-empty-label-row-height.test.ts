/**
 * at0297-lens-empty-label-row-height.test.ts — a Lens section's empty label
 * stands at the height of the row it stands in for.
 *
 * ## What this gates
 *
 * "None" is rendered INSTEAD of the list, so it is the section's only content
 * when the section is empty. It therefore has to be one row tall: a Cards
 * section holding nothing must not be a taller band than the same section
 * holding one file. The label's box is authored once for every section
 * (`.lens-section-empty` in `lens-content.css`) against a stated height, and
 * that height is a copy of the one-line row's natural height — so this test is
 * where the copy is checked against the original.
 *
 * Drives the real path: a real file opened in a real Text card, so the Cards
 * section renders a real file row; the row is measured, the card is closed, and
 * the empty label that replaces it is measured in the same list frame.
 *
 * @covers tugdeck/src/components/lens/lens-content.css
 * @covers tugdeck/src/components/lens/sections/cards-section.tsx
 * @covers tugdeck/src/components/lens/sections/cards-section.css
 * @covers tugdeck/src/components/jots/jots-card.css
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const EDITOR_CONTENT =
  '[data-card-id="A"] [data-slot="tug-text-card-editor"] .cm-content';
// The cell holding the FILE row, not the group header above it — headers are
// cells too, and the first one in the list is the Files group's.
const ROW_CELL =
  ".lens-cards-list .tug-list-view-cell:has(.lens-cards-row-headline)";
const ROW_TITLE = ".lens-cards-list .lens-cards-row-headline .tug-list-row-title";
const ROW_CLOSE = ".lens-cards-list .lens-cards-row-close";
const EMPTY = '[data-testid="lens-cards-empty"]';

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("at0297 — empty label is one row tall", () => {
  test(
    "the Cards 'None' label is exactly as tall as a file row",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0297-"));
      const file = path.join(dir, "manual.txt");
      fs.writeFileSync(file, "alpha\nbeta\n", "utf8");
      const app = await launchTugApp({ testName: "at0297-empty-row-height" });
      try {
        await app.seedDeckState({
          state: deckShape(),
          cardStates: {
            A: {
              content: { path: file, anchor: { line: 1, ch: 0 }, scrollTop: 0 },
            },
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${EDITOR_CONTENT}');
            return el !== null && el.innerText.indexOf("alpha") !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );
        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("toggle-lens"), null)`,
        );
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${ROW_TITLE}');
            return el !== null && el.innerText.indexOf("manual.txt") !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );

        const rowHeight = await app.evalJS<number>(
          `document.querySelector('${ROW_CELL}').getBoundingClientRect().height`,
        );
        expect(rowHeight).toBeGreaterThan(0);

        // Close the one open file: the label replaces the list in the same
        // frame, which is the comparison this test exists to make.
        await app.evalJS<null>(
          `(document.querySelector('${ROW_CLOSE}').click(), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('${EMPTY}') !== null`,
          { timeoutMs: 8_000 },
        );

        const emptyHeight = await app.evalJS<number>(
          `document.querySelector('${EMPTY}').getBoundingClientRect().height`,
        );
        expect(emptyHeight).toBe(rowHeight);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
