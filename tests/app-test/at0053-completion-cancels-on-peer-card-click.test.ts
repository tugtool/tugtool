/**
 * at0053-completion-cancels-on-peer-card-click.test.ts —
 * Strict-superset regression guard.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 4 / [D05] / (#companion-binding):
 * the companion-focus signal subsumes the prior `cardDidDeactivate`
 * subscription. When a peer card activates, DOM focus moves to the
 * peer's editor (or chrome, depending on what's clicked). Card A's
 * `view.contentDOM` loses focus; `useCompanionPopupBinding` observes
 * the focusout, queues a microtask, sees `nowInside === false`, and
 * dispatches `cancelCompletion(view)` for card A.
 *
 * Pre-migration this was the deck-store path:
 *   peer-click → deck activates B → `cardDidDeactivate("A")` →
 *   `observeCardDidDeactivate("A", …)` callback → cancelCompletion.
 *
 * Post-migration this is the focus path:
 *   peer-click → focus moves out of A's contentDOM → focusout →
 *   microtask defer → useCompanionPopupBinding fires → cancelCompletion.
 *
 * The user-visible behavior is identical. This test is a [L23]
 * strict-superset guard: every dismissal the old signal triggered
 * is still triggered by the new signal.
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
      {
        id: "B",
        componentId: "gallery-text-editor",
        title: "TugTextEditor B",
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
      {
        id: "p2",
        position: { x: 800, y: 40 },
        size: { width: 720, height: 540 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

async function setupDeck(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {},
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
  );
  await app.awaitEngineReady("A");
  await app.awaitEngineReady("B");
  // Land focus inside card A's editor so the companion binding's
  // initial isFocusedInside is true for A's contentDOM.
  const editorA = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;
  await app.nativeClickAtElement(editorA);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorA)})`,
    { timeoutMs: 2000 },
  );
}

async function waitForPopupVisible(app: App, timeoutMs = 4000): Promise<void> {
  // Card A's popup specifically — querySelectorAll all completion
  // menus and require at least one is visible. There is one
  // CompletionOverlay per editor; both render `[data-slot="tug-
  // completion-menu"]` divs. We check that exactly one is `display:
  // block` (the active session's).
  await app.waitForCondition<boolean>(
    `(function(){
      var menus = document.querySelectorAll(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      for (var i = 0; i < menus.length; i++) {
        var m = menus[i];
        var display = m.style.display || getComputedStyle(m).display;
        var items = m.querySelectorAll(".tug-completion-menu-item");
        if (display === "block" && items.length > 0) return true;
      }
      return false;
    })()`,
    { timeoutMs },
  );
}

async function waitForAllPopupsHidden(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var menus = document.querySelectorAll(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      for (var i = 0; i < menus.length; i++) {
        var m = menus[i];
        var display = m.style.display || getComputedStyle(m).display;
        if (display !== "none") return false;
      }
      return true;
    })()`,
    { timeoutMs },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0053 — peer-card click cancels typeahead via DOM focus signal",
  () => {
    test(
      "open `/` typeahead on card A, native-click card B's chrome, A's popup vanishes",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0053-completion-cancels-on-peer-card-click",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupDeck(app);

            // Trigger `/` completion in card A's editor.
            await app.nativeType("/");
            await waitForPopupVisible(app);

            // Native-click card B's pane chrome (title bar). This is
            // a peer-card activation gesture — the deck-store activates
            // B, focus moves out of A's contentDOM into B's chrome /
            // editor area. With companion binding wired, A's binding
            // observes A.contentDOM losing focus and cancels.
            const cardBChrome = `[data-pane-id="p2"] [data-slot="tug-pane"]`;
            await app.nativeClickAtElement(cardBChrome);

            // Both popups should end up hidden: A's because companion
            // fired cancel; B's because it never opened (B's editor
            // was just activated, no `/` was typed there).
            await waitForAllPopupsHidden(app, 2000);
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
