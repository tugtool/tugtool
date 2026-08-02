/**
 * at0303-imposer-space-allocator.test.ts — the imposer flexes the Lens so the
 * cards tile evenly, and knows when not to.
 *
 * A slot is an anchor at a fixed fraction of the band and a card's width is its
 * own, so whatever the band leaves over shows up as slack between the cards:
 * choose Five Up on a roomy deck and the cards stand apart, narrow the window
 * slightly and the same arrangement overlaps. The **space allocator** treats the
 * pinned Lens's width as the one flexible quantity — it is the band's other end
 * — and picks the width that puts every seam on one imposition gap.
 *
 * What has to hold:
 *
 *  1. It engages. Picking an arrangement whose exact solve is inside the flex
 *     allowance lands the Lens on that solve, and every seam in the chain on
 *     `IMPOSITION_GAP_PX`. The Lens's crossing is a FLIP settle like any other
 *     arrangement change, not a cut.
 *  2. It leaves the preference alone. The allocated width is live geometry; the
 *     width the user CHOSE is what the Lens reopens at, and no number of
 *     re-tunes may touch it. Read through the production path — close the Lens,
 *     open it again, and it must come back at the preferred width.
 *  3. It declines by NOT MOVING. A solve it cannot make good is not applied at
 *     all and not applied partway — and "not applied" means the Lens stays
 *     exactly where it stood, never snapping to the remembered preference. The
 *     Lens's width is the user's; it is only ever taken from them to close a
 *     gap, so a re-tune that closes none must cost them nothing.
 *  4. Re-asserting the layout re-tunes. Re-clicking the already-active Cards
 *     option used to be a total no-op; it now drives the same entry the
 *     settled-resize observer calls. The harness cannot resize the app's
 *     window, so this gesture is what covers that entry end to end.
 *  5. Joining the chain does NOT re-tune. The occupied slots are the
 *     allocator's input, but slotting a card is not one of the two moments the
 *     Lens's width is the deck's to spend: the user moved a CARD and did not
 *     ask for their rail to be resized. The seams go ragged and stay that way
 *     until a Layouts click or a window resize asks for them back.
 *
 * The fixture card width is computed at runtime from the measured canvas, so
 * the solve lands a known distance from the preferred width whatever size the
 * app launched at. The preferred width itself is seeded through tugbank rather
 * than assumed.
 *
 * @covers tugdeck/src/lib/layout-imposer.ts
 * @covers tugdeck/src/deck-manager.ts
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** The imposition gap (`lib/layout-imposer.ts`). */
const GAP = 5;
/** The preferred Lens width this test seeds, so nothing depends on the default. */
const PREFERRED = 420;
/** The settle window, with room for the tween to land. */
const AFTER_LAND_MS = 900;
/** Frames are measured in device pixels; a rounded pin is within a pixel. */
const TOL = 1.5;

const FIVE_UP_TILE = '[data-testid="lens-layouts-kind"] [data-radio-value="five-up"]';
const KIND_TILES = '[data-testid="lens-layouts-kind"] [data-radio-value]';
const LENS_FRAME = `.tug-pane[data-pane-id="pLens"]`;
/** The three chain panes, in slot order. */
const CHAIN = ["p1", "p2", "p3"];

/**
 * A deck of three cards in slots 1, 3 and 5 (stored 0-based) at `paneWidth`,
 * with the Lens pinned right at `lensWidth`. The kind starts at two-up, so
 * choosing Five Up in the Layouts section is a real kind change.
 */
function deckShape(paneWidth: number, lensWidth: number) {
  const pane = (id: string, slot: number, cardId: string) => ({
    id,
    position: { x: 40, y: 40 },
    size: { width: paneWidth, height: 400 },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["maker"],
    slot,
  });
  return {
    cards: [
      { id: "A", componentId: "hello", title: "Card A", closable: true },
      { id: "B", componentId: "hello", title: "Card B", closable: true },
      { id: "C", componentId: "hello", title: "Card C", closable: true },
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      pane("p1", 0, "A"),
      pane("p2", 2, "B"),
      pane("p3", 4, "C"),
      {
        id: "pLens",
        position: { x: 0, y: 0 },
        size: { width: lensWidth, height: 900 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Lens",
        acceptsFamilies: [],
      },
    ],
    activePaneId: "p1",
    imposition: { kind: "two-up", lens: "right" },
    hasFocus: true,
  };
}

const wait = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

/** Seed the user's preferred Lens width, the number the flex range centres on. */
async function seedPreferredWidth(app: App, widthPx: number): Promise<void> {
  await app.evalJS<null>(
    `(window.__tug.setTugbankValue("dev.tugtool.lens", "widthPx", { kind: "i64", value: ${widthPx} }), null)`,
  );
}

/** The width of the canvas the chain is imposed across. */
async function canvasWidth(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector(".tug-pane").parentElement.clientWidth`,
  );
}

async function frameWidth(app: App, paneId: string): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector('.tug-pane[data-pane-id="${paneId}"]').getBoundingClientRect().width`,
  );
}

/** The seam between each pair of adjacent chain panes, left to right. */
async function seams(app: App): Promise<number[]> {
  return app.evalJS<number[]>(
    `(function () {
      var rects = ${JSON.stringify(CHAIN)}.map(function (id) {
        return document.querySelector('.tug-pane[data-pane-id="' + id + '"]').getBoundingClientRect();
      });
      var out = [];
      for (var i = 0; i < rects.length - 1; i += 1) {
        out.push(rects[i + 1].left - rects[i].right);
      }
      return out;
    })()`,
  );
}

/**
 * The pane width whose exact solve puts the Lens `offset` px off the preferred
 * width. Three cards and two gaps fill the band, and the band is the canvas
 * less the Lens and three gaps — so `lens = canvas - 5·gap - 3·width`.
 */
function paneWidthFor(canvas: number, offset: number): number {
  return Math.floor((canvas - GAP * 5 - (PREFERRED + offset)) / 3);
}

/** What the allocator must answer for that fixture — the same arithmetic back. */
function predictedLensWidth(canvas: number, paneWidth: number): number {
  return canvas - GAP * 5 - paneWidth * 3;
}

async function seedFixture(
  app: App,
  paneWidth: number,
  lensWidth: number,
): Promise<void> {
  await app.seedDeckState({
    state: deckShape(paneWidth, lensWidth),
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `document.querySelectorAll(${JSON.stringify(KIND_TILES)}).length > 0`,
    { timeoutMs: 8_000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0303 — the space allocator flexes the Lens to tile the chain",
  () => {
    test(
      "an in-range solve lands exact seams, settles by FLIP, and leaves the preference alone",
      async () => {
        const app = await launchTugApp({
          testName: "at0303-imposer-space-allocator",
        });
        try {
          await seedPreferredWidth(app, PREFERRED);
          await seedFixture(app, 400, PREFERRED);

          // The fixture is sized against the canvas the app actually launched
          // at, so the exact solve lands 30px above the preferred width —
          // inside the flex range whatever the window size.
          const canvas = await canvasWidth(app);
          const paneWidth = paneWidthFor(canvas, 30);
          expect(paneWidth).toBeGreaterThan(200);
          await seedFixture(app, paneWidth, PREFERRED);
          await wait(AFTER_LAND_MS);

          // At rest the Lens shows the preferred width: seeding a deck is not
          // one of the moments that re-tunes.
          expect(await frameWidth(app, "pLens")).toBeCloseTo(PREFERRED, 0);

          // ── The moment: choose Five Up. ──────────────────────────────────
          await app.nativeClickAtElement(FIVE_UP_TILE);

          // The Lens's new width crosses by the settle FLIP rather than
          // cutting — the width is part of the arrangement signature.
          await app.waitForCondition<boolean>(
            `document.querySelector("[data-imposer-settling]") !== null`,
            { timeoutMs: 2_000 },
          );
          await wait(AFTER_LAND_MS);
          expect(
            await app.evalJS<boolean>(
              `document.querySelector("[data-imposer-settling]") !== null`,
            ),
          ).toBe(false);

          expect(await frameWidth(app, "pLens")).toBeCloseTo(
            predictedLensWidth(canvas, paneWidth),
            0,
          );
          for (const seam of await seams(app)) {
            expect(Math.abs(seam - GAP)).toBeLessThanOrEqual(TOL);
          }

          // ── The preference is untouched. Read through the path that owns
          // it: the Lens reopens at the width the user chose, never at the
          // width the allocator handed it. ─────────────────────────────────
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("toggle-lens"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(LENS_FRAME)}) === null`,
            { timeoutMs: 5_000 },
          );
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("toggle-lens"), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('.tug-pane[data-lens-pane]') !== null`,
            { timeoutMs: 5_000 },
          );
          await wait(AFTER_LAND_MS);
          expect(
            await app.evalJS<number>(
              `document.querySelector('.tug-pane[data-lens-pane]').getBoundingClientRect().width`,
            ),
          ).toBeCloseTo(PREFERRED, 0);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "a solve it cannot make good leaves the Lens exactly where it stood",
      async () => {
        const app = await launchTugApp({
          testName: "at0303-imposer-allocator-revert",
        });
        try {
          await seedPreferredWidth(app, PREFERRED);
          await seedFixture(app, 400, PREFERRED);

          // 260px above preferred is far outside the flex range, so the
          // allocator wants a width it may not have — and the widest it MAY
          // have still leaves the chain ragged.
          const canvas = await canvasWidth(app);
          const paneWidth = paneWidthFor(canvas, 260);
          expect(paneWidth).toBeGreaterThan(200);

          // The Lens stands somewhere the user put it, NOT at the remembered
          // preference — which is the whole point of the assertion below. A
          // fixture resting at the preferred width could not tell "left alone"
          // apart from "reset to the preference".
          const standing = PREFERRED - 60;
          await seedFixture(app, paneWidth, standing);
          await wait(AFTER_LAND_MS);
          expect(await frameWidth(app, "pLens")).toBeCloseTo(standing, 0);

          await app.nativeClickAtElement(FIVE_UP_TILE);
          await wait(AFTER_LAND_MS);

          // Not the solve, not a step toward it, and not the preference
          // either: the Lens's width is the user's, and choosing a layout is
          // not a licence to take it back for nothing.
          expect(await frameWidth(app, "pLens")).toBeCloseTo(standing, 0);
          // The seams are what the classic rule produces: the cards stand
          // apart, because the deck really is wider than the chain wants.
          for (const seam of await seams(app)) {
            expect(seam).toBeGreaterThan(GAP + 10);
          }
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "re-clicking the active layout re-tunes, and nothing else does",
      async () => {
        const app = await launchTugApp({
          testName: "at0303-imposer-allocator-reassert",
        });
        try {
          await seedPreferredWidth(app, PREFERRED);
          await seedFixture(app, 400, PREFERRED);

          const canvas = await canvasWidth(app);
          const first = paneWidthFor(canvas, 30);
          await seedFixture(app, first, PREFERRED);
          await wait(AFTER_LAND_MS);
          await app.nativeClickAtElement(FIVE_UP_TILE);
          await wait(AFTER_LAND_MS);
          expect(await frameWidth(app, "pLens")).toBeCloseTo(
            predictedLensWidth(canvas, first),
            0,
          );

          // Now change what the chain wants, WITHOUT going through a moment:
          // the arrangement is already Five Up, so this is the state a card
          // resize leaves behind — seams gone ragged, and nothing has asked
          // for them back.
          const second = paneWidthFor(canvas, -30);
          await app.seedDeckState({
            state: {
              ...deckShape(second, predictedLensWidth(canvas, first)),
              imposition: { kind: "five-up", lens: "right" },
            },
            focusCardId: "A",
          });
          await wait(AFTER_LAND_MS);
          expect(await frameWidth(app, "pLens")).toBeCloseTo(
            predictedLensWidth(canvas, first),
            0,
          );
          expect(
            Math.abs((await seams(app))[0] - GAP),
          ).toBeGreaterThan(TOL);

          // Re-click the layout that is ALREADY active. This used to be a
          // total no-op; it now runs the same re-tune the settled-resize
          // observer asks for.
          await app.nativeClickAtElement(FIVE_UP_TILE);
          await wait(AFTER_LAND_MS);

          expect(await frameWidth(app, "pLens")).toBeCloseTo(
            predictedLensWidth(canvas, second),
            0,
          );
          for (const seam of await seams(app)) {
            expect(Math.abs(seam - GAP)).toBeLessThanOrEqual(TOL);
          }
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "a card joining the chain does not move the Lens",
      async () => {
        const app = await launchTugApp({
          testName: "at0303-imposer-allocator-assign",
        });
        try {
          await seedPreferredWidth(app, PREFERRED);
          await seedFixture(app, 400, PREFERRED);

          // Sized so the THREE-card chain's exact solve sits 30px above the
          // preferred width — in range. The two-card chain it starts as wants
          // a band a whole card wider, which is far out of range, so the Lens
          // rests at the preferred width until the third card lands.
          const canvas = await canvasWidth(app);
          const paneWidth = paneWidthFor(canvas, 30);
          expect(paneWidth).toBeGreaterThan(200);

          const shape = deckShape(paneWidth, PREFERRED);
          const middle = shape.panes.find((p) => p.id === "p2");
          if (middle === undefined) throw new Error("fixture lost p2");
          delete (middle as { slot?: number }).slot;
          await app.seedDeckState({
            state: {
              ...shape,
              panes: [...shape.panes],
              imposition: { kind: "five-up", lens: "right" },
            },
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(KIND_TILES)}).length > 0`,
            { timeoutMs: 8_000 },
          );
          await wait(AFTER_LAND_MS);
          expect(await frameWidth(app, "pLens")).toBeCloseTo(PREFERRED, 0);

          // ── Put the loose card in slot 3 — the assign the Lens row's slot
          // picker dispatches. This completes a chain the allocator COULD
          // tile, which is what makes the assertion mean something. ────────
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("assign-slot", { cardId: "B", slot: 2 }), null)`,
          );
          await wait(AFTER_LAND_MS);

          // The Lens has not moved. Slotting a card is the user moving a card.
          expect(await frameWidth(app, "pLens")).toBeCloseTo(PREFERRED, 0);

          // ── And now ask for the seams, the only way there is to ask: click
          // the layout. The chain the assign completed tiles, so this lands
          // it. ─────────────────────────────────────────────────────────────
          await app.nativeClickAtElement(FIVE_UP_TILE);
          await wait(AFTER_LAND_MS);

          expect(await frameWidth(app, "pLens")).toBeCloseTo(
            predictedLensWidth(canvas, paneWidth),
            0,
          );
          for (const seam of await seams(app)) {
            expect(Math.abs(seam - GAP)).toBeLessThanOrEqual(TOL);
          }
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
