/**
 * at0358-slim-width-regression.test.ts — the slim preset actually fits.
 *
 * Slim (675) is not a number the layout system picked; it is the width the
 * Session card's chrome was put on a **diet** to reach — the Z2 status row shed
 * its BTW cell, dropped to 12px/10px type and 16px gaps, and Z4B gave up the
 * Session and Project chips on the code route. Every one of those is a change
 * somebody can undo by adding one cell or one chip back, and nothing about
 * adding a chip announces that it broke a width preset. The failure is silent by
 * construction: Z2 degrades by hiding whole cells through a container ladder, so
 * an overfull row does not overflow visibly — **it goes quiet**, and an
 * instrument that has stopped reporting looks exactly like an instrument with
 * nothing to report. Z4B has no degradation machinery at all; only its spacers
 * flex, so its failure is the opposite — the cluster pushes its flanks off their
 * edges.
 *
 * So this is the phase's standing guard, and it asserts both shapes of failure:
 *
 *  1. **The card lands on the preset.** `set-card-width` puts the pane at 675,
 *     which is also its registered floor — a floor no gesture could reach would
 *     be a floor nobody could trust.
 *  2. **Z2 stays fully populated.** All five cells — STATE, TIME, TOKENS,
 *     CONTEXT, WORK — are rendered AND laid out (a hidden cell has no box), and
 *     the row does not overflow its strip. Read as boxes rather than as
 *     `display`, because the ladder's rungs and an accidental overflow are two
 *     different bugs and `getBoundingClientRect` catches both.
 *  3. **Z4B's flanks hold.** The Z4A route group stays at the toolbar's leading
 *     edge and the Z5 submit at its trailing edge across the width change, and
 *     the toolbar's content still fits its box. [D97]'s geometry rule is that
 *     the two spacers absorb the difference; a cluster too wide for the row
 *     spends the flanks' positions instead, which is what these three
 *     assertions catch.
 *
 * The card is measured at comfy first so every claim is a comparison rather than
 * an absolute: the flanks are asserted to be where they already were.
 *
 * **The headroom, measured rather than derived** (the diagnostics print it every
 * run): at slim the strip is ~673px, the five cells occupy ~516px of it, and
 * four 24px gaps plus the row's inline padding bring the row to ~644px. The
 * ~29px left over is the whole margin, and that is deliberate — the cell
 * budgets were sized to SPEND the slim row rather than to leave room in it,
 * because a row of cells trimmed to their content reads as five labels huddled
 * in an empty strip rather than as an instrument panel.
 *
 * A consequence worth stating: the row centers its cells between two flexing
 * margins, so it absorbs some growth by closing those margins before anything
 * spills. This guard was checked against a real regression rather than assumed —
 * a probe widening one cell enough to break the strip does fail it — but read it
 * as catching a cell ADDED, not a cell nudged. A change that quietly tightens
 * the row's rhythm without spilling it is still a change to look at.
 *
 * @covers tugdeck/src/components/tugways/cards/session-card-registration.tsx
 * @covers tugdeck/src/components/tugways/cards/session-card-telemetry-renderers.tsx
 * @covers tugdeck/src/components/tugways/tug-status-cell.tsx
 * @covers tugdeck/src/components/tugways/tug-status-cell.css
 * @covers tugdeck/src/components/tugways/tug-entry-shell.tsx
 * @covers tugdeck/src/lib/layout-imposer.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/** The presets, as `lib/layout-imposer.ts` fixes them. */
const SLIM = 675;
const COMFY = 800;

const CARD = '[data-card-id="A"]';
const PANE = '.tug-pane[data-pane-id="p1"]';
const STATUS_BAR = `${CARD} .session-card-status-bar`;
const STATUS_CELL = `${CARD} [data-slot="tug-status-cell"]`;
const TOOLBAR = `${CARD} .tug-prompt-entry-toolbar`;
const ROUTE_GROUP = `${TOOLBAR} .tug-prompt-entry-route-group`;
const SUBMIT = `${CARD} .tug-prompt-entry-submit-button`;
/** The toolbar's three occupied zones: Z4A, the Z4B cluster, and Z5. */
const TOOLBAR_ITEMS = `${ROUTE_GROUP}, ${CARD} [data-slot="entry-shell-indicators"] > *, ${SUBMIT}`;

/** The five cells the post-diet row carries, in the order it renders them. */
const Z2_CELLS = ["state", "time", "tokens", "context", "work"];

function deckShape(): Record<string, unknown> {
  return {
    cards: [
      { id: "A", componentId: "session", title: "Session", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: COMFY, height: 620 },
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

interface Rect {
  left: number;
  right: number;
  width: number;
}

const RECT_JS = (selector: string): string => `(function () {
  var el = document.querySelector(${JSON.stringify(selector)});
  if (el === null) return null;
  var r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, width: r.width };
})()`;

async function rect(app: App, selector: string): Promise<Rect | null> {
  return app.evalJS<Rect | null>(RECT_JS(selector));
}

/** Each laid-out Z2 cell's rendered width, keyed by priority. */
async function cellWidths(app: App): Promise<Record<string, number>> {
  return app.evalJS<Record<string, number>>(
    `Array.from(document.querySelectorAll(${JSON.stringify(STATUS_CELL)}))
      .reduce(function (acc, el) {
        acc[el.getAttribute("data-priority")] =
          Math.round(el.getBoundingClientRect().width);
        return acc;
      }, {})`,
  );
}

/**
 * True when every cell crosses one common horizontal band — i.e. the row did
 * not wrap.
 *
 * Asked as an overlap rather than as "one distinct `top`", which is what this
 * test asked first and which is false even on a perfectly good row: STATE
 * carries indicator glyphs beside its value and sits a pixel or two off its
 * neighbours. Overlap is the claim that matters — a wrapped cell drops entirely
 * below the others, and no amount of within-row nudging can fake that.
 */
async function cellsShareARow(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function () {
      var rs = Array.from(document.querySelectorAll(${JSON.stringify(STATUS_CELL)}))
        .map(function (el) { return el.getBoundingClientRect(); })
        .filter(function (r) { return r.width > 0; });
      if (rs.length === 0) return false;
      var lowestTop = Math.max.apply(null, rs.map(function (r) { return r.top; }));
      var highestBottom = Math.min.apply(null, rs.map(function (r) { return r.bottom; }));
      return lowestTop < highestBottom;
    })()`,
  );
}

/** Which Z2 cells have a box — laid out, not merely in the DOM. */
async function laidOutCells(app: App): Promise<string[]> {
  return app.evalJS<string[]>(
    `Array.from(document.querySelectorAll(${JSON.stringify(STATUS_CELL)}))
      .filter(function (el) { return el.getBoundingClientRect().width > 0; })
      .map(function (el) { return el.getAttribute("data-priority"); })`,
  );
}

/**
 * How far a set of children spills past its container's box, in pixels — the
 * larger of the two edges, 0 when everything is inside.
 *
 * Measured from rects rather than from `scrollWidth - clientWidth`, which is
 * what this test asked first and which answers 0 here whatever the children do:
 * neither the status strip nor the toolbar is a scroll container, so there is no
 * scrolling area for the overflow to show up in. Rects are what the browser
 * actually paints, and they are the same thing a person would look at.
 */
async function spill(
  app: App,
  container: string,
  children: string,
): Promise<number> {
  return app.evalJS<number>(
    `(function () {
      var box = document.querySelector(${JSON.stringify(container)});
      if (box === null) return -1;
      var kids = Array.from(document.querySelectorAll(${JSON.stringify(children)}));
      if (kids.length === 0) return -1;
      var r = box.getBoundingClientRect();
      var over = 0;
      for (var i = 0; i < kids.length; i += 1) {
        var k = kids[i].getBoundingClientRect();
        if (k.width === 0) continue;
        over = Math.max(over, r.left - k.left, k.right - r.right);
      }
      return Math.round(over);
    })()`,
  );
}

async function paneWidth(app: App): Promise<number> {
  return app.evalJS<number>(
    `Math.round(document.querySelector(${JSON.stringify(PANE)}).getBoundingClientRect().width)`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0358 — a Session card at the slim preset still reads everything",
  () => {
    test(
      "slim lands on 675 with Z2 fully populated and Z4B's flanks where they were",
      async () => {
        const app = await launchTugApp({
          testName: "at0358-slim-width-regression",
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 8_000 },
          );
          await app.bindSession("A");
          await app.awaitEngineReady("A");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SUBMIT)}) !== null`,
            { timeoutMs: 8_000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(STATUS_CELL)}).length === ${Z2_CELLS.length}`,
            { timeoutMs: 8_000 },
          );

          // ── At comfy: the reference. Everything asserted below is asserted
          //    against this, so a canvas of any size gives the same answers. ──
          expect(await paneWidth(app)).toBe(COMFY);
          expect(await laidOutCells(app)).toEqual(Z2_CELLS);
          const comfyCells = await cellWidths(app);
          note(
            "Z2 at comfy",
            `${Object.entries(comfyCells)
              .map(([k, w]) => `${k}=${w}`)
              .join(" ")} strip=${(await rect(app, STATUS_BAR))?.width} oneRow=${await cellsShareARow(app)}`,
          );
          const comfyRoute = await rect(app, ROUTE_GROUP);
          const comfySubmit = await rect(app, SUBMIT);
          const comfyToolbar = await rect(app, TOOLBAR);
          expect(comfyRoute).not.toBeNull();
          expect(comfySubmit).not.toBeNull();
          expect(comfyToolbar).not.toBeNull();
          const comfyLeadGap = comfyRoute!.left - comfyToolbar!.left;
          const comfyTrailGap = comfyToolbar!.right - comfySubmit!.right;

          // ── Apply slim through the command the width popup dispatches. ──
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("set-card-width", { paneId: "p1", preset: "slim" }), null)`,
          );
          await app.waitForCondition<boolean>(
            `Math.round(document.querySelector(${JSON.stringify(PANE)}).getBoundingClientRect().width) === ${SLIM}`,
            { timeoutMs: 8_000 },
          );
          expect(await paneWidth(app)).toBe(SLIM);

          // ── 2. Z2 is still five cells, all of them laid out. ──
          const cells = await laidOutCells(app);
          expect(
            cells,
            "no ladder rung fires at the slim preset — the diet is what bought that",
          ).toEqual(Z2_CELLS);

          const statusSpill = await spill(app, STATUS_BAR, STATUS_CELL);
          const slimCells = await cellWidths(app);
          note(
            "Z2 at slim",
            `${Object.entries(slimCells)
              .map(([k, w]) => `${k}=${w}`)
              .join(" ")} strip=${(await rect(app, STATUS_BAR))?.width} spill=${statusSpill}px oneRow=${await cellsShareARow(app)}`,
          );
          expect(
            statusSpill,
            "every cell is inside the strip — the row fits at 675 rather than running past its edge",
          ).toBeLessThanOrEqual(1);

          // The cells are `flex: 0 0 auto`, so a row that no longer fits does
          // not squeeze — it spills or wraps. Asserting all three (same widths,
          // no spill, one row) is what makes "it fits" mean the thing a person
          // means by it, whichever way a future cell breaks it.
          expect(
            slimCells,
            "no cell is narrower at slim than at comfy — the row is not being squeezed",
          ).toEqual(comfyCells);
          expect(
            await cellsShareARow(app),
            "the cells stand on one row — a wrapped cell is an unread instrument as surely as a hidden one",
          ).toBe(true);

          // ── 3. Z4B's flanks are where they were. ──
          const slimRoute = await rect(app, ROUTE_GROUP);
          const slimSubmit = await rect(app, SUBMIT);
          const slimToolbar = await rect(app, TOOLBAR);
          expect(slimRoute).not.toBeNull();
          expect(slimSubmit).not.toBeNull();

          // The flanks are edge-pinned, so what must hold across the width
          // change is their DISTANCE to their own edge, not an absolute x — the
          // card moved.
          expect(
            Math.abs(slimRoute!.left - slimToolbar!.left - comfyLeadGap),
            "Z4A stays pinned to the toolbar's leading edge",
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(slimToolbar!.right - slimSubmit!.right - comfyTrailGap),
            "Z5 stays pinned to the toolbar's trailing edge",
          ).toBeLessThanOrEqual(1);
          expect(
            slimRoute!.width,
            "Z4A keeps its width — the spacers absorb the difference, not the flanks",
          ).toBeCloseTo(comfyRoute!.width, 0);

          const toolbarSpill = await spill(app, TOOLBAR, TOOLBAR_ITEMS);
          note("Z4B spill at slim", `${toolbarSpill}px`);
          expect(
            toolbarSpill,
            "every chip is inside the toolbar — Z4B has no degradation machinery, so fitting is the whole check",
          ).toBeLessThanOrEqual(1);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
