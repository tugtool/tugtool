/**
 * at0236-settings-general-tab.test.ts — the Settings card's new **General**
 * tab hosts the focus-ring modality control (moved off the dev surface).
 *
 * Selecting "Keyboard + pointer" writes `dev.tugtool.app/focusRingModality`
 * (unchanged persistence) — the control behaves exactly as it did on the
 * dev panel, now in a user-facing home.
 *
 * Scenario:
 *   1. Open Settings; the General tab is first (default).
 *   2. Pick the "pointer" radio; assert the modality persists to tugbank.
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

const RING_GROUP = `[data-testid="settings-focus-ring-modality"]`;
const POINTER_RADIO = `${RING_GROUP} [data-radio-value="pointer"]`;

async function openSettings(app: App): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction("show-card", { component: "settings" })`,
  );
  await app.waitForCondition<boolean>(
    `document.querySelector('[data-testid="settings-card"]') !== null`,
    { timeoutMs: 5_000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0236 — Settings General tab: focus-ring modality persists",
  () => {
    test(
      "selecting pointer modality writes dev.tugtool.app/focusRingModality",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0236-settings-general-tab",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await openSettings(app);

            // The General tab is the default → the focus-ring group is up.
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(RING_GROUP)}) !== null`,
              { timeoutMs: 3_000 },
            );

            // Pick "Keyboard + pointer".
            await app.nativeClickAtElement(POINTER_RADIO);
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(POINTER_RADIO)}).getAttribute("aria-checked") === "true"`,
              { timeoutMs: 3_000 },
            );

            const persisted = tugbankRead<string>(
              tugbankPath,
              "dev.tugtool.app",
              "focusRingModality",
            );
            expect(persisted?.value).toBe("pointer");
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
