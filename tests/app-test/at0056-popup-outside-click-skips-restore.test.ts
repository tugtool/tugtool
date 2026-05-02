/**
 * at0056-popup-outside-click-skips-restore.test.ts —
 * Service-binding external-click predicate.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 5 / [D07] / [Q02]:
 * the service binding's restore predicate must SKIP when the user
 * clicked outside any popup before the close cascade fired. Always-
 * restore would overwrite the user's chosen click target with the
 * pre-popup responder; the predicate's job is to detect "the user has
 * moved on" and let Radix's default close-focus path run.
 *
 * The predicate is a document-level pointerdown listener installed
 * imperatively in `captureOnOpen`. It flips `externalClickRef = true`
 * when the pointerdown's target is NOT a descendant of the canvas
 * overlay root. On `onCloseAutoFocus`, the flag short-circuits the
 * restore path: no `event.preventDefault()`, no `focusResponder`
 * — Radix's default (focus the trigger) runs.
 *
 * What this test asserts:
 *   - Open `/` typeahead in the editor (so the editor has a
 *     companion popup live; this also ensures the test is not
 *     conflating service-binding behavior with the unrelated
 *     "no-popup-was-open" branch).
 *   - Native-click the deck canvas background (outside the editor,
 *     outside any popup, outside any sheet).
 *   - The completion popup hides (companion binding fires on
 *     focusout — Step 4 territory).
 *   - DOM focus is NOT inside the editor's contentDOM. (The user
 *     clicked elsewhere; the binding does not restore.)
 *
 * What this test does NOT assert:
 *   - Where DOM focus DOES land — that depends on what's at the
 *     click point and is governed by pane-focus-controller, not the
 *     service binding. The negative assertion (focus NOT on editor)
 *     is sufficient to prove the binding did not over-restore.
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
const COMPLETION_MENU_SELECTOR = '[data-slot="tug-completion-menu"]';

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

async function waitForCompletionVisible(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      if (!popup) return false;
      var display = popup.style.display || getComputedStyle(popup).display;
      var items = popup.querySelectorAll(".tug-completion-menu-item");
      return display === "block" && items.length > 0;
    })()`,
    { timeoutMs },
  );
}

async function waitForCompletionHidden(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      if (!popup) return true;
      var display = popup.style.display || getComputedStyle(popup).display;
      return display === "none";
    })()`,
    { timeoutMs },
  );
}

async function probeFocusInEditor(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){
      var ae = document.activeElement;
      if (!ae) return false;
      return ae.matches(${JSON.stringify(`[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`)});
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0056 — clicking outside any popup does NOT restore prior responder",
  () => {
    test(
      "open `/` typeahead, native-click deck-canvas background, popup hides AND DOM focus is not in editor",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0056-popup-outside-click-skips-restore",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            // Open `/` typeahead so a companion popup is live and we
            // know there's an actual popup in the overlay tier
            // before the test's "click outside" gesture.
            await app.nativeType("/");
            await waitForCompletionVisible(app);

            // Native-click the deck canvas background. The pane is
            // 720×540 starting at (40, 40); below the pane (e.g.,
            // viewport y > 580) is canvas background.
            await app.nativeClick({ x: 1000, y: 700 });

            // Companion binding fires on focusout — completion popup
            // hides regardless of service-binding behavior.
            await waitForCompletionHidden(app, 2000);

            // The clinching assertion: DOM focus is NOT in the
            // editor's contentDOM. The service binding (or any other
            // restore path) did not over-restore. If pane-focus-
            // controller's "deselect" branch fired, focus is on
            // body or some other element — not on contentDOM.
            const inEditor = await probeFocusInEditor(app);
            expect(inEditor, "DOM focus should NOT be inside editor after outside click").toBe(false);
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
