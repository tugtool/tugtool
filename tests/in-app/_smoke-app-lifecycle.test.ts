/**
 * _smoke-app-lifecycle.test.ts — Phase A app-lifecycle smoke test.
 *
 * ## What this file pins
 *
 * The four `simulateApp*` RPC verbs added in harness extensions
 * Step 4 ([D07], Spec [#s01-hardware-rpc]). Each verb invokes the
 * matching `NSApp` primitive on Tug.app's main thread and waits up
 * to 1000ms for the corresponding
 * `NSApplication.did...Notification` to fire on the real
 * AppDelegate. The notification handler in `AppDelegate.swift` is
 * what production tugdeck observes via the `app-lifecycle` control
 * frame, so binding these verbs to real notifications guarantees
 * fidelity with manual user actions ([D07] rationale).
 *
 *   1. **resign / become-active round trip** — call
 *      `simulateAppResign`, then `simulateAppBecomeActive`. Both
 *      should resolve without throwing. This is the M04 dependency.
 *
 *   2. **hide / unhide round trip** — same shape with
 *      `simulateAppHide` / `simulateAppUnhide`. M05 dependency.
 *
 *   3. **deliberate timeout** — pass `timeoutMs: 1` to a verb and
 *      assert it throws `AppLifecycleTimeoutError`. The 1ms bound
 *      expires before the run loop's next iteration can deliver the
 *      delegate callback, so the wait races out reliably.
 *
 * ## Why this is a scratch test
 *
 * Per parent plan #step-4 artifacts, this file is "deleted after
 * Step 6" — its coverage is subsumed once M04/M05 land in the
 * permanent test set. Until then, this is the unit-level pin for
 * the bridge primitive.
 *
 * ## AX preflight
 *
 * The lifecycle verbs themselves don't need the Accessibility grant
 * (no `CGEvent.post`), but `launchTugApp` runs the AX preflight
 * unconditionally unless `skipAccessibilityPreflight: true` is set.
 * We don't bother opting out — the preflight is a fast no-op when
 * the grant is in place.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import { AppLifecycleTimeoutError } from "./_harness/errors";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

describe.skipIf(!SHOULD_RUN)("phase A app-lifecycle smoke", () => {
  test("simulateAppResign + simulateAppBecomeActive round-trip resolves", async () => {
    const app = await launchTugApp({ testName: "smoke-app-lifecycle-resign" });
    try {
      // Tug.app boots with the window key + frontmost (see
      // `AppDelegate.applicationDidFinishLaunching`'s
      // `NSApp.activate(ignoringOtherApps: true)`). The first
      // `simulateAppResign` therefore exercises a real active →
      // inactive transition. macOS posts
      // `applicationDidResignActive:` once `windowserver` finishes
      // updating the per-app activation state machine.
      await app.simulateAppResign();
      // Round-trip back to active. `NSApp.activate(ignoringOtherApps: true)`
      // re-frontmosts the app and posts `applicationDidBecomeActive:`.
      await app.simulateAppBecomeActive();
    } finally {
      await app.close();
    }
  });

  test("simulateAppHide + simulateAppUnhide round-trip resolves", async () => {
    const app = await launchTugApp({ testName: "smoke-app-lifecycle-hide" });
    try {
      await app.simulateAppHide();
      await app.simulateAppUnhide();
    } finally {
      await app.close();
    }
  });

  test("simulateAppHide with 1ms timeout fires AppLifecycleTimeoutError when called twice", async () => {
    const app = await launchTugApp({
      testName: "smoke-app-lifecycle-timeout",
    });
    try {
      // First hide: should succeed (active → hidden transition).
      await app.simulateAppHide();
      // Second hide: NSApp.hide() is a no-op when the app is already
      // hidden, so `applicationDidHide:` doesn't fire. Combined with
      // a tight 1ms server-side wait, the verb is guaranteed to
      // surface an `AppLifecycleTimeoutError` rather than racing the
      // run loop.
      let caught: unknown = null;
      try {
        await app.simulateAppHide({ timeoutMs: 1 });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppLifecycleTimeoutError);
      const lifecycleErr = caught as AppLifecycleTimeoutError;
      expect(lifecycleErr.name).toBe("AppLifecycleTimeoutError");
      expect(lifecycleErr.event).toBe("didHide");

      // Restore the app to a clean state for any subsequent tests in
      // this file (`describe` blocks share no state across tests, but
      // the running Tug.app subprocess persists per `launchTugApp`).
      await app.simulateAppUnhide();
    } finally {
      await app.close();
    }
  });
});
