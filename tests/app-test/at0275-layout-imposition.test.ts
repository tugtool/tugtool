/**
 * at0275-layout-imposition.test.ts — the layout imposer places panes and never
 * sizes them.
 *
 * ## What this gates (a failure mode, not busywork)
 *
 * An imposed pane's rect exists nowhere in React state. Its horizontal pin and
 * its vertical run are `calc()` expressions over the rail inset custom
 * properties and a chain offset in pixels, resolved by the browser — which is
 * the whole point of the design (no resize observation anywhere on the deck)
 * and also the reason no unit test can see it. The only honest reading is
 * `getBoundingClientRect()` on real frames in the real app, against a real Lens
 * rail whose live width the arrangement has to answer to.
 *
 * Six claims, all measured:
 *   - **the chain packs** — the cards start a gap in from the edge away from
 *     the Lens and stand exactly one gap apart, running the canvas's height a
 *     gap down from the top and the deeper bottom gap up from the bottom.
 *   - **the slack pools** — every leftover pixel is in one margin, between the
 *     last card and the Lens, rather than split between the cards.
 *   - **width is untouched** — the pane's width across an assignment is
 *     identical to the pixel. A slot is a position anchor, not a rect; if this
 *     ever drifts, the imposer has started fighting the user for horizontal
 *     space, which is the tab strip's failure being reinvented.
 *   - **slots order, they do not reserve** — an empty slot occupies nothing, so
 *     moving a card between two empty positions does not move it.
 *   - **slots are stacks** — two panes assigned to one slot land on the same
 *     rect, with the later assignment on top. That is the tab replacement: many
 *     cards at one position, switched from the Lens list.
 *   - **a span change moves nothing** — closing the Lens hands the rail's whole
 *     width to the pooled slack and leaves the cards exactly where they were.
 *     This is the same reflow a window or display resize triggers, driven by
 *     the one span change a headless test can actually make.
 *   - **a drag evicts** — dragging an imposed pane's title bar releases it to
 *     free geometry (`data-imposed` gone) while the pane beneath keeps its
 *     slot. Any manual geometry gesture does this; the explicit gesture wins.
 *
 * Driven through the real surfaces: a real click on the Layouts section's
 * "Three Up" segment, real clicks on the numbered slots of real Text Files
 * rows, and a real native drag.
 *
 * @covers tugdeck/src/lib/layout-imposer.ts
 * @covers tugdeck/src/deck-manager.ts
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 * @covers tugdeck/src/components/lens/sections/layouts-section.tsx
 * @covers tugdeck/src/components/lens/slot-picker.tsx
 * @covers tugdeck/src/components/lens/sections/sessions-section.tsx
 * @covers tugdeck/src/components/tugways/tug-slot.tsx
 * @covers tugdeck/src/components/tugways/tug-slot-layout.tsx
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

/** Both panes start the same size, so a shared slot is a shared rect. */
const PANE_WIDTH = 460;
const PANE_HEIGHT = 380;

const LIST = ".lens-text-files-list";
const SECTION = '[data-testid="lens-layouts-section"]';
const THREE_UP = `${SECTION} [data-radio-value="three-up"]`;
/** The Lens-side segments of the two-axis picker. */
const sideSegment = (side: "left" | "right"): string =>
  `${SECTION} [data-testid="lens-layouts-side"] [data-choice-value="${side}"]`;

/** `IMPOSITION_GAP_PX` — the standoff an imposed left, right, or top edge keeps. */
const GAP = 5;
/** `IMPOSITION_GAP_BOTTOM_PX` — deeper, to clear the host's dev-info strip. */
const GAP_BOTTOM = 32;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Frame extends Rect {
  imposed: string | null;
  z: number;
}

interface Scene {
  canvas: Rect;
  lens: Rect | null;
  a: Frame | null;
  b: Frame | null;
}

/** Which side the Lens is holding, from its measured box. */
function lensOnLeft(scene: Scene): boolean {
  if (scene.lens === null) return false;
  return scene.lens.x - scene.canvas.x < scene.canvas.width / 2;
}

/**
 * The band the chain is laid across, in viewport coordinates.
 *
 * The Lens is itself imposed a gap off the canvas edge, so the band ends at
 * the Lens's near edge — the extra gap between the chain's far card and the
 * Lens comes from the chain's own gap, not from this span. A closed Lens
 * leaves the whole canvas.
 */
function spanFor(scene: Scene): { left: number; right: number } {
  const canvasRight = scene.canvas.x + scene.canvas.width;
  if (scene.lens === null) return { left: scene.canvas.x, right: canvasRight };
  return lensOnLeft(scene)
    ? { left: scene.lens.x + scene.lens.width, right: canvasRight }
    : { left: scene.canvas.x, right: scene.lens.x };
}

/**
 * Read the live geometry of both cards' pane frames, the canvas they sit in,
 * and the Lens — all from the DOM, since an imposed frame's real rect is the
 * browser's answer, not the store's.
 */
const READ_SCENE = `(function(){
  function frameFor(cardId) {
    var host = document.querySelector('[data-card-id="' + cardId + '"]');
    if (host === null) return null;
    var frame = host.closest(".tug-pane");
    if (frame === null) return null;
    var r = frame.getBoundingClientRect();
    return {
      x: r.left, y: r.top, width: r.width, height: r.height,
      imposed: frame.getAttribute("data-imposed"),
      z: parseInt(getComputedStyle(frame).zIndex || "0", 10),
    };
  }
  function box(el) {
    if (el === null) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  var anyPane = document.querySelector(".tug-pane");
  var canvasEl = anyPane === null ? null : anyPane.parentElement;
  return {
    canvas: box(canvasEl),
    lens: box(document.querySelector(".tug-pane[data-lens]")),
    a: frameFor("A"),
    b: frameFor("B"),
  };
})()`;

function deckShape() {
  const pane = (id: string, cardId: string, x: number) => ({
    id,
    position: { x, y: 60 },
    size: { width: PANE_WIDTH, height: PANE_HEIGHT },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["standard"],
  });
  return {
    cards: [
      { id: "A", componentId: "text", title: "Alpha", closable: true },
      { id: "B", componentId: "text", title: "Bravo", closable: true },
    ],
    panes: [pane("p1", "A", 40), pane("p2", "B", 560)],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** The `[data-tug-list-cell-index]` of the Text Files row for `filename`. */
async function rowIndexFor(app: App, filename: string): Promise<number> {
  const index = await app.evalJS<number>(
    `(function(){
      var cells = document.querySelectorAll('${LIST} [data-tug-list-cell-index]');
      for (var i = 0; i < cells.length; i += 1) {
        var title = cells[i].querySelector(".tug-list-row-title");
        if (title !== null && title.innerText.indexOf(${JSON.stringify(filename)}) !== -1) {
          return parseInt(cells[i].getAttribute("data-tug-list-cell-index"), 10);
        }
      }
      return -1;
    })()`,
  );
  if (index < 0) throw new Error(`[at0275] no Text Files row for ${filename}`);
  return index;
}

/** Selector for the 1-based numbered button on the row at `cellIndex`. */
function slotButton(cellIndex: number, position: number): string {
  return `${LIST} [data-tug-list-cell-index="${cellIndex}"] [aria-label="Put at position ${position}"]`;
}

const settle = (ms = 350): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(!SHOULD_RUN)("at0275 — the layout imposer", () => {
  test(
    "imposed panes anchor to their slots a gap in, keep their width, re-impose live, stack, and evict on a drag",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0275-"));
      const alpha = path.join(dir, "alpha.txt");
      const bravo = path.join(dir, "bravo.txt");
      fs.writeFileSync(alpha, "alpha\n", "utf8");
      fs.writeFileSync(bravo, "bravo\n", "utf8");

      const app = await launchTugApp({ testName: "at0275-layout-imposition" });
      try {
        await app.seedDeckState({
          state: deckShape(),
          cardStates: {
            A: { content: { path: alpha, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
            B: { content: { path: bravo, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          { timeoutMs: 15_000 },
        );

        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("toggle-lens"), null)`,
        );
        // Both open files reach the Lens list once their cards bind their paths.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('${LIST} [data-tug-list-cell-index]').length >= 2`,
          { timeoutMs: 15_000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(".tug-pane[data-lens]") !== null`,
          { timeoutMs: 10_000 },
        );

        const before = await app.evalJS<Scene>(READ_SCENE);
        if (before.a === null || before.b === null) {
          throw new Error("[at0275] both panes must be on the canvas to start");
        }
        // No imposition yet: nothing is imposed, and no slot buttons exist —
        // the cluster is the arrangement's affordance, not a row fixture.
        expect(before.a.imposed).toBeNull();
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll('[data-testid="lens-slot-picker"] button').length`,
          ),
        ).toBe(0);

        // ---- Choose Three Up in the Layouts section (a real click) ----
        await app.nativeClickAtElement(THREE_UP);
        await app.waitForCondition<boolean>(
          `document.querySelector('${THREE_UP}').getAttribute("data-state") === "checked"`,
          { timeoutMs: 8_000 },
        );
        // Three slots means three buttons per row.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('${LIST} [data-testid="lens-slot-picker"] button').length === 6`,
          { timeoutMs: 8_000 },
        );

        const alphaRow = await rowIndexFor(app, "alpha.txt");
        const bravoRow = await rowIndexFor(app, "bravo.txt");

        // ---- Slot 1 for alpha ----
        await app.nativeClickAtElement(slotButton(alphaRow, 1));
        await settle();

        // With one card in the chain, all of the slack is visible and it is all
        // in one place: between that card and the Lens.
        const lone = await app.evalJS<Scene>(READ_SCENE);
        if (lone.a === null || lone.lens === null) {
          throw new Error("[at0275] expected alpha's pane and the Lens");
        }
        console.log("[at0275] lone scene:", JSON.stringify(lone));
        const loneSpan = spanFor(lone);
        const loneSpanLeft = loneSpan.left;
        const loneSpanRight = loneSpan.right;
        expect(lone.a.x).toBeCloseTo(loneSpanLeft + GAP, 0);
        // The pooled margin is everything the chain did not use, and it is far
        // wider than the gap on the other three sides — that asymmetry is the
        // arrangement, not drift.
        const pooled = loneSpanRight - (lone.a.x + lone.a.width);
        expect(pooled).toBeCloseTo(
          loneSpanRight - loneSpanLeft - GAP - lone.a.width,
          0,
        );
        expect(pooled).toBeGreaterThan(GAP * 10);

        // ---- Slot 3 for bravo ----
        await app.nativeClickAtElement(slotButton(bravoRow, 3));
        await settle();

        const three = await app.evalJS<Scene>(READ_SCENE);
        if (three.a === null || three.b === null || three.lens === null) {
          throw new Error("[at0275] expected two panes and the Lens");
        }
        console.log("[at0275] three-up scene:", JSON.stringify(three));

        // ---- The Lens is imposed too: gaps on all four sides ----
        //
        // It stands off the canvas edges rather than lying flush against
        // them, which is what lets the band end one gap short of it below.
        {
          const onLeft = lensOnLeft(three);
          const nearCanvasEdge = onLeft
            ? three.lens.x - three.canvas.x
            : three.canvas.x + three.canvas.width - (three.lens.x + three.lens.width);
          expect(nearCanvasEdge).toBeCloseTo(GAP, 0);
          expect(three.lens.y).toBeCloseTo(three.canvas.y + GAP, 0);
          expect(three.lens.y + three.lens.height).toBeCloseTo(
            three.canvas.y + three.canvas.height - GAP_BOTTOM,
            0,
          );
        }

        const { left: spanLeft, right: spanRight } = spanFor(three);

        expect(three.a.imposed).toBe("0");
        expect(three.b.imposed).toBe("2");

        // The Lens holds the right, so the chain packs LEFT: alpha starts a gap
        // in from the span's left edge.
        expect(three.a.x).toBeCloseTo(spanLeft + GAP, 0);

        // These two cards are each floored at 800px by the text card's size
        // policy, so two of them do not fit the span. The step goes negative
        // and they OVERLAP — the deck is narrow, which is ordinary. What is not
        // ordinary is a card sliding under the Lens, so the strip still ends
        // exactly on the band's far edge.
        const band = spanRight - spanLeft - GAP * 2;
        const overlap = three.a.x + three.a.width - three.b.x;
        expect(overlap).toBeCloseTo(three.a.width + three.b.width - band, 0);
        expect(overlap).toBeGreaterThan(0);
        expect(three.b.x + three.b.width).toBeCloseTo(spanRight - GAP, 0);
        // Said the other way round, which is the requirement itself: the far
        // card's edge lands exactly one gap short of the Lens's near edge, so
        // no card ever slides under the Lens however crowded the deck gets.
        expect(three.b.x + three.b.width).toBeCloseTo(three.lens.x - GAP, 0);

        // Both run the canvas's height, a gap down from the top and the deeper
        // bottom gap up from the bottom.
        for (const frame of [three.a, three.b]) {
          expect(frame.y).toBeCloseTo(three.canvas.y + GAP, 0);
          expect(frame.y + frame.height).toBeCloseTo(
            three.canvas.y + three.canvas.height - GAP_BOTTOM,
            0,
          );
        }

        // Width is untouched by the imposer, to the pixel.
        expect(three.a.width).toBe(before.a.width);
        expect(three.b.width).toBe(before.b.width);

        // ---- An empty slot occupies nothing: the chain closes up ----
        //
        // Bravo moves from slot 3 to slot 2. Nothing about its position
        // changes: slot numbers order the chain, they do not reserve space, so
        // the card that follows alpha follows it either way.
        const spread = { x: three.b.x, width: three.b.width };
        await app.nativeClickAtElement(slotButton(bravoRow, 2));
        await settle();
        const middle = await app.evalJS<Scene>(READ_SCENE);
        if (middle.b === null) throw new Error("[at0275] bravo's pane vanished");
        expect(middle.b.imposed).toBe("1");
        expect(middle.b.x).toBeCloseTo(spread.x, 0);
        expect(middle.b.width).toBe(before.b.width);

        // ---- Closing the Lens widens the band, and the overlap eases off ----
        //
        // The chain is pinned to the edge away from the Lens, so its head never
        // moves. What the Lens's width buys is room in the band, and the step
        // rule spends it on the overlap first: with 420px more to work with,
        // these two cards stop overlapping and stand a clean gap apart.
        //
        // Nothing observes the change. `deck-canvas.tsx` writes the new inset
        // custom properties, the browser re-resolves the `min()` in each pin,
        // and that is the whole mechanism — the same path a window or display
        // resize takes, and why there is no ResizeObserver anywhere on the deck.
        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("toggle-lens"), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(".tug-pane[data-lens]") === null`,
          { timeoutMs: 8_000 },
        );
        await settle();
        const railless = await app.evalJS<Scene>(READ_SCENE);
        if (railless.a === null || railless.b === null) {
          throw new Error("[at0275] both panes must survive the Lens close");
        }
        console.log("[at0275] railless scene:", JSON.stringify(railless));
        expect(railless.a.imposed).toBe("0");
        // The head of the chain has not moved.
        expect(railless.a.x).toBeCloseTo(three.a.x, 0);
        expect(railless.a.width).toBe(before.a.width);
        // The overlap is gone: the two cards now stand one gap apart, which is
        // as far as the step rule will ever push them.
        expect(railless.b.x).toBeCloseTo(
          railless.a.x + railless.a.width + GAP,
          0,
        );

        // Bring the Lens back; the slack gives the width straight back.
        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("toggle-lens"), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(".tug-pane[data-lens]") !== null`,
          { timeoutMs: 8_000 },
        );
        await settle();
        const relensed = await app.evalJS<Scene>(READ_SCENE);
        if (relensed.a === null) throw new Error("[at0275] alpha's pane vanished");
        expect(relensed.a.x).toBeCloseTo(spanLeft + GAP, 0);

        // ---- The picker's other axis: send the Lens to the left ----
        //
        // Driven through the real control, not a raw dispatch: the segment is
        // what a user touches, so it is what the test touches. Flipping the
        // side flips which edge the chain packs from, so the whole strip moves
        // with the Lens — live, with no reload.
        await app.nativeClickAtElement(sideSegment("left"));
        await app.waitForCondition<boolean>(
          `document.querySelector(".tug-pane[data-lens=\\"left\\"]") !== null`,
          { timeoutMs: 8_000 },
        );
        await settle();
        const flipped = await app.evalJS<Scene>(READ_SCENE);
        if (flipped.a === null || flipped.b === null || flipped.lens === null) {
          throw new Error("[at0275] expected both panes and the Lens after the flip");
        }
        console.log("[at0275] flipped scene:", JSON.stringify(flipped));
        // The Lens now stands one gap off the LEFT canvas edge.
        expect(flipped.lens.x - flipped.canvas.x).toBeCloseTo(GAP, 0);
        // And the chain has crossed to the other end of the band: it packs
        // right, so its far card is now the one a gap off the Lens.
        const flippedSpan = spanFor(flipped);
        expect(flipped.b.x + flipped.b.width).toBeCloseTo(flippedSpan.right - GAP, 0);
        expect(flipped.a.x).toBeCloseTo(
          flipped.lens.x + flipped.lens.width + GAP,
          0,
        );

        // Every kind option is a picture of THIS deck, so they all flip with
        // it rather than staying abstract diagrams. (The side control's own
        // two segments keep drawing one side each — that is the choice they
        // offer, not a reading of the deck.)
        const kindMinis = `${SECTION} [data-testid="lens-layouts-kind"] .layout-mini`;
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll('${kindMinis}[data-lens="left"]').length`,
          ),
        ).toBe(4);
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll('${kindMinis}[data-lens="right"]').length`,
          ),
        ).toBe(0);

        // Put it back so the rest of the run reads against the right-side deck.
        await app.nativeClickAtElement(sideSegment("right"));
        await app.waitForCondition<boolean>(
          `document.querySelector(".tug-pane[data-lens=\\"right\\"]") !== null`,
          { timeoutMs: 8_000 },
        );
        await settle();

        // ---- Slots are stacks: alpha joins bravo at slot 2 ----
        //
        // Alpha vacates slot 1, so the chain closes up behind it and bravo —
        // which has not been touched — slides to the head of the chain.
        await app.nativeClickAtElement(slotButton(alphaRow, 2));
        await settle();
        const stacked = await app.evalJS<Scene>(READ_SCENE);
        if (stacked.a === null || stacked.b === null) {
          throw new Error("[at0275] both panes must survive the stack");
        }
        console.log("[at0275] stacked scene:", JSON.stringify(stacked));
        expect(stacked.a.imposed).toBe("1");
        expect(stacked.b.imposed).toBe("1");
        // Same slot, so the same place in the chain — and with slot 1 now empty
        // ahead of them, that place is the head of it.
        expect(stacked.a.x).toBeCloseTo(stacked.b.x, 0);
        expect(stacked.a.width).toBeCloseTo(stacked.b.width, 0);
        expect(stacked.a.x).toBeCloseTo(spanLeft + GAP, 0);
        // The later assignment is on top, and is the deck's active card:
        // assigning always raises, which is what makes a shared slot usable.
        expect(stacked.a.z).toBeGreaterThan(stacked.b.z);
        expect(await app.evalJS<string | null>(`window.__tug.getActiveCardId()`)).toBe(
          "A",
        );

        // ---- The rows say who is on top ----
        //
        // Both cards hold slot 2, so both rows light that slot — but only the
        // one on top reads filled. The row that is buried reads outlined, which
        // is how the Lens list tells you a click there raises rather than moves.
        const states = await app.evalJS<{ alpha: string[]; bravo: string[] }>(
          `(function(){
            function read(cellIndex) {
              var cell = document.querySelector(
                '${LIST} [data-tug-list-cell-index="' + cellIndex + '"]');
              var slots = cell.querySelectorAll('[data-slot="tug-slot"]');
              var out = [];
              for (var i = 0; i < slots.length; i += 1) {
                out.push(slots[i].getAttribute("data-state"));
              }
              return out;
            }
            return { alpha: read(${alphaRow}), bravo: read(${bravoRow}) };
          })()`,
        );
        expect(states.alpha).toEqual(["rest", "filled", "rest"]);
        expect(states.bravo).toEqual(["rest", "outlined", "rest"]);

        // ---- Dragging the top pane evicts it; the one beneath keeps its slot ----
        const bar = await app.evalJS<Rect>(
          `(function(){
            var host = document.querySelector('[data-card-id="A"]');
            var frame = host.closest(".tug-pane");
            var el = frame.querySelector('[data-testid="tug-pane-title-bar"]');
            if (el === null) throw new Error("no title bar on alpha's pane");
            var r = el.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
          })()`,
        );
        // Left of the controls cluster, on the bar's own drag surface.
        const from = {
          x: Math.round(bar.x + Math.min(80, bar.width / 3)),
          y: Math.round(bar.y + bar.height / 2),
        };
        // Rightward: the chain's head sits a gap in from the canvas edge, so a
        // leftward drag of any size would leave the viewport.
        await app.nativeDrag(from, { x: from.x + 120, y: from.y + 140 });
        await settle(600);

        const dropped = await app.evalJS<Scene>(READ_SCENE);
        if (dropped.a === null || dropped.b === null) {
          throw new Error("[at0275] both panes must survive the drag");
        }
        console.log("[at0275] dropped scene:", JSON.stringify(dropped));
        // Alpha is free again — no slot, and standing where it was dropped
        // rather than back at its place in the chain. It keeps the height it
        // visibly had: the drop commits the rect the user is looking at, so a
        // pane dragged out of a slot keeps the slot's height.
        expect(dropped.a.imposed).toBeNull();
        expect(dropped.a.x).toBeCloseTo(stacked.a.x + 120, 0);
        expect(dropped.a.y).toBeCloseTo(stacked.a.y + 140, 0);
        expect(dropped.a.width).toBe(before.a.width);
        // Bravo is untouched underneath, still holding the head of the chain —
        // one pane leaving the arrangement does not disturb the rest of it.
        expect(dropped.b.imposed).toBe("1");
        expect(dropped.b.x).toBeCloseTo(stacked.b.x, 0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
