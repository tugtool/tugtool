/**
 * at0170-maker-mode-gate.test.ts — the Maker menu's tugbank gate.
 *
 * The Maker menu hides behind the `maker-mode-enabled` tugbank
 * preference (`AppDelegate.loadPreferences` → `makerMenu.isHidden`).
 * Seeded via a temp `TUGBANK_PATH` DB: an explicit `true` shows the
 * menu, an explicit `false` hides it. (The unseeded default — hidden
 * under the harness — is covered by the structure test.)
 *
 * The app-test harness pins production *serving* — maker mode on
 * under the harness shows the Maker menu without spawning Vite, which
 * is exactly the serving/preference split this test relies on.
 *
 * Visibility is asserted on the top-level bar item (the submenu items
 * themselves are never hidden), located by its submenu's content per
 * the assert-by-identifier rule.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  tugbankWrite,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const DOMAIN = "dev.tugtool.app";
const MAKER_KEY = "maker-mode-enabled";

async function makerBarItemHidden(tugbankPath: string, testName: string): Promise<boolean> {
  const app = await launchTugApp({
    testName,
    env: { TUGBANK_PATH: tugbankPath },
  });
  try {
    const tree = await app.menuSnapshot();
    const makerBarItem = tree.find((it) =>
      it.submenu?.some((sub) => sub.identifier === "maker.reload"),
    );
    expect(makerBarItem, "Maker bar item exists").toBeDefined();
    return makerBarItem!.hidden;
  } catch (err) {
    const tail = app.tailLog(200);
    if (tail !== "") process.stderr.write(`\n[${testName}] log tail:\n${tail}\n`);
    throw err;
  } finally {
    await app.close();
  }
}

describe.skipIf(!SHOULD_RUN)("AT0170: maker-mode gate", () => {
  test(
    "seeded maker-mode-enabled=true shows the Maker menu",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        tugbankWrite(tugbankPath, DOMAIN, MAKER_KEY, "string", "true");
        const hidden = await makerBarItemHidden(tugbankPath, "at0170-gate-on");
        expect(hidden, "Maker menu visible when the gate is on").toBe(false);
      } finally {
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "seeded maker-mode-enabled=false hides the Maker menu",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        tugbankWrite(tugbankPath, DOMAIN, MAKER_KEY, "string", "false");
        const hidden = await makerBarItemHidden(tugbankPath, "at0170-gate-off");
        expect(hidden, "Maker menu hidden when the gate is off").toBe(true);
      } finally {
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
