/**
 * at0254-lens-snippet-editor-growth.test.ts — the Lens fill model + the snippet
 * editor well, measured on the live DOM against a real snippets file.
 *
 * Invariants:
 *
 *  1. **The Lens is always full.** Exactly one section carries `data-lens-flex`
 *     and absorbs the slack, so the stack composes edge-to-edge — no void ever
 *     trails below the last band.
 *
 *  2. **Opening an editor is geometrically calm.** The editor opens inside the
 *     flexible section's standing share, so the section's outer height does not
 *     change when a well opens.
 *
 *  3. **The well opens at a writing height.** A one-line snippet's editor opens
 *     at the ≈6-line writing floor, not one cramped line — and sits inset with a
 *     real gap below the row above it, so the focus ring can never touch a
 *     neighboring row.
 *
 *  4. **The caret stays in view while editing a snippet taller than the Lens.**
 *     The well grows uncapped and the list is the single scroller; SnippetsBody
 *     reveals the caret into the list on every edit, so typing at the tail of a
 *     very long snippet keeps the caret on-screen.
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
const TEST_TIMEOUT_MS = 60_000;

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

describe.skipIf(!SHOULD_RUN)("at0254 — Lens fill model + snippet editor well", () => {
  test(
    "the Lens fills; a well opens calm at the writing floor; the caret stays in view",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-at0254-"));
      const snippetsPath = join(dir, "snippets.json");
      // A few short snippets, then one snippet whose body is taller than the
      // whole Lens — its open editor forces the list to scroll.
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
          testName: "at0254-lens-snippet-editor-growth",
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
            `document.querySelector('.lens-snippets-list .snippet-row-content[data-snippet-id="long"]') !== null`,
            { timeoutMs: 5_000 },
          );

          // 1. The fill model at rest: the snippets section (tallest content)
          //    is the flexible one, and the stack composes edge-to-edge — the
          //    last band's bottom sits at the stack's bottom, no trailing void.
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-section[data-lens-section="snippets"]')?.dataset.lensFlex === "true"`,
            { timeoutMs: 3_000 },
          );
          expect(
            await app.evalJS<boolean>(
              `(() => {
                const stack = document.querySelector('.lens-sections').getBoundingClientRect();
                const bands = [...document.querySelectorAll('.lens-sections > .lens-section')];
                const last = bands[bands.length - 1].getBoundingClientRect();
                return Math.abs(stack.bottom - last.bottom) <= 2;
              })()`,
            ),
          ).toBe(true);

          const restHeight = await app.evalJS<number>(
            `Math.round(document.querySelector('.lens-section[data-lens-section="snippets"]').getBoundingClientRect().height)`,
          );

          // 2 + 3. Open a ONE-LINE snippet: the well opens at the writing
          //    floor (≈6 lines), inset with a real gap from the row above, and
          //    the section's outer height does not move.
          await app.nativeDoubleClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s0"] .snippet-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );
          // Writing floor: at least 6 lines tall for one line of content. The
          // well animates open (height 0 → target), so wait for the settled
          // height rather than sampling mid-animation.
          await app.waitForCondition<boolean>(
            `(() => {
              const well = document.querySelector('.snippet-editor');
              if (well === null) return false;
              const lineH = parseFloat(getComputedStyle(well.querySelector('.cm-content')).lineHeight);
              return well.getBoundingClientRect().height >= lineH * 6;
            })()`,
            { timeoutMs: 3_000 },
          );
          const short = await app.evalJS<{
            gapAbove: number;
            sectionH: number;
          }>(
            `(() => {
              const well = document.querySelector('.snippet-editor');
              const w = well.getBoundingClientRect();
              const cell = well.closest('.tug-list-view-cell');
              const above = cell.previousElementSibling;
              const gapAbove = above === null ? 99 : w.top - above.getBoundingClientRect().bottom;
              const sectionH = Math.round(document.querySelector('.lens-section[data-lens-section="snippets"]').getBoundingClientRect().height);
              return { gapAbove, sectionH };
            })()`,
          );
          // The well's frame sits clear of the row above — the ring's home.
          expect(short.gapAbove).toBeGreaterThanOrEqual(3);
          // Calm geometry: opening the well did not reshape the section.
          expect(Math.abs(short.sectionH - restHeight)).toBeLessThanOrEqual(2);

          // Close the well (Escape ascends; the blur commits).
          await app.nativeKey("Escape", []);
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor') === null`,
            { timeoutMs: 3_000 },
          );

          // 4. Open the LONG snippet, move the caret to the document end, and
          //    type — editing at the tail of a snippet taller than the Lens.
          //    The caret must stay in view, and the list is what scrolled.
          await app.nativeDoubleClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="long"] .snippet-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );
          await app.nativeKey("ArrowDown", ["cmd"]);
          await app.nativeType(" EDITED");
          await app.waitForCondition<boolean>(
            `(() => {
              const cur = document.querySelector('.snippet-editor .tug-text-editor-caret');
              const list = document.querySelector('.lens-snippets-list');
              if (cur === null || list === null) return false;
              const c = cur.getBoundingClientRect();
              const l = list.getBoundingClientRect();
              return c.top >= l.top - 1 && c.bottom <= l.bottom + 1;
            })()`,
            { timeoutMs: 3_000 },
          );
          // The list genuinely scrolled to follow the caret (the tail is far
          // below the top), proving the reveal — not a coincidental fit.
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.lens-snippets-list').scrollTop > 200`,
            ),
          ).toBe(true);
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
