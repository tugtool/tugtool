/**
 * _smoke.test.ts — Minimal end-to-end smoke test for the bridge.
 *
 * Covers parent plan step-7 test requirement:
 *   launchTugApp → evalJS("1 + 1") → close → expect 2.
 *
 * Also asserts `app.version === "1.0.0"` to pin the handshake.
 *
 * Skipped by default unless `TUGAPP_IN_APP_TEST=1` is set. The test
 * needs a built debug Tug.app binary at the default path (or
 * `TUGAPP_DEBUG_PATH` pointing at one). Running without that env
 * variable would fail in environments where the app isn't built,
 * which includes CI and `bun x tsc --noEmit` checks.
 *
 * To run locally:
 *   xcodebuild -scheme Tug -configuration Debug build
 *   TUGAPP_IN_APP_TEST=1 bun test tests/in-app/_smoke.test.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, EXPECTED_SURFACE_VERSION } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

describe.skipIf(!SHOULD_RUN)("smoke: launchTugApp → evalJS → close", () => {
  test("evalJS('1 + 1') returns 2", async () => {
    const app = await launchTugApp();
    try {
      const result = await app.evalJS<number>("1 + 1");
      expect(result).toBe(2);
    } finally {
      await app.close();
    }
  });

  test("handshake reports the expected surface version", async () => {
    const app = await launchTugApp();
    try {
      expect(app.version).toBe(EXPECTED_SURFACE_VERSION);
    } finally {
      await app.close();
    }
  });
});
