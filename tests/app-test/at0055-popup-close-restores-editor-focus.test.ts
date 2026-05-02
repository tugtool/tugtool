/**
 * at0055-popup-close-restores-editor-focus.test.ts —
 * The image-5 close-path regression guard.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 5 / [D06] / [D07] /
 * (#service-binding). The pre-fix bug: clicking a font picker (a
 * service-role TugPopupButton) and choosing an item left DOM focus
 * stranded inside the closed menu, so the next keystroke went
 * nowhere — the user had to click the editor again to resume typing.
 *
 * The fix wires `useServicePopupBinding` into `TugPopupMenu`. At
 * `onOpenChange(true)`, the binding snapshots
 * `manager.getFirstResponder()` (the editor's id, because of the
 * existing `data-tug-focus="refuse"` discipline on the trigger
 * button). At `onCloseAutoFocus`, the binding calls
 * `event.preventDefault()` to short-circuit Radix's default close-
 * focus path and `manager.focusResponder(captured)` which (per [D03] /
 * [D04]) invokes the editor's substrate `view.focus()` callback,
 * landing DOM focus back on `view.contentDOM`.
 *
 * What this test asserts:
 *   - Pre-condition: editor's contentDOM has DOM focus and the
 *     gallery's font-family popup-button is rendered.
 *   - After clicking the font-family TugPopupButton trigger, choosing
 *     a menu item, and the menu closes:
 *       - `document.activeElement` is the editor's `view.contentDOM`.
 *       - Typing continues to land in the editor (additional native
 *         keystroke produces visible text in the editor's DOM).
 *
 * Why the chain: it's the central proof point that all four pieces
 * land in the right order.
 *   1. trigger click promotes nothing on the chain (TugButton's
 *      `data-tug-focus="refuse"` honored by pane-focus-controller),
 *   2. captureOnOpen snapshots the editor as captured,
 *   3. menu-item click + blink + dispatch + close cascade fires,
 *   4. onCloseAutoFocus restores via `manager.focusResponder(editor)`
 *      → editor's `focus: () => viewRef.current?.focus()` runs →
 *      `document.activeElement === view.contentDOM`.
 *
 * If any of those four steps regresses, the next-keystroke landing
 * assertion fails.
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

const TUG_EDIT_CONTENT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';
const FONT_PICKER_BUTTON_SELECTOR =
  '[data-card-id="A"] .gallery-text-editor-toolbar [data-slot="tug-button"][aria-haspopup="menu"]';
const MENU_CONTENT_SELECTOR = '[data-slot="tug-menu-content"], .tug-menu-content';

function deckShape() {
  return {
    cards: [
      {
        id: "A",
        componentId: "gallery-text-editor",
        title: "TugTextEditor A",
        closable: true,
      },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 540 },
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

async function setupGallery(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {},
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.awaitEngineReady("A");
  const editorSelector = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;
  await app.nativeClickAtElement(editorSelector);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelector)})`,
    { timeoutMs: 2000 },
  );
}

async function waitForMenuVisible(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var menus = document.querySelectorAll(${JSON.stringify(MENU_CONTENT_SELECTOR)});
      for (var i = 0; i < menus.length; i++) {
        var m = menus[i];
        if (m.getAttribute("data-state") === "open") return true;
      }
      return false;
    })()`,
    { timeoutMs },
  );
}

async function waitForMenuHidden(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var menus = document.querySelectorAll(${JSON.stringify(MENU_CONTENT_SELECTOR)});
      for (var i = 0; i < menus.length; i++) {
        var m = menus[i];
        if (m.getAttribute("data-state") === "open") return false;
      }
      return true;
    })()`,
    { timeoutMs },
  );
}

async function waitForActiveElementMatches(
  app: App,
  selector: string,
  timeoutMs = 4000,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(selector)})`,
    { timeoutMs },
  );
}

async function getEditorText(app: App): Promise<string> {
  return app.evalJS<string>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(`[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`)});
      return el ? (el.textContent || "") : "";
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0055 — service popup close restores editor focus + next keystroke lands in editor",
  () => {
    test(
      "image 5 close path: open font-family menu, pick item, focus returns to editor and typing continues",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0055-popup-close-restores-editor-focus",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            const editorSelector = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;

            // Pre-condition: editor focused, baseline text content
            // captured. Type a known marker so we can detect post-
            // close keystrokes against this baseline.
            await app.nativeType("X");
            const baselineText = await getEditorText(app);
            expect(baselineText.includes("X"), "baseline keystroke landed in editor").toBe(true);

            // Open the font-family popup-button. Per [D07], this is
            // where captureOnOpen snapshots the editor's responder id.
            await app.nativeClickAtElement(FONT_PICKER_BUTTON_SELECTOR);
            await waitForMenuVisible(app);

            // Click the first menu item. The menu's onSelect runs the
            // double-blink animation, dispatches setValue through the
            // chain, then closes via setOpen(false). Radix unmounts
            // content; service binding's onCloseAutoFocus runs;
            // preventDefault + focusResponder(editor) restore focus.
            await app.nativeClickAtElement(`${MENU_CONTENT_SELECTOR} .tug-menu-item`);
            await waitForMenuHidden(app);

            // The restoration is complete when DOM focus is back on
            // the editor's contentDOM.
            await waitForActiveElementMatches(app, editorSelector, 3000);

            // The clinching assertion: typing now lands in the
            // editor without any additional click. Type a second
            // marker; assert it appears in the text.
            await app.nativeType("Y");
            const postCloseText = await getEditorText(app);
            expect(postCloseText.includes("Y"), "post-close keystroke landed in editor").toBe(true);
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
