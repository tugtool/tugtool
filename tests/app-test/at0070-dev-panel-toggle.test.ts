/**
 * at0070-dev-panel-toggle.test.ts — TugDevPanel visibility toggle via
 * the Swift Developer menu's `⌥⌘/` shortcut (Step 20.3.1).
 *
 * Scenario:
 *   1. Launch with `devModeEnabled = true` so the Developer menu is
 *      visible (it's gated on the runtime dev-mode setting).
 *   2. Probe initial state: `.tug-devpanel` exists and `[data-open="false"]`.
 *   3. `nativeKey('/', ['cmd', 'alt'])` — fires the menu item.
 *   4. Wait for `[data-open="true"]`.
 *   5. Press the chord again — wait for `[data-open="false"]`.
 *
 * The panel mounts unconditionally at app root (see
 * `deck-manager.ts`), so its DOM presence asserts the mount; the
 * `[data-open]` attribute asserts the visibility toggle path
 * triggered by the Swift menu → tugcast control → tugdeck
 * action-dispatch → tugDevPanelStore.toggle().
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

describe.skipIf(!SHOULD_RUN)(
  "at0070 — ⌥⌘/ toggles the TugDevPanel",
  () => {
    test(
      "panel mounts hidden, first chord shows, second chord hides",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath, { devModeEnabled: true });
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

            // Chord ⌥⌘/ → show.
            await app.nativeKey("/", ["cmd", "alt"]);
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(PANEL_SELECTOR)});
                return el !== null && el.getAttribute("data-open") === "true";
              })()`,
              { timeoutMs: 3_000 },
            );
            expect(await readPanelOpen(app)).toBe("true");

            // Chord ⌥⌘/ again → hide.
            await app.nativeKey("/", ["cmd", "alt"]);
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
