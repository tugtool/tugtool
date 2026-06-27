/**
 * at0199 — a trapped floating surface (the title-bar "Close N Tabs?" confirm
 * popover) must NOT project the `data-key-within` mark onto the control it was
 * opened from. The within mark is the "contains the active component" cue for a
 * DESCEND scope, where the key view moves into a container that stays its DOM
 * ancestor. A portaled, trapped surface is opened FROM a trigger that does not
 * contain it, so marking that trigger paints a spurious focus ring on the host
 * control sitting behind the open popover.
 *
 * Repro: open the Component Gallery, put a KEYBOARD key view on a body control
 * (Tab), then click the title-bar X to raise the confirm popover. Before the
 * fix the prior key view kept a `data-key-within` outline behind the popover.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const GALLERY_PANE_ID_EXPR = `(function(){
  var panes = document.querySelectorAll('.tug-pane[data-pane-id]');
  for (var i = 0; i < panes.length; i++) {
    var titleEl = panes[i].querySelector('[data-testid="tug-pane-title"]');
    var title = titleEl ? (titleEl.textContent || "") : "";
    if (title.indexOf("Component Gallery") !== -1) {
      return panes[i].getAttribute('data-pane-id');
    }
  }
  return null;
})()`;

const CONFIRM_POPOVER_SELECTOR = '[data-slot="tug-confirm-popover"]';

describe.skipIf(!SHOULD_RUN)(
  "at0199: trapped confirm popover must not leave a within ring on its host",
  () => {
    test(
      "keyboard key view on a card control → open X-confirm → no host within mark",
      async () => {
        const app = await launchTugApp({ testName: "at0199-confirm-within" });
        try {
          await app.seedDeckState({
            state: { cards: [], panes: [], activePaneId: undefined, hasFocus: true },
          });
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-responder-id="deck-canvas"]') !== null`,
            { timeoutMs: 2000 },
          );
          await app.evalJS<void>(
            `window.__tug.dispatchControlAction("show-component-gallery")`,
          );
          await app.waitForCondition<boolean>(
            `${GALLERY_PANE_ID_EXPR} !== null`,
            { timeoutMs: 3000 },
          );
          const paneId = await app.evalJS<string | null>(GALLERY_PANE_ID_EXPR);

          // Click a neutral spot in the body to make the gallery the key card,
          // then Tab so a KEYBOARD key view lands on the first body focusable.
          const demoSel = `.tug-pane[data-pane-id="${paneId}"] [data-testid="button-focus-demo"]`;
          await app.nativeClickAtElement(demoSel);
          await app.nativeKey("Tab");

          // Sanity: a keyboard key view (ring) now exists in the card body.
          await app.waitForCondition<boolean>(
            `document.querySelector('${demoSel} [data-key-view-kbd]') !== null`,
            { timeoutMs: 2000 },
          );

          // Click the title-bar X → the trapped confirm popover.
          const closeBtnSel = `.tug-pane[data-pane-id="${paneId}"] [data-testid="tug-pane-close-button"]`;
          await app.nativeClickAtElement(closeBtnSel);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)}) !== null`,
            { timeoutMs: 2000 },
          );

          // The fix: while the trapped popover is the top mode, NOTHING carries
          // the within mark — the host control behind it shows no spurious ring.
          const withinCount = await app.evalJS<number>(
            `document.querySelectorAll('[data-key-within]').length`,
          );
          expect(
            withinCount,
            "a trapped confirm popover must not project data-key-within onto any host control",
          ).toBe(0);

          // The popover's own default button still wears the real key-view ring.
          const popoverHasRing = await app.evalJS<boolean>(
            `document.querySelector('${CONFIRM_POPOVER_SELECTOR} [data-key-view-kbd]') !== null`,
          );
          expect(
            popoverHasRing,
            "the confirm popover's default button keeps its key-view ring",
          ).toBe(true);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
