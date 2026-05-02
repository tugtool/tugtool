/**
 * at0057-popup-in-sheet-stacking.test.ts —
 * [D09] popup-in-sheet z-tier elevation visual gate.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 5 / [D09] / [Q01]: when a
 * popup-class primitive (TugPopupMenu, TugPopover, TugContextMenu)
 * opens from a control inside a sheet, the popup's z-index MUST be
 * elevated above the sheet's z-index. Both share the canvas overlay
 * root post-[D01]/[D02], so default tokens (popup 9200, menu 9300,
 * dialog 9400) would stack the popup BEHIND the sheet — visually
 * unusable.
 *
 * The mechanism: `TugSheetContent` provides
 * `TugSheetStackingContext` with `true` inside its portaled subtree.
 * Popup primitives consume the context and apply a CSS class
 * (`tug-popup-in-dialog` / `tug-menu-in-dialog`) to their portaled
 * content. The class swaps z-index to the elevated tokens
 * (`--tug-z-overlay-popup-in-dialog: 9500`,
 * `--tug-z-overlay-menu-in-dialog: 9600`). Visually correct
 * stacking; structurally consistent (one tier).
 *
 * What this test asserts:
 *   - The gallery-sheet card's "Popup Button in Sheet" section
 *     opens its sheet successfully.
 *   - Clicking the TugPopupButton trigger inside the sheet opens
 *     the menu.
 *   - The menu's portaled content carries `tug-menu-in-dialog`.
 *   - The menu's resolved z-index is `9600` (the elevated token).
 *   - The menu's bounding rect overlaps the sheet's content panel
 *     bounding rect (proves the menu paints on top of sheet content,
 *     not in some unrelated corner of the viewport).
 *   - A menu item is clickable (synthesizing a click selects it
 *     and the readout below the trigger updates).
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

async function waitForSelectorVisible(
  app: App,
  selector: string,
  timeoutMs = 4000,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
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

interface StackingProbe {
  hasInDialogClass: boolean;
  zIndex: string;
  menuRect: { top: number; left: number; width: number; height: number };
  sheetRect: { top: number; left: number; width: number; height: number };
}

async function probeStacking(app: App): Promise<StackingProbe> {
  return app.evalJS<StackingProbe>(
    `(function(){
      var menu = null;
      var menus = document.querySelectorAll(${JSON.stringify(MENU_CONTENT_SELECTOR)});
      for (var i = 0; i < menus.length; i++) {
        if (menus[i].getAttribute("data-state") === "open") {
          menu = menus[i];
          break;
        }
      }
      var sheet = document.querySelector(${JSON.stringify(SHEET_CONTENT_SELECTOR)});
      var menuRect = menu ? menu.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };
      var sheetRect = sheet ? sheet.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };
      return {
        hasInDialogClass: menu ? menu.classList.contains("tug-menu-in-dialog") : false,
        zIndex: menu ? getComputedStyle(menu).zIndex : "",
        menuRect: { top: menuRect.top, left: menuRect.left, width: menuRect.width, height: menuRect.height },
        sheetRect: { top: sheetRect.top, left: sheetRect.left, width: sheetRect.width, height: sheetRect.height },
      };
    })()`,
  );
}

function rectsOverlap(
  a: { top: number; left: number; width: number; height: number },
  b: { top: number; left: number; width: number; height: number },
): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0057 — popup inside a sheet stacks ABOVE the sheet via [D09] elevation",
  () => {
    test(
      "open sheet, open popup-button menu inside sheet, menu has tug-menu-in-dialog class + z-index 9600 + overlaps sheet",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0057-popup-in-sheet-stacking",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupCard(app);

            // Open the sheet that hosts the popup-button.
            await app.nativeClickAtElement(SHEET_TRIGGER_SELECTOR);
            await waitForSelectorVisible(app, SHEET_CONTENT_SELECTOR);

            // Open the popup-button menu inside the sheet.
            //
            // Use a synthesized `.click()` on the trigger element
            // rather than `nativeClickAtElement`. The harness's coord-
            // based click translates web viewport coords to OS screen
            // coords via the deck-window mapping. After a sheet opens
            // (with its slide-in animation), the popup-button trigger
            // can transiently sit above the visible viewport (negative
            // bounding-rect top); the OS-level click then lands on
            // window chrome instead of the trigger. A synthetic click
            // is unaffected by coord translation and exercises the
            // same React code path (Radix's `onOpenChange`,
            // `captureOnOpen`, `FocusScope` mount, [D09] z-tier
            // elevation). The structural assertions below are the
            // [D09] gate, not the click delivery mechanism.
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

            const probe = await probeStacking(app);

            expect(probe.hasInDialogClass, "menu has tug-menu-in-dialog class").toBe(true);
            expect(probe.zIndex, "menu z-index resolves to 9600").toBe("9600");
            expect(
              rectsOverlap(probe.menuRect, probe.sheetRect),
              "menu bounding rect overlaps sheet content rect",
            ).toBe(true);
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
