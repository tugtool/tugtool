/**
 * at0058-popup-in-sheet-close-focus.test.ts —
 * Service binding's external-click predicate when popup is in sheet.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 5 / [D07] / [D09]: the
 * external-click predicate distinguishes "user moved on" from "user
 * is still working in this surface" by asking whether the pointerdown
 * target is inside the canvas overlay root. Sheet content is also
 * inside the overlay root post-[D02], which is correct: closing a
 * service popup inside a sheet by clicking on the surrounding sheet
 * content should NOT restore the editor below the sheet — the user's
 * intent is to keep working in the sheet.
 *
 * What this test asserts:
 *   - Open the gallery-sheet card's "Popup Button in Sheet" sheet.
 *   - Open the TugPopupButton menu inside the sheet.
 *   - Pick a menu item.
 *   - After the menu closes, DOM focus is somewhere INSIDE the sheet
 *     content (the trigger button's neighborhood — Radix's default
 *     close-focus-to-trigger). The service binding's external-click
 *     predicate should NOT fire (the trigger click was internal —
 *     inside the overlay root). Even when the predicate WOULD fire
 *     and skip restore, Radix's default still focuses the trigger,
 *     which is inside the sheet — so the assertion holds either way.
 *   - Critically: DOM focus is NOT inside any element BEHIND the
 *     sheet (e.g., the gallery card itself, since it has no editor;
 *     a regression where the binding tried to restore prior responder
 *     would land focus there or on the body).
 *
 * The test is satisfied if `document.activeElement` is a descendant
 * of the sheet content element OR the body's focus equivalent.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const SHEET_TRIGGER_SELECTOR =
  '[data-card-id="A"] [data-testid="gallery-sheet-trigger"]';
const SHEET_CONTENT_SELECTOR = '[data-slot="tug-sheet"]';
const POPUP_TRIGGER_INSIDE_SHEET =
  `${SHEET_CONTENT_SELECTOR} [data-slot="tug-button"][aria-haspopup="menu"]`;
const MENU_CONTENT_SELECTOR = ".tug-menu-content";

function deckShape() {
  return {
    cards: [
      {
        id: "A",
        componentId: "gallery-sheet",
        title: "Sheet Gallery",
        closable: true,
      },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 600 },
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

async function setupCard(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {},
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(SHEET_TRIGGER_SELECTOR)}) !== null`,
    { timeoutMs: 4000 },
  );
}

async function waitForSheetVisible(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(SHEET_CONTENT_SELECTOR)});
      if (!el) return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })()`,
    { timeoutMs },
  );
}

async function waitForMenuOpen(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var menus = document.querySelectorAll(${JSON.stringify(MENU_CONTENT_SELECTOR)});
      for (var i = 0; i < menus.length; i++) {
        if (menus[i].getAttribute("data-state") === "open") return true;
      }
      return false;
    })()`,
    { timeoutMs },
  );
}

async function waitForMenuClosed(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var menus = document.querySelectorAll(${JSON.stringify(MENU_CONTENT_SELECTOR)});
      for (var i = 0; i < menus.length; i++) {
        if (menus[i].getAttribute("data-state") === "open") return false;
      }
      return true;
    })()`,
    { timeoutMs },
  );
}

interface FocusProbe {
  activeInsideSheet: boolean;
  activeTag: string;
}

async function probeFocus(app: App): Promise<FocusProbe> {
  return app.evalJS<FocusProbe>(
    `(function(){
      var sheet = document.querySelector(${JSON.stringify(SHEET_CONTENT_SELECTOR)});
      var ae = document.activeElement;
      var insideSheet = sheet !== null && ae !== null && sheet.contains(ae);
      var tag = ae ? ae.tagName + (ae.getAttribute("data-slot") ? ":" + ae.getAttribute("data-slot") : "") : "(none)";
      return { activeInsideSheet: insideSheet, activeTag: tag };
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0058 — closing a popup inside a sheet keeps focus in the sheet, NOT in elements behind it",
  () => {
    test(
      "open sheet, open popup-button menu, pick item, focus stays in sheet content",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0058-popup-in-sheet-close-focus",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupCard(app);

            await app.nativeClickAtElement(SHEET_TRIGGER_SELECTOR);
            await waitForSheetVisible(app);

            // Synthetic click on the popup trigger inside the sheet.
            // The harness's coord-based `nativeClickAtElement` is
            // unreliable for elements rendered above the viewport
            // during sheet animation (negative bounding-rect top); a
            // synthetic click is unaffected by coord translation and
            // still exercises Radix's full open path (onOpenChange,
            // FocusScope mount, captureOnOpen).
            await app.evalJS<void>(
              `(function(){
                var trigger = document.querySelector(${JSON.stringify(POPUP_TRIGGER_INSIDE_SHEET)});
                if (trigger) {
                  trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
                  trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
                  trigger.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
                  trigger.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
                  trigger.click();
                }
              })()`,
            );
            await waitForMenuOpen(app);

            // Pick a menu item via synthetic click for the same
            // coord-translation reason. The Radix Item dispatches
            // `onSelect`, the popup menu's blink-then-close cascade
            // runs, the service binding's `onCloseAutoFocus` fires.
            await app.evalJS<void>(
              `(function(){
                var item = document.querySelector(${JSON.stringify(`${MENU_CONTENT_SELECTOR}[data-state="open"] .tug-menu-item`)});
                if (item) {
                  item.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
                  item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
                  item.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
                  item.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
                  item.click();
                }
              })()`,
            );
            await waitForMenuClosed(app);

            // Confirm DOM focus is inside the sheet — the trigger
            // button (Radix's default close-focus target) is a sheet
            // descendant. The service binding's external-click
            // predicate would have flagged "external" only if the
            // pointerdown was outside the canvas overlay root; the
            // menu item click is INSIDE the overlay root (popup
            // content); the trigger click before that is also inside
            // the overlay root (sheet content). So the predicate does
            // not flag external; either path keeps focus in the sheet.
            const probe = await probeFocus(app);
            expect(probe.activeInsideSheet, `expected focus inside sheet, got: ${probe.activeTag}`).toBe(true);
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
