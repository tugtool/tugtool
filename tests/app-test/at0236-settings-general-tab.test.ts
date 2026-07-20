/**
 * at0236-settings-general-tab.test.ts — the Settings card's **General**
 * tab hosts the Lens section: choose which side of the deck the Lens rail
 * anchors to.
 *
 * Picking "Left" writes `dev.tugtool.lens/anchorSide` AND flips an
 * already-open rail in place: the deck manager re-anchors the live pane,
 * so it moves from the right edge to the left edge without a reopen.
 *
 * Scenario:
 *   1. Open the Lens (`toggle-lens`) — it mounts on the right by default.
 *   2. Open Settings; the General tab is first (default).
 *   3. Pick the "Left" segment.
 *   4. Assert the rail flips to the left edge AND the side persists.
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

const RAIL = `.tug-pane[data-anchored]`;
const SIDE_GROUP = `[data-testid="settings-lens-side"]`;
const LEFT_SEGMENT = `${SIDE_GROUP} [data-choice-value="left"]`;

async function dispatch(app: App, action: string): Promise<void> {
  await app.dispatchControlAction(action);
}

async function railLeft(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector(${JSON.stringify(RAIL)}).getBoundingClientRect().left`,
  );
}

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
  "at0236 — Settings General tab: Lens anchor side flips + persists",
  () => {
    test(
      "picking Left re-anchors the open rail and writes anchorSide",
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
            // 1. Open the Lens — defaults to the right edge.
            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelector('${RAIL}[data-anchored="right"]') !== null`,
              { timeoutMs: 5_000 },
            );

            // 2. Open Settings; General tab (Lens side group) is up.
            await openSettings(app);
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(SIDE_GROUP)}) !== null`,
              { timeoutMs: 3_000 },
            );

            // 3. Pick "Left".
            await app.nativeClickAtElement(LEFT_SEGMENT);
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(LEFT_SEGMENT)}).getAttribute("aria-checked") === "true"`,
              { timeoutMs: 3_000 },
            );

            // 4a. The live rail re-anchors to the left edge (flush with 0).
            await app.waitForCondition<boolean>(
              `document.querySelector('${RAIL}[data-anchored="left"]') !== null`,
              { timeoutMs: 3_000 },
            );
            expect(Math.abs(await railLeft(app))).toBeLessThanOrEqual(2);

            // 4b. And the choice persists to tugbank.
            const persisted = tugbankRead<string>(
              tugbankPath,
              "dev.tugtool.lens",
              "anchorSide",
            );
            expect(persisted?.value).toBe("left");
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
