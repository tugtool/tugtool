/**
 * at0287-lens-row-action-not-a-pick.test.ts — an in-row action button is not a
 * row pick.
 *
 * ## What this gates
 *
 * The Lens **Text Files** close box acts on the file its row names. Picking that
 * row is a different gesture with a different meaning: the list's `onSelect`
 * fronts the bound card. Run them together and closing a file from the Lens
 * first hauls the about-to-close card to the front, taking activation off
 * whatever the user was actually working in and leaving it nowhere to return to.
 *
 * `stopPropagation` on the button's CLICK cannot prevent this. Selection commits
 * at POINTERDOWN (`focus-language.md` § Drag and the keyboard), which has
 * already bubbled to the cell by the time any click runs. So `TugListView` asks
 * the question itself: a pointer gesture that landed on a focus-refusing control
 * (`data-tug-focus="refuse"` — every `TugIconButton`) is that control's, not the
 * row's.
 *
 * Two consequences, both asserted here, because they are two different-looking
 * bugs with one cause:
 *
 *  - **Activation stays put.** The gallery pane is front; closing a text file
 *    from the Lens leaves it front. The closed file's pane survives the close
 *    (it holds a second card), so a stolen front would still be stolen when the
 *    dust settled — which is what the user sees.
 *  - **The banding stays put.** A phantom selection also *removed* the row's
 *    alternating tint, so closing the middle of three files left the row that
 *    slid up into its place with no band at all. The band is a property of the
 *    row's position and nothing else: after the close the two survivors read
 *    even-then-odd, in the same two colors the list used before.
 *
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/tug-list-view.css
 * @covers tugdeck/src/components/lens/sections/text-files-section.tsx
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const LIST = ".lens-text-files-list";
const ROWS = `${LIST} .tug-list-view-cell`;

type RowState = {
  index: number;
  parity: string;
  selected: string | null;
  background: string;
  title: string;
};

const READ_ROWS = `Array.from(document.querySelectorAll(${JSON.stringify(ROWS)})).map(function(el){
  var t = el.querySelector('.tug-list-row-title');
  return {
    index: Number(el.getAttribute('data-tug-list-cell-index')),
    parity: el.getAttribute('data-row-parity') || '',
    selected: el.getAttribute('data-selected'),
    background: getComputedStyle(el).backgroundColor,
    title: t ? t.innerText.trim() : ''
  };
})`;

/** The front canvas pane — highest stacking order, Lens excluded (it is pinned
 *  above the canvas and never participates in the front-to-back order). */
const TOP_PANE = `(function(){
  var top = null, z = -Infinity;
  Array.from(document.querySelectorAll('[data-pane-id]:not([data-lens-pane])')).forEach(function(el){
    var v = Number(getComputedStyle(el).zIndex);
    if (!Number.isFinite(v)) return;
    if (v > z) { z = v; top = el.getAttribute('data-pane-id'); }
  });
  return top;
})()`;

function deckShape() {
  return {
    cards: [
      ...["A", "B", "C"].map((id) => ({
        id,
        componentId: "text",
        title: id,
        closable: true,
      })),
      // `G` is what the user is working in. `H` is the FRONT card of `B`'s
      // pane, which makes `two.txt` a background tab — the case where "close
      // the active card" quietly closes a different file than the one the row
      // names — and keeps that pane alive past the close, so a stolen front
      // would still be visible afterwards.
      ...["G", "H"].map((id) => ({
        id,
        componentId: "gallery-accordion",
        title: id,
        closable: true,
      })),
    ],
    panes: [
      ...["A", "C"].map((id, i) => ({
        id: `p${id}`,
        position: { x: 40 + i * 20, y: 40 + i * 20 },
        size: { width: 420, height: 300 },
        cardIds: [id],
        activeCardId: id,
        title: "",
        acceptsFamilies: ["standard"],
      })),
      {
        id: "pB",
        position: { x: 100, y: 100 },
        size: { width: 420, height: 300 },
        cardIds: ["H", "B"],
        activeCardId: "H",
        title: "",
        acceptsFamilies: ["standard"],
      },
      {
        id: "pG",
        position: { x: 600, y: 60 },
        size: { width: 420, height: 320 },
        cardIds: ["G"],
        activeCardId: "G",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pG",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("at0287 — a row action is not a row pick", () => {
  test(
    "closing a Lens text file keeps the front pane and the row banding",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0287-"));
      const files = ["one.txt", "two.txt", "three.txt"].map((name) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, `contents of ${name}\n`, "utf8");
        return file;
      });
      const app = await launchTugApp({ testName: "at0287-row-action" });
      try {
        await app.seedDeckState({
          state: deckShape(),
          cardStates: {
            A: { content: { path: files[0], anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
            B: { content: { path: files[1], anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
            C: { content: { path: files[2], anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
          },
          focusCardId: "G",
        });
        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("toggle-lens"), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(ROWS)}).length === 3`,
          { timeoutMs: 15_000 },
        );

        const before = await app.evalJS<RowState[]>(READ_ROWS);
        expect(before.map((r) => r.title)).toEqual([
          "one.txt",
          "two.txt",
          "three.txt",
        ]);
        // Three rows, two colors, alternating — the baseline the close must not
        // disturb. (Whether the Lens is currently tuned TO stripes is
        // `lens-list-presentation.ts`'s call; at0283 covers the striping
        // contract itself. Here the point is only that nothing CHANGES.)
        const evenBackground = before[0]!.background;
        const oddBackground = before[1]!.background;
        expect(before[2]!.background).toBe(evenBackground);
        expect(await app.evalJS<string | null>(TOP_PANE)).toBe("pG");

        // Close the MIDDLE file from its row's close box, with a real click at
        // real coordinates — the pointerdown is the half that used to pick the
        // row, so a synthetic `click()` would prove nothing.
        await app.nativeClickAtElement(
          `${LIST} .tug-list-view-cell[data-tug-list-cell-index="1"] .text-files-row-close`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(ROWS)}).length === 2`,
          { timeoutMs: 8_000 },
        );

        // The named file closed — not the front card of its pane, not a
        // neighbour — and its pane's other card is untouched.
        const after = await app.evalJS<RowState[]>(READ_ROWS);
        expect(after.map((r) => r.title)).toEqual(["one.txt", "three.txt"]);
        expect(
          await app.evalJS<number>(`document.querySelectorAll('[data-card-id="H"]').length`),
        ).toBeGreaterThan(0);

        // Activation never left the card the user was working in.
        expect(await app.evalJS<string | null>(TOP_PANE)).toBe("pG");

        // No row was picked by the close gesture.
        for (const row of after) {
          expect(row.selected).toBeNull();
        }

        // `three.txt` slid from index 2 to index 1 and took index 1's color
        // with it: the band belongs to the position.
        expect(after.map((r) => r.parity)).toEqual(["even", "odd"]);
        expect(after[0]!.background).toBe(evenBackground);
        expect(after[1]!.background).toBe(oddBackground);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
