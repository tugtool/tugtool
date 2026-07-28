/**
 * at0278-lens-cmdl-focus-stability.test.ts — ⌘L always lands the keyboard
 * VISIBLY in the Lens, exactly where it was left.
 *
 * ## What this gates
 *
 * ⌘L is a keyboard gesture, so its activation asserts keyboard modality
 * through the one focus channel (`transferFocusForActivation` →
 * `applyBagFocus` → `adoptKeyCard`): the Lens's retained key view comes back
 * RINGED and revealed rather than replayed with whatever modality the last
 * interaction left it. Before this, a pointer click on a Layouts tile left
 * the key view pointer-flavored, and every subsequent ⌘L return was an
 * invisible focus mark — the Lens activated, nothing lit, and a Tab was
 * needed to see where the keyboard was. An invisible mark reads as drift.
 *
 * Four boundaries, in one drive:
 *
 *  - **Exact restore.** A keyboard-placed cursor row survives a ⌘L
 *    out-and-back untouched — same row, ring visible, no Tab.
 *  - **Pointer interactions stay visible.** After a pointer click on a
 *    Layouts tile, the ⌘L return re-asserts the tile group as a KEYBOARD
 *    destination: `data-key-view-kbd` paints without any key press.
 *  - **Slot assignment is a first-class exit.** Space on a row's slot
 *    assigns AND activates the slotted card through
 *    `transferFocusForActivation` (a raw `activateCard` skipped the focus
 *    claim); the ⌘L return restores the descend exactly — ring on the slot.
 *  - **Stale state heals, and ⌘L is never a no-op.** Closing the slotted
 *    card unmounts the descended row under the backgrounded Lens. The next
 *    ⌘L (with no live prior to toggle out to) ascends the dead scope
 *    (`assertKeyboardDestination`) and lands the keyboard somewhere live and
 *    ringed — never parked invisibly on a ghost.
 *
 * @covers tugdeck/src/focus-transfer.ts
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 * @covers tugdeck/src/deck-manager.ts
 * @covers tugdeck/src/components/lens/lens-content.tsx
 * @covers tugdeck/src/components/lens/slot-picker.tsx
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SNIPPETS_LIST = ".lens-content .lens-snippets-list";
const SNIPPETS_KBD = `${SNIPPETS_LIST}[data-key-view-kbd]`;
const CURSOR_ROW = `${SNIPPETS_LIST} [data-key-cursor]`;
const KIND_GROUP = '[data-testid="lens-layouts-kind"]';
const LENS_KBD = ".lens-content [data-key-view-kbd]";

const SNIPPETS = Array.from({ length: 4 }, (_, i) => ({
  id: `s${i}`,
  text: `row-${i} snippet handle`,
}));

function priorCardDeck() {
  return {
    // A Text card: the prior card ⌘L stashes, and the Text Files row whose
    // slot picker the drive assigns from.
    cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
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

/** Whether anything inside the Lens wears the visible keyboard mark. */
async function lensKbdVisible(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.querySelector(${JSON.stringify(LENS_KBD)}) !== null`,
  );
}

describe.skipIf(!SHOULD_RUN)("at0278 — ⌘L lands the keyboard visibly, where it was left", () => {
  test(
    "exact restore, pointer-left modality, slot-assign exit, stale-descend heal",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0278-"));
      const snippetsPath = join(filesDir, "snippets.json");
      const filePath = join(filesDir, "fixture.txt");
      writeFileSync(filePath, "alpha meridian\n");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets: SNIPPETS }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0278-lens-cmdl-focus-stability",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        });
        try {
          await app.seedDeckState({
            state: priorCardDeck(),
            cardStates: {
              A: { content: { path: filePath, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
            },
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          // ---- A. Exact restore: a keyboard cursor row survives ⌘L
          // out-and-back with its ring, no Tab needed.
          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 5_000 },
          );
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(
            `(function(){ var c = document.querySelector(${JSON.stringify(CURSOR_ROW)}); return c !== null && (c.textContent || '').indexOf('row-1') >= 0; })()`,
            { timeoutMs: 3_000 },
          );
          await app.dispatchControlAction("focus-lens"); // out
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() === "A"`,
            { timeoutMs: 3_000 },
          );
          await app.dispatchControlAction("focus-lens"); // back in
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );
          // Same row, ring on, without a single key press since the return.
          const restoredRow = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(CURSOR_ROW)})?.textContent) || ''`,
          );
          expect(restoredRow).toContain("row-1");

          // ---- B. A pointer click on a Layouts tile leaves the key view on
          // the tile group with pointer modality; the ⌘L return must re-assert
          // it as a KEYBOARD destination — ring visible with no Tab.
          await app.click(`${KIND_GROUP}`);
          await app.waitForCondition<boolean>(
            `(function(){ var kv = document.querySelector('.lens-content [data-key-view]'); return kv !== null && kv.closest(${JSON.stringify(KIND_GROUP)}) !== null; })()`,
            { timeoutMs: 3_000 },
          );
          await app.dispatchControlAction("focus-lens"); // out
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() === "A"`,
            { timeoutMs: 3_000 },
          );
          await app.dispatchControlAction("focus-lens"); // back in
          await app.waitForCondition<boolean>(
            `(function(){ var el = document.querySelector(${JSON.stringify(LENS_KBD)}); return el !== null && el.closest(${JSON.stringify(KIND_GROUP)}) !== null; })()`,
            { timeoutMs: 3_000 },
          );
          expect(await lensKbdVisible(app)).toBe(true);

          // ---- C. Slot assignment by keyboard: descend onto the text-file
          // row's slots, Space assigns AND activates the slotted card (the
          // first-class exit). The ⌘L return restores the descend exactly.
          await app.dispatchControlAction("set-imposition", { kind: "two-up" });
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-text-files-list [data-slot="tug-slot"]') !== null`,
            { timeoutMs: 3_000 },
          );
          for (let i = 0; i < 8; i += 1) {
            const on = await app.evalJS<boolean>(
              `document.querySelector('.lens-text-files-list[data-key-view-kbd]') !== null`,
            );
            if (on) break;
            await app.nativeKey("Tab");
            await new Promise<void>((r) => setTimeout(r, 200));
          }
          // Right descends onto the row's FIRST accessory — the leading close
          // box — and the next Right walks on to the slots.
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(function(){ var el = document.querySelector(${JSON.stringify(LENS_KBD)}); return el !== null && (el.getAttribute('aria-label') || '').indexOf('Close ') === 0; })()`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(function(){ var el = document.querySelector(${JSON.stringify(LENS_KBD)}); return el !== null && el.getAttribute('aria-label') === 'Put at position 1'; })()`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey(" "); // assign slot 1 → raises card A
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() === "A"`,
            { timeoutMs: 3_000 },
          );
          await app.dispatchControlAction("focus-lens"); // back in
          await app.waitForCondition<boolean>(
            `(function(){ var el = document.querySelector(${JSON.stringify(LENS_KBD)}); return el !== null && el.getAttribute('aria-label') === 'Put at position 1'; })()`,
            { timeoutMs: 3_000 },
          );

          // ---- D. Stale-descend heal, and ⌘L is never a no-op. Close the
          // slotted card while the Lens is descended into its row: the row
          // unmounts under the backgrounded Lens. ⌘L (already inside the
          // Lens after the close hands focus to the last pane standing — the
          // Lens rail — and with no live prior card) must still land the
          // keyboard somewhere live and ringed.
          await app.dispatchControlAction("focus-lens"); // out to A first
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() === "A"`,
            { timeoutMs: 3_000 },
          );
          await app.evalJS<void>(`window.__tug.closePane("pA")`);
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() !== "A"`,
            { timeoutMs: 3_000 },
          );
          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(LENS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );
          // The healed landing is live — the ring is on a connected element
          // with real geometry, not a ghost of the closed card's row.
          const healed = await app.evalJS<{ label: string | null; width: number }>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(LENS_KBD)});
              return {
                label: el.getAttribute('aria-label'),
                width: Math.round(el.getBoundingClientRect().width),
              };
            })()`,
          );
          expect(healed.width).toBeGreaterThan(0);
          expect(healed.label).not.toBe("Put at position 1");
        } finally {
          await app.close();
        }
      } finally {
        rmTempTugbank(tugbankPath);
        rmSync(filesDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
