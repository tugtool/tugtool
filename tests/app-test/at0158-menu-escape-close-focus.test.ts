/**
 * at0158-menu-escape-close-focus.test.ts — closing a service popup menu with
 * Escape restores editor focus and the next keystroke lands.
 *
 * ## What this pins
 *
 * The sibling of at0055 (which closes via menu-item selection): here the menu is
 * dismissed by **Escape**, the close path the mode-stack refactor re-routes. On
 * current `main` the Radix `DropdownMenu` owns the Escape and
 * `useServicePopupBinding`'s `onCloseAutoFocus` restores the editor caret. After
 * the menus join the engine trap and the binding is deleted (the plan's
 * #step-6), the SAME observable outcome must hold — the trap's teardown writer
 * reproduces the binding's restore. This test is the menu-Escape contract that
 * gates that swap: green before and after.
 *
 *   - Pre-condition: editor's contentDOM has DOM focus; a known marker typed.
 *   - Open the font-family `TugPopupButton` menu, press Escape:
 *       - the menu closes,
 *       - `document.activeElement` is the editor's `view.contentDOM`,
 *       - typing continues to land in the editor.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

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
        acceptsFamilies: ["maker"],
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
        if (menus[i].getAttribute("data-state") === "open") return true;
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
        if (menus[i].getAttribute("data-state") === "open") return false;
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
  "at0158 — service popup menu Escape-close restores editor focus + next keystroke lands",
  () => {
    test(
      "open font-family menu, press Escape, focus returns to editor and typing continues",
      async () => {
        const app = await launchTugApp({
          testName: "at0158-menu-escape-close-focus",
        });
        try {
          await setupGallery(app);

          const editorSelector = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;

          // Pre-condition: editor focused, baseline marker typed.
          await app.nativeType("X");
          const baselineText = await getEditorText(app);
          expect(baselineText.includes("X"), "baseline keystroke landed in editor").toBe(true);

          // Open the font-family popup-button menu.
          await app.nativeClickAtElement(FONT_PICKER_BUTTON_SELECTOR);
          await waitForMenuVisible(app);

          // Escape closes the menu (Radix today; the engine trap after #step-6).
          // Either way close-focus must return to the editor.
          await app.nativeKey("Escape");
          await waitForMenuHidden(app);
          await waitForActiveElementMatches(app, editorSelector, 3000);

          // The clinching assertion: typing now lands in the editor with no
          // additional click.
          await app.nativeType("Y");
          const postCloseText = await getEditorText(app);
          expect(postCloseText.includes("Y"), "post-Escape keystroke landed in editor").toBe(true);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
