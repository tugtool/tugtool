/**
 * at0111-blue-keyboard-active.test.ts — orange is confined to the keyboard-active
 * axis, not selection.
 *
 * The color contract, end state (after the accent/action role swap): a
 * **selected-and-focused** element must read as two distinct things at once — a
 * **blue** selection fill and an **orange** focus ring. The keyboard-active axis
 * (the ring) is the lone orange surface; the primary **CTA** rides the *action*
 * axis, which the swap moved to **blue** (cobalt) — so the CTA is no longer
 * orange. This pins the three tokens those surfaces paint, and proves the
 * selection-vs-focus hues are far apart (so "selected" and "keyboard-active" are
 * not the same color):
 *   - `--tugx-list-row-selected-bg` (the fill a selected row paints) → blue;
 *   - `--tugx-focus-ring-color` (the ring a focused element paints) → orange;
 *   - `--tug7-surface-control-primary-filled-action-rest` (the CTA) → blue.
 *
 * Hue is read from each token's build-expanded `oklch(L C H …)` value — robust
 * against tone/intensity tuning and theme differences, since orange and blue sit
 * on disjoint hue arcs in both themes. A `gallery-list-view` card is mounted so
 * `tug-list-row.css` (which defines `--tugx-list-row-selected-bg`) is loaded.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const LIST_VIEW = `${CARD} [data-testid="gallery-list-view"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-list-view", title: "List", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 520 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

const RAW_OF = (prop: string) => `getComputedStyle(document.body).getPropertyValue(${JSON.stringify(prop)}).trim()`;

// Pull the hue (3rd component) out of an `oklch(L C H)` / `oklch(L C H / A)`
// color string. Returns null if the value is not an oklch color.
function oklchHue(value: string | null): number | null {
  if (!value) return null;
  const m = value.match(/oklch\(\s*[\d.]+%?\s+[\d.]+%?\s+([\d.]+)/i);
  return m ? parseFloat(m[1]) : null;
}

const ORANGE_LO = 20;
const ORANGE_HI = 110;
const BLUE_LO = 200;
const BLUE_HI = 290;

describe.skipIf(!SHOULD_RUN)("AT0111: orange is the keyboard-active axis, not selection", () => {
  test(
    "selected fill is blue, focus ring is orange, CTA is orange — selection and focus are distinguishable",
    async () => {
      const app = await launchTugApp({ testName: "at0111-blue-keyboard-active" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(LIST_VIEW)}) !== null`,
          { timeoutMs: 8000 },
        );

        const selectedFillRaw = await app.evalJS<string | null>(RAW_OF("--tugx-list-row-selected-bg"));
        const focusRingRaw = await app.evalJS<string | null>(RAW_OF("--tugx-focus-ring-color"));
        const ctaRaw = await app.evalJS<string | null>(
          RAW_OF("--tug7-surface-control-primary-filled-action-rest"),
        );

        const selectedHue = oklchHue(selectedFillRaw);
        const focusRingHue = oklchHue(focusRingRaw);
        const ctaHue = oklchHue(ctaRaw);

        // A selected row's fill is blue (the selection axis).
        expect(selectedHue).not.toBeNull();
        expect(selectedHue).toBeGreaterThan(BLUE_LO);
        expect(selectedHue).toBeLessThan(BLUE_HI);

        // The focus ring (keyboard-active axis) is orange.
        expect(focusRingHue).not.toBeNull();
        expect(focusRingHue).toBeGreaterThan(ORANGE_LO);
        expect(focusRingHue).toBeLessThan(ORANGE_HI);

        // The primary CTA rides the action axis, which the accent/action
        // swap moved to blue — so the CTA is blue (cobalt), not orange.
        // Orange is now confined to the keyboard-active ring above.
        expect(ctaHue).not.toBeNull();
        expect(ctaHue).toBeGreaterThan(BLUE_LO);
        expect(ctaHue).toBeLessThan(BLUE_HI);

        // Selection and keyboard-active are no longer the same color: the two
        // hues are far apart, so a selected-and-focused element reads as both.
        expect(Math.abs((focusRingHue as number) - (selectedHue as number))).toBeGreaterThan(100);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
