/**
 * at0234-lens-visibility-menu.test.ts — the generic pane title-bar `…`
 * menu, lens-contributed section-visibility items (Spec S03).
 *
 * The Lens card contributes one `…` item per registered section; toggling
 * an item hides/shows that section and persists to
 * `dev.tugtool.lens/hiddenSections`. A free (non-lens) pane contributes
 * nothing, so it renders no `…` button.
 *
 * Scenario:
 *   1. Seed a free card + open the Lens. Exactly one `…` button exists
 *      (the Lens's); the free pane has none.
 *   2. Open the `…` menu, toggle Telemetry off; assert it leaves the
 *      stack and persists.
 *   3. Toggle it back on; assert it returns.
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const MENU_BUTTON = `.tug-pane[data-anchored="true"] [data-testid="tug-pane-title-bar-menu-button"]`;
const TELEMETRY = `.lens-section[data-lens-section="telemetry"]`;

async function dispatch(app: App, action: string): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction(${JSON.stringify(action)})`,
  );
}

async function menuButtonCount(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll('[data-testid="tug-pane-title-bar-menu-button"]').length`,
  );
}

async function toggleTelemetry(app: App): Promise<void> {
  await app.nativeClickAtElement(MENU_BUTTON);
  await app.waitForCondition<boolean>(
    `document.querySelector('[data-item-id="telemetry"]') !== null`,
    { timeoutMs: 3_000 },
  );
  await app.nativeClickAtElement(`[data-item-id="telemetry"]`);
}

function freeCardDeck() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 40, y: 40 },
        size: { width: 480, height: 380 },
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
  "at0234 — title-bar visibility menu toggles sections",
  () => {
    test(
      "only the lens pane has a … menu; toggling hides + shows a section",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0234-lens-visibility-menu",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({ state: freeCardDeck(), focusCardId: "A" });
            await app.waitForCondition<boolean>(
              `window.__tug.assertHostRootRegistered("A")`,
              { timeoutMs: 5_000 },
            );

            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(TELEMETRY)}) !== null`,
              { timeoutMs: 3_000 },
            );

            // Only the lens pane contributes a … menu; the free pane has none.
            expect(await menuButtonCount(app)).toBe(1);

            // Toggle Telemetry off → leaves the stack + persists.
            await toggleTelemetry(app);
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(TELEMETRY)}) === null`,
              { timeoutMs: 3_000 },
            );
            const hidden = tugbankRead<string[]>(
              tugbankPath,
              "dev.tugtool.lens",
              "hiddenSections",
            );
            expect(hidden?.value).toContain("telemetry");

            // Toggle it back on → returns.
            await toggleTelemetry(app);
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(TELEMETRY)}) !== null`,
              { timeoutMs: 3_000 },
            );
            expect(
              await app.evalJS<boolean>(
                `document.querySelector(${JSON.stringify(TELEMETRY)}) !== null`,
              ),
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
