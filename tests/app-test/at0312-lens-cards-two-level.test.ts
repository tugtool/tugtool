/**
 * at0312-lens-cards-two-level.test.ts — the Lens Cards section is a pane-first
 * mirror of the deck, and its second level is never a folder.
 *
 * ## What this gates
 *
 * The section's whole premise is that a pane's row is the *card's* row in the
 * overwhelmingly common single-card case, and that the rare multi-card case
 * discloses nothing — its outline is simply always there. Both halves are
 * assertable only against the real app, because both are claims about what is
 * in the DOM with no interaction at all:
 *
 *   A. **A single-card pane's row IS the card's row.** No subrow, no fold
 *      affordance, and the accessories the row has always had (close box, slot
 *      picker) still present.
 *   B. **A multi-card pane's outline is open on arrival.** Four gallery tabs
 *      seeded by `addCard("gallery-buttons")` render as four subrows with zero
 *      clicks, and there is no per-pane fold control anywhere in the row.
 *   C. **A subrow fronts its tab.** Activating one changes its pane's
 *      `activeCardId` without changing which pane is active.
 *   D. **⌘L lands the cursor on a card, not on a collapse toggle.** Group
 *      headers are cursorable rows, which is exactly what would let the list's
 *      own gain-seed park the cursor on index 0 — a header. The section seeds
 *      past them deliberately, and this is where that is checked.
 *   E. **The chevron is the header's whole mouse target, and the count is the
 *      collapsed state's voice.** Clicking the header body does nothing;
 *      clicking the chevron folds the group. Open, the rows are the count and
 *      the number is not ink at all; collapsed, it is the only report of what
 *      the fold is hiding.
 *   F. **Reorder still engages while another group is collapsed.** The reorder
 *      hook aborts a drag silently — no error, no log — when any key in the
 *      visible order has no mounted element, so a collapsed group's keys must
 *      be absent from that order. A drag that quietly does nothing is the
 *      failure this guards, and nothing in the console would say so.
 *
 * @covers tugdeck/src/components/lens/sections/cards-section.tsx
 * @covers tugdeck/src/components/lens/sections/cards-section.css
 * @covers tugdeck/src/components/lens/sections/cards-data-source.ts
 * @covers tugdeck/src/components/lens/sections/cards-groups.ts
 * @covers tugdeck/src/components/lens/sections/cards-session-cell.tsx
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const LIST = ".lens-cards-list";
const HEADER = `${LIST} .lens-cards-header`;
const PANE_ROW = `${LIST} .lens-cards-row[data-lens-row-id]`;
const SUBROW = `${LIST} .lens-cards-subrow[data-lens-card-id]`;
const EDITOR_CONTENT =
  '[data-card-id="A"] [data-slot="tug-text-card-editor"] .cm-content';

/** The number of elements matching `sel`. */
function count(sel: string): string {
  return `document.querySelectorAll(${JSON.stringify(sel)}).length`;
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 700, height: 520 },
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

describe.skipIf(!SHOULD_RUN)("at0312 — Cards is two-level, never a folder", () => {
  test(
    "single-card panes render today's row; a stack's outline is open on arrival",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0312-"));
      const file = path.join(dir, "alpha.txt");
      fs.writeFileSync(file, "alpha\nbeta\n", "utf8");
      const app = await launchTugApp({ testName: "at0312-lens-cards-two-level" });
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
        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(`${count(PANE_ROW)} === 1`, {
          timeoutMs: 15_000,
        });

        // ---- A. A single-card pane's row IS the card's row. ---------------
        //
        // Nothing about it says "container": no subrow beneath it, and no fold
        // control inside it. Its accessories are the ones a file row has always
        // carried.
        expect(await app.evalJS<number>(count(SUBROW))).toBe(0);
        const single = await app.evalJS<{
          title: string;
          hasClose: boolean;
          hasSlots: boolean;
          foldControls: number;
          indent: number;
        }>(`(function(){
          var row = document.querySelector(${JSON.stringify(PANE_ROW)});
          if (row === null) throw new Error("no pane row");
          var title = row.querySelector(".lens-cards-row-headline .tug-list-row-title");
          return {
            title: title === null ? "" : title.innerText,
            hasClose: row.querySelector(".lens-cards-row-close") !== null,
            hasSlots: row.querySelector('[data-testid="lens-slot-picker"]') !== null,
            // Any disclosure affordance at all — the section renders exactly
            // one chevron kind, and it belongs to group headers.
            foldControls: row.querySelectorAll(
              '.lens-cards-header-chevron, [data-slot="block-fold-cue"]',
            ).length,
            indent: row.querySelector(".tug-list-row-content") === null
              ? 0
              : parseFloat(
                  getComputedStyle(row.querySelector(".tug-list-row-content"))
                    .paddingInlineStart,
                ) || 0,
          };
        })()`);
        expect(single.title).toContain("alpha.txt");
        expect(single.hasClose).toBe(true);
        expect(single.hasSlots).toBe(true);
        expect(single.foldControls).toBe(0);
        expect(single.indent).toBe(0);

        // The file row sits under a Files header — one group, one header.
        expect(await app.evalJS<number>(count(HEADER))).toBe(1);

        // ---- D. ⌘L seeds the cursor onto a CARD row, not onto a header. ----
        //
        // Headers are cursorable cells, so the list's own gain-seed would land
        // on index 0 — the Files header — if the section did not seed past it.
        // `focus-lens` IS ⌘L: the keystroke's registered control action, and the
        // same entry point the menu item and the accelerator both call.
        await app.dispatchControlAction("focus-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector('${LIST}[data-key-view-kbd] [data-key-cursor]') !== null`,
          { timeoutMs: 8_000 },
        );
        const seeded = await app.evalJS<{ isHeader: boolean; isPane: boolean }>(
          `(function(){
            var cur = document.querySelector('${LIST} [data-key-cursor]');
            return {
              isHeader: cur.querySelector(".lens-cards-header") !== null
                || cur.matches(".lens-cards-header"),
              isPane: cur.querySelector(".lens-cards-row[data-lens-row-id]") !== null
                || cur.matches(".lens-cards-row[data-lens-row-id]"),
            };
          })()`,
        );
        expect(seeded).toEqual({ isHeader: false, isPane: true });

        // ---- B. A multi-card pane discloses nothing — it is already open. --
        //
        // `show-component-gallery` runs `addCard("gallery-buttons")`, whose
        // registration seeds a four-card stack from its `defaultCards`.
        await app.dispatchControlAction("show-component-gallery");
        await app.waitForCondition<boolean>(`${count(SUBROW)} === 4`, {
          timeoutMs: 15_000,
        });
        // Zero clicks were spent opening it: the wait above is the assertion,
        // and this pins that the stack row itself carries no fold control.
        const stack = await app.evalJS<{
          tabCount: string;
          hasClose: boolean;
          foldControls: number;
          subrowIndent: number;
          paneIndent: number;
        }>(`(function(){
          var sub = document.querySelector(${JSON.stringify(SUBROW)});
          var paneId = sub.closest(".tug-list-view-cell")
            .previousElementSibling
            .querySelector(".lens-cards-row[data-lens-row-id]");
          var badge = document.querySelector('[data-testid="lens-cards-tab-count"]');
          var contentOf = function (el) {
            var c = el.querySelector(".tug-list-row-content");
            return c === null ? 0 : parseFloat(getComputedStyle(c).paddingInlineStart) || 0;
          };
          return {
            tabCount: badge === null ? "" : badge.innerText,
            hasClose: paneId.querySelector(".lens-cards-row-close") !== null,
            foldControls: paneId.querySelectorAll(
              '.lens-cards-header-chevron, [data-slot="block-fold-cue"]',
            ).length,
            subrowIndent: contentOf(sub),
            paneIndent: contentOf(paneId),
          };
        })()`);
        expect(stack.tabCount).toBe("4 tabs");
        // A stack row carries no close box — per-card close lives on subrows.
        expect(stack.hasClose).toBe(false);
        expect(stack.foldControls).toBe(0);
        // Indent is the ONLY thing marking a subrow as one.
        expect(stack.subrowIndent).toBeGreaterThan(stack.paneIndent);

        // ---- C. Activating a subrow fronts that tab within its pane. -------
        const before = await app.evalJS<{ paneId: string; activeCardId: string }>(
          `(function(){
            var sub = document.querySelector(${JSON.stringify(SUBROW)});
            var cardId = sub.getAttribute("data-lens-card-id");
            var deck = window.tugdeck.diag.getDeckState();
            var pane = deck.panes.find(function (p) { return p.cardIds.indexOf(cardId) >= 0; });
            return { paneId: pane.id, activeCardId: pane.activeCardId };
          })()`,
        );
        // Pick a subrow that is NOT already the active tab.
        const targetCardId = await app.evalJS<string>(
          `(function(){
            var subs = Array.prototype.slice.call(
              document.querySelectorAll(${JSON.stringify(SUBROW)}),
            );
            var pick = subs.find(function (s) {
              return s.getAttribute("data-lens-card-id")
                !== ${JSON.stringify(before.activeCardId)};
            });
            if (pick === undefined) throw new Error("no background tab to front");
            pick.click();
            return pick.getAttribute("data-lens-card-id");
          })()`,
        );
        await app.waitForCondition<boolean>(
          `(function(){
            var deck = window.tugdeck.diag.getDeckState();
            var pane = deck.panes.find(function (p) { return p.id === ${JSON.stringify(before.paneId)}; });
            return pane.activeCardId === ${JSON.stringify(targetCardId)};
          })()`,
          { timeoutMs: 8_000 },
        );

        // ---- E. The chevron folds the group; the header body does not. -----
        const filesHeader = `${LIST} .lens-cards-header[data-lens-group="files"]`;
        // Open, the rows ARE the count. Measured as paint, not as text: an
        // unrendered element's `innerText` falls back to `textContent`, so the
        // number reads "1" either way and only the box tells the truth.
        const countBox = `(function(){
          var el = document.querySelector('${filesHeader} .lens-cards-header-count');
          if (el === null) throw new Error("no count element");
          return {
            display: getComputedStyle(el).display,
            height: el.getBoundingClientRect().height,
          };
        })()`;
        expect(await app.evalJS<{ display: string; height: number }>(countBox))
          .toEqual({ display: "none", height: 0 });

        // Clicking the label does nothing at all. A group folding out from
        // under a user who clicked a word they were reading is the whole
        // reason the header body is inert.
        await app.evalJS<null>(
          `(document.querySelector('${filesHeader} .tug-list-row-title').click(), null)`,
        );
        expect(
          await app.evalJS<boolean>(
            `document.querySelector('${filesHeader}').getAttribute("data-group-collapsed") === "true"`,
          ),
        ).toBe(false);

        await app.evalJS<null>(
          `(document.querySelector('${filesHeader} .lens-cards-header-chevron').click(), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('${filesHeader}[data-group-collapsed="true"]') !== null`,
          { timeoutMs: 8_000 },
        );
        const collapsed = await app.evalJS<{
          fileRows: number;
          count: string;
          countPainted: boolean;
        }>(
          `(function(){
            var rows = Array.prototype.slice.call(
              document.querySelectorAll(${JSON.stringify(PANE_ROW)}),
            );
            var el = document.querySelector('${filesHeader} .lens-cards-header-count');
            return {
              fileRows: rows.filter(function (r) {
                return r.querySelector(".lens-cards-row-headline .tug-list-row-title") !== null
                  && r.textContent.indexOf("alpha.txt") !== -1;
              }).length,
              count: el.innerText,
              countPainted: el.getBoundingClientRect().height > 0,
            };
          })()`,
        );
        expect(collapsed.fileRows).toBe(0);
        // The header stays, and now the number speaks: it is the only report
        // of what the fold is hiding, and the way back.
        expect(collapsed.count).toBe("1");
        expect(collapsed.countPainted).toBe(true);

        // ---- F. Reorder engages while another group is collapsed. ----------
        //
        // The Tools group still has its stack row mounted. Arming a drag on it
        // must actually engage: if the visible order handed to the reorder hook
        // still carried the collapsed Files group's keys, `beginDrag` would
        // return without a word and the row would never pick up.
        const engaged = await app.evalJS<boolean>(`(function(){
          var row = document.querySelector(
            '${LIST} .lens-cards-row[data-lens-row-id]'
          );
          if (row === null) throw new Error("no pane row to drag");
          var r = row.getBoundingClientRect();
          var x = r.left + r.width / 2;
          var y = r.top + r.height / 2;
          var opts = function (cy) {
            return { bubbles: true, cancelable: true, clientX: x, clientY: cy, pointerId: 1, button: 0 };
          };
          row.dispatchEvent(new PointerEvent("pointerdown", opts(y)));
          window.dispatchEvent(new PointerEvent("pointermove", opts(y + 30)));
          var dragging = document.querySelector(
            '${LIST} [data-dragging="true"]'
          ) !== null;
          window.dispatchEvent(new PointerEvent("pointerup", opts(y + 30)));
          return dragging;
        })()`);
        expect(engaged).toBe(true);

        // Re-expanding puts the group back — the chevron again, since that is
        // the only thing the mouse can toggle.
        await app.evalJS<null>(
          `(document.querySelector('${filesHeader} .lens-cards-header-chevron').click(), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('${filesHeader}[data-group-collapsed="false"]') !== null`,
          { timeoutMs: 8_000 },
        );
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
