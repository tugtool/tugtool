/**
 * at0302-imposed-resize-click.test.ts — a click on a resize handle keeps the
 * slot; a drag still gives it up.
 *
 * An imposed pane's geometry is derived: CSS pins it to its place in the
 * imposition chain, so it re-imposes on every canvas or Lens change with no
 * JavaScript at all. Leaving the chain is a commit — the pane converts to free
 * pixel geometry and the store drops its slot — and the only gestures that may
 * make that commit are a real drag and a real resize.
 *
 * The distinction has teeth on the resize handles specifically, because they
 * overhang the frame by 4px (`chrome.css`) and the imposition gap between two
 * adjacent imposed cards is 5px: the seam a user aims at to grab nothing at all
 * is nearly wall-to-wall resize handle. A zero-travel click there used to
 * release the pane at pointer-down and commit its measured rect at pointer-up,
 * both of which are pixel-identical to what was already on screen — so nothing
 * looked wrong until the NEXT canvas change, when every still-imposed pane
 * re-imposed and the evicted one stayed frozen where it was. That is the
 * "imposed cards drift into slightly different sizes and positions" report, and
 * why the assertion below is not "the rect did not change" but "the pane still
 * TRACKS the arrangement": the rect is unchanged either way.
 *
 * Scenario:
 *   1. Seed a two-up deck with a pinned right Lens and a pane in each slot.
 *   2. Click the east handle of the slot-0 pane — down and up, no travel.
 *   3. It still carries `data-imposed`; flip the Lens to the left and its new
 *      rect is the one `imposeRect` predicts, so it is still in the chain.
 *   4. Drag the same handle well past the threshold: `data-imposed` is gone and
 *      the pane no longer tracks a second arrangement change.
 *
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/lib/layout-imposer.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** The imposition gap (`lib/layout-imposer.ts`). */
const GAP = 5;
const LENS_WIDTH = 320;
const PANE_WIDTH = 420;
/** The settle window (`IMPOSITION_SETTLE_MS`), with room for the tween to land. */
const AFTER_LAND_MS = 900;
/** Well past `DRAG_MOVE_THRESHOLD_PX`, so the gesture is unambiguously a resize. */
const RESIZE_DRAG_PX = 80;

const FRAMES = ".tug-pane[data-pane-id]";
const SLOT_ZERO = `.tug-pane[data-pane-id="p1"]`;
const SLOT_ZERO_EAST_HANDLE = `${SLOT_ZERO} .tug-pane-resize-e`;

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
      pane("p2", 1, "B"),
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
    imposition: { kind: "two-up", lens: "right" },
    hasFocus: true,
  };
}

const wait = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

async function setLensSide(app: App, side: "left" | "right"): Promise<void> {
  await app.evalJS<null>(
    `(window.__tug.dispatchControlAction("set-imposition-lens", { side: ${JSON.stringify(
      side,
    )} }), null)`,
  );
}

/** The `data-imposed` attribute — the slot the pane holds, or null once free. */
async function imposedSlot(app: App, paneId: string): Promise<string | null> {
  return app.evalJS<string | null>(
    `document.querySelector('.tug-pane[data-pane-id="${paneId}"]').getAttribute("data-imposed")`,
  );
}

async function frameLeft(app: App, paneId: string): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector('.tug-pane[data-pane-id="${paneId}"]').getBoundingClientRect().left`,
  );
}

async function frameWidth(app: App, paneId: string): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector('.tug-pane[data-pane-id="${paneId}"]').getBoundingClientRect().width`,
  );
}

async function lensWidth(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector('.tug-pane[data-pane-id="pLens"]').getBoundingClientRect().width`,
  );
}

/**
 * Where `imposeRect` puts a slot's left edge: the span is the canvas minus the
 * Lens's side, the band is the span inset by a gap at each end, and the slot
 * rides `slot / (count - 1)` of whatever travel the band has after the pane's
 * own width. The Lens width is measured at the assertion rather than seeded or
 * captured at rest — a pane renders at its stored width raised to its stack's
 * size floor, and an arrangement change re-runs the space allocator, which may
 * hand the Lens a different width (`at0303`).
 */
function expectedLeft(
  slot: number,
  count: number,
  viewport: number,
  lensSide: "left" | "right",
  lens: number,
  paneWidth: number,
): number {
  const inset = lens + GAP;
  const spanX = lensSide === "left" ? inset : 0;
  const band = viewport - inset - GAP * 2;
  const travel = Math.max(0, band - paneWidth);
  const fraction = count < 2 ? 0.5 : slot / (count - 1);
  return spanX + GAP + fraction * travel;
}

describe.skipIf(!SHOULD_RUN)(
  "at0302 — a resize handle click keeps the slot, a resize drag gives it up",
  () => {
    test(
      "a zero-travel click on a handle leaves the pane in the chain; a drag evicts it",
      async () => {
        const app = await launchTugApp({
          testName: "at0302-imposed-resize-click",
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(FRAMES)}).length === 3`,
            { timeoutMs: 5_000 },
          );
          await wait(AFTER_LAND_MS);

          const vp = await app.evalJS<number>(`window.innerWidth`);
          const restWidth = await frameWidth(app, "p1");
          expect(await imposedSlot(app, "p1")).toBe("0");

          // ── The click. The handle straddles the frame's east edge, which is
          // where the seam between two imposed cards is. ────────────────────
          const handle = await app.getElementBounds(SLOT_ZERO_EAST_HANDLE);
          await app.nativeClick({
            x: handle.x + handle.width / 2,
            y: handle.y + handle.height / 2,
          });
          await wait(200);

          // The rect is unchanged whether or not the pane was evicted — the
          // eviction commits the rect it measured — so the attribute is what
          // says which happened.
          expect(await imposedSlot(app, "p1")).toBe("0");
          expect(await frameWidth(app, "p1")).toBeCloseTo(restWidth, 0);

          // And the consequence the attribute stands for: the pane still moves
          // with the arrangement.
          await setLensSide(app, "left");
          await wait(AFTER_LAND_MS);
          expect(await frameLeft(app, "p1")).toBeCloseTo(
            expectedLeft(0, 2, vp, "left", await lensWidth(app), restWidth),
            0,
          );

          // ── The drag. Same handle, past the threshold: this one is a real
          // resize, and a resized pane leaves the chain. ────────────────────
          const handle2 = await app.getElementBounds(SLOT_ZERO_EAST_HANDLE);
          const grabX = handle2.x + handle2.width / 2;
          const grabY = handle2.y + handle2.height / 2;
          await app.nativeDrag(
            { x: grabX, y: grabY },
            { x: grabX + RESIZE_DRAG_PX, y: grabY },
          );
          await wait(AFTER_LAND_MS);

          expect(await imposedSlot(app, "p1")).toBe(null);
          expect(await frameWidth(app, "p1")).toBeGreaterThan(
            restWidth + RESIZE_DRAG_PX - 10,
          );

          // A free pane ignores the arrangement: the second flip moves the
          // still-imposed pane and leaves this one where the drag left it.
          const freeLeft = await frameLeft(app, "p1");
          await setLensSide(app, "right");
          await wait(AFTER_LAND_MS);
          expect(await frameLeft(app, "p1")).toBeCloseTo(freeLeft, 0);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
