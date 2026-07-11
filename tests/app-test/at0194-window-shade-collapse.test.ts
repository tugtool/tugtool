/**
 * at0194-window-shade-collapse.test.ts — window-shade collapse leaves a clean
 * stub and round-trips the card height ([AT0194]).
 *
 * Two regressions, both observed on a real collapsed card:
 *
 *  1. **The turd.** `.tug-pane-chrome` is `height: 100%` with a 1px border.
 *     Under the default `content-box`, that resolves to a box 2px taller (and
 *     wider) than the frame, so the chrome's bottom border + rounded corner
 *     protrude below the title bar of a collapsed card. Fixed by giving the
 *     chrome `box-sizing: border-box`. This test asserts the chrome's bottom
 *     never falls below the frame's bottom and the two heights match.
 *
 *  2. **Lost height on re-expand.** Collapsing locks the frame to the title-bar
 *     stub height. The drag-commit path wrote `frame.offsetHeight` to the store
 *     unconditionally, so ANY title-bar interaction on a collapsed card (even a
 *     zero-distance click, or a reposition drag) overwrote the stored expanded
 *     height with the stub height — and the card could never be restored. Fixed
 *     by committing the preserved `size.height` while collapsed. This test
 *     drags the collapsed card by its title bar, then re-expands and asserts the
 *     original height is restored.
 *
 * Drives native CGEvents (click + drag) → strict AX preflight.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`. Runs only under `TUGAPP_APP_TEST=1`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const FRAME = '[data-testid="tug-pane"][data-pane-id="p1"]';
const TITLE_BAR = '[data-testid="tug-pane-title-bar"]';
const CHEVRON = '[data-testid="tug-pane-title-bar-collapse-button"]';

const SEEDED_HEIGHT = 900;

describe.skipIf(!SHOULD_RUN)("at0194: window-shade collapse", () => {
  test("collapsed stub has no protrusion; title-bar drag preserves height", async () => {
    const app = await launchTugApp({ testName: "at0194-window-shade-collapse" });
    try {
      await app.seedDeckState({
        state: {
          cards: [
            {
              id: "A",
              componentId: "gallery-theme-editor",
              title: "Theme Deriver",
              closable: true,
            },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 640, height: SEEDED_HEIGHT },
              cardIds: ["A"],
              activeCardId: "A",
              title: "",
              acceptsFamilies: ["maker"],
            },
          ],
          activePaneId: "p1",
          hasFocus: true,
        },
        focusCardId: "A",
      });
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(CHEVRON)}) !== null`,
      );

      const expanded = await app.getElementBounds(FRAME);
      expect(expanded.height).toBeCloseTo(SEEDED_HEIGHT, 0);

      // ---- Collapse ----
      await app.nativeClickAtElement(CHEVRON);
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(FRAME)}).getAttribute("data-collapsed") === "true"`,
      );
      // Let the height transition settle to the stub height.
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(FRAME)}).getBoundingClientRect().height < 60`,
        { timeoutMs: 3000 },
      );

      // Regression 1 — no chrome protruding below the frame (the "turd").
      const frameBottom = await app.evalJS<number>(
        `document.querySelector(${JSON.stringify(FRAME)}).getBoundingClientRect().bottom`,
      );
      const chromeBottom = await app.evalJS<number>(
        `document.querySelector(".tug-pane-chrome--collapsed").getBoundingClientRect().bottom`,
      );
      const chromeHeight = await app.evalJS<number>(
        `document.querySelector(".tug-pane-chrome--collapsed").getBoundingClientRect().height`,
      );
      const collapsed = await app.getElementBounds(FRAME);
      expect(chromeBottom).toBeLessThanOrEqual(frameBottom + 0.5);
      expect(chromeHeight).toBeCloseTo(collapsed.height, 0);

      // ---- Drag the collapsed card by its title bar (grab the shade) ----
      const tb = await app.getElementBounds(TITLE_BAR);
      const startX = Math.round(tb.x + tb.width / 2);
      const startY = Math.round(tb.y + tb.height / 2);
      await app.nativeDrag(
        { x: startX, y: startY },
        { x: startX + 80, y: startY + 40 },
      );
      // The card actually moved (the drag took effect).
      const moved = await app.getElementBounds(FRAME);
      expect(moved.x).toBeGreaterThan(collapsed.x + 20);
      expect(moved.y).toBeGreaterThan(collapsed.y + 10);

      // ---- Re-expand ----
      await app.nativeClickAtElement(CHEVRON);
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(FRAME)}).getAttribute("data-collapsed") === "false"`,
      );
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(FRAME)}).getBoundingClientRect().height >= ${SEEDED_HEIGHT - 5}`,
        { timeoutMs: 3000 },
      );

      // Regression 2 — original height restored.
      const reExpanded = await app.getElementBounds(FRAME);
      expect(reExpanded.height).toBeCloseTo(SEEDED_HEIGHT, 0);
    } finally {
      await app.close();
    }
  });
});
