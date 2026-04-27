/**
 * _log-capture.test.ts — Per-test subprocess log capture. Covers
 * harness test:
 *
 *   "Log-capture test: evalJS(\"console.log('test log')\") then close;
 *    verify the log file contains the line."
 *
 * The harness routes Tug.app stdout/stderr into
 * `tests/in-app/logs/<testName>.log` when `launchTugApp({ testName })`
 * is called. `app.tailLog()` reads the file contents so tests can
 * diff; `app.close()` flushes the stream before this test inspects
 * the file.
 *
 * Note on `console.log` inside the WKWebView: by default, WKWebView
 * does not forward JS console messages to the host process's stdout.
 * Tug.app installs a `WKScriptMessageHandler` or the WebKit
 * `developerExtrasEnabled` bridge so console output does route out.
 * If the underlying host ever stops doing that, this test will
 * surface the regression as an empty log tail.
 *
 * Skipped by default unless `TUGAPP_IN_APP_TEST=1` is set. The test
 * needs a built debug Tug.app binary at the default path (or
 * `TUGAPP_DEBUG_PATH` pointing at one).
 *
 * To run locally:
 *   xcodebuild -scheme Tug -configuration Debug build
 *   TUGAPP_IN_APP_TEST=1 bun test tests/in-app/_log-capture.test.ts
 *
 * Design notes:
 * - The test uses a unique marker string so a flake involving an
 *   older log file (truncation bug, for instance) is still easy to
 *   diagnose.
 * - We do NOT assert on exact line count — Tug.app may emit its own
 *   startup chatter to stdout/stderr before our marker arrives.
 * - The test name is sanitized by the harness before being turned
 *   into a filename. Keep it filesystem-safe so you can `ls
 *   tests/in-app/logs/` and see what ran.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

describe.skipIf(!SHOULD_RUN)("in-app: log capture", () => {
  test("evalJS console output lands in the per-test log file", async () => {
    // Unique marker survives any noisy startup chatter in the log.
    const marker = `PROBE_LOG_CAPTURE_${Date.now()}`;
    const testName = "log-capture-probe";

    // Pure stdout-capture test — no CGEvent path. Opt out of the
    // Step-3 AX preflight to avoid coupling to the Accessibility
    // grant state.
    const app = await launchTugApp({
      testName,
      skipAccessibilityPreflight: true,
    });
    expect(app.logPath).toBeTruthy();
    const logPath = app.logPath as string;

    try {
      await app.evalJS(`console.log(${JSON.stringify(marker)})`);
    } finally {
      // Close flushes the log stream and gives pipes time to drain.
      await app.close();
    }

    // Post-close inspection: the log file must exist and the marker
    // must appear at least once. `app.tailLog()` (used by other
    // tests' failure paths) returns the same content.
    expect(existsSync(logPath)).toBe(true);
    const contents = readFileSync(logPath, "utf8");
    expect(contents.length).toBeGreaterThan(0);
    expect(contents).toContain(marker);

    // tailLog() is the helper tests use on failure. Sanity-check it
    // agrees with the raw file: the marker must be in the last 50
    // lines (the tail window is more than enough for this tiny test).
    const tail = app.tailLog(50);
    expect(tail).toContain(marker);
  });
});
