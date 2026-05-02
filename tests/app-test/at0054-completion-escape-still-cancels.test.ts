/**
 * at0054-completion-escape-still-cancels.test.ts —
 * Escape keymap regression guard post companion-binding migration.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 4 / [D05] / (#companion-binding):
 * the migration replaced the cardDidDeactivate-driven cancel with a
 * DOM-focus-driven cancel. The Escape keymap path
 * (`tugCompletionKeymap` → `cancelCompletion`) was NOT touched; this
 * test pins that the keymap path is still wired and effective.
 *
 * If a refactor accidentally rewires Escape through any modified
 * pathway (e.g., a stale handler that depended on the removed
 * cardDidDeactivate subscription), this test would fail.
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

async function waitForPopupVisible(app: App, timeoutMs = 4000): Promise<void> {
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

async function waitForPopupHidden(app: App, timeoutMs = 4000): Promise<void> {
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

async function probePopupVisible(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){
      var popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      if (!popup) return false;
      var display = popup.style.display || getComputedStyle(popup).display;
      return display === "block";
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0054 — Escape still cancels typeahead post companion-binding migration",
  () => {
    test(
      "open `/` typeahead, press Escape, popup vanishes",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0054-completion-escape-still-cancels",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            await app.nativeType("/");
            await waitForPopupVisible(app);
            expect(await probePopupVisible(app)).toBe(true);

            // Press Escape natively. The keymap routes Escape →
            // `cancelCompletion(view)` inside the editor's
            // tugCompletionKeymap. The companion binding does NOT need
            // to fire for this case — the keymap is the canonical
            // dismissal path for Escape.
            await app.nativeKey("Escape");
            await waitForPopupHidden(app, 2000);

            expect(await probePopupVisible(app)).toBe(false);
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
