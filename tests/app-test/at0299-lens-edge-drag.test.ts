/**
 * at0299-lens-edge-drag.test.ts — what a Lens width drag is allowed to move.
 *
 * The pinned Lens exposes exactly one resize handle: the deck-facing edge (the
 * west one on a right-side deck). Two things follow from the pin, and both are
 * asserted here DURING the gesture rather than after it, because both used to
 * be true only at pointer-up:
 *
 *  1. The pinned edge holds. The Lens is pinned by an expression that subtracts
 *     its width from the canvas (`100% - width - gap`), so a width written
 *     without the pin re-resolving moves the wrong edge — the deck edge walks
 *     inward as the dragged edge stays put, and a Lens dragged wider runs off
 *     the far side of the window.
 *  2. The cards re-impose live. The band the chain rides is inset by the Lens's
 *     width, so the card against the Lens tracks the moving edge for the whole
 *     gesture, one imposition gap off it, rather than jumping there on release.
 *
 * One property carries the width (`LENS_WIDTH_PROPERTY`) and all three
 * expressions read it — the Lens's pin, the Lens's own `width`, and the band
 * inset — so the drag writes one number and the browser resolves the rest.
 *
 * Scenario:
 *   1. Seed a two-up deck: two slotted panes + the Lens pinned right at 420.
 *   2. Take the resting geometry — Lens on the right edge, last card one gap
 *      off its near edge.
 *   3. Drag the west handle 140px left WITHOUT releasing, and assert mid-drag:
 *      the right edge has not moved, the width grew by the drag, and the last
 *      card is still exactly one gap off the Lens.
 *   4. Release, and assert the committed geometry is the geometry the gesture
 *      was already showing.
 *   5. Drag back to the right (narrower) and assert the same three facts.
 *
 * @covers tugdeck/src/lib/layout-imposer.ts
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** The imposition gap (`lib/layout-imposer.ts`). */
const GAP = 5;
const LENS_WIDTH = 420;
const PANE_WIDTH = 320;
/** How far the handle travels, and the slack the geometry is read within. */
const GROW_PX = 140;
const SHRINK_PX = 90;
const TOL = 3;

const LENS_SELECTOR = `.tug-pane[data-pane-id="pLens"]`;
/** The Lens's one handle: a right-side Lens faces west. */
const LENS_HANDLE = `${LENS_SELECTOR} .tug-pane-resize-w`;
/** The card in the last slot — the one standing against the Lens. */
const LAST_CARD = `.tug-pane[data-pane-id="p2"]`;

function deckShape() {
  const card = (id: string, title: string) => ({
    id,
    componentId: "gallery-accordion",
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
    cards: [card("A", "Card A"), card("B", "Card B"), { id: "L", componentId: "lens", title: "Lens", closable: true }],
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

interface Geometry {
  viewportWidth: number;
  lensLeft: number;
  lensRight: number;
  lensWidth: number;
  cardRight: number;
}

/** One read of everything the drag is allowed — and not allowed — to move. */
async function geometry(app: App): Promise<Geometry> {
  return app.evalJS<Geometry>(
    `(function () {
      var lens = document.querySelector(${JSON.stringify(LENS_SELECTOR)});
      var card = document.querySelector(${JSON.stringify(LAST_CARD)});
      var l = lens.getBoundingClientRect();
      var c = card.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        lensLeft: l.left,
        lensRight: l.right,
        lensWidth: l.width,
        cardRight: c.right,
      };
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0299 — a Lens width drag moves the dragged edge, and the deck with it",
  () => {
    test(
      "the pinned edge holds and the chain re-imposes live, mid-gesture",
      async () => {
        const app = await launchTugApp({ testName: "at0299-lens-edge-drag" });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(
              `${LENS_SELECTOR}[data-lens="right"]`,
            )}) !== null && document.querySelector(${JSON.stringify(
              LAST_CARD,
            )}) !== null`,
            { timeoutMs: 5_000 },
          );

          const rest = await geometry(app);
          // The deck has room for the chain to travel — otherwise the cards
          // are crowded against the band's left edge and the card beside the
          // Lens would not track it, making everything below vacuous.
          expect(rest.viewportWidth).toBeGreaterThan(
            LENS_WIDTH + PANE_WIDTH * 2 + GROW_PX + 100,
          );
          expect(
            Math.abs(rest.lensRight - (rest.viewportWidth - GAP)),
          ).toBeLessThanOrEqual(TOL);
          expect(Math.abs(rest.lensWidth - LENS_WIDTH)).toBeLessThanOrEqual(TOL);
          expect(
            Math.abs(rest.cardRight - (rest.lensLeft - GAP)),
          ).toBeLessThanOrEqual(TOL);

          // ── Wider: drag the west handle left, and look before releasing ──
          const handle = await app.getElementBounds(LENS_HANDLE);
          const grabX = handle.x + handle.width / 2;
          const grabY = handle.y + handle.height / 2;
          await app.nativeDragElementWithoutRelease(LENS_HANDLE, {
            x: grabX - GROW_PX,
            y: grabY,
          });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(
              LENS_SELECTOR,
            )}).getBoundingClientRect().width > ${LENS_WIDTH + GROW_PX - 20}`,
            { timeoutMs: 5_000 },
          );

          const wider = await geometry(app);
          // The edge the Lens holds is the one edge the drag may not move.
          expect(Math.abs(wider.lensRight - rest.lensRight)).toBeLessThanOrEqual(TOL);
          expect(
            Math.abs(wider.lensWidth - (rest.lensWidth + GROW_PX)),
          ).toBeLessThanOrEqual(TOL);
          // And the chain has already moved out of the way — mid-gesture.
          expect(
            Math.abs(wider.cardRight - (wider.lensLeft - GAP)),
          ).toBeLessThanOrEqual(TOL);
          expect(rest.cardRight - wider.cardRight).toBeGreaterThan(GROW_PX - TOL);

          await app.nativeMouseUp({ x: grabX - GROW_PX, y: grabY });

          // The release commits what the gesture was already showing.
          const committed = await geometry(app);
          expect(
            Math.abs(committed.lensRight - rest.lensRight),
          ).toBeLessThanOrEqual(TOL);
          expect(
            Math.abs(committed.lensWidth - wider.lensWidth),
          ).toBeLessThanOrEqual(TOL);
          expect(
            Math.abs(committed.cardRight - (committed.lensLeft - GAP)),
          ).toBeLessThanOrEqual(TOL);

          // ── Narrower: the same three facts in the other direction ────────
          const handle2 = await app.getElementBounds(LENS_HANDLE);
          const grabX2 = handle2.x + handle2.width / 2;
          const grabY2 = handle2.y + handle2.height / 2;
          await app.nativeDragElementWithoutRelease(LENS_HANDLE, {
            x: grabX2 + SHRINK_PX,
            y: grabY2,
          });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(
              LENS_SELECTOR,
            )}).getBoundingClientRect().width < ${
              LENS_WIDTH + GROW_PX - SHRINK_PX + 20
            }`,
            { timeoutMs: 5_000 },
          );

          const narrower = await geometry(app);
          expect(
            Math.abs(narrower.lensRight - rest.lensRight),
          ).toBeLessThanOrEqual(TOL);
          expect(
            Math.abs(narrower.lensWidth - (committed.lensWidth - SHRINK_PX)),
          ).toBeLessThanOrEqual(TOL);
          expect(
            Math.abs(narrower.cardRight - (narrower.lensLeft - GAP)),
          ).toBeLessThanOrEqual(TOL);

          await app.nativeMouseUp({ x: grabX2 + SHRINK_PX, y: grabY2 });
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
