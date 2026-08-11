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
 * The second test covers [P07] case 2 — `Tab` from this single-line field
 * reaching the directory switcher. The field has no Tab meaning of its own, so
 * the key is a request to leave: it engages the mode and steps. The switcher
 * renders only when there is more than one candidate directory, so this test
 * seeds a recent project to give the walk somewhere to go — with a single
 * candidate the accessory is absent and there is no second stop, which is not
 * the same thing as Tab failing to reach it.
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

/** The ring is on the switcher — the landing [P07] case 2 is about. */
const SWITCHER_RINGED = `document.querySelector(${JSON.stringify(SWITCHER)})?.hasAttribute("data-key-view-kbd") === true`;

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

        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "Tab reaches the directory switcher and ⇧Tab comes back ([P07] case 2)",
      async () => {
        const dir = mkdtempSync(`${tmpdir()}/at0396-projects-`);
        for (const name of ["alpha.txt", "bravo.txt"]) {
          writeFileSync(`${dir}/${name}`, `${name}\n`);
        }
        // A second candidate directory, so the switcher renders at all.
        const other = mkdtempSync(`${tmpdir()}/at0396-other-`);
        writeFileSync(`${other}/echo.txt`, "echo\n");

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
            `(window.__tug.setTugbankValue("dev.tugtool.dev", "recent-projects", { kind: "json", value: { paths: [${JSON.stringify(other)}] } }), null)`,
          );
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("open-quickly"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
            { timeoutMs: 8000 },
          );
          await app.waitForCondition<boolean>(CARET_IN_FIELD, { timeoutMs: 8000 });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SWITCHER)}) !== null`,
            { timeoutMs: 8000 },
          );

          // Tab engages the mode and steps to the accessory. The popup must
          // survive it: the field blurs and the engine parks the sink, and
          // `onBlur`'s sink exemption is what keeps that from reading as the
          // keyboard leaving the popup.
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(SWITCHER_RINGED, {
            timeoutMs: 6000,
          });
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
            ),
            "stepping off the field does not dismiss the popup",
          ).toBe(true);
          expect(
            await app.evalJS<boolean>(CARET_IN_FIELD),
            "the caret left the field — the switcher is engine-routed",
          ).toBe(false);
          note(
            "after Tab",
            await app.evalJS<string>(
              `JSON.stringify({ ringed: document.querySelectorAll("[data-key-view-kbd]").length, kbf: document.documentElement.hasAttribute("data-kbf") })`,
            ),
          );

          // ⇧Tab returns to the field. It is a text stop reached by MOVEMENT,
          // so it parks: ringed, no caret, until a printable asks for one
          // ([P12]).
          await app.nativeKey("Tab", ["shift"]);
          await app.waitForCondition<boolean>(FIELD_RINGED, { timeoutMs: 6000 });
          expect(
            await app.evalJS<boolean>(CARET_IN_FIELD),
            "a text stop arrived at by movement is parked — ring, no caret",
          ).toBe(false);

          // And the stop is operable, not merely reachable: Space on the
          // engine-routed switcher opens its menu.
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(SWITCHER_RINGED, {
            timeoutMs: 6000,
          });
          await app.nativeKey(" ");
          await app.waitForCondition<boolean>(
            `document.querySelector('[role="menu"]') !== null`,
            { timeoutMs: 6000 },
          );
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "⌥⇥ in the popup engages the popup's mode, not the session card behind it",
      async () => {
        // A REAL SESSION CARD behind the popup. That is the whole test.
        //
        // ⌥⇥'s first tier dispatches to the key card, and the session card is
        // the one card that registers a `CYCLE_FOCUS_MODE` handler. With the
        // popup up, letting the card answer is destructive: it enters its own
        // cycle, moves the key view into itself, and DOM focus lands somewhere
        // that is neither inside the popup's panel nor on the engine key sink
        // — so the popup's blur-dismiss closes it. ⌥⇥ reads as "Open Quickly
        // disappears".
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
          // and the test cannot tell a gated dispatch from an ungated one —
          // verified by patching the gate out and watching it still pass.
          await app.bindSession("A");
          await app.awaitEngineReady("A");
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("open-quickly"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
            { timeoutMs: 8000 },
          );
          await app.waitForCondition<boolean>(CARET_IN_FIELD, { timeoutMs: 8000 });
          // NOT asserted here: that the mode is off on open. A session card at
          // rest engages it through `keyCard.kbfAtRest`, so the deck this popup
          // floats over is already engaged — the trap's own `kbf: false` opts
          // out of auto-engaging, which is a different claim. The first test
          // makes the mode-off claim, over a deck with no card to derive it.
          note(
            "before ⌥⇥",
            await app.evalJS<string>(
              `JSON.stringify({ kbf: document.documentElement.hasAttribute("data-kbf"), caret: ${CARET_IN_FIELD} })`,
            ),
          );

          await app.nativeKey("Tab", ["alt"]);
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(POPUP)} + " [data-key-view-kbd]").length > 0`,
            { timeoutMs: 6000 },
          );
          note(
            "after ⌥⇥",
            await app.evalJS<string>(
              `JSON.stringify({
                popup: document.querySelector(${JSON.stringify(POPUP)}) !== null,
                ringed: Array.from(document.querySelectorAll("[data-key-view-kbd]")).map(function(e){ return e.getAttribute("data-slot") || e.tagName; }),
                active: document.activeElement && (document.activeElement.className || document.activeElement.tagName),
              })`,
            ),
          );

          // The assertion the app-reported bug turns on: the surface survives.
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(POPUP)}) !== null`,
            ),
            "⌥⇥ must not dismiss the popup — the card behind it never gets the gesture",
          ).toBe(true);
          // And the ring is INSIDE the popup, not on the card behind it.
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(POPUP)} + " [data-key-view-kbd]").length`,
            ),
            "the ring lands among the popup's own stops",
          ).toBeGreaterThan(0);
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('[data-card-id="A"] [data-key-view-kbd]') !== null`,
            ),
            "the session card behind the popup did not enter its own cycle",
          ).toBe(false);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
