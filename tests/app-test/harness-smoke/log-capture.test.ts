/**
 * log-capture.test.ts — Per-test subprocess log capture.
 *
 * The harness routes Tug.app stdout/stderr into
 * `tests/app-test/logs/<testName>.log` when `launchTugApp({ testName })`
 * is called. `app.tailLog()` reads the file contents so tests can
 * diff; `app.close()` flushes the stream before this test inspects
 * the file.
 *
 * The marker is the app's own harness-startup line, which `NSLog`s the
 * socket path the launch minted (`TestHarnessBridge.start`). That path
 * is unique per launch and the test already knows it as
 * `app.socketPath`, so it identifies THIS run's output as sharply as a
 * generated token would — while travelling the stdout route the harness
 * actually captures.
 *
 * WKWebView `console.log` is deliberately NOT the vehicle here: WebKit
 * does not forward JS console messages to the host process's stdout,
 * and Tug.app installs no bridge that would. Routing the marker through
 * `evalJS(console.log(...))` tested a path that does not exist.
 *
 * Skipped by default unless `TUGAPP_APP_TEST=1` is set. The test
 * needs a built debug Tug.app binary at the default path (or
 * `TUGAPP_DEBUG_PATH` pointing at one).
 *
 * To run locally:
 *   xcodebuild -scheme Tug -configuration Debug build
 *   TUGAPP_APP_TEST=1 bun test tests/app-test/log-capture.test.ts
 *
 * Design notes:
 * - The marker is unique per launch, so a flake involving an older log
 *   file (truncation bug, for instance) is still easy to diagnose.
 * - We do NOT assert on exact line count — Tug.app emits plenty of its
 *   own startup chatter to stdout/stderr around the marker.
 * - The test name is sanitized by the harness before being turned
 *   into a filename. Keep it filesystem-safe so you can `ls
 *   tests/app-test/logs/` and see what ran.
 *
 * @covers tests/app-test/_harness/
 * @covers tugapp/Sources/TestHarness/
 * @covers tugapp/Sources/ProcessManager.swift
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { launchTugApp } from "../_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

describe.skipIf(!SHOULD_RUN)("in-app: log capture", () => {
  test("app subprocess output lands in the per-test log file", async () => {
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

    // The app NSLogs this line with the socket path it just bound, and
    // that path is unique to this launch — so finding it in the log
    // proves this run's stdout reached this run's file.
    const marker = `tughost.test-harness.started: socket=${app.socketPath}`;

    try {
      // Round-trip one eval so the app is demonstrably alive and its
      // output stream has had traffic before we close it.
      expect(await app.evalJS<number>("1")).toBe(1);
    } finally {
      // Close flushes the log stream and gives pipes time to drain.
      await app.close();
    }

    // Post-close inspection: the log file must exist and carry this
    // launch's marker.
    expect(existsSync(logPath)).toBe(true);
    const contents = readFileSync(logPath, "utf8");
    expect(contents.length).toBeGreaterThan(0);
    expect(contents).toContain(marker);

    // tailLog() is the helper tests use on failure. Sanity-check it
    // agrees with the raw file — it must return a true suffix of the
    // captured contents. (The marker itself is startup-early, so it is
    // not expected to survive a 50-line tail window.)
    const tail = app.tailLog(50);
    expect(tail.length).toBeGreaterThan(0);
    expect(contents.trimEnd().endsWith(tail.trimEnd())).toBe(true);
  });
});
