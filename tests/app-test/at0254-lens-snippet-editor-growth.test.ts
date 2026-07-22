/**
 * at0254-lens-snippet-editor-growth.test.ts — the ratified Lens design, measured
 * on the live DOM against a real snippets file.
 *
 * Space rules (states A–D of the approved mockups):
 *
 *  1. **Top-anchored stack.** At rest the sections are content-sized and the
 *     leftover space is quiet background below the last band — nothing fills,
 *     nothing pins to the bottom.
 *
 *  2. **The well opens at a writing floor.** A one-line snippet's editor opens
 *     as an open card (header row + well) at a ≈6-line height, extending the
 *     stack downward into the slack — the bands below move down by the card's
 *     height and no more.
 *
 *  3. **The carrier rule.** While the caret is the keyboard-focus carrier
 *     (keyboard inside the well), no ring ink paints on the editor — the leaf
 *     ring is suppressed on both the descend wrapper and the editor host.
 *
 *  4. **The caret stays in view while editing a snippet taller than the Lens.**
 *     The well grows uncapped, the list is the single scroller, and SnippetsBody
 *     reveals the caret into the list on every edit.
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

describe.skipIf(!SHOULD_RUN)("at0254 — Lens open card + top-anchored stack", () => {
  test(
    "the stack is top-anchored; the well opens at the floor without ring ink; the caret stays in view",
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

          // 1. Top-anchored at rest: real slack sits BELOW the last band —
          //    nothing is stretched to fill it or pinned to the Lens bottom.
          const rest = await app.evalJS<{ slack: number; lastBottom: number }>(
            `(() => {
              const stack = document.querySelector('.lens-sections').getBoundingClientRect();
              const bands = [...document.querySelectorAll('.lens-sections > .lens-section')];
              const last = bands[bands.length - 1].getBoundingClientRect();
              return { slack: Math.round(stack.bottom - last.bottom), lastBottom: Math.round(last.bottom) };
            })()`,
          );
          expect(rest.slack).toBeGreaterThan(100);

          // 2 + 3. Open a ONE-LINE snippet: the open card (header + well)
          //    appears at the writing floor, the stack extends downward by the
          //    card's height (slack shrinks but the last band is NOT pinned),
          //    and no ring ink paints while the caret is the carrier.
          await app.nativeDoubleClickAtElement(
            `.lens-snippets-list .snippet-row-content[data-snippet-id="s0"] .snippet-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );
          // The card animates open (the cell grows 0 → target) — wait until the
          // WRAPPER has settled at the floor and the stack has actually
          // extended (slack below the last band shrank from its rest value).
          await app.waitForCondition<boolean>(
            `(() => {
              const wrap = document.querySelector('.snippet-editor');
              if (wrap === null) return false;
              const lineH = parseFloat(getComputedStyle(wrap.querySelector('.cm-content')).lineHeight);
              if (wrap.getBoundingClientRect().height < lineH * 6) return false;
              const stack = document.querySelector('.lens-sections').getBoundingClientRect();
              const bands = [...document.querySelectorAll('.lens-sections > .lens-section')];
              const last = bands[bands.length - 1].getBoundingClientRect();
              return Math.round(stack.bottom - last.bottom) < ${rest.slack};
            })()`,
            { timeoutMs: 3_000 },
          );
          const editing = await app.evalJS<{
            headerH: number;
            slack: number;
            wrapperOutline: string;
            hostOutline: string;
          }>(
            `(() => {
              const header = document.querySelector('.snippet-editor-header').getBoundingClientRect();
              const stack = document.querySelector('.lens-sections').getBoundingClientRect();
              const bands = [...document.querySelectorAll('.lens-sections > .lens-section')];
              const last = bands[bands.length - 1].getBoundingClientRect();
              return {
                headerH: Math.round(header.height),
                slack: Math.round(stack.bottom - last.bottom),
                wrapperOutline: getComputedStyle(document.querySelector('.snippet-editor')).outlineStyle,
                hostOutline: getComputedStyle(document.querySelector('.snippet-editor-well .tug-text-editor')).outlineStyle,
              };
            })()`,
          );
          // The card header row exists at row height.
          expect(editing.headerH).toBeGreaterThanOrEqual(28);
          // The stack extended into the slack but did NOT fill it — the last
          // band is still not pinned to the Lens bottom.
          expect(editing.slack).toBeGreaterThan(50);
          expect(editing.slack).toBeLessThan(rest.slack);
          // Carrier rule: no leaf-ring ink on the wrapper or the editor host.
          expect(editing.wrapperOutline).toBe("none");
          expect(editing.hostOutline).toBe("none");

          // Close the card (Escape ascends; the blur commits).
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
