/**
 * at0254-jots-editor-growth.test.ts — the ratified Lens design, measured
 * on the live DOM against a real jots file.
 *
 * Space rules (states A–D of the approved mockups):
 *
 *  1. **Top-anchored stack.** At rest the sections are content-sized and the
 *     leftover space is quiet background below the last band — nothing fills,
 *     nothing pins to the bottom.
 *
 *  2. **The well opens at a writing floor.** A one-line jot's editor opens
 *     as an open card (header row + well) at a ≈6-line height, extending the
 *     stack downward into the slack — the bands below move down by the card's
 *     height and no more.
 *
 *  3. **The carrier rule.** While the caret is the keyboard-focus carrier
 *     (keyboard inside the well), no ring ink paints on the editor — the leaf
 *     ring is suppressed on both the descend wrapper and the editor host.
 *
 *  4. **The caret stays in view while editing a jot taller than the Lens.**
 *     The well grows uncapped, the list is the single scroller, and the editor
 *     reveals its own caret into the list on every edit.
 *
 *     The load-bearing half is 4a, the caret sitting BEHIND the card's pinned
 *     header. Inside the scrollport's rectangle but covered by chrome is the
 *     one state nothing else corrects: WebKit's native editing reveal (which
 *     handles the plain off-the-bottom case on its own, verified by disabling
 *     the app's reveal entirely) reasons about visibility and sees nothing
 *     wrong. Only a reveal that insets the port by its sticky chrome moves it.
 *     4b keeps the tail case as a companion; it is not, by itself, a gate.
 *
 * Runs against an isolated jots file (`TUG_JOTS_PATH`), and in the
 * FOREGROUND: the caret only paints while `document.hasFocus()` is true, which
 * WebKit ties to application activation and the default (pid) launch withholds.
 *
 * @foreground
 * @covers tugdeck/src/components/jots/jots-card.tsx
 * @covers tugdeck/src/lib/jots-store.ts
 * @covers tugdeck/src/lib/jots-doc.ts
 * @covers tugdeck/src/components/tugways/tug-text-editor/
 * @covers tugdeck/src/components/tugways/tug-text-editor.tsx
 * @covers tugdeck/src/components/tugways/tug-message-editor.tsx
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
      const jotsPath = join(dir, "jots.json");
      // A few short jots, then one jot whose body is far taller than the
      // card — its open editor forces the list to scroll well past a screenful.
      const longText = Array.from(
        { length: 160 },
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
          testName: "at0254-jots-editor-growth",
          env: { TUGBANK_PATH: tugbankPath, TUG_JOTS_PATH: jotsPath },
          persistInTestMode: true,
          // The caret is the subject: CM6 paints it only while
          // `document.hasFocus()`, and that needs an activating launch.
          foreground: true,
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 10_000,
          });

          await app.dispatchControlAction("toggle-jots");
          await app.waitForCondition<boolean>(
            `document.querySelector('.jots-list .jot-row-content[data-jot-id="long"]') !== null`,
            { timeoutMs: 5_000 },
          );

          // 1. Top-anchored at rest: real slack sits BELOW the last row —
          //    nothing is stretched to fill it or pinned to the Lens bottom.
          const rest = await app.evalJS<{ slack: number; lastBottom: number }>(
            `(() => {
              const stack = document.querySelector('.jots-card .jots-list').getBoundingClientRect();
              const bands = [...document.querySelectorAll('.jots-card .jots-list .tug-list-view-cell')];
              const last = bands[bands.length - 1].getBoundingClientRect();
              return { slack: Math.round(stack.bottom - last.bottom), lastBottom: Math.round(last.bottom) };
            })()`,
          );
          expect(rest.slack).toBeGreaterThan(100);

          // 2 + 3. Open a ONE-LINE jot: the open card (header + well)
          //    appears at the writing floor, the stack extends downward by the
          //    card's height (slack shrinks but the last row is NOT pinned),
          //    and no ring ink paints while the caret is the carrier.
          await app.nativeDoubleClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="s0"] .jot-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.jot-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );
          // The card animates open (the cell grows 0 → target) — wait until the
          // WRAPPER has settled at the floor and the stack has actually
          // extended (slack below the last row shrank from its rest value).
          await app.waitForCondition<boolean>(
            `(() => {
              const wrap = document.querySelector('.jot-editor');
              if (wrap === null) return false;
              const lineH = parseFloat(getComputedStyle(wrap.querySelector('.cm-content')).lineHeight);
              if (wrap.getBoundingClientRect().height < lineH * 6) return false;
              const stack = document.querySelector('.jots-card .jots-list').getBoundingClientRect();
              const bands = [...document.querySelectorAll('.jots-card .jots-list .tug-list-view-cell')];
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
              const header = document.querySelector('.jot-editor-header').getBoundingClientRect();
              const stack = document.querySelector('.jots-card .jots-list').getBoundingClientRect();
              const bands = [...document.querySelectorAll('.jots-card .jots-list .tug-list-view-cell')];
              const last = bands[bands.length - 1].getBoundingClientRect();
              return {
                headerH: Math.round(header.height),
                slack: Math.round(stack.bottom - last.bottom),
                wrapperOutline: getComputedStyle(document.querySelector('.jot-editor')).outlineStyle,
                hostOutline: getComputedStyle(document.querySelector('.jot-editor-well .tug-text-editor')).outlineStyle,
              };
            })()`,
          );
          // The card header row exists at row height.
          expect(editing.headerH).toBeGreaterThanOrEqual(28);
          // The stack extended into the slack but did NOT fill it — the last
          // row is still not pinned to the list bottom.
          expect(editing.slack).toBeGreaterThan(50);
          expect(editing.slack).toBeLessThan(rest.slack);
          // Carrier rule: no leaf-ring ink on the wrapper or the editor host.
          expect(editing.wrapperOutline).toBe("none");
          expect(editing.hostOutline).toBe("none");

          // Close the card (Escape ascends; the blur commits).
          await app.nativeKey("Escape", []);
          await app.waitForCondition<boolean>(
            `document.querySelector('.jot-editor') === null`,
            { timeoutMs: 3_000 },
          );

          // 4. Open the LONG jot — a body taller than the whole Lens, so the
          //    open card's header pins to the list's top edge while the body
          //    scrolls under it.
          await app.nativeDoubleClickAtElement(
            `.jots-list .jot-row-content[data-jot-id="long"] .jot-row-incipit`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.jot-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );

          // 4a. Edit with the caret BEHIND the pinned header, and it must come
          //     out from under it. Scroll deliberately — and never to the live
          //     edge, which engages the list's follow-bottom and hands the pin,
          //     not the reveal, the last word on scroll position.
          //
          // The well animates open, so the list's scroll range grows over
          // several frames; scrolling before it settles just clamps to 0.
          await app.waitForCondition<boolean>(
            `(() => {
              const list = document.querySelector('.jots-list');
              return list !== null && list.scrollHeight - list.clientHeight > 1200;
            })()`,
            { timeoutMs: 4_000 },
          );
          await app.evalJS<number>(
            `(() => {
              const list = document.querySelector('.jots-list');
              list.scrollTop = 500;
              return Math.round(list.scrollTop);
            })()`,
          );
          // Put the caret on a line well inside the port, then scroll it up to
          // sit BEHIND the pinned header — inside the scrollport's rectangle,
          // so nothing that reasons about mere visibility (WebKit's own
          // editing reveal included) will move it, yet covered by chrome.
          const lineNth = await app.evalJS<number>(
            `(() => {
              const port = document.querySelector('.jots-list').getBoundingClientRect();
              const lines = [...document.querySelectorAll('.jot-editor .cm-line')];
              return lines.findIndex((l) => l.getBoundingClientRect().top > port.top + 200) + 1;
            })()`,
          );
          expect(lineNth).toBeGreaterThan(0);
          await app.nativeClickAtElement(
            `.jot-editor .cm-line:nth-of-type(${lineNth})`,
          );
          const buried = await app.evalJS<number>(
            `(() => {
              const list = document.querySelector('.jots-list');
              const caret = document.querySelector('.jot-editor .tug-text-editor-caret');
              const head = document.querySelector('.jot-editor-header');
              // Land the caret 10px above the header's bottom edge: covered.
              list.scrollTop += caret.getBoundingClientRect().top - (head.getBoundingClientRect().bottom - 10);
              return Math.round(caret.getBoundingClientRect().top - head.getBoundingClientRect().bottom);
            })()`,
          );
          expect(buried).toBeLessThan(0);
          await app.nativeType("TOP ");
          await app.waitForCondition<boolean>(
            `(() => {
              const cur = document.querySelector('.jot-editor .tug-text-editor-caret');
              const head = document.querySelector('.jot-editor-header');
              const list = document.querySelector('.jots-list');
              if (cur === null || head === null || list === null) return false;
              const c = cur.getBoundingClientRect();
              const h = head.getBoundingClientRect();
              const l = list.getBoundingClientRect();
              return c.top >= h.bottom - 1 && c.bottom <= l.bottom + 1;
            })()`,
            { timeoutMs: 3_000 },
          );
          // …and the header really was pinned, or the clause above is vacuous:
          // it is holding the list's top edge with the body scrolled under it.
          const pinned = await app.evalJS<{ gap: number; scrollTop: number }>(
            `(() => {
              const head = document.querySelector('.jot-editor-header').getBoundingClientRect();
              const list = document.querySelector('.jots-list');
              return {
                gap: Math.round(head.top - list.getBoundingClientRect().top),
                scrollTop: Math.round(list.scrollTop),
              };
            })()`,
          );
          expect(pinned.gap).toBeLessThanOrEqual(1);
          expect(pinned.scrollTop).toBeGreaterThan(0);

          // 4b. Now the tail: move the caret to the document end and type. The
          //     caret must stay in view, and the list is what scrolled.
          await app.nativeKey("ArrowDown", ["cmd"]);
          await app.nativeType(" EDITED");
          await app.waitForCondition<boolean>(
            `(() => {
              const cur = document.querySelector('.jot-editor .tug-text-editor-caret');
              const list = document.querySelector('.jots-list');
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
              `document.querySelector('.jots-list').scrollTop > 200`,
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
