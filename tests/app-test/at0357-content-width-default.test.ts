/**
 * at0357-content-width-default.test.ts — the deck's content width is a
 * deck-wide statement, and the Layouts section is where it is made.
 *
 * The per-pane popup narrows one card. **Card Width** in the Layouts section
 * says how wide content reads on this deck, which is a different claim and has
 * to behave like one:
 *
 *  1. It reaches the panes already open — every content pane at once, not the
 *     focused one and not the next one created.
 *  2. It never STAMPS a rail. A sidebar's width is the allocator's unknown
 *     ([P04]): a width click re-solves the rails (it is a Layouts click, and it
 *     moves every seam), but what a rail may get is the allocator's answer
 *     under its licence — never the content preset written in as if the rail
 *     were a card. The fixture makes the licence refuse (four slotted cards
 *     overfill the band at any plausible window, so no rail width tiles the
 *     chain), which is what lets a plain "unchanged" assertion pin the
 *     distinction: a stamped rail would move to the preset even when the
 *     allocator declines.
 *  3. It is what a NEW card opens at. The registrations no longer carry a
 *     literal opening width; a Session, Text, File, Diff, or DevTools card
 *     resolves one from this record at `addCard` time, so the first card of a
 *     session arrives at the width the deck is set to.
 *  4. Choosing again puts everything back on it. The default is not a one-shot
 *     seed, so re-asserting it is a real gesture — the same reasoning that
 *     keeps a side re-click from being a no-op.
 *
 * The widths asserted are slim (675) and comfy (800), both of which fit any
 * canvas the harness can launch at; wide is the same code path with a bigger
 * number, and asserting it would only be asserting the canvas.
 *
 * @covers tugdeck/src/components/lens/sections/layouts-section.tsx
 * @covers tugdeck/src/components/lens/layout-miniature.tsx
 * @covers tugdeck/src/deck-manager.ts
 * @covers tugdeck/src/action-dispatch.ts
 * @covers tugdeck/src/lib/layout-imposer.ts
 * @covers tugdeck/src/card-registry.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** The presets, as `lib/layout-imposer.ts` fixes them. */
const SLIM = 675;
const COMFY = 800;

/** The seeded Lens rail width — a number no preset resolves to, so a rail that
 *  moved would be unmistakable. */
const LENS_WIDTH = 412;

const WIDTH_TILE = (preset: string): string =>
  `[data-testid="lens-layouts-width"] [data-radio-value="${preset}"]`;

/** Four content panes filling four-up, plus the Lens standing at its pin.
 *  Four, deliberately: at slim the chain wants a band of 2715px and at comfy
 *  3215px, so on any window the harness can launch the allocator's solve is
 *  far under every rail's shrink floor and the licence refuses — the rail
 *  width below is guaranteed to be untouched by the retune, canvas be what it
 *  may. */
function deckShape(): Record<string, unknown> {
  const pane = (id: string, slot: number, cardId: string) => ({
    id,
    position: { x: 40, y: 40 },
    size: { width: 560, height: 620 },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["maker"],
    slot,
  });
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Card A", closable: true },
      { id: "B", componentId: "gallery-accordion", title: "Card B", closable: true },
      { id: "C", componentId: "gallery-accordion", title: "Card C", closable: true },
      { id: "D", componentId: "gallery-accordion", title: "Card D", closable: true },
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      pane("p1", 0, "A"),
      pane("p2", 1, "B"),
      pane("p3", 2, "C"),
      pane("p4", 3, "D"),
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
    imposition: { kind: "four-up", sidebars: { lens: { side: "right" } } },
    hasFocus: true,
  };
}

/** A pane's stored width, read off the deck rather than off the paint — the
 *  claim is about the geometry the deck holds, and a rounded frame rect would
 *  blur the one-pixel difference between "clamped" and "written". */
const PANE_WIDTH_JS = (paneId: string): string =>
  `Math.round(document.querySelector('.tug-pane[data-pane-id="${paneId}"]').getBoundingClientRect().width)`;

async function paneWidth(app: App, paneId: string): Promise<number> {
  return app.evalJS<number>(PANE_WIDTH_JS(paneId));
}

describe.skipIf(!SHOULD_RUN)(
  "at0357 — the deck's content width reaches every content pane",
  () => {
    test(
      "Card Width lands on both open cards, spares the rail, and is what the next card opens at",
      async () => {
        const app = await launchTugApp({
          testName: "at0357-content-width-default",
        });
        try {
          // The seed carries the Lens pane, so the Lens is already open —
          // toggling here would close it.
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(WIDTH_TILE("slim"))}) !== null`,
            { timeoutMs: 8_000 },
          );

          // ── Slim, from the real control. ──
          await app.nativeClickAtElement(WIDTH_TILE("slim"));
          await app.waitForCondition<boolean>(
            `(${PANE_WIDTH_JS("p1")}) === ${SLIM}`,
            { timeoutMs: 8_000 },
          );
          // EVERY content pane, not just the active one: the deck's width is
          // the deck's.
          expect(await paneWidth(app, "p1")).toBe(SLIM);
          expect(await paneWidth(app, "p2")).toBe(SLIM);
          expect(await paneWidth(app, "p3")).toBe(SLIM);
          expect(await paneWidth(app, "p4")).toBe(SLIM);
          // The rail did not come with them: the click's retune refused (no
          // rail width tiles this chain), and the preset was never stamped.
          expect(await paneWidth(app, "pLens")).toBe(LENS_WIDTH);

          // ── A card opened now arrives at the deck's width. ──
          await app.dispatchControlAction("show-devtools");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('.tug-pane').length === 6`,
            { timeoutMs: 8_000 },
          );
          const openedWidth = await app.evalJS<number>(
            `(function () {
              var seeded = ["p1", "p2", "p3", "p4", "pLens"];
              var panes = Array.from(document.querySelectorAll('.tug-pane'));
              var fresh = panes.filter(function (el) {
                return seeded.indexOf(el.getAttribute("data-pane-id")) === -1;
              });
              return Math.round(fresh[0].getBoundingClientRect().width);
            })()`,
          );
          expect(openedWidth).toBe(SLIM);

          // ── Comfy: the default overwrites what slim had set, on every
          //    content pane including the one opened since. ──
          await app.nativeClickAtElement(WIDTH_TILE("comfy"));
          await app.waitForCondition<boolean>(
            `(${PANE_WIDTH_JS("p1")}) === ${COMFY}`,
            { timeoutMs: 8_000 },
          );
          expect(await paneWidth(app, "p1")).toBe(COMFY);
          expect(await paneWidth(app, "p2")).toBe(COMFY);
          expect(await paneWidth(app, "pLens")).toBe(LENS_WIDTH);
          expect(
            await app.evalJS<number[]>(
              `Array.from(document.querySelectorAll('.tug-pane'))
                .filter(function (el) {
                  return el.getAttribute("data-pane-id") !== "pLens";
                })
                .map(function (el) {
                  return Math.round(el.getBoundingClientRect().width);
                })`,
            ),
          ).toEqual([COMFY, COMFY, COMFY, COMFY, COMFY]);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
