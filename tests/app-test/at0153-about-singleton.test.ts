/**
 * at0153-about-singleton.test.ts — About card singleton + payload
 * identity ([AT0153]).
 *
 * Scenario:
 *
 *   Boot an empty deck. Dispatch the same `show-card` control action
 *   the Swift About Tug menu item sends, with the app-identity payload
 *   fields riding along. Verify the About card appears and renders the
 *   payload's version/build. Open a second (hello) card so the About
 *   pane is no longer top of z-order, then re-dispatch the About
 *   action: no duplicate card is created, the existing About pane is
 *   raised to z-top, and the About card becomes the focused card.
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

/**
 * Payload mirroring AppDelegate.showAbout's params. The icon is a 1×1
 * PNG data URL — the card renders any icon at its fixed 96px box, so
 * this exercises the tallest layout (real-icon variant) for the
 * no-scroll assertion below.
 */
const ABOUT_PAYLOAD = {
  component: "about",
  version: "9.9.9",
  build: "9990",
  commit: "0123456789abcdef0123456789abcdef01234567",
  branch: "test-branch",
  profile: "debug",
  copyright: "Copyright © 2026 Test",
  icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
} as const;

/** Expression: count of deck cards with the given componentId. */
function countByComponent(componentId: string): string {
  return `window.tugdeck.diag.getDeckState().cards.filter(
    (c) => c.componentId === ${JSON.stringify(componentId)},
  ).length`;
}

describe.skipIf(!SHOULD_RUN)("at0153: About card is a singleton", () => {
  test("show-card about creates once, renders payload, raises on repeat", async () => {
    const app = await launchTugApp({ ...NO_AX, testName: "at0153-about-singleton" });
    try {
      // ---- First invocation: card is created and renders the payload.
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-card", ${JSON.stringify(ABOUT_PAYLOAD)})`,
      );
      await app.waitForCondition<boolean>(`${countByComponent("about")} === 1`);
      expect(
        await app.getElementText('[data-testid="about-card-version"]'),
      ).toBe("Version 9.9.9 (9990)");

      // The About pane opens centered in the deck canvas (registration
      // `placement: "center"` — addCard computes floor((canvas - pane)/2)).
      const centered = await app.evalJS<boolean>(
        `(() => {
          const s = window.tugdeck.diag.getDeckState();
          const pane = s.panes[s.panes.length - 1];
          const c = document.getElementById("deck-container");
          const ex = Math.max(0, Math.floor((c.clientWidth - pane.size.width) / 2));
          const ey = Math.max(0, Math.floor((c.clientHeight - pane.size.height) / 2));
          return pane.position.x === ex && pane.position.y === ey;
        })()`,
      );
      expect(centered).toBe(true);

      // The About box never scrolls: the full layout (96px icon
      // variant) fits the pane's fixed-height content area.
      const overflows = await app.evalJS<boolean>(
        `(() => {
          const s = window.tugdeck.diag.getDeckState();
          const pane = s.panes[s.panes.length - 1];
          const content = document.querySelector(
            '[data-pane-id="' + pane.id + '"] .tug-pane-content',
          );
          return content.scrollHeight > content.clientHeight;
        })()`,
      );
      expect(overflows).toBe(false);

      // ---- Put another pane on top so the raise is observable.
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-card", { component: "hello" })`,
      );
      await app.waitForCondition<boolean>(`${countByComponent("hello")} === 1`);
      const aboutCardId = await app.evalJS<string>(
        `window.tugdeck.diag.getDeckState().cards.find((c) => c.componentId === "about").id`,
      );
      expect(await app.getFocusedCardId()).not.toBe(aboutCardId);

      // ---- Second invocation: no duplicate; existing pane raised to z-top
      //      (last entry in panes is top of z-order) and focused.
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-card", ${JSON.stringify(ABOUT_PAYLOAD)})`,
      );
      await app.waitForCondition<boolean>(
        `(() => {
          const s = window.tugdeck.diag.getDeckState();
          const top = s.panes[s.panes.length - 1];
          return top.cardIds.includes(${JSON.stringify(aboutCardId)});
        })()`,
      );
      expect(await app.evalJS<number>(countByComponent("about"))).toBe(1);
      expect(await app.getFocusedCardId()).toBe(aboutCardId);
    } finally {
      await app.close();
    }
  });
});
