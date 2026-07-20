/**
 * at0231-lens-toggle-focus.test.ts — the Lens card in its anchored pane:
 * toggle visibility, focus in/out through the normal activation path, and
 * reload survival.
 *
 * The Lens is an ordinary registered card (`"lens"`) hosted by the normal
 * CardHost inside an anchored pane.
 *
 * Control surface exercised (same path Swift's "Show Lens" menu +
 * Cmd-L / Opt-Cmd-L take):
 *   - `toggle-lens`  → `deckManager.toggleLensPane()` (presence = open).
 *   - `focus-lens`   → chain → deck-canvas FOCUS_LENS handler → stash
 *     prior FR, `showLensPane()`, `transferFocusForActivation`.
 *
 * Scenarios:
 *   1. toggle-lens shows the anchored rail; a second toggle hides it.
 *   2. focus-lens opens + moves the first responder into the Lens; a
 *      second focus-lens restores the previously-focused card.
 *
 * Escape-to-focus-out (the deck-canvas CANCEL_DIALOG handler) is verified
 * in at0233, where the Lens has real focusable section content: the
 * global Escape ladder only chain-dispatches CANCEL_DIALOG in the base
 * focus mode with DOM focus landed, which an empty placeholder Lens
 * can't provide.
 *
 * Reload-survival of the anchored pane is NOT an app-test: in test mode
 * `DeckManager` ignores the persisted layout blob and starts empty (the
 * harness drives state via `seedDeckState`), so auto-restore-on-reload
 * can't be exercised here. That path — parseV4 carrying `anchor` and
 * skipping the fit-clamp — is pinned by the `serialization` unit tests
 * (`layout-tree.test.ts`).
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const ANCHORED_SELECTOR = `.tug-pane[data-anchored]`;

async function anchoredPaneExists(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.querySelector(${JSON.stringify(ANCHORED_SELECTOR)}) !== null`,
  );
}

async function dispatch(app: App, action: string): Promise<void> {
  await app.dispatchControlAction(action);
}

function priorCardDeck() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 60, y: 60 },
        size: { width: 520, height: 420 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pA",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)(
  "at0231 — Lens toggle, focus in/out, and reload survival",
  () => {
    test(
      "toggle-lens shows then hides the anchored rail",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0231-lens-toggle",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.waitForCondition<boolean>(
              `typeof window.__tug !== "undefined"`,
              { timeoutMs: 5_000 },
            );
            expect(await anchoredPaneExists(app)).toBe(false);

            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(ANCHORED_SELECTOR)}) !== null`,
              { timeoutMs: 3_000 },
            );
            expect(await anchoredPaneExists(app)).toBe(true);

            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(ANCHORED_SELECTOR)}) === null`,
              { timeoutMs: 3_000 },
            );
            expect(await anchoredPaneExists(app)).toBe(false);
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "focus-lens moves the first responder into the Lens and back out",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0231-lens-focus",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
            await app.waitForCondition<boolean>(
              `window.__tug.assertHostRootRegistered("A")`,
              { timeoutMs: 5_000 },
            );
            // The seeded free card is the first responder.
            expect(await app.evalJS<string | null>(`window.__tug.getActiveCardId()`)).toBe("A");

            // Focus in: the Lens opens and becomes the first responder.
            await dispatch(app, "focus-lens");
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(ANCHORED_SELECTOR)}) !== null`,
              { timeoutMs: 3_000 },
            );
            await app.waitForCondition<boolean>(
              `window.__tug.getActiveCardId() !== "A"`,
              { timeoutMs: 3_000 },
            );
            const lensCardId = await app.evalJS<string | null>(
              `window.__tug.getActiveCardId()`,
            );
            expect(lensCardId).not.toBe("A");
            expect(lensCardId).not.toBeNull();
            // The active card is the one rendered inside the anchored rail.
            const railCardId = await app.evalJS<string | null>(
              `(function(){
                var el = document.querySelector('[data-lens-card-id]');
                return el ? el.getAttribute('data-lens-card-id') : null;
              })()`,
            );
            expect(railCardId).toBe(lensCardId);

            // Focus out: a second focus-lens restores the prior card.
            await dispatch(app, "focus-lens");
            await app.waitForCondition<boolean>(
              `window.__tug.getActiveCardId() === "A"`,
              { timeoutMs: 3_000 },
            );
            expect(await app.evalJS<string | null>(`window.__tug.getActiveCardId()`)).toBe("A");
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
