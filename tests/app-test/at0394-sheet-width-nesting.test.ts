/**
 * at0394-sheet-width-nesting.test.ts — every sheet width tier stays visibly
 * nested inside its host card, at every content-width preset.
 *
 * The failure this exists to catch has already happened once. The `sm`/`md`/
 * `lg`/`xl` ladder was calibrated when every content card was 800px wide, and
 * its only guard was an absolute `max-width: calc(100% - 2 * 24px)`. When the
 * Layouts rework put cards on the 675 / 800 / 1230 presets, two of those landed
 * UNDER the ladder — so `md`, `lg`, and `xl` all clamped to a 24px gutter on a
 * slim card, which is the same 24px the sheet carries as internal padding. The
 * panel did not overflow and nothing threw; it just stopped reading as a panel.
 * No existing test could see it, because every one of them asserts what a sheet
 * CONTAINS rather than where its edges are.
 *
 * So the claim pinned here is geometric, and it is the one a screenshot makes:
 * the card shows on both sides of the sheet, by an amount proportional to the
 * card. Two assertions per (preset × tier) pair:
 *
 *  1. **The gutter is proportional, not a fixed floor.** Each side is at least
 *     6% of the pane frame — just under the 7% `--tugx-sheet-gutter` so a
 *     sub-pixel rounding difference is not a failure, but far above the 24px
 *     absolute floor (3.6% of slim, 2.0% of wide) that the old guard produced.
 *     A regression to any fixed px gutter fails on the wide card first.
 *  2. **It is centered.** Left and right gutters match within a pixel, so a
 *     panel pushed off-axis by a margin change cannot pass on its total inset.
 *
 * The tiers are opened through the gallery's Display Widths section rather than
 * through a shipping sheet, because the claim is about the FRAME: driving all
 * four tiers over one body isolates the width ladder from whatever any one
 * card's content happens to want, and it fails at whichever tier broke instead
 * of at whichever card was chosen as the sample.
 *
 * Widths are read off the painted rects — the sheet's and the pane frame's —
 * which is what makes this an app-test. The presets are applied with ⌃⌘1/2/3,
 * the same door at0371 pins, so a card really is wearing the width when the
 * sheet opens rather than being told it is.
 *
 * @covers tugdeck/src/components/tugways/tug-sheet.css
 * @covers tugdeck/src/components/tugways/tug-sheet.tsx
 * @covers tugdeck/src/components/tugways/cards/gallery-sheet.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/** The presets, as `lib/layout-imposer.ts` fixes them, with their chord digit. */
const PRESETS = [
  { name: "slim", digit: 1, px: 675 },
  { name: "comfy", digit: 2, px: 800 },
  { name: "wide", digit: 3, px: 1230 },
] as const;

/** The width ladder, as `tug-sheet.css` fixes it. */
const TIERS = ["sm", "md", "lg", "xl"] as const;

/**
 * The gutter floor asserted, as a fraction of the pane frame. Set just under
 * `--tugx-sheet-gutter` (7%) so rounding cannot fail a correct build, and well
 * above what any fixed-px guard yields on a wide card.
 */
const MIN_GUTTER_FRACTION = 0.06;

/** The settle window (`IMPOSITION_SETTLE_MS`), with room for the tween. */
const AFTER_LAND_MS = 900;

const CARD = '[data-testid="gallery-sheet"]';

const wait = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

function deckShape(): Record<string, unknown> {
  return {
    cards: [
      { id: "A", componentId: "gallery-sheet", title: "Sheet Gallery", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 675, height: 760 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
        slot: 0,
      },
    ],
    activePaneId: "p1",
    imposition: { kind: "single" },
    hasFocus: true,
  };
}

const PANE_WIDTH_JS =
  `Math.round(document.querySelector('.tug-pane[data-pane-id="p1"]').getBoundingClientRect().width)`;

/** The sheet's and the frame's painted rects, as the gutters they imply. */
interface Gutters {
  frameWidth: number;
  sheetWidth: number;
  left: number;
  right: number;
}

async function readGutters(app: App): Promise<Gutters> {
  return app.evalJS<Gutters>(`(() => {
    const frame = document.querySelector('.tug-pane[data-pane-id="p1"]').getBoundingClientRect();
    const sheet = document.querySelector('.tug-sheet-content').getBoundingClientRect();
    return {
      frameWidth: frame.width,
      sheetWidth: sheet.width,
      left: sheet.left - frame.left,
      right: frame.right - sheet.right,
    };
  })()`);
}

/** Apply a width preset and wait for the pane to land on it. */
async function applyPreset(app: App, digit: number, px: number): Promise<void> {
  await app.nativeKey(String(digit), ["ctrl", "cmd"]);
  await app.waitForCondition<boolean>(`(${PANE_WIDTH_JS}) === ${px}`, {
    timeoutMs: 8_000,
  });
  await wait(AFTER_LAND_MS);
}

/**
 * Open one tier's sheet and wait for it to reach its resting geometry. The
 * entrance is a scale-fade, so a rect read mid-flight is a scaled one — the
 * wait is on the animation having settled, not on the element existing.
 */
async function openTier(app: App, tier: string): Promise<void> {
  await app.click(`${CARD} [data-testid="gallery-sheet-width-${tier}"]`);
  await app.waitForCondition<boolean>(
    `(() => {
      const el = document.querySelector('.tug-sheet-content');
      if (el === null) return false;
      const t = getComputedStyle(el).transform;
      return (t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)")
        && getComputedStyle(el).opacity === "1";
    })()`,
    { timeoutMs: 8_000 },
  );
}

async function closeSheet(app: App): Promise<void> {
  await app.nativeKey("Escape");
  await app.waitForCondition<boolean>(
    `document.querySelector('.tug-sheet-content') === null`,
    { timeoutMs: 8_000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0394 — sheet widths stay nested at every card preset",
  () => {
    test(
      "every tier keeps a proportional, centered gutter on slim, comfy, and wide",
      async () => {
        const app = await launchTugApp({ testName: "at0394-sheet-width-nesting" });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelector('${CARD}') !== null`,
            { timeoutMs: 10_000 },
          );
          await wait(AFTER_LAND_MS);

          for (const preset of PRESETS) {
            await applyPreset(app, preset.digit, preset.px);

            for (const tier of TIERS) {
              await openTier(app, tier);
              const g = await readGutters(app);
              const floor = g.frameWidth * MIN_GUTTER_FRACTION;
              const where = `${preset.name} card, ${tier} sheet`;

              note(
                where,
                `frame ${Math.round(g.frameWidth)} · sheet ${Math.round(
                  g.sheetWidth,
                )} · gutters ${Math.round(g.left)}/${Math.round(g.right)}`,
              );

              // 1. Proportional — the card shows on both sides, by an amount
              //    that scales with the card rather than a fixed 24px.
              expect(
                g.left,
                `${where}: left gutter ${g.left.toFixed(1)}px is below ${floor.toFixed(1)}px`,
              ).toBeGreaterThanOrEqual(floor);
              expect(
                g.right,
                `${where}: right gutter ${g.right.toFixed(1)}px is below ${floor.toFixed(1)}px`,
              ).toBeGreaterThanOrEqual(floor);

              // 2. Centered — a panel pushed off-axis cannot pass on its total.
              expect(
                Math.abs(g.left - g.right),
                `${where}: gutters ${g.left.toFixed(1)}/${g.right.toFixed(1)} are not symmetric`,
              ).toBeLessThanOrEqual(1);

              await closeSheet(app);
            }
          }
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
