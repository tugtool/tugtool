/**
 * at0154-settings-singleton.test.ts — Settings card singleton +
 * internal tab strip ([AT0154]).
 *
 * Scenario:
 *
 *   Boot an empty deck. Dispatch the `show-card` control action the
 *   Swift Settings… (⌘,) menu item sends. Verify the Settings card
 *   appears with its internal tab strip (the fixed "Session Card" tab).
 *   Open a second (hello) card so the Settings pane is no longer top
 *   of z-order, then re-dispatch: no duplicate card is created and the
 *   existing Settings pane is raised to z-top and focused.
 *
 * Drives no native CGEvents — control actions go through
 * `__tug.dispatchControlAction`, the same `dispatchAction` path the
 * Swift host's control frames take — so the AX preflight is skipped.
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

/** Expression: count of deck cards with the given componentId. */
function countByComponent(componentId: string): string {
  return `window.tugdeck.diag.getDeckState().cards.filter(
    (c) => c.componentId === ${JSON.stringify(componentId)},
  ).length`;
}

describe.skipIf(!SHOULD_RUN)("at0154: Settings card is a singleton", () => {
  test("show-card settings creates once with tab strip, raises on repeat", async () => {
    const app = await launchTugApp({ ...NO_AX, testName: "at0154-settings-singleton" });
    try {
      // ---- First invocation: card is created with its tab strip.
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-card", { component: "settings" })`,
      );
      await app.waitForCondition<boolean>(
        `${countByComponent("settings")} === 1`,
      );
      // The internal TugTabBar renders the fixed Session Card tab inside the card.
      await app.waitForCondition<boolean>(
        `document.querySelector('[data-testid="settings-card"] [role="tablist"]') !== null`,
      );
      expect(
        await app.getElementText(
          '[data-testid="settings-card"] [role="tab"][aria-selected="true"]',
        ),
      ).toContain("Session Card");

      // ---- Put another pane on top so the raise is observable.
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-card", { component: "hello" })`,
      );
      await app.waitForCondition<boolean>(`${countByComponent("hello")} === 1`);
      const settingsCardId = await app.evalJS<string>(
        `window.tugdeck.diag.getDeckState().cards.find((c) => c.componentId === "settings").id`,
      );
      expect(await app.getFocusedCardId()).not.toBe(settingsCardId);

      // ---- Second invocation: no duplicate; existing pane raised to z-top
      //      (last entry in panes is top of z-order) and focused.
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-card", { component: "settings" })`,
      );
      await app.waitForCondition<boolean>(
        `(() => {
          const s = window.tugdeck.diag.getDeckState();
          const top = s.panes[s.panes.length - 1];
          return top.cardIds.includes(${JSON.stringify(settingsCardId)});
        })()`,
      );
      expect(await app.evalJS<number>(countByComponent("settings"))).toBe(1);
      expect(await app.getFocusedCardId()).toBe(settingsCardId);
    } finally {
      await app.close();
    }
  });
});
