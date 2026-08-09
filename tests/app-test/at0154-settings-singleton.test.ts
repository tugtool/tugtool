/**
 * at0154-settings-singleton.test.ts — Settings card singleton +
 * master/detail sections ([AT0154]).
 *
 * Scenario:
 *
 *   Boot an empty deck. Dispatch the `show-card` control action the
 *   Swift Settings… (⌘,) menu item sends. Verify the Settings card
 *   appears with its three preference sections in the tab view's sidebar
 *   and exactly one panel showing.
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
 *
 * @covers tugdeck/src/components/tugways/cards/settings-card.tsx
 * @covers tugdeck/src/components/tugways/cards/settings-card.css
 * @covers tugdeck/src/components/tugways/tug-tab-view.tsx
 * @covers tugdeck/src/card-registry.ts
 * @covers tugdeck/src/action-dispatch.ts
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
  test("show-card settings creates once with its sections, raises on repeat", async () => {
    const app = await launchTugApp({ ...NO_AX, testName: "at0154-settings-singleton" });
    try {
      // ---- First invocation: card is created with its three sections.
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-card", { component: "settings" })`,
      );
      await app.waitForCondition<boolean>(
        `${countByComponent("settings")} === 1`,
      );
      // The card renders one sidebar tab per section (`settings-card.tsx`
      // SECTIONS), in order, and exactly one panel — the selected section's.
      await app.waitForCondition<boolean>(
        `document.querySelectorAll(
          '[data-testid="settings-card"] [data-testid^="tug-tab-view-tab-"]',
        ).length === 3`,
      );
      expect(
        await app.evalJS<string[]>(
          `Array.from(
            document.querySelectorAll(
              '[data-testid="settings-card"] [data-testid^="tug-tab-view-tab-"]',
            ),
          ).map((el) =>
            (el.querySelector(".tug-tab-view-tab-label")?.textContent || "").trim(),
          )`,
        ),
      ).toEqual(["General", "Sessions", "Text Card"]);

      // The sidebar is sized by its own names: narrower than the tab view's
      // 190px default, and still wide enough that no label is clipped.
      const sidebar = await app.evalJS<{ width: number; clipped: boolean }>(
        `(function(){
          var list = document.querySelector(
            '[data-testid="settings-card"] .tug-tab-view-list',
          );
          var labels = Array.from(
            list.querySelectorAll(".tug-tab-view-tab-label"),
          );
          return {
            width: list.getBoundingClientRect().width,
            clipped: labels.some(function (el) {
              return el.scrollWidth > el.clientWidth;
            }),
          };
        })()`,
      );
      expect(sidebar.width).toBeLessThan(190);
      expect(sidebar.clipped).toBe(false);
      expect(
        await app.evalJS<number>(
          `document.querySelectorAll(
            '[data-testid="settings-card"] [data-testid^="settings-section-"]',
          ).length`,
        ),
      ).toBe(1);

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
