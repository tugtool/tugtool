/**
 * at0278-update-bulletin.test.ts — the self-update notice reaches the deck.
 *
 * Scenario:
 *
 *   Launch the app, then call `window.__tugBridge.onUpdateAvailable` the
 *   way the host does when a scheduled Sparkle check finds a new version.
 *   The callback under test is the real one `installUpdateBridge()`
 *   installed at deck boot — only its caller is synthesized, because the
 *   updater itself is gated off for every identity the harness can build
 *   (`UpdateController` starts only for `dev.tugtool.app` or with
 *   `TUG_SPARKLE_FEED` set). The actual download / install / relaunch is
 *   Sparkle's and is verified by hand against a served feed.
 *
 * Assertions:
 *
 *   - a bulletin carrying the offered version renders;
 *   - its action posts back to the host without throwing. In the harness
 *     the `checkForUpdates` message handler is registered but the updater
 *     is inactive, so the host logs and returns — the point is that the
 *     round trip is wired, not that an update flow opens.
 *
 * Opts out of the AX preflight: no native CGEvents are driven.
 *
 * @covers tugdeck/src/lib/update-bridge.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const NO_AX = { skipAccessibilityPreflight: true } as const;

/** The version the synthesized appcast item offers. */
const OFFERED_VERSION = "9.9.9";
const OFFERED_BUILD = "99999";

/** Text content of the bulletin stack, or "" when nothing is up. */
const BULLETIN_TEXT = `(function () {
  var el = document.querySelector(".tug-bulletin");
  return el === null ? "" : el.textContent || "";
})()`;

describe.skipIf(!SHOULD_RUN)("at0278: update bulletin", () => {
  test("a scheduled update find renders a bulletin whose action posts back", async () => {
    const app = await launchTugApp({ ...NO_AX, testName: "at0278-update-bulletin" });
    try {
      // The bridge receiver must exist before the push — if boot never
      // installed it, the push below would no-op and the wait would time
      // out with a less obvious failure.
      const installed = await app.evalJS<boolean>(
        `typeof window.__tugBridge?.onUpdateAvailable === "function"`,
      );
      expect(installed).toBe(true);

      await app.evalJS<null>(
        `(window.__tugBridge.onUpdateAvailable({` +
          `version: ${JSON.stringify(OFFERED_VERSION)}, ` +
          `build: ${JSON.stringify(OFFERED_BUILD)}}), null)`,
      );

      await app.waitForCondition(
        `${BULLETIN_TEXT}.indexOf(${JSON.stringify(OFFERED_VERSION)}) !== -1`,
      );

      const text = await app.evalJS<string>(BULLETIN_TEXT);
      expect(text).toContain(`Tug ${OFFERED_VERSION} is available`);
      expect(text).toContain("Restart into the new version");

      // The action button is the only button in the bulletin besides
      // Sonner's close affordance, which carries a data attribute.
      const clicked = await app.evalJS<boolean>(`(function () {
        var el = document.querySelector(".tug-bulletin");
        if (el === null) return false;
        var buttons = Array.prototype.slice.call(el.querySelectorAll("button"));
        var action = buttons.filter(function (b) {
          return (b.textContent || "").indexOf("Update") !== -1;
        })[0];
        if (action === undefined) return false;
        action.click();
        return true;
      })()`);
      expect(clicked).toBe(true);
    } finally {
      await app.close();
    }
  });
});
