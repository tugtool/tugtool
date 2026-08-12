/**
 * at0303-imposer-space-allocator.test.ts — the imposer flexes the Lens so the
 * cards tile evenly, and knows when not to.
 *
 * A slot is an anchor at a fixed fraction of the band and a card's width is its
 * own, so whatever the band leaves over shows up as slack between the cards:
 * choose Five Up on a roomy deck and the cards stand apart, narrow the window
 * slightly and the same arrangement overlaps. The **space allocator** treats the
 * pinned Lens's width as the one flexible quantity — it is the band's other end
 * — and picks the width that puts every seam on one imposition gap. The
 * licence is graded: a rail may grow to the slim content width (675) —
 * whatever Card Width the deck is set to, a rail is a reading surface and
 * never sprawls — and shrink a fifth under the width the user chose; crowding
 * the soft allowance cannot absorb deepens the shrink to the rail's hard
 * floor; and a solve that cannot tile at all still moves the rails as far as
 * visibly helps, never into new overlap and never past the chosen width.
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
 *  3. An untileable solve gives back, and gives back no further than the
 *     chosen width. A Lens standing under its preference (only past
 *     allocations put it there) returns to the width the user chose when the
 *     deck has slack no width can tile — and not one pixel past it toward the
 *     untileable fit. The chosen width is the cap on what slack may buy.
 *  4. Re-asserting the layout re-tunes. Re-clicking the already-active Cards
 *     option used to be a total no-op; it now drives the same entry the
 *     settled-resize observer calls. The harness cannot resize the app's
 *     window, so this gesture is what covers that entry end to end.
 *  5. Joining the chain RE-TUNES. Assigning a card to a slot is the imposer's
 *     own verb — the user asked the deck to arrange itself, whichever door
 *     dispatched it — so the assign itself re-solves the rails for the chain
 *     it just completed, with no separate Layouts click needed.
 *  6. Two rails take ONE width. With sidebars on both edges, the allocator's
 *     answer is a single width every standing rail lands on — whatever each
 *     card's chosen width was. Sidebars are a uniform class; the deck never
 *     answers with two rails at two widths.
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

const FIVE_UP_TILE = '[data-testid="lens-layouts-kind"] [data-choice-value="five-up"]';
const KIND_TILES = '[data-testid="lens-layouts-kind"] [data-choice-value]';
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
      "an untileable solve gives back to the chosen width, and never past it",
      async () => {
        const app = await launchTugApp({
          testName: "at0303-imposer-allocator-giveback",
        });
        try {
          await seedPreferredWidth(app, PREFERRED);
          await seedFixture(app, 400, PREFERRED);

          // A rail may grow to the slim width (675), so the untileable
          // fixture has to want MORE than that ceiling. The exact solve sits
          // 320px above the preferred 420 — 65 past the ceiling, where the
          // widest width the allocator may have still leaves the chain
          // visibly ragged: no width tiles this deck.
          const canvas = await canvasWidth(app);
          const paneWidth = paneWidthFor(canvas, 320);
          expect(paneWidth).toBeGreaterThan(200);

          // The Lens stands UNDER its preference — the state only a past
          // allocation leaves behind, since a hand-drag writes the durable
          // preference as it goes. The give-back rule owes the user this
          // width back the moment holding it buys nothing.
          const standing = PREFERRED - 60;
          await seedFixture(app, paneWidth, standing);
          await wait(AFTER_LAND_MS);
          expect(await frameWidth(app, "pLens")).toBeCloseTo(standing, 0);

          await app.nativeClickAtElement(FIVE_UP_TILE);
          await wait(AFTER_LAND_MS);

          // The Lens returns to the CHOSEN width — closer to the fit than
          // where it stood — and not one pixel past it: an untileable
          // arrangement never conscripts width beyond the preference.
          expect(await frameWidth(app, "pLens")).toBeCloseTo(PREFERRED, 0);
          // The seams are still what the classic rule produces: the cards
          // stand apart, because the deck really is wider than any width
          // the rails may stand at can absorb.
          for (const seam of await seams(app)) {
            expect(seam).toBeGreaterThan(GAP + 10);
          }

          // Re-clicking is now a no-op: the Lens already stands at the cap,
          // so the same unusable solve has nothing left to give back.
          await app.nativeClickAtElement(FIVE_UP_TILE);
          await wait(AFTER_LAND_MS);
          expect(await frameWidth(app, "pLens")).toBeCloseTo(PREFERRED, 0);
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
      "a card joining the chain re-tunes the rails in the same gesture",
      async () => {
        const app = await launchTugApp({
          testName: "at0303-imposer-allocator-assign",
        });
        try {
          await seedPreferredWidth(app, PREFERRED);
          await seedFixture(app, 400, PREFERRED);

          // Sized so the THREE-card chain's exact solve sits 30px above the
          // preferred width — in range. The two-card chain it starts as is
          // never solved at all: seeding a deck is not one of the moments,
          // so the Lens rests at the preferred width until a gesture asks.
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
          // picker dispatches (a ⌘N chord lands on the same verb). The assign
          // completes a chain the allocator can tile, and the assign ITSELF
          // is the moment: the user just asked the deck to arrange itself,
          // and the deck makes room for what it was asked to arrange. ──────
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("assign-slot", { cardId: "B", slot: 2 }), null)`,
          );
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

    test(
      "two rails, one width: opposite-side sidebars land equal, whatever they preferred",
      async () => {
        const app = await launchTugApp({
          testName: "at0303-imposer-allocator-shared-width",
        });
        try {
          // The two cards CHOSE different widths — 420 and 560 — which is
          // exactly the state the shared-width rule has to erase when it
          // moves: the answer is one number, not one delta.
          await seedPreferredWidth(app, PREFERRED);
          await app.evalJS<null>(
            `(window.__tug.setTugbankValue("dev.tugtool.jots", "widthPx", { kind: "i64", value: 560 }), null)`,
          );
          await seedFixture(app, 400, PREFERRED);

          // Two rails and three cards: canvas = T + 6·gap + 3·pane, with T the
          // rails' total. Size the chain so each rail's share sits near 500 —
          // above both shrink floors (0.8·420 = 336, 0.8·560 = 448), under the
          // slim ceiling — so the solve is taken, not clamped.
          const canvas = await canvasWidth(app);
          const paneWidth = Math.floor((canvas - GAP * 6 - 2 * 500) / 3);
          expect(paneWidth).toBeGreaterThan(200);

          const shape = deckShape(paneWidth, PREFERRED);
          shape.cards.push({
            id: "J",
            componentId: "jots",
            title: "Jots",
            closable: true,
          });
          shape.panes.push({
            id: "pJots",
            position: { x: 0, y: 0 },
            size: { width: 560, height: 900 },
            cardIds: ["J"],
            activeCardId: "J",
            title: "Jots",
            acceptsFamilies: [],
          });
          await app.seedDeckState({
            state: {
              ...shape,
              imposition: {
                kind: "two-up",
                sidebars: {
                  lens: { side: "right" },
                  jots: { side: "left" },
                },
              },
            },
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(KIND_TILES)}).length > 0`,
            { timeoutMs: 8_000 },
          );
          await wait(AFTER_LAND_MS);

          await app.nativeClickAtElement(FIVE_UP_TILE);
          await wait(AFTER_LAND_MS);

          // ONE width. Not "each moved the same amount" — the SAME number.
          const lensWidth = await frameWidth(app, "pLens");
          const jotsWidth = await frameWidth(app, "pJots");
          expect(Math.round(lensWidth)).toBe(Math.round(jotsWidth));

          // And it is the solve: each rail's equal share of the total the
          // seams want, which tiles the chain.
          const share = (canvas - GAP * 6 - paneWidth * 3) / 2;
          expect(lensWidth).toBeCloseTo(Math.round(share), 0);
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
