/**
 * at0088-permission-mode-chip.test.ts — the Z4B permission-mode chip cycles
 * with `Shift+Tab` and via its chevron popup menu ([AT0088]).
 *
 * ## Why this exists
 *
 * Step 1 of the dev-card / Claude-Code-parity plan adds the permission-mode
 * chip. There is no `system_metadata` round-trip on a `set_permission_mode`
 * (claude answers with a control_response only), so the chip reflects the
 * change optimistically via `SessionMetadataStore.applyPermissionMode`. Two
 * user paths drive it:
 *
 *   1. **`Shift+Tab`** — the `CYCLE_PERMISSION_MODE` key-card binding →
 *      the dev card's card-content responder → `cycle()`. The chip's value
 *      line must advance through default → acceptEdits → plan → auto.
 *   2. **Chevron menu** — clicking the chip opens a popup menu whose items
 *      dispatch `select-value` through the chain to the dev card, which sets
 *      the mode. Picking an item must update the chip to that mode.
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
// .tug-badge-content, so read the dedicated shown span.
const CHIP_CONTENT = `${CHIP} [data-slot="permission-mode-value"]`;
const CHIP_CHEVRON = `${CHIP} .tug-badge-chevron`;
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
  "AT0088: permission-mode chip cycles via Shift+Tab and the chevron menu",
  () => {
    test(
      "Shift+Tab advances the mode; the chevron menu sets it explicitly",
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

          // The chip mounts with a value line and a chevron hint. (We do not
          // wait for live claude metadata: the optimistic cycle works from the
          // unknown state too, and headless claude is slow / may never emit a
          // `system_metadata` — the chip's behavior under test is the
          // client-side cycle + menu, not the live mode value.)
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CHIP_CONTENT)}) !== null`,
            { timeoutMs: 8000 },
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(CHIP_CHEVRON)}) !== null`,
            ),
            "chip must render a chevron hint",
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

          // 2. Chevron menu sets the mode explicitly. Open the menu by
          //    clicking the chip, then pick "Auto" (menu item index 3 in
          //    PERMISSION_MODE_MENU) via a real click — Radix fires `onSelect`
          //    from pointer events, so a native click drives the full
          //    item → chain-dispatch → setMode path.
          const AUTO_ITEM = `.tug-menu-content [data-item-id="3"]`;
          await app.nativeClickAtElement(CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(AUTO_ITEM)}) !== null`,
            { timeoutMs: 4000 },
          );
          // The teaching header is present and non-selectable (a menu label,
          // not an item — no data-item-id, so it can never be chosen).
          expect(
            await app.evalJS<boolean>(
              `(function(){
                var labels = document.querySelectorAll('.tug-menu-content .tug-menu-label');
                for (var i = 0; i < labels.length; i++) {
                  if (labels[i].textContent.indexOf("Tab to cycle") !== -1 &&
                      !labels[i].hasAttribute('data-item-id')) return true;
                }
                return false;
              })()`,
            ),
            'menu must show a non-selectable "Tab to cycle" header',
          ).toBe(true);
          await app.nativeClickAtElement(AUTO_ITEM);
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_CONTENT)});
              return el !== null && el.textContent.trim() === "Auto";
            })()`,
            { timeoutMs: 4000 },
          );
          expect(await chipMode(app), "menu pick must set the chip mode").toBe("Auto");

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
