/**
 * at0088-permission-mode-chip.test.ts — the Z4B permission-mode chip cycles
 * with `Shift+Tab` and via its behavior sheet ([AT0088]).
 *
 * ## Why this exists
 *
 * The permission-mode chip is a two-line `TugPushButton`. There is no
 * `system_metadata` round-trip on a `set_permission_mode` (claude answers with
 * a control_response only), so the chip reflects the change optimistically via
 * `SessionMetadataStore.applyPermissionMode`. Two user paths drive it:
 *
 *   1. **`Shift+Tab`** — the `CYCLE_PERMISSION_MODE` key-card binding →
 *      the dev card's card-content responder → `cycle()`. The chip's value
 *      line must advance through default → acceptEdits → plan → auto.
 *   2. **Behavior sheet** — clicking the chip opens a `TugSheet` listing the
 *      behavior options; picking one calls the dev card's `setMode`. Picking
 *      an option must update the chip to that mode.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const CHIP = `${CARD} [data-slot="permission-mode-chip"]`;
// The shown value only — the width-stabilizer sizers also live under
// .tug-button-content, so read the dedicated shown span.
const CHIP_CONTENT = `${CHIP} [data-slot="permission-mode-value"]`;
const CHIP_ICON = `${CHIP} svg`;
// Behavior sheet + its option rows (rendered into the pane frame portal).
const SHEET = '[data-slot="tug-sheet"]';
const AUTO_OPTION = `${SHEET} [data-mode="auto"]`;
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** Trimmed text of the chip's value line. `null` if the chip is absent. */
async function chipMode(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(CHIP_CONTENT)});
      return el ? el.textContent.trim() : null;
    })()`,
  );
}

const KNOWN_MODE_LABELS = ["Default", "Accept Edits", "Plan", "Auto", "Bypass"];

/** Outer width of the chip, rounded to 1/100 px. */
async function chipWidth(app: App): Promise<number | null> {
  return await app.evalJS<number | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(CHIP)});
      return el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null;
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0088: permission-mode chip cycles via Shift+Tab and the behavior sheet",
  () => {
    test(
      "Shift+Tab advances the mode; the behavior sheet sets it explicitly",
      async () => {
        const app = await launchTugApp({ testName: "at0088-permission-mode-chip" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindDevSession("A");
          await app.awaitEngineReady("A");

          // The chip mounts as a two-line button with a value line and the
          // shield-cog icon. (We do not wait for live claude metadata: the
          // optimistic cycle works from the unknown state too, and headless
          // claude is slow / may never emit a `system_metadata` — the chip's
          // behavior under test is the client-side cycle + sheet, not the live
          // mode value.)
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CHIP_CONTENT)}) !== null`,
            { timeoutMs: 8000 },
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(CHIP_ICON)}) !== null`,
            ),
            "chip must render its leading icon",
          ).toBe(true);

          const initialMode = await chipMode(app);

          // 1. Shift+Tab advances the mode (focus the editor first so the
          //    dev card is the key card the binding routes to). From an
          //    unknown ("…") state the cycle resets to Default; from a known
          //    mode it steps to the next.
          //
          //    The chord is dispatched as a synthetic capture-phase keydown
          //    rather than a native CGEvent: macOS full-keyboard-access eats a
          //    posted ⇧⇥ for focus-ring navigation before it reaches the
          //    WebView, whereas a real user's keystroke reaches the document
          //    listener normally. The synthetic event drives the exact same
          //    capture-phase pipeline (`matchKeybinding` → key-card dispatch).
          await app.nativeClickAtElement(PROMPT_INPUT);
          await app.evalJS<void>(
            `document.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", key: "Tab", shiftKey: true, bubbles: true, cancelable: true }))`,
          );
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_CONTENT)});
              if (el === null) return false;
              var t = el.textContent.trim();
              return t !== ${JSON.stringify(initialMode)} &&
                ${JSON.stringify(KNOWN_MODE_LABELS)}.indexOf(t) !== -1;
            })()`,
            { timeoutMs: 4000 },
          );
          const afterCycle = await chipMode(app);
          expect(afterCycle, "Shift+Tab must change the mode").not.toBe(initialMode);
          expect(KNOWN_MODE_LABELS).toContain(afterCycle!);
          const widthAtCycle = await chipWidth(app);

          // 2. Behavior sheet sets the mode explicitly. Click the chip to open
          //    the sheet, then pick "Auto" via a real click so the full
          //    button → onClick → setMode path runs.
          await app.nativeClickAtElement(CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(AUTO_OPTION)}) !== null`,
            { timeoutMs: 4000 },
          );
          // The sheet lists every behavior option, and exactly the current
          // mode reads as selected.
          const sheetState = await app.evalJS<{ total: number; selected: string[] }>(
            `(function(){
              var opts = document.querySelectorAll(${JSON.stringify(`${SHEET} [data-mode]`)});
              var selected = [];
              for (var i = 0; i < opts.length; i++) {
                if (opts[i].getAttribute('data-selected') === 'true') {
                  // Read the title line only — each row also carries a subtitle.
                  var t = opts[i].querySelector('.tug-list-row-title');
                  selected.push((t ? t.textContent : opts[i].textContent).trim());
                }
              }
              return { total: opts.length, selected: selected };
            })()`,
          );
          expect(sheetState.total, "sheet lists every behavior option").toBe(5);
          expect(sheetState.selected, "exactly the current mode is selected").toEqual([
            afterCycle!,
          ]);

          // Every row reserves a leading check holder (so titles align), and
          // exactly the current mode shows a checkmark inside it.
          const checks = await app.evalJS<{ holders: number; marks: number }>(
            `(function(){
              return {
                holders: document.querySelectorAll(${JSON.stringify(`${SHEET} .permission-mode-check`)}).length,
                marks: document.querySelectorAll(${JSON.stringify(`${SHEET} .permission-mode-check svg`)}).length,
              };
            })()`,
          );
          expect(checks.holders, "every option reserves a check holder").toBe(5);
          expect(checks.marks, "exactly the current mode is checkmarked").toBe(1);

          await app.nativeClickAtElement(AUTO_OPTION);
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_CONTENT)});
              return el !== null && el.textContent.trim() === "Auto";
            })()`,
            { timeoutMs: 4000 },
          );
          expect(await chipMode(app), "sheet pick must set the chip mode").toBe("Auto");

          // 3. Width stabilization: the chip reserves its widest label, so the
          //    mode change above (a different-length value) does not reflow it.
          const widthAtAuto = await chipWidth(app);
          expect(widthAtCycle, "chip width must be measurable").not.toBeNull();
          expect(
            widthAtAuto,
            "permission chip must not reflow across mode values ([R01], this chip)",
          ).toBe(widthAtCycle);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0088-permission-mode-chip] log tail:\n${tail}\n`);
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
