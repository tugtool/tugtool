/**
 * at0255-jots-followons.test.ts — the three follow-on Lens notes,
 * measured on the live DOM against a real jots file:
 *
 *  1. **The editing header pins.** While a jot taller than the Lens is
 *     edited, the open card's header row is `position: sticky` and holds the
 *     top of the list scroller as the body scrolls under it — the jot's
 *     name and its copy / close stay in reach.
 *
 *  2. **Exactly one selection green.** Opening a jot for editing MOVES the
 *     list's owned selection onto the edited row, so a create-and-open path
 *     (the header +) can't leave the previously-selected row painting its fill
 *     while a different row is open. One row wears the picker green, ever.
 *
 *  3. **A click lands the keyboard.** Single-clicking a jot promotes the
 *     list to the KEYBOARD key view (ring lit, cursor on the clicked row), so
 *     the section's Delete verb fires (its confirm popover opens) instead of
 *     beeping.
 *
 * Runs against an isolated jots file (`TUG_JOTS_PATH`).
 *
 * @covers tugdeck/src/components/jots/jots-card.tsx
 * @covers tugdeck/src/lib/jots-store.ts
 * @covers tugdeck/src/lib/jot-drag.ts
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

describe.skipIf(!SHOULD_RUN)("at0255 — Lens jot follow-ons", () => {
  test(
    "the header pins, one row is green, and a click lands the keyboard",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-at0255-"));
      const jotsPath = join(dir, "jots.json");
      const longText = Array.from(
        { length: 80 },
        (_, i) => `line ${i} of the pasted multi-line jot body`,
      ).join("\n");
      const jots = [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `s${i}`,
          text: `short jot ${i}`,
        })),
        { id: "long", text: longText },
      ];
      writeFileSync(
        jotsPath,
        `${JSON.stringify({ version: 1, jots: jots }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0255-jots-followons",
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
          await app.dispatchControlAction("toggle-jots");
          await app.waitForCondition<boolean>(
            `document.querySelector('.jots-list .jot-row-content[data-jot-id="s2"]') !== null`,
            { timeoutMs: 5_000 },
          );

          // The toolbar's natural height at rest — captured so we can later
          // prove a long jot edit never squeezes it (note C below).
          const toolbarRestH = await app.evalJS<number>(
            `Math.round(document.querySelector('.jots-toolbar').getBoundingClientRect().height)`,
          );

          // ---- 3. A click lands the KEYBOARD key view + ring, so Delete fires.
          // First click activates the Lens card; the second (same-card) click is
          // the one under test — it must light the ring and land the cursor.
          await app.nativeClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="s0"] .jot-row-label`,
          );
          await app.nativeClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="s2"] .jot-row-label`,
          );
          const click = await app.evalJS<{
            listHasKbd: boolean;
            wash: string;
            outlineWidth: string;
            cursorJotId: string | null;
            selectedCount: number;
          }>(
            `(() => {
              const list = document.querySelector('.jots-list');
              const cs = list ? getComputedStyle(list) : null;
              const cursor = document.querySelector('.jots-list [data-key-cursor]');
              return {
                listHasKbd: list?.hasAttribute('data-key-view-kbd') ?? false,
                wash: cs ? cs.backgroundImage : 'none',
                outlineWidth: cs ? cs.outlineWidth : '0px',
                cursorJotId: cursor?.querySelector('[data-jot-id]')?.getAttribute('data-jot-id') ?? null,
                selectedCount: document.querySelectorAll('.jots-list .tug-list-view-cell[data-selected="true"]').length,
              };
            })()`,
          );
          // The cursor sits on the clicked row, and the row's mark is the only
          // one: the container marks nothing ([D122]) — neither an outline nor a
          // background layer — even though it is the key view. The list is still
          // `data-key-view-kbd`, so this is the suppression holding, not the
          // attribute being absent.
          expect(click.listHasKbd).toBe(true);
          expect(click.wash).toBe("none");
          expect(click.outlineWidth).toBe("0px");
          expect(click.cursorJotId).toBe("s2");
          expect(click.selectedCount).toBe(1);

          // Re-click a DIFFERENT row while the list already holds the keyboard:
          // the ring stays lit (the keyboard promotion rides pointerdown, in the
          // same event as the capture-phase pointer placement, so kbd never
          // blinks off-then-on) and the cursor follows to the new row.
          await app.nativeClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="s0"] .jot-row-label`,
          );
          const reclick = await app.evalJS<{ kbd: boolean; cursor: string | null }>(
            `(() => {
              const list = document.querySelector('.jots-list');
              const cursor = document.querySelector('.jots-list [data-key-cursor]');
              return {
                kbd: list?.hasAttribute('data-key-view-kbd') ?? false,
                cursor: cursor?.querySelector('[data-jot-id]')?.getAttribute('data-jot-id') ?? null,
              };
            })()`,
          );
          expect(reclick.kbd).toBe(true);
          expect(reclick.cursor).toBe("s0");
          // Re-select s2 so the Delete probe below acts on a known row.
          await app.nativeClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="s2"] .jot-row-label`,
          );

          // Delete now fires the section verb: the destructive confirm popover
          // opens (rather than a system beep). Dismiss it without deleting.
          await app.nativeKey("Delete", []);
          expect(
            await app.waitForCondition<boolean>(
              `document.querySelector('.tug-confirm-popover') !== null`,
              { timeoutMs: 3_000 },
            ),
          ).toBe(true);
          await app.nativeKey("Escape", []);
          await app.waitForCondition<boolean>(
            `document.querySelector('.tug-confirm-popover') === null`,
            { timeoutMs: 3_000 },
          );

          // ---- 2. Create-and-open moves selection: exactly one green.
          // Select s1, then press the header + (creates a new jot and opens
          // it). The new row is the only selected cell; the old selection cleared.
          await app.nativeClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="s1"] .jot-row-label`,
          );
          await app.nativeClickAtElement(`.jots-toolbar [aria-label="New jot"]`);
          await app.waitForCondition<boolean>(
            `document.querySelector('.jot-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );
          const green = await app.evalJS<{
            selectedCount: number;
            editingHeaderIsSelected: boolean;
          }>(
            `(() => {
              const cells = [...document.querySelectorAll('.jots-list .tug-list-view-cell[data-selected="true"]')];
              const header = document.querySelector('.jot-editor-header[data-jot-id]');
              const headerCell = header?.closest('.tug-list-view-cell') ?? null;
              return {
                selectedCount: cells.length,
                editingHeaderIsSelected: headerCell !== null && cells.includes(headerCell),
              };
            })()`,
          );
          expect(green.selectedCount).toBe(1);
          expect(green.editingHeaderIsSelected).toBe(true);

          // Close the create editor.
          await app.nativeKey("Escape", []);
          await app.waitForCondition<boolean>(
            `document.querySelector('.jot-editor') === null`,
            { timeoutMs: 3_000 },
          );

          // ---- 1. The header pins while a taller-than-Lens jot scrolls.
          // Open the long jot, move the caret to the document end and type —
          // the reveal scrolls the list to the tail. The header must stay stuck
          // at the top of the scroller (sticky), not scroll away with the body.
          await app.nativeDoubleClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="long"] .jot-row-label`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.jot-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );

          // A click INSIDE the open editor must not close it — the click stays
          // with the editor (it does not depart the row's descend scope). Wait
          // until the editor has fully claimed focus and the descend has settled
          // (the editor holds the active element AND the list is no longer the
          // keyboard key view) before each in-card click.
          const editorSettled = `document.querySelector('.jot-editor')?.contains(document.activeElement) === true
             && document.querySelector('.jots-list')?.hasAttribute('data-key-view-kbd') === false`;

          // (a) A click on the card's CHROME — the sticky header, which is NOT
          // the contenteditable — keeps the editor open.
          await app.waitForCondition<boolean>(editorSettled, { timeoutMs: 3_000 });
          await app.nativeClickAtElement(
            `.jot-editor-header .jot-row-label`,
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.jot-editor .cm-content') !== null`,
            ),
          ).toBe(true);

          // (b) A click on the editor's TEXT keeps it open too (the first line
          // is near the top, on-screen; the tall `.cm-content`'s center would be
          // below the visible frame).
          await app.waitForCondition<boolean>(editorSettled, { timeoutMs: 3_000 });
          // Clicking the header above reveals the caret, which scrolls the list
          // — so the FIRST `.cm-line` is no longer the one on screen. Click the
          // first line that actually intersects the scroller’s visible box.
          const visibleLine = await app.evalJS<number>(
            `(() => {
              const list = document.querySelector(".jots-list");
              const box = list.getBoundingClientRect();
              const lines = [...document.querySelectorAll(".jot-editor .cm-content .cm-line")];
              return lines.findIndex((el) => {
                const b = el.getBoundingClientRect();
                return b.top >= box.top + 4 && b.bottom <= box.bottom - 4;
              }) + 1;
            })()`,
          );
          expect(visibleLine).toBeGreaterThan(0);
          await app.nativeClickAtElement(
            `.jot-editor .cm-content .cm-line:nth-of-type(${visibleLine})`,
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.jot-editor .cm-content') !== null`,
            ),
          ).toBe(true);

          await app.nativeKey("ArrowDown", ["cmd"]);
          await app.nativeType(" EDITED");
          // The list genuinely scrolled to follow the caret to the tail.
          await app.waitForCondition<boolean>(
            `document.querySelector('.jots-list').scrollTop > 200`,
            { timeoutMs: 3_000 },
          );
          const pin = await app.evalJS<{
            position: string;
            headerTop: number;
            listTop: number;
            pinnedToTop: boolean;
            scrollTop: number;
          }>(
            `(() => {
              const l = document.querySelector('.jots-list');
              const list = l.getBoundingClientRect();
              const headerEl = document.querySelector('.jot-editor-header');
              const header = headerEl.getBoundingClientRect();
              return {
                position: getComputedStyle(headerEl).position,
                headerTop: Math.round(header.top),
                listTop: Math.round(list.top),
                pinnedToTop: Math.abs(header.top - list.top) < 6,
                scrollTop: Math.round(l.scrollTop),
              };
            })()`,
          );
          expect(pin.position).toBe("sticky");
          // Stuck to the top of the scroller even though the body scrolled far.
          expect(pin.scrollTop).toBeGreaterThan(200);
          expect(pin.pinnedToTop).toBe(true);

          // ---- C. The list absorbs the overflow; the card's chrome is never
          // eaten. With a jot far taller than the card open, the toolbar still
          // stands at its full height — the list took the overflow by scrolling,
          // rather than the flex shrink squeezing the toolbar to nothing (which
          // would nudge the pinned header up into it).
          const toolbarEditH = await app.evalJS<number>(
            `Math.round(document.querySelector('.jots-toolbar').getBoundingClientRect().height)`,
          );
          expect(toolbarEditH).toBeGreaterThanOrEqual(toolbarRestH - 2);
        } finally {
          await app.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
