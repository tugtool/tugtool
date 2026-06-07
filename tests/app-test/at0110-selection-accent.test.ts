/**
 * at0110-selection-accent.test.ts — the color contract for selection.
 *
 * Under the focus language ([P01]/[P03]) committed selection is the **native
 * fill in the role color** — the role-resolved **blue** (unified with the toggle
 * "on" / filled-action blue), NOT orange. (This supersedes the earlier "accent /
 * orange = selection" reading; the focus / selection disentangle re-homed the
 * keyboard axis off the selection color, so selection is free to be the role
 * blue.) Two things must hold:
 *   - the **UI-selection** surface a selected list row paints
 *     (`--tug7-surface-selection-primary-normal-selected-rest`, surfaced to the
 *     row via the quiet sibling `--tugx-list-row-selected-bg`) resolves to the
 *     **blue** arc;
 *   - **text/character selection** (`--tug7-surface-selection-primary-normal-plain-rest`,
 *     the OS highlight consumed by the editors) is also **blue**.
 *
 * Hue is read from the computed, build-expanded `oklch(L C H …)` value of each
 * token — robust against tone/intensity/alpha tuning and theme differences,
 * since the blue arc is disjoint from the warm arcs in both brio and harmony. A
 * `gallery-list-view` card is mounted so `tug-list-row.css` (which defines the
 * `--tugx-list-row-selected-*` aliases) is loaded and its alias resolves.
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
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

// Resolve a custom property on :root and return its computed (build-expanded)
// value verbatim, so the test can parse the hue and a mismatch prints the raw
// color string.
const RAW_OF = (prop: string) => `getComputedStyle(document.body).getPropertyValue(${JSON.stringify(prop)}).trim()`;

// Pull the hue (3rd component) out of an `oklch(L C H)` / `oklch(L C H / A)`
// color string. Returns null if the value is not an oklch color.
function oklchHue(value: string | null): number | null {
  if (!value) return null;
  const m = value.match(/oklch\(\s*[\d.]+%?\s+[\d.]+%?\s+([\d.]+)/i);
  return m ? parseFloat(m[1]) : null;
}

describe.skipIf(!SHOULD_RUN)("AT0110: selection is the action/blue role color", () => {
  test(
    "UI-selection tokens resolve to blue; the text-selection token stays blue",
    async () => {
      const app = await launchTugApp({ testName: "at0110-selection-accent" });
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

        // UI selection — the base `selected` surface and the list-row alias
        // that consumes it both land in the blue arc (the role color).
        const selectedRaw = await app.evalJS<string | null>(
          RAW_OF("--tug7-surface-selection-primary-normal-selected-rest"),
        );
        const rowSelectedRaw = await app.evalJS<string | null>(
          RAW_OF("--tugx-list-row-selected-bg"),
        );
        // Text/character selection — the OS highlight is in the blue arc too.
        const textSelectionRaw = await app.evalJS<string | null>(
          RAW_OF("--tug7-surface-selection-primary-normal-plain-rest"),
        );

        const selectedHue = oklchHue(selectedRaw);
        const rowSelectedHue = oklchHue(rowSelectedRaw);
        const textSelectionHue = oklchHue(textSelectionRaw);

        expect(selectedHue).not.toBeNull();
        expect(selectedHue).toBeGreaterThan(200);
        expect(selectedHue).toBeLessThan(290); // blue arc — selection is the role color

        expect(rowSelectedHue).not.toBeNull();
        expect(rowSelectedHue).toBeGreaterThan(200);
        expect(rowSelectedHue).toBeLessThan(290); // blue arc — row fill is the role color

        expect(textSelectionHue).not.toBeNull();
        expect(textSelectionHue).toBeGreaterThan(200);
        expect(textSelectionHue).toBeLessThan(290); // blue arc
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
