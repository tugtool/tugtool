/**
 * at0000-smoke.test.ts — Simplest possible app-test ([AT0000]).
 *
 * Scenario:
 *
 *   launchTugApp → close. Nothing else. This is the floor of the
 *   harness: if the app can boot, complete its handshake, and shut
 *   down cleanly, this passes. When it fails, the problem is the
 *   build / signing / bridge — not any scenario under test.
 *
 * Opts out of the AX preflight (`skipAccessibilityPreflight`): this
 * test drives no native CGEvents, so it should not couple its green
 * state to the macOS Accessibility grant.
 *
 * Gating
 * ------
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs
 * without `TUGAPP_APP_TEST=1` skip every test.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const NO_AX = { skipAccessibilityPreflight: true } as const;

describe.skipIf(!SHOULD_RUN)("at0000: smoke — launch and quit", () => {
  test("launchTugApp then close", async () => {
    const app = await launchTugApp({ ...NO_AX, testName: "at0000-smoke" });
    try {
      // A successful launch resolves the handshake; assert it pinned a
      // surface version so a half-open bridge can't pass as green.
      expect(typeof app.version).toBe("string");
      expect(app.version.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
