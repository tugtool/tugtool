/**
 * at0396-open-quickly-arrows.test.ts — ↓ selects the first result on an EMPTY
 * query, from the first keystroke.
 *
 * ## Why this exists
 *
 * This is the regression KBF mode was written for ([roadmap/kbf-mode.md], the
 * plan's Context section names it as the sharpest casualty). On open, the
 * popup's query is empty and its key view is seeded — the exact state the old
 * `resolveArrowRelease` policy read as "this field is empty, so it has no caret
 * motion to protect, so the engine may have the arrow." The spatial move then
 * declined and the liveliness net consumed ↓ before the popup's own `onKeyDown`
 * ever ran, so ↓ either rang the directory switcher or did nothing — in exactly
 * the state a fast open-quickly gesture passes through.
 *
 * Two rules fix it and both are asserted here:
 *
 *  - the popup's trap passes `kbf: false` ([P03]), so it does not auto-engage
 *    the mode and the engine never claims its arrows;
 *  - its field declares an **attached list** ([P08]), so ↑/↓ drive the result
 *    cursor and never leave the field, *regardless of whether the query is
 *    empty* — which is the whole point, since emptiness is what the old rule
 *    keyed on.
 *
 * [P07] case 2 — `Tab` from this single-line field reaching the directory
 * switcher — is deliberately NOT asserted yet; see the note at the end of the
 * test and the plan's ledger.
 *
 * @covers tugdeck/src/components/tugways/tug-completion-popup.tsx
 * @covers tugdeck/src/components/tugways/responder-chain-provider.tsx
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/components/chrome/open-quickly-overlay.tsx
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";
import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const POPUP = '[data-slot="tug-completion-popup"]';
const INPUT = ".tug-completion-popup .tug-completion-popup-input";
const ROWS = '[data-slot="tug-completion-popup-list"] .tug-completion-popup-row';
const OVERLAY_ROOT = '[data-slot="tug-canvas-overlay-root"]';
const SWITCHER = '[data-slot="tug-completion-popup-accessory"] button';

/** The index of the highlighted result row, or -1 when none is. */
const SELECTED_INDEX = `(function(){
  var rows = Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}));
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute("data-selected") === "true") return i;
  }
  return -1;
})()`;

const ROW_COUNT = `document.querySelectorAll(${JSON.stringify(ROWS)}).length`;

/** Whether the caret is in the query field. */
const CARET_IN_FIELD = `(function(){
  var el = document.querySelector(${JSON.stringify(INPUT)});
  return el !== null && document.activeElement === el;
})()`;

describe.skipIf(!SHOULD_RUN)(
  "at0396: Open Quickly's arrows drive its results on an empty query",
  () => {
    test(
      "↓ / ↑ move the result cursor with an empty query and the caret never leaves",
      async () => {
        // Several files so there is a list to move a cursor through, and so a
        // second ↓ has somewhere to go.
        const dir = mkdtempSync(`${tmpdir()}/at0396-projects-`);
        mkdirSync(`${dir}/nested`, { recursive: true });
        for (const name of ["alpha.txt", "bravo.txt", "charlie.txt"]) {
          writeFileSync(`${dir}/${name}`, `${name}\n`);
        }
        writeFileSync(`${dir}/nested/delta.txt`, "delta\n");

        const app = await launchTugApp({ testName: "at0396-open-quickly-arrows" });
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(OVERLAY_ROOT)}) !== null`,
            { timeoutMs: 20000 },
          );
          await app.evalJS<null>(
            `(window.__tug.setTugbankValue("dev.tugtool.app", "default-project-path", { kind: "string", value: ${JSON.stringify(dir)} }), null)`,
          );
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("open-quickly"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
            { timeoutMs: 8000 },
          );
          // Results with NO query typed — the state the regression lived in.
          await app.waitForCondition<boolean>(`${ROW_COUNT} >= 2`, {
            timeoutMs: 15000,
          });
          await app.waitForCondition<boolean>(CARET_IN_FIELD, { timeoutMs: 8000 });

          // The popup does not engage the mode: it is typing-first ([P03]).
          expect(
            await app.evalJS<boolean>(
              `document.documentElement.hasAttribute("data-kbf")`,
            ),
            "a typing-first trap does not auto-engage KBF",
          ).toBe(false);

          note(
            "on open",
            await app.evalJS<string>(
              `JSON.stringify({ rows: ${ROW_COUNT}, selected: ${SELECTED_INDEX} })`,
            ),
          );

          // ↓ moves the result cursor — the assertion this whole file exists
          // for. The query is still empty.
          const before = await app.evalJS<number>(SELECTED_INDEX);
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(
            `${SELECTED_INDEX} === ${before + 1}`,
            { timeoutMs: 6000 },
          );
          // …and the caret never left the field.
          expect(
            await app.evalJS<boolean>(CARET_IN_FIELD),
            "the arrow drives the list without taking the caret out of the field",
          ).toBe(true);
          // …and nothing rang: the engine never claimed the key.
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll("[data-key-view-kbd]").length`,
            ),
            "no ring paints — the popup is mode OFF and the arrow was the field's",
          ).toBe(0);

          // ↑ comes back, so the contract carries both directions.
          await app.nativeKey("ArrowUp");
          await app.waitForCondition<boolean>(`${SELECTED_INDEX} === ${before}`, {
            timeoutMs: 6000,
          });
          expect(await app.evalJS<boolean>(CARET_IN_FIELD)).toBe(true);

          // Typing and clearing back to empty must not change any of it — the
          // old rule re-decided this on every keystroke from the field's
          // contents, and the contract is deliberately unconditional.
          await app.nativeType("a");
          await app.waitForCondition<boolean>(`${ROW_COUNT} >= 1`, {
            timeoutMs: 8000,
          });
          await app.nativeKey("Backspace");
          await app.waitForCondition<boolean>(`${ROW_COUNT} >= 2`, {
            timeoutMs: 8000,
          });
          const afterRoundTrip = await app.evalJS<number>(SELECTED_INDEX);
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(
            `${SELECTED_INDEX} === ${afterRoundTrip + 1}`,
            { timeoutMs: 6000 },
          );
          expect(
            await app.evalJS<boolean>(CARET_IN_FIELD),
            "typing then deleting back to empty does not change arrow behavior",
          ).toBe(true);

          // NOTE — [P07] case 2 (Tab from the single-line field reaches the
          // directory switcher) is NOT asserted here yet. The switcher is
          // authored into the popup's focus group at the accessory order, and
          // the Tab split routes the key to the walk, but the landing does not
          // arrive; the popup's own `onBlur` dismiss guard is the first
          // suspect. Tracked in roadmap/kbf-mode.md's ledger rather than
          // asserted-and-skipped, so it reads as unfinished work rather than a
          // passing promise.
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
