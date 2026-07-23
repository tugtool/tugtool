/**
 * at0255-lens-snippet-followons.test.ts — the three follow-on Lens notes,
 * measured on the live DOM against a real snippets file:
 *
 *  1. **The editing header pins.** While a snippet taller than the Lens is
 *     edited, the open card's header row is `position: sticky` and holds the
 *     top of the list scroller as the body scrolls under it — the snippet's
 *     name and its copy / close stay in reach.
 *
 *  2. **Exactly one selection green.** Opening a snippet for editing MOVES the
 *     list's owned selection onto the edited row, so a create-and-open path
 *     (the header +) can't leave the previously-selected row painting its fill
 *     while a different row is open. One row wears the picker green, ever.
 *
 *  3. **A click lands the keyboard.** Single-clicking a snippet promotes the
 *     list to the KEYBOARD key view (ring lit, cursor on the clicked row), so
 *     the section's Delete verb fires (its confirm popover opens) instead of
 *     beeping.
 *
 * Runs against an isolated snippets file (`TUG_SNIPPETS_PATH`).
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

describe.skipIf(!SHOULD_RUN)("at0255 — Lens snippet follow-ons", () => {
  test(
    "the header pins, one row is green, and a click lands the keyboard",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-at0255-"));
      const snippetsPath = join(dir, "snippets.json");
      const longText = Array.from(
        { length: 80 },
        (_, i) => `line ${i} of the pasted multi-line snippet body`,
      ).join("\n");
      const snippets = [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `s${i}`,
          text: `short snippet ${i}`,
        })),
        { id: "long", text: longText },
      ];
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0255-lens-snippet-followons",
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
          await app.dispatchControlAction("toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-snippets-list .snippet-row-content[data-snippet-id="s2"]') !== null`,
            { timeoutMs: 5_000 },
          );

          // The Sessions band's natural height at rest — captured so we can later
          // prove a long snippet edit never squeezes it (note C below).
          const sessionsRestH = await app.evalJS<number>(
            `Math.round(document.querySelector('.lens-sections > .lens-section').getBoundingClientRect().height)`,
          );

          // ---- 3. A click lands the KEYBOARD key view + ring, so Delete fires.
          // First click activates the Lens card; the second (same-card) click is
          // the one under test — it must light the ring and land the cursor.
          await app.nativeClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s0"] .snippet-row-label`,
          );
          await app.nativeClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s2"] .snippet-row-label`,
          );
          const click = await app.evalJS<{
            listHasKbd: boolean;
            listOutline: string;
            cursorSnippetId: string | null;
            selectedCount: number;
          }>(
            `(() => {
              const list = document.querySelector('.lens-snippets-list');
              const cursor = document.querySelector('.lens-snippets-list [data-key-cursor]');
              return {
                listHasKbd: list?.hasAttribute('data-key-view-kbd') ?? false,
                listOutline: list ? getComputedStyle(list).outlineStyle : 'none',
                cursorSnippetId: cursor?.querySelector('[data-snippet-id]')?.getAttribute('data-snippet-id') ?? null,
                selectedCount: document.querySelectorAll('.lens-snippets-list .tug-list-view-cell[data-selected="true"]').length,
              };
            })()`,
          );
          // The list wears the perimeter ring, and the cursor sits on the clicked row.
          expect(click.listHasKbd).toBe(true);
          expect(click.listOutline).not.toBe("none");
          expect(click.cursorSnippetId).toBe("s2");
          expect(click.selectedCount).toBe(1);

          // Re-click a DIFFERENT row while the list already holds the keyboard:
          // the ring stays lit (the keyboard promotion rides pointerdown, in the
          // same event as the capture-phase pointer placement, so kbd never
          // blinks off-then-on) and the cursor follows to the new row.
          await app.nativeClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s0"] .snippet-row-label`,
          );
          const reclick = await app.evalJS<{ kbd: boolean; cursor: string | null }>(
            `(() => {
              const list = document.querySelector('.lens-snippets-list');
              const cursor = document.querySelector('.lens-snippets-list [data-key-cursor]');
              return {
                kbd: list?.hasAttribute('data-key-view-kbd') ?? false,
                cursor: cursor?.querySelector('[data-snippet-id]')?.getAttribute('data-snippet-id') ?? null,
              };
            })()`,
          );
          expect(reclick.kbd).toBe(true);
          expect(reclick.cursor).toBe("s0");
          // Re-select s2 so the Delete probe below acts on a known row.
          await app.nativeClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s2"] .snippet-row-label`,
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
          // Select s1, then press the header + (creates a new snippet and opens
          // it). The new row is the only selected cell; the old selection cleared.
          await app.nativeClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s1"] .snippet-row-label`,
          );
          await app.nativeClickAtElement(`.lens-section [aria-label="New snippet"]`);
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );
          const green = await app.evalJS<{
            selectedCount: number;
            editingHeaderIsSelected: boolean;
          }>(
            `(() => {
              const cells = [...document.querySelectorAll('.lens-snippets-list .tug-list-view-cell[data-selected="true"]')];
              const header = document.querySelector('.snippet-editor-header[data-snippet-id]');
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
            `document.querySelector('.snippet-editor') === null`,
            { timeoutMs: 3_000 },
          );

          // ---- 1. The header pins while a taller-than-Lens snippet scrolls.
          // Open the long snippet, move the caret to the document end and type —
          // the reveal scrolls the list to the tail. The header must stay stuck
          // at the top of the scroller (sticky), not scroll away with the body.
          await app.nativeDoubleClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="long"] .snippet-row-label`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );

          // A click INSIDE the open editor must not close it — the click stays
          // with the editor (it does not depart the row's descend scope). Wait
          // until the editor has fully claimed focus and the descend has settled
          // (the editor holds the active element AND the list is no longer the
          // keyboard key view) before each in-card click.
          const editorSettled = `document.querySelector('.snippet-editor')?.contains(document.activeElement) === true
             && document.querySelector('.lens-snippets-list')?.hasAttribute('data-key-view-kbd') === false`;

          // (a) A click on the card's CHROME — the sticky header, which is NOT
          // the contenteditable — keeps the editor open.
          await app.waitForCondition<boolean>(editorSettled, { timeoutMs: 3_000 });
          await app.nativeClickAtElement(
            `.snippet-editor-header .snippet-row-label`,
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.snippet-editor .cm-content') !== null`,
            ),
          ).toBe(true);

          // (b) A click on the editor's TEXT keeps it open too (the first line
          // is near the top, on-screen; the tall `.cm-content`'s center would be
          // below the visible frame).
          await app.waitForCondition<boolean>(editorSettled, { timeoutMs: 3_000 });
          await app.nativeClickAtElement(`.snippet-editor .cm-content .cm-line`);
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.snippet-editor .cm-content') !== null`,
            ),
          ).toBe(true);

          await app.nativeKey("ArrowDown", ["cmd"]);
          await app.nativeType(" EDITED");
          // The list genuinely scrolled to follow the caret to the tail.
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-snippets-list').scrollTop > 200`,
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
              const l = document.querySelector('.lens-snippets-list');
              const list = l.getBoundingClientRect();
              const headerEl = document.querySelector('.snippet-editor-header');
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

          // ---- C. The editing section scrolls; it never eats its neighbors.
          // With a snippet far taller than the Lens open, the Sessions band still
          // shows its full content — the editing section absorbed the overflow by
          // scrolling, rather than the flex shrink squeezing Sessions to nothing
          // (which would nudge the pinned header up into it).
          const sessionsEditH = await app.evalJS<number>(
            `Math.round(document.querySelector('.lens-sections > .lens-section').getBoundingClientRect().height)`,
          );
          expect(sessionsEditH).toBeGreaterThanOrEqual(sessionsRestH - 2);
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
