/**
 * at0338-slot-chords.test.ts — ⌘1..⌘N moves the selected card to slot N, and
 * the arrangement decides what N means.
 *
 * The Lens's Layouts section is the only place the numbers come from. Choosing
 * three-up does not just draw three columns; it declares that ⌘1, ⌘2 and ⌘3
 * are live and that everything else on the digit row is not. There is no
 * second list of shortcuts to keep in step with the arrangement, so the thing
 * worth proving is that the chords read `slotCount(kind)` at the moment they
 * fire rather than a range fixed at build time.
 *
 * The no-op half carries the weight. Every digit is bound — all nine, though
 * six-up is the largest arrangement — precisely so an out-of-range number is
 * inert rather than falling through to a macOS beep, which means the handler
 * is the only thing standing between ⌘5-in-a-three-up and a clamped slot
 * assignment. `clampSlot` would happily turn 4 into 2; the range gate has to
 * run first. A no-op is asserted the only way a no-op can be: the frame that
 * would have moved is measured before and after and has to be in the same
 * place, to the pixel.
 *
 * The Lens is excluded by selection, not by geometry. `assignCardToSlot`
 * already refuses a Lens-hosted card, but it refuses it with a `console.warn`,
 * and a chord the user has not configured should be silent. So the canvas
 * checks the selection itself and returns before dispatching.
 *
 * Geometry is the assertion because the store is not reachable from a test:
 * a slot's left edge is hand-computable from `imposeRect` (the band is the
 * span inset by a gap at each end; a slot rides `slot / (count - 1)` of
 * whatever travel the pane's own width leaves over), and the Lens width is
 * MEASURED at each assertion rather than taken from the seed, since the space
 * allocator may hand the Lens a width the seed did not ask for.
 *
 * Scenario:
 *   1. Seed a three-up deck, Lens right, card A in slot 0 with focus.
 *   2. ⌘3 — A crosses to the last slot. ⌘1 — A comes back.
 *   3. ⌘5 — out of range for three-up. A does not move.
 *   4. Select the Lens, then ⌘2. Nothing moves: not the Lens, not A.
 *   5. Switch to one-up. ⌘2 was live a moment ago and is now out of range,
 *      so it does nothing — the range followed the arrangement.
 *
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 * @covers tugdeck/src/components/tugways/keybinding-map.ts
 * @covers tugdeck/src/components/tugways/action-vocabulary.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** The imposition gap (`lib/layout-imposer.ts`). */
const GAP = 5;
const LENS_WIDTH = 300;
const PANE_WIDTH = 420;
/** The settle window (`IMPOSITION_SETTLE_MS`), with room for the tween to land. */
const AFTER_LAND_MS = 900;

const FRAMES = ".tug-pane[data-pane-id]";

function deckShape() {
  const card = (id: string, componentId: string, title: string) => ({
    id,
    componentId,
    title,
    closable: true,
  });
  const pane = (id: string, slot: number, cardId: string) => ({
    id,
    position: { x: 40, y: 40 },
    size: { width: PANE_WIDTH, height: 400 },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["maker"],
    slot,
  });
  return {
    cards: [
      card("A", "gallery-accordion", "Card A"),
      card("B", "gallery-accordion", "Card B"),
      card("L", "lens", "Lens"),
    ],
    panes: [
      pane("p1", 0, "A"),
      pane("p2", 2, "B"),
      {
        id: "pLens",
        position: { x: 0, y: 0 },
        size: { width: LENS_WIDTH, height: 900 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Lens",
        acceptsFamilies: [],
      },
    ],
    activePaneId: "p1",
    imposition: { kind: "three-up", lens: "right" },
    hasFocus: true,
  };
}

const wait = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

async function frameLeft(app: App, paneId: string): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector('.tug-pane[data-pane-id="${paneId}"]').getBoundingClientRect().left`,
  );
}

async function lensWidth(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector('.tug-pane[data-pane-id="pLens"]').getBoundingClientRect().width`,
  );
}

async function viewportWidth(app: App): Promise<number> {
  return app.evalJS<number>(`window.innerWidth`);
}

/** Where `imposeRect` puts a slot's left edge, with the Lens on the right. */
function expectedLeft(
  slot: number,
  count: number,
  viewport: number,
  lens: number,
): number {
  const spanWidth = viewport - (lens + GAP);
  const band = spanWidth - GAP * 2;
  const travel = Math.max(0, band - PANE_WIDTH);
  const fraction = count < 2 ? 0.5 : slot / (count - 1);
  return GAP + fraction * travel;
}

/** Press ⌘<digit> and give the settle time to land. */
async function slotChord(app: App, digit: number): Promise<void> {
  await app.nativeKey(String(digit), ["cmd"]);
  await wait(AFTER_LAND_MS);
}

async function expectFrameAt(
  app: App,
  paneId: string,
  slot: number,
  count: number,
): Promise<void> {
  const [vp, lens] = [await viewportWidth(app), await lensWidth(app)];
  expect(await frameLeft(app, paneId)).toBeCloseTo(
    expectedLeft(slot, count, vp, lens),
    0,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0338 — ⌘1..⌘N assigns a slot, and out-of-range digits do nothing",
  () => {
    test(
      "the live range follows the Layouts arrangement, and every other digit is inert",
      async () => {
        const app = await launchTugApp({ testName: "at0338-slot-chords" });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(FRAMES)}).length === 3`,
            { timeoutMs: 5_000 },
          );
          await wait(AFTER_LAND_MS);

          // --- The seeded arrangement. -------------------------------------
          await expectFrameAt(app, "p1", 0, 3);

          // --- ⌘3: A crosses to the last slot of a three-up. ----------------
          await slotChord(app, 3);
          await expectFrameAt(app, "p1", 2, 3);

          // --- ⌘1: and back to the first. ----------------------------------
          await slotChord(app, 1);
          await expectFrameAt(app, "p1", 0, 3);

          // --- ⌘5: out of range for three-up. ------------------------------
          // The failure this catches is a clamp instead of a gate — `clampSlot`
          // would fold 4 down to 2 and slide the frame to the far end.
          {
            const before = await frameLeft(app, "p1");
            await slotChord(app, 5);
            expect(await frameLeft(app, "p1")).toBeCloseTo(before, 0);
          }

          // --- The Lens is selected: every digit is inert. ------------------
          // Not because the Lens pane refuses a slot (it does), but because
          // the canvas never dispatches. Both frames have to hold still.
          {
            await app.evalJS<null>(
              `(window.__tug.dispatchControlAction("focus-session-card", { cardId: "L" }), null)`,
            );
            await wait(AFTER_LAND_MS);
            const lensBefore = await frameLeft(app, "pLens");
            const aBefore = await frameLeft(app, "p1");
            await slotChord(app, 2);
            expect(await frameLeft(app, "pLens")).toBeCloseTo(lensBefore, 0);
            expect(await frameLeft(app, "p1")).toBeCloseTo(aBefore, 0);
          }

          // --- One-up: ⌘2 was live a moment ago, and is not any more. -------
          {
            await app.evalJS<null>(
              `(window.__tug.dispatchControlAction("focus-session-card", { cardId: "A" }), null)`,
            );
            await app.evalJS<null>(
              `(window.__tug.dispatchControlAction("set-imposition", { kind: "one-up" }), null)`,
            );
            await wait(AFTER_LAND_MS);
            const before = await frameLeft(app, "p1");
            await slotChord(app, 2);
            expect(await frameLeft(app, "p1")).toBeCloseTo(before, 0);

            // ⌘1 is the whole live range of a one-up, and it still works.
            await slotChord(app, 1);
            await expectFrameAt(app, "p1", 0, 1);
          }
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
