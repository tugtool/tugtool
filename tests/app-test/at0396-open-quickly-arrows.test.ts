/**
 * at0396-open-quickly-arrows.test.ts — Open Quickly's keyboard story on the
 * app-modal dialog: ↓ selects the first result on an EMPTY query, Tab walks the
 * dialog's own stops, and ⌥⇥ engages the mode over those stops rather than the
 * card behind them.
 *
 * ## Why this exists
 *
 * Test 1 is the regression KBF mode was written for ([roadmap/kbf-mode.md], the
 * plan's Context section names it as the sharpest casualty). On open, the
 * query is empty and the key view is seeded — the exact state the old
 * `resolveArrowRelease` policy read as "this field is empty, so it has no caret
 * motion to protect, so the engine may have the arrow." The spatial move then
 * declined and the liveliness net consumed ↓ before the surface's own
 * `onKeyDown` ever ran, so ↓ either rang the directory switcher or did nothing.
 *
 * Two rules fix it and both are asserted here:
 *
 *  - the dialog's trap passes `kbf: false`, so it does not auto-engage the mode
 *    and the engine never claims its arrows;
 *  - its field declares an **attached list**, so ↑/↓ drive the result cursor
 *    and never leave the field, *regardless of whether the query is empty* —
 *    which is the whole point, since emptiness is what the old rule keyed on.
 *
 * Test 2 walks the dialog's Tab order: query field (0) → Browse… (1) → the
 * scope chooser's path field (2) → the chevron (3) — the scope row's stops in
 * reading order, which the linear order must match because it doubles as the
 * arrow order (the liveliness net walks it). What it pins is that the walk
 * reaches every stop at all — the chevron had no stop, and the walk did not
 * reach past the chooser, until the fixes in test 3's note below. Return on
 * the chevron opens the seed menu (the engine delivers it as a synthesized
 * click), which is the keyboard door to the dropdown.
 *
 * It does **not** pin the re-scope guard, and the probe is what settled that.
 * `TugComboBox` settles on blur, so the plan expected this Tab to settle the
 * unchanged path on its way past and — without the guard — bounce the key view
 * back to the query field. Patching both halves of the guard out leaves this
 * test green, because on a keyboard walk the chooser's input never holds DOM
 * focus in the first place: the engine parks the stop rather than granting it,
 * so there is no blur and no settle. The guard is still right, and it is real
 * on the pointer path (a click into the field grants it for real); at0306 is
 * where that gets pinned.
 *
 * Test 3 is the KBF adoption. It ran green once while proving nothing, because
 * the seeded card was never bound and so registered no `CYCLE_FOCUS_MODE`
 * handler — the failing tier did not exist. The card is bound here, which is
 * what makes the "not the card behind it" clause mean something. Two probes,
 * both red first: with the dialog's manual-bit restore patched out the
 * no-ring-after-dismiss clause fails, and with `use-cycle-mode`'s
 * resting-mode gate patched out the card behind pushes its cycle over the
 * dialog's trap, the walk order comes back empty (its stops are all behind a
 * `pointer-events: none` overlay), and the ring never reaches the panel.
 *
 * @covers tugdeck/src/components/tugways/tug-modal-input-dialog.tsx
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

const PANEL = '[data-slot="tug-modal-input-dialog"]';
const INPUT = ".tug-modal-input-dialog .tug-modal-input-dialog-input";
const ROWS =
  '[data-slot="tug-modal-input-dialog-list"] .tug-modal-input-dialog-row';
const OVERLAY_ROOT = '[data-slot="tug-canvas-overlay-root"]';
const SCOPE_FIELD = `${PANEL} input.tug-file-chooser-input`;
const BROWSE = `${PANEL} [data-slot="tug-file-chooser-browse"]`;
const CHEVRON = `${PANEL} [data-slot="tug-combo-box-chevron"]`;
const CHOOSER_MENU = '[data-slot="tug-modal-input-dialog-chooser-overlay"]';

/** The ring is on the scope chooser's path field. */
const SCOPE_RINGED = `document.querySelector(${JSON.stringify(SCOPE_FIELD)})?.hasAttribute("data-key-view-kbd") === true`;

/** The ring is on the Browse… button. */
const BROWSE_RINGED = `document.querySelector(${JSON.stringify(BROWSE)})?.hasAttribute("data-key-view-kbd") === true`;

/** The ring is on the combo box's chevron. */
const CHEVRON_RINGED = `document.querySelector(${JSON.stringify(CHEVRON)})?.hasAttribute("data-key-view-kbd") === true`;

/** The ring is on the query field. */
const FIELD_RINGED = `document.querySelector(${JSON.stringify(INPUT)})?.hasAttribute("data-key-view-kbd") === true`;

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
  "at0396: Open Quickly's keyboard story on the modal dialog",
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
            `document.querySelector(${JSON.stringify(PANEL)}) !== null`,
            { timeoutMs: 8000 },
          );
          // Results with NO query typed — the state the regression lived in.
          await app.waitForCondition<boolean>(`${ROW_COUNT} >= 2`, {
            timeoutMs: 15000,
          });
          await app.waitForCondition<boolean>(CARET_IN_FIELD, { timeoutMs: 8000 });

          // The dialog does not engage the mode: it is typing-first.
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
            "no ring paints — the dialog is mode OFF and the arrow was the field's",
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
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "Tab walks query field → scope chooser → Browse…, and a bare Tab re-scopes nothing",
      async () => {
        const dir = mkdtempSync(`${tmpdir()}/at0396-projects-`);
        for (const name of ["alpha.txt", "bravo.txt"]) {
          writeFileSync(`${dir}/${name}`, `${name}\n`);
        }

        const app = await launchTugApp({ testName: "at0396-open-quickly-tab" });
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
            `document.querySelector(${JSON.stringify(PANEL)}) !== null`,
            { timeoutMs: 8000 },
          );
          await app.waitForCondition<boolean>(CARET_IN_FIELD, { timeoutMs: 8000 });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SCOPE_FIELD)}) !== null`,
            { timeoutMs: 8000 },
          );
          const scopeBefore = await app.evalJS<string>(
            `document.querySelector(${JSON.stringify(SCOPE_FIELD)}).value`,
          );

          // Tab engages the mode and steps to the scope row's first stop in
          // reading order — the Browse… folder button.
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(BROWSE_RINGED, { timeoutMs: 6000 });
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(PANEL)}) !== null`,
            ),
            "stepping off the query field does not dismiss the dialog",
          ).toBe(true);
          expect(
            await app.evalJS<boolean>(CARET_IN_FIELD),
            "the caret left the query field",
          ).toBe(false);

          // Tab again parks the chooser's path field — a text stop reached by
          // MOVEMENT: ringed, no caret.
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(SCOPE_RINGED, { timeoutMs: 6000 });

          // Tab once more lands on the chevron. This is the assertion the
          // changed-only re-scope guard exists for: the chooser settles on
          // blur, and a re-scope fired from that settle would re-seed the key
          // view onto the query field, so the walk would appear to skip the
          // chevron entirely.
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(CHEVRON_RINGED, { timeoutMs: 6000 });
          note(
            "after three Tabs",
            await app.evalJS<string>(
              `JSON.stringify({ ringed: Array.from(document.querySelectorAll("[data-key-view-kbd]")).map(function(e){ return e.getAttribute("data-slot") || e.className || e.tagName; }) })`,
            ),
          );
          expect(
            await app.evalJS<boolean>(FIELD_RINGED),
            "the walk did not bounce back to the query field",
          ).toBe(false);
          // …and the scope itself never moved.
          expect(
            await app.evalJS<string>(
              `document.querySelector(${JSON.stringify(SCOPE_FIELD)}).value`,
            ),
            "a Tab through the chooser leaves the scope exactly as it was",
          ).toBe(scopeBefore);

          // Return on the chevron opens the seed menu — the engine delivers
          // Return to a leaf as a synthesized click, and the chevron's
          // keyboard click path is the same toggle the pointer uses.
          await app.nativeKey("Return");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CHOOSER_MENU)}) !== null`,
            { timeoutMs: 6000 },
          );
          // Escape closes only the menu — the dialog survives.
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CHOOSER_MENU)}) === null`,
            { timeoutMs: 6000 },
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(PANEL)}) !== null`,
            ),
            "Escape on the open menu closes the menu, not the dialog",
          ).toBe(true);

          // Opening the menu moved the caret into the chooser field (that is
          // the chevron's contract: the list is driven from the field). ⇧Tab
          // from there walks BACK to Browse…, so the walk carries both
          // directions — and the blur this causes settles the unchanged path,
          // which the re-scope guard must swallow.
          await app.nativeKey("Tab", ["shift"]);
          await app.waitForCondition<boolean>(BROWSE_RINGED, { timeoutMs: 6000 });
          expect(
            await app.evalJS<string>(
              `document.querySelector(${JSON.stringify(SCOPE_FIELD)}).value`,
            ),
            "the settle fired by leaving the field re-scoped nothing",
          ).toBe(scopeBefore);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "⌥⇥ engages the dialog's own mode, not the session card behind it, and leaves no ring",
      async () => {
        // A REAL SESSION CARD behind the dialog. That is the whole test.
        //
        // ⌥⇥'s first tier dispatches to the key card, and the session card is
        // the one card that registers a `CYCLE_FOCUS_MODE` handler. With the
        // dialog up, letting the card answer is destructive: it enters its own
        // cycle and moves the key view into itself, so the ring lands behind
        // the surface the user is looking at.
        //
        // An empty deck cannot see any of that: no card, no key-card tier, no
        // failure. This test was originally written that way and passed while
        // the gesture was broken in the app. The card is the fixture.
        const app = await launchTugApp({ testName: "at0396-open-quickly-kbf" });
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(OVERLAY_ROOT)}) !== null`,
            { timeoutMs: 20000 },
          );
          await app.seedDeckState({
            state: {
              cards: [
                { id: "A", componentId: "session", title: "Session", closable: true },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 760, height: 560 },
                  cardIds: ["A"],
                  activeCardId: "A",
                  title: "",
                  acceptsFamilies: ["maker"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 20000 },
          );
          // Bind and wait for the engine. Without this the card renders but
          // registers no `CYCLE_FOCUS_MODE` handler, the key-card tier no-ops,
          // and the test cannot tell a gated dispatch from an ungated one.
          // `isEngineReady` reads the deck-trace ring, so the trace has to be on
          // BEFORE the engine mounts or the event this waits for is never
          // recorded — the wait then times out on a card whose engine is ready.
          await app.enableDeckTrace(true);
          await app.bindSession("A");
          await app.awaitEngineReady("A");
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("open-quickly"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(PANEL)}) !== null`,
            { timeoutMs: 8000 },
          );
          await app.waitForCondition<boolean>(CARET_IN_FIELD, { timeoutMs: 8000 });
          // NOT asserted here: that the mode is off on open. A session card at
          // rest engages it through `keyCard.kbfAtRest`, so the deck this dialog
          // floats over is already engaged — the trap's own `kbf: false` opts
          // out of auto-engaging, which is a different claim. Test 1 makes the
          // mode-off claim, over a deck with no card to derive it.
          note(
            "before ⌥⇥",
            await app.evalJS<string>(
              `JSON.stringify({ kbf: document.documentElement.hasAttribute("data-kbf"), caret: ${CARET_IN_FIELD} })`,
            ),
          );

          // ⌥⇥ engages the mode AND parks the stop the caret is on —
          // `toggleKbfManual` lands the gesture as a movement arrival, so the
          // ring appears on the query field with the press and the caret goes
          // away. Without the park the bit went up with nothing painted (a
          // caret and a ring are mutually exclusive) and the still-granted
          // route forced every subsequent ⌥⇥ back to true: an engagement that
          // showed nothing and could never be turned off.
          await app.nativeKey("Tab", ["alt"]);
          await app.waitForCondition<boolean>(
            `window.__tug.kbfEngaged() === true && window.__tug.kbfManual() === true`,
            { timeoutMs: 6000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(PANEL)} + " [data-key-view-kbd]").length > 0`,
            { timeoutMs: 6000 },
          );
          expect(
            await app.evalJS<boolean>(CARET_IN_FIELD),
            "⌥⇥ parks the granted stop — ring up, caret gone",
          ).toBe(false);
          // The ring is PAINTED, not merely attributed: the dialog's CSS strips
          // TugInput's chrome from the query field, and the strip once took the
          // global leaf ring down with it — attribute present, zero-width
          // outline, nothing on screen.
          const ringPaint = await app.evalJS<{ style: string; width: number }>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(INPUT)});
              var cs = getComputedStyle(el);
              return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
            })()`,
          );
          note("ring paint on the query field", JSON.stringify(ringPaint));
          expect(ringPaint.style, "the parked query field paints a real outline").toBe("solid");
          expect(ringPaint.width, "the ring has visible width").toBeGreaterThan(0);

          // Escape at the parked stop asks for the caret, NOT the close —
          // "stop steering" and "close the surface" are two gestures. The
          // grant clears the manual bit, so the mode's marks stand down and
          // the caret blinks in the query field with the dialog still up.
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(CARET_IN_FIELD, {
            timeoutMs: 6000,
          });
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(PANEL)}) !== null`,
            ),
            "Escape at a parked stop cancels the mode, never the dialog",
          ).toBe(true);
          await app.waitForCondition<boolean>(
            `window.__tug.kbfManual() === false`,
            { timeoutMs: 6000 },
          );

          // Re-engage for the walk below.
          await app.nativeKey("Tab", ["alt"]);
          await app.waitForCondition<boolean>(
            `window.__tug.kbfManual() === true && ${CARET_IN_FIELD} === false`,
            { timeoutMs: 6000 },
          );
          note(
            "after ⌥⇥",
            await app.evalJS<string>(
              `JSON.stringify({
                dialog: document.querySelector(${JSON.stringify(PANEL)}) !== null,
                ringed: Array.from(document.querySelectorAll("[data-key-view-kbd]")).map(function(e){ return e.getAttribute("data-slot") || e.className || e.tagName; }),
                manual: window.__tug.kbfManual(),
              })`,
            ),
          );

          // The surface survives the gesture.
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(PANEL)}) !== null`,
            ),
            "⌥⇥ must not dismiss the dialog — the card behind it never gets the gesture",
          ).toBe(true);

          // Tab moves the ring to the next stop, still inside the panel — and
          // this is where the target is proved. The engagement is deck-global,
          // so the card behind is free to answer it by pushing its own focus
          // cycle ON TOP of the dialog's trap; when it did, the walk serviced
          // a mode whose stops all sit behind the modal overlay
          // (`pointer-events: none`), the walk order came back empty, and Tab
          // moved nothing at all. So: the ring lands inside the dialog, and
          // nothing rings on the card.
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(PANEL)} + " [data-key-view-kbd]").length > 0 && ${FIELD_RINGED} === false`,
            { timeoutMs: 6000 },
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('[data-card-id="A"] [data-key-view-kbd]') !== null`,
            ),
            "the session card behind the dialog did not enter its own cycle",
          ).toBe(false);

          // ⌥⇥ from the parked stop disengages the mode.
          await app.nativeKey("Tab", ["alt"]);
          await app.waitForCondition<boolean>(
            `window.__tug.kbfManual() === false`,
            { timeoutMs: 6000 },
          );

          // Engage once more, then dismiss. The manual bit is STORED, not
          // derived, and `popFocusMode` clears it only for engaging traps — a
          // `kbf: false` trap manages its own. Without the dialog's
          // capture-and-restore, the ⌥⇥ pressed in here would strand a ring on
          // the deck the user comes back to.
          await app.nativeKey("Tab", ["alt"]);
          await app.waitForCondition<boolean>(
            `window.__tug.kbfManual() === true`,
            { timeoutMs: 6000 },
          );
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(PANEL)}) === null`,
            { timeoutMs: 8000 },
          );
          await app.waitForCondition<boolean>(
            `window.__tug.kbfManual() === false`,
            { timeoutMs: 6000 },
          );
          note(
            "after dismiss",
            await app.evalJS<string>(
              `JSON.stringify({
                manual: window.__tug.kbfManual(),
                ringed: Array.from(document.querySelectorAll("[data-key-view-kbd]")).map(function(e){ return e.getAttribute("data-slot") || e.className || e.tagName; }),
              })`,
            ),
          );
          expect(
            await app.evalJS<boolean>(`window.__tug.kbfManual()`),
            "the ⌥⇥ pressed inside the dialog does not outlive it",
          ).toBe(false);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
