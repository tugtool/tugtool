/**
 * at0071-dev-panel-tab-persistence.test.ts — TugDevPanel `activeTab`
 * persistence (Step 20.3.2 of tide-assistant-turns).
 *
 * Two assertions:
 *
 *   A) The active tab survives a panel hide/show round-trip — driven
 *      by the `show-dev-panel-toggle` action. This is the cheap path:
 *      open the panel, switch to the Log tab, dispatch toggle twice
 *      (hide then show), confirm the Log tab is still active.
 *
 *   B) The active tab survives a full `app.appReload()` — driven by
 *      the tugbank-persisted `activeTab` key in `dev.tugtool.dev-panel`.
 *      This is the load-bearing path: switch to the Log tab, reload
 *      the page, confirm the panel reopens (open=true is also
 *      persisted) AND the Log tab is still active.
 *
 * Why we drive the tab switch via JS rather than clicking the tab:
 * the same `TUGAPP_APP_TEST=1` reason as at0070 — dev mode is pinned
 * off so the menu chord is dead, and we avoid coupling the test to
 * tab-strip pixel coordinates.
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

const PANEL_SELECTOR = ".tug-devpanel";

async function readPanelOpen(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(PANEL_SELECTOR)});
      return el ? el.getAttribute("data-open") : null;
    })()`,
  );
}

async function readActiveTab(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(".tug-devpanel-body");
      return el ? el.getAttribute("data-active-tab") : null;
    })()`,
  );
}

async function dispatchToggle(app: App): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction("show-dev-panel-toggle")`,
  );
}

/**
 * Switch the active tab via the `dev-panel-select-log-tab` control
 * action. Same dispatch surface as `show-dev-panel-toggle`; routes
 * through the registry in `action-dispatch.ts`. We avoid clicking
 * the tab because the harness can't synthesize mouse events on
 * arbitrary DOM, and we'd have to hard-code tab-strip pixel
 * coordinates that drift across themes.
 */
async function selectLogTab(app: App): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction("dev-panel-select-log-tab")`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0071 — TugDevPanel activeTab persists across hide/show AND appReload",
  () => {
    test(
      "(A) hide/show preserves activeTab; (B) appReload restores activeTab + open=true",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0071-dev-panel-tab-persistence",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            // Panel mounts.
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(PANEL_SELECTOR)}) !== null`,
              { timeoutMs: 5_000 },
            );

            // Open the panel.
            await dispatchToggle(app);
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(PANEL_SELECTOR)});
                return el !== null && el.getAttribute("data-open") === "true";
              })()`,
              { timeoutMs: 3_000 },
            );
            expect(await readPanelOpen(app)).toBe("true");

            // Switch to Log tab.
            await selectLogTab(app);
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(".tug-devpanel-body");
                return el !== null && el.getAttribute("data-active-tab") === "log";
              })()`,
              { timeoutMs: 3_000 },
            );
            expect(await readActiveTab(app)).toBe("log");

            // (A) Hide → show via toggle; tab survives.
            await dispatchToggle(app);
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(PANEL_SELECTOR)});
                return el !== null && el.getAttribute("data-open") === "false";
              })()`,
              { timeoutMs: 3_000 },
            );
            await dispatchToggle(app);
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(PANEL_SELECTOR)});
                return el !== null && el.getAttribute("data-open") === "true";
              })()`,
              { timeoutMs: 3_000 },
            );
            expect(await readActiveTab(app)).toBe("log");

            // (B) Full reload — activeTab + open both come back via
            //     tugbank.
            await app.appReload();
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(PANEL_SELECTOR)}) !== null`,
              { timeoutMs: 8_000 },
            );
            // Open state persists (panel was open at reload time).
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(PANEL_SELECTOR)});
                return el !== null && el.getAttribute("data-open") === "true";
              })()`,
              { timeoutMs: 5_000 },
            );
            expect(await readPanelOpen(app)).toBe("true");
            // And the Log tab is still active.
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(".tug-devpanel-body");
                return el !== null && el.getAttribute("data-active-tab") === "log";
              })()`,
              { timeoutMs: 5_000 },
            );
            expect(await readActiveTab(app)).toBe("log");
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
