/**
 * at0156-title-bar-controls.test.ts — pane title bar carries only the
 * window-shade and close controls ([AT0156]).
 *
 * The per-pane `…` (card settings) button is retired — settings live
 * in the app-level Settings card. This pins the title-bar control set:
 * exactly two buttons (collapse chevron + close X) for a closable
 * card, and no settings button anywhere in the deck.
 *
 * Drives no native CGEvents — DOM assertions only — so the AX
 * preflight is skipped.
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

const CONTROLS = '[data-testid="tug-pane-title-bar-controls"]';

describe.skipIf(!SHOULD_RUN)("at0156: title bar is shade + close only", () => {
  test("controls hold exactly collapse and close; no settings button", async () => {
    const app = await launchTugApp({ ...NO_AX, testName: "at0156-title-bar-controls" });
    try {
      await app.seedDeckState({
        state: {
          cards: [
            { id: "A", componentId: "gallery-input", title: "Card A", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 420, height: 320 },
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
        `document.querySelector(${JSON.stringify(CONTROLS)}) !== null`,
      );

      // No settings button anywhere.
      expect(
        await app.evalJS<number>(
          `document.querySelectorAll('[data-testid="tug-pane-title-bar-settings-button"]').length`,
        ),
      ).toBe(0);

      // Exactly two buttons in the controls cluster: collapse, then close.
      const testids = await app.evalJS<string[]>(
        `Array.from(
          document.querySelector(${JSON.stringify(CONTROLS)}).querySelectorAll("button"),
        ).map((b) => b.getAttribute("data-testid"))`,
      );
      expect(testids).toEqual([
        "tug-pane-title-bar-collapse-button",
        "tug-pane-close-button",
      ]);
    } finally {
      await app.close();
    }
  });
});
