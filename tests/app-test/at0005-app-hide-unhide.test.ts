/**
 * at0005-app-hide-unhide.test.ts — App hide → unhide preserves focus
 * + selection on the current first-responder card (parallel to m04;
 * [AT0005]).
 *
 * Scenario:
 *
 *   Seed P1=[A] active=A. Click into A's input and type "alpha".
 *   Call `simulateAppHide` — `NSApp.hide(nil)` triggers the full
 *   AppKit hide cascade: `applicationWillHide:` →
 *   `applicationDidHide:`, AND the WKWebView's window goes from
 *   visible to off-screen, which fires JS `window.blur` AND
 *   `visibilitychange` (document.hidden flips true). Both saves
 *   fire — but only the window-`blur` source is the new wiring
 *   We assert that source
 *   appears in the trace.
 *
 *   Then call `simulateAppUnhide`. The window comes back, JS
 *   `window.focus` fires, `reactivateCurrentFocusDestination`
 *   resolves A's saved focus snapshot, and `.focus()` lands on
 *   A's input. Value + first responder preserved.
 *
 * Probes
 * ------
 * Same shape as m04. The single behavioral difference is the
 * Swift primitive (`NSApp.hide` vs `NSApp.deactivate` + Finder
 * activation) — both produce the JS `window.blur` event the
 * deck-store listener observes, so the [A4] reactivation path is
 * the same.
 *
 * Gating
 * ------
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs
 * without `TUGAPP_IN_APP_TEST=1` skip every test.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

const INPUT_PERSIST_KEY = "gallery-input/size/sm";

function inputSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-persist-value="${INPUT_PERSIST_KEY}"]`;
}

describe.skipIf(!SHOULD_RUN)("m05: app hide → unhide preserves focus + value", () => {
  test("simulateAppHide + simulateAppUnhide restores focus inside first-responder card", async () => {
    const app = await launchTugApp({ testName: "at0005-app-hide-unhide" });
    try {
      await app.enableDeckTrace(true);

      await app.seedDeckState({
        state: {
          cards: [
            { id: "A", componentId: "gallery-input", title: "Card A", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 400, height: 320 },
              cardIds: ["A"],
              activeCardId: "A",
              title: "",
              acceptsFamilies: ["developer"],
            },
          ],
          activePaneId: "p1",
          hasFocus: true,
        },
        focusCardId: "A",
      });

      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
      );

      await app.nativeClickAtElement(inputSelectorFor("A"));
      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(inputSelectorFor("A"))})`,
      );
      await app.type(inputSelectorFor("A"), "alpha");
      expect(await app.getFormControlValue("A", INPUT_PERSIST_KEY)).toBe("alpha");

      // -----------------------------------------------------------------
      // Hide: NSApp.hide(nil). applicationDidHide fires; WKWebView
      // blurs (JS window.blur fires) and goes hidden (JS
      // visibilitychange may also fire). The blur listener saves
      // with source "window-blur" — that's the marker we assert on.
      // -----------------------------------------------------------------
      const markBeforeHide = await app.markDeckTrace();
      await app.simulateAppHide();

      await app.waitForCondition<boolean>(
        `(function(){
          var t = window.__tug.getDeckTrace({since: ${markBeforeHide}});
          for (var i = 0; i < t.length; i++) {
            if (t[i].kind === "save-callback" && t[i].source === "window-blur" && t[i].cardId === "A") return true;
          }
          return false;
        })()`,
        { timeoutMs: 2000 },
      );

      // -----------------------------------------------------------------
      // Unhide: NSApp.unhide(nil). applicationDidUnhide fires; the
      // window comes back, JS window.focus fires,
      // reactivateCurrentFocusDestination restores focus to A.
      // -----------------------------------------------------------------
      await app.simulateAppUnhide();

      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(inputSelectorFor("A"))})`,
        { timeoutMs: 2000 },
      );

      expect(await app.getFormControlValue("A", INPUT_PERSIST_KEY)).toBe("alpha");
      expect(await app.getActiveCardId()).toBe("A");
    } catch (err) {
      const tail = app.tailLog(200);
      if (tail !== "") {
        process.stderr.write(
          `\n[at0005-app-hide-unhide] Tug.app log tail (last 200 lines):\n${tail}\n`,
        );
      }
      const tracePath = await app.dumpTraceToFile(
        "logs/at0005-app-hide-unhide-trace.json",
      );
      if (tracePath !== null) {
        process.stderr.write(`[at0005-app-hide-unhide] trace dumped to ${tracePath}\n`);
      }
      throw err;
    } finally {
      await app.close();
    }
  });
});
