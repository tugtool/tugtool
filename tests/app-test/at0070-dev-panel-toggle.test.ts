/**
 * at0070-dev-panel-toggle.test.ts — TugDevPanel toggle round-trip via
 * the `show-dev-panel-toggle` action (Step 20.3.1).
 *
 * Why we don't fire `nativeKey('/', ['cmd', 'alt'])` here:
 * the in-app harness force-disables dev mode at launch (see
 * `tugapp/Sources/AppDelegate.swift::loadPreferences` — when
 * `TUGAPP_APP_TEST=1`, dev mode is pinned to `false` so the harness
 * loads from the pre-built `dist/` and skips Vite, saving ~700ms per
 * test). The Developer menu (`developerMenu.isHidden = !devModeEnabled`)
 * is therefore HIDDEN during app-tests, so `⌥⌘/` cannot reach the
 * "Show Dev Panel" menu item — the chord is dead before it ever
 * dispatches.
 *
 * The chord-to-menu wiring is a manual checkpoint (see
 * dev-assistant-turns.md Step 20.3.1's "Manual" checkpoint item).
 * What we CAN exercise here in automation is the dispatch surface the
 * menu fires:
 *
 *   Swift menu item action → `sendControl("show-dev-panel-toggle")`
 *      → tugcast CONTROL frame → `dispatchAction({action})` → tugdeck
 *      → `tugDevPanelStore.toggle()` → snapshot updates → React
 *      re-renders the panel → `[data-open]` flips
 *
 * We invoke the action via `window.__tug.dispatchControlAction(...)`,
 * which routes through the exact same `dispatchAction` registry as
 * the live Swift→tugdeck path. This pins steps 4–7 of that chain;
 * steps 1–3 (the menu item + sendControl wiring) are visually
 * verifiable and don't change shape across runs.
 *
 * Scenario:
 *   1. Launch.
 *   2. Confirm `.tug-devpanel` mounts hidden (`data-open="false"`).
 *   3. Fire `show-dev-panel-toggle` → `data-open="true"`.
 *   4. Fire it again → `data-open="false"`.
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

const PANEL_SELECTOR = ".tug-devpanel";

async function readPanelOpen(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(PANEL_SELECTOR)});
      return el ? el.getAttribute("data-open") : null;
    })()`,
  );
}

async function fireToggle(app: App): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction("show-dev-panel-toggle")`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0070 — show-dev-panel-toggle action flips the TugDevPanel visibility",
  () => {
    test(
      "panel mounts hidden, first dispatch shows, second dispatch hides",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0070-dev-panel-toggle",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            // Panel mounts once at app root regardless of card state.
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(PANEL_SELECTOR)}) !== null`,
              { timeoutMs: 5_000 },
            );

            // Initial: hidden.
            expect(await readPanelOpen(app)).toBe("false");

            // Dispatch → show.
            await fireToggle(app);
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(PANEL_SELECTOR)});
                return el !== null && el.getAttribute("data-open") === "true";
              })()`,
              { timeoutMs: 3_000 },
            );
            expect(await readPanelOpen(app)).toBe("true");

            // Dispatch again → hide.
            await fireToggle(app);
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(PANEL_SELECTOR)});
                return el !== null && el.getAttribute("data-open") === "false";
              })()`,
              { timeoutMs: 3_000 },
            );
            expect(await readPanelOpen(app)).toBe("false");
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
