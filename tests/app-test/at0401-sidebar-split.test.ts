/**
 * at0401-sidebar-split.test.ts — a shared sidebar rail, divided.
 *
 * Two sidebar cards on one edge share a rail. By default they stack
 * front-to-back and z-order decides which one you see. The user may instead
 * SPLIT that side, and then the rail's vertical run is divided between them and
 * every member is visible at once. Stack stays the default; the choice is
 * per-side state on `imposition.rails`.
 *
 * The invariants under test are the ones a screenshot cannot lie about, so
 * every one of them is read from live `getBoundingClientRect()`:
 *
 *   1. A split rail TILES its run — top member at the imposition gap, bottom
 *      member at the deeper bottom gap, exactly one gap of air between them,
 *      and one shared width and left edge. Both frames carry
 *      `data-rail-split`.
 *   2. Vertical order does NOT follow z-order. Clicking either member raises
 *      it in the deck's array and leaves both frames exactly where they were.
 *      This is the regression that would otherwise ship silently: it looks
 *      like a feature until you notice the cards moved.
 *   3. A seam drag changes only the two adjacent members' heights, clamps at
 *      each member's minimum, and persists as weights in the layout blob.
 *   4. Reordering flips the members' vertical positions, and the heights stay
 *      with their CARDS — weights are keyed by componentId, so a reorder is a
 *      pure translate.
 *   5. Membership churn does not destroy the arrangement: close a member and
 *      the survivor takes the whole run; reopen it and the split re-applies at
 *      the order and heights it had.
 *   6. Re-stacking restores today's behavior byte for byte — two frames the
 *      browser cannot tell apart.
 *
 * Every gesture here is the door the user has, driven by a real pointer: the
 * badge menu by a real click on the real badge, the seam by a real drag, and
 * the reorder by a real title-bar drag down the rail's own column — which is
 * the corridor gesture end to end, latch to commit.
 *
 * Not here, deliberately: the corridor drag's mid-gesture EXIT, where a
 * trajectory leaving the rail's band converts the reorder into a free drag.
 * The harness's pointer path cannot honestly express a mid-gesture trajectory
 * change, and faking it with synthetic PointerEvents would assert the fake
 * rather than the gesture. What that branch lands on is covered from both
 * sides: the reorder it converts FROM is asserted here, and the free drag's
 * unpin-on-drop it converts TO is asserted in at0230.
 *
 * @covers tugdeck/src/lib/layout-imposer.ts
 * @covers tugdeck/src/deck-manager.ts
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/components/lens/sections/layouts-section.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** The imposition gaps (`lib/layout-imposer.ts`). */
const GAP = 5;
const GAP_BOTTOM = 32;
/** Every sidebar registration declares this floor; the seam clamp reads it. */
const MEMBER_MIN_HEIGHT = 240;
/** Geometry tolerance: sub-pixel layout rounding, never a real disagreement. */
const EPSILON = 1.5;
/** How long the debounced layout save needs to reach disk. */
const SAVE_SETTLE_MS = 1_200;
/** Room past the settle attribute clearing for the tween's own tail. */
const SETTLE_TAIL_MS = 900;

const RAIL_WIDTH = 420;
const LENS_PANE = "pLens";
const JOTS_PANE = "pJots";

const frame = (paneId: string): string =>
  `.tug-pane[data-pane-id="${paneId}"]`;
const BADGE = '[data-testid="tug-pane-title-bar-stack-badge"]';
const MENU = '[data-testid="tug-pane-title-bar-stack-menu"]';
const ROW = `${MENU} [role="menuitemradio"]`;
const SEAM = '[data-rail-seam="right:0"]';

function deckShape() {
  return {
    cards: [
      { id: "L", componentId: "lens", title: "Lens", closable: true },
      { id: "J", componentId: "jots", title: "Jots", closable: true },
    ],
    panes: [
      {
        id: LENS_PANE,
        position: { x: 0, y: 0 },
        size: { width: RAIL_WIDTH, height: 900 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Lens",
        acceptsFamilies: [],
      },
      {
        id: JOTS_PANE,
        position: { x: 0, y: 0 },
        size: { width: RAIL_WIDTH, height: 900 },
        cardIds: ["J"],
        activeCardId: "J",
        title: "Jots",
        acceptsFamilies: [],
      },
    ],
    activePaneId: LENS_PANE,
    imposition: {
      kind: "three-up",
      sidebars: { lens: { side: "right" }, jots: { side: "right" } },
    },
    hasFocus: true,
  };
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

/** Both rail members' live rects, keyed by pane id. */
async function railRects(app: App): Promise<Record<string, Rect>> {
  return app.evalJS<Record<string, Rect>>(
    `(function () {
      var out = {};
      document.querySelectorAll('.tug-pane[data-lens="right"]').forEach(function (el) {
        var r = el.getBoundingClientRect();
        out[el.getAttribute("data-pane-id")] = {
          top: r.top, bottom: r.bottom, left: r.left,
          width: r.width, height: r.height,
        };
      });
      return out;
    })()`,
  );
}

/** How many rail frames are currently rendering as split members. */
function splitFrameCount(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll('.tug-pane[data-rail-split]').length`,
  );
}

/**
 * Each rail frame's z-index — the deck's pane-array order, made observable.
 *
 * Read from the painted frames rather than from the store: z-index is exactly
 * what the array produces, so this is the same fact one step closer to the
 * user, and it needs no test-surface reader of its own.
 */
function railZIndexes(app: App): Promise<Record<string, number>> {
  return app.evalJS<Record<string, number>>(
    `(function () {
      var out = {};
      document.querySelectorAll('.tug-pane[data-lens="right"]').forEach(function (el) {
        out[el.getAttribute("data-pane-id")] = parseInt(getComputedStyle(el).zIndex, 10);
      });
      return out;
    })()`,
  );
}

/** The rail members' componentIds in vertical order, top to bottom — the
 *  order the record holds, read off the frames that render it. */
function railOrderOnScreen(app: App): Promise<string[]> {
  return app.evalJS<string[]>(
    `Array.from(document.querySelectorAll('.tug-pane[data-rail-split]'))
      .sort(function (a, b) {
        return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
      })
      .map(function (el) { return el.getAttribute("data-rail-member"); })`,
  );
}

/** The right rail's arrangement as the layout blob on disk records it. */
function railOnDisk(tugbankPath: string): {
  mode?: string;
  order?: string[];
  shares?: Record<string, number>;
} | undefined {
  const blob = tugbankRead<{
    imposition?: {
      rails?: Record<
        string,
        { mode?: string; order?: string[]; shares?: Record<string, number> }
      >;
    };
  }>(tugbankPath, "dev.tugtool.deck.layout", "layout");
  return blob?.value.imposition?.rails?.["right"];
}

/** Flush the debounced layout save and let it reach disk. */
async function flushSave(app: App): Promise<void> {
  await app.evalJS<void>(`(window.tugdeck.saveState(), null)`);
  await new Promise((resolve) => setTimeout(resolve, SAVE_SETTLE_MS));
}

/**
 * Wait out the settle before measuring anything.
 *
 * An arrangement change arms the imposer's FLIP: for its duration every moved
 * frame wears a transform that starts at the inverse of the move, so a rect
 * read mid-settle is the frame's OLD geometry wearing its new attributes. This
 * is not a race to lose gracefully — it is the difference between asserting
 * where a frame landed and asserting where it came from.
 */
async function settled(app: App): Promise<void> {
  await app.waitForCondition<boolean>(
    `document.querySelector("[data-imposer-settling]") === null`,
    { timeoutMs: 8_000 },
  );
  // The attribute is cleared on a timer sized to the tween; give the tween's
  // own tail room to finish clearing the inline transforms behind it.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_TAIL_MS));
  expect(
    await app.evalJS<boolean>(
      `document.querySelector("[data-imposer-settling]") !== null`,
    ),
    "the deck came to rest before anything was measured",
  ).toBe(false);
}

async function waitForSplitFrames(app: App, count: number): Promise<void> {
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('.tug-pane[data-rail-split]').length === ${count}`,
    { timeoutMs: 8_000 },
  );
  await settled(app);
}

/** The labels of the open badge menu's rows, in render order. */
function rowLabels(app: App): Promise<string[]> {
  return app.evalJS<string[]>(
    `Array.from(document.querySelectorAll(${JSON.stringify(
      `${MENU} [role="menuitem"], ${ROW}`,
    )})).map(function (el) { return el.textContent.trim(); })`,
  );
}

/** The pane id of the checked row, or null when no row is checked. */
function checkedRowPaneId(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function () {
      var rows = Array.from(document.querySelectorAll(${JSON.stringify(ROW)}));
      var hit = rows.find(function (el) { return el.getAttribute("aria-checked") === "true"; });
      return hit ? hit.getAttribute("data-item-id") : null;
    })()`,
  );
}

/** Click the row whose label reads `label` in the open badge menu. */
async function clickMenuRow(app: App, label: string): Promise<void> {
  const selector = await app.evalJS<string | null>(
    `(function () {
      var rows = Array.from(document.querySelectorAll(${JSON.stringify(
        `${MENU} [role="menuitem"], ${ROW}`,
      )}));
      var hit = rows.find(function (el) { return el.textContent.trim() === ${JSON.stringify(label)}; });
      if (!hit) return null;
      var id = hit.getAttribute("data-item-id");
      return id === null ? null : ${JSON.stringify(MENU)} + ' [data-item-id="' + id + '"]';
    })()`,
  );
  expect(selector, `the menu offers a "${label}" row`).not.toBeNull();
  await app.nativeClickAtElement(selector as string);
}

async function waitForMenu(app: App, present: boolean): Promise<void> {
  await app.waitForCondition<boolean>(
    `(document.querySelectorAll(${JSON.stringify(MENU)}).length > 0) === ${
      present ? "true" : "false"
    }`,
    { timeoutMs: 5_000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0401 — a shared rail can be split, and the split is the user's to arrange",
  () => {
    test(
      "split tiles the run, order ignores z, the seam persists, churn survives, stack returns",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0401-sidebar-split",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({ state: deckShape(), focusCardId: "L" });

            // ── Both members stand on the right rail, stacked. ──
            await app.waitForCondition<boolean>(
              `document.querySelectorAll('.tug-pane[data-lens="right"]').length === 2`,
              { timeoutMs: 8_000 },
            );
            const stacked = await railRects(app);
            expect(
              Math.abs(stacked[LENS_PANE].top - stacked[JOTS_PANE].top),
              "stacked members share a top edge",
            ).toBeLessThanOrEqual(EPSILON);
            expect(
              Math.abs(stacked[LENS_PANE].bottom - stacked[JOTS_PANE].bottom),
              "and a bottom edge",
            ).toBeLessThanOrEqual(EPSILON);
            expect(await splitFrameCount(app), "nothing is split yet").toBe(0);

            // ── Split, through the door the user has: the badge menu. ──
            await app.nativeClickAtElement(`${frame(JOTS_PANE)} ${BADGE}`);
            await waitForMenu(app, true);
            expect(
              await rowLabels(app),
              "a stacked rail offers its members and one verb",
            ).toContain("Split Vertically");
            await clickMenuRow(app, "Split Vertically");
            await waitForSplitFrames(app, 2);

            // ── 1. The run is TILED. ──
            const vp = await app.evalJS<{ h: number }>(
              `({ h: window.innerHeight })`,
            );
            const split = await railRects(app);
            const ordered = Object.values(split).sort((a, b) => a.top - b.top);
            const [upper, lower] = ordered;
            expect(
              Math.abs(upper.top - GAP),
              "the top member starts at the imposition gap, exactly where an unsplit rail does",
            ).toBeLessThanOrEqual(EPSILON);
            expect(
              Math.abs(lower.bottom - (vp.h - GAP_BOTTOM)),
              "the bottom member ends at the deeper bottom gap",
            ).toBeLessThanOrEqual(EPSILON);
            expect(
              Math.abs(lower.top - upper.bottom - GAP),
              "one imposition gap of air between them — no overlap, no chasm",
            ).toBeLessThanOrEqual(EPSILON);
            expect(
              Math.abs(upper.width - lower.width),
              "one rail, one width",
            ).toBeLessThanOrEqual(EPSILON);
            expect(
              Math.abs(upper.left - lower.left),
              "and one left edge",
            ).toBeLessThanOrEqual(EPSILON);
            expect(
              Math.abs(upper.height - lower.height),
              "an untouched split divides the run equally",
            ).toBeLessThanOrEqual(EPSILON * 2);

            // The split materialized an explicit order rather than leaving it
            // to be derived from something that moves.
            await flushSave(app);
            expect(railOnDisk(tugbankPath)?.mode).toBe("split");
            expect(
              railOnDisk(tugbankPath)?.order?.length,
              "splitting stores the vertical order at the instant it becomes visible",
            ).toBe(2);

            // ── 2. Vertical order does not follow z-order. ──
            {
              const before = await railRects(app);
              const zBefore = await railZIndexes(app);
              // Raise whichever member is currently behind, so the click has
              // something to change.
              const buried =
                zBefore[LENS_PANE] < zBefore[JOTS_PANE] ? LENS_PANE : JOTS_PANE;
              await app.nativeClickAtElement(
                `${frame(buried)} .tug-pane-title-bar`,
              );
              await app.waitForCondition<boolean>(
                `(function () {
                  var el = document.querySelector(${JSON.stringify(
                    frame(LENS_PANE),
                  )});
                  return parseInt(getComputedStyle(el).zIndex, 10) !== ${zBefore[LENS_PANE]};
                })()`,
                { timeoutMs: 5_000 },
              );
              const zAfter = await railZIndexes(app);
              expect(
                zAfter[buried] > zAfter[buried === LENS_PANE ? JOTS_PANE : LENS_PANE],
                "the click really did raise the pane — otherwise this proves nothing",
              ).toBe(true);
              await settled(app);
              const after = await railRects(app);
              for (const paneId of [LENS_PANE, JOTS_PANE]) {
                expect(
                  Math.abs(after[paneId].top - before[paneId].top),
                  `${paneId} did not move vertically when a member was raised`,
                ).toBeLessThanOrEqual(EPSILON);
                expect(
                  Math.abs(after[paneId].bottom - before[paneId].bottom),
                  `${paneId} kept its height when a member was raised`,
                ).toBeLessThanOrEqual(EPSILON);
              }
            }

            // ── 3. The seam drags, and it clamps. ──
            {
              const before = await railRects(app);
              const seam = await app.getElementBounds(SEAM);
              // Drag the seam a long way up — past the top member's floor, so
              // the clamp is what decides where it lands rather than the hand.
              await app.nativeDragElement(SEAM, {
                x: Math.round(seam.x + seam.width / 2),
                y: 20,
              });
              await app.waitForCondition<boolean>(
                `(function () {
                  var r = document.querySelector(${JSON.stringify(
                    frame(LENS_PANE),
                  )}).getBoundingClientRect();
                  return Math.abs(r.height - ${before[LENS_PANE].height}) > 2;
                })()`,
                { timeoutMs: 5_000 },
              );
              await settled(app);
              const after = await railRects(app);
              const shortest = Math.min(
                after[LENS_PANE].height,
                after[JOTS_PANE].height,
              );
              expect(
                shortest,
                "the seam stops at the member's own minimum height rather than crushing it",
              ).toBeGreaterThanOrEqual(MEMBER_MIN_HEIGHT - EPSILON);
              // Still tiled: a drag moves the boundary, never the endpoints.
              const orderedAfter = Object.values(after).sort(
                (a, b) => a.top - b.top,
              );
              expect(
                Math.abs(orderedAfter[0].top - GAP),
              ).toBeLessThanOrEqual(EPSILON);
              expect(
                Math.abs(
                  orderedAfter[1].top - orderedAfter[0].bottom - GAP,
                ),
                "the members still meet at exactly one gap",
              ).toBeLessThanOrEqual(EPSILON);

              await flushSave(app);
              expect(
                railOnDisk(tugbankPath)?.shares,
                "the drag committed weights, not pixels — and they reached disk",
              ).toBeDefined();
            }

            // ── 4. Reorder, through the real gesture: a title-bar drag that
            //    stays inside the rail's corridor shuffles rather than
            //    unpinning. Positions swap; heights stay with their cards. ──
            {
              const before = await railRects(app);
              const orderBefore = await railOrderOnScreen(app);
              const upperPane =
                before[LENS_PANE].top < before[JOTS_PANE].top
                  ? LENS_PANE
                  : JOTS_PANE;
              const lower = before[upperPane === LENS_PANE ? JOTS_PANE : LENS_PANE];
              // Straight down the rail's own column, past the lower member's
              // midpoint — a vertical trajectory never leaves the corridor.
              await app.nativeDragElement(`${frame(upperPane)} .tug-pane-title-bar`, {
                x: Math.round(before[upperPane].left + before[upperPane].width / 2),
                y: Math.round(lower.top + lower.height * 0.75),
              });
              await app.waitForCondition<boolean>(
                `(function () {
                  var r = document.querySelector(${JSON.stringify(
                    frame(upperPane),
                  )}).getBoundingClientRect();
                  return Math.abs(r.top - ${before[upperPane].top}) > 2;
                })()`,
                { timeoutMs: 5_000 },
              );
              expect(
                await splitFrameCount(app),
                "a drag inside the corridor reorders — it does not unpin",
              ).toBe(2);
              await settled(app);
              expect(
                await railOrderOnScreen(app),
                "the members traded places",
              ).toEqual([...orderBefore].reverse());
              const after = await railRects(app);
              // The members traded places…
              expect(
                after[LENS_PANE].top > after[JOTS_PANE].top,
              ).not.toBe(before[LENS_PANE].top > before[JOTS_PANE].top);
              // …and each kept its own height, because a weight is keyed by
              // the card rather than by the position. A height that moved with
              // the slot would be the positional-fractions bug.
              for (const paneId of [LENS_PANE, JOTS_PANE]) {
                expect(
                  Math.abs(after[paneId].height - before[paneId].height),
                  `${paneId} carried its height to its new place`,
                ).toBeLessThanOrEqual(EPSILON * 2);
              }
            }

            // ── 5. Churn: the arrangement outlives its members. ──
            {
              await flushSave(app);
              const beforeClose = railOnDisk(tugbankPath);
              const orderBefore = await railOrderOnScreen(app);
              // Closed outright, which is what the churn question is about.
              // (`toggle-jots` is the three-state shortcut — it hides only when
              // Jots already holds the keyboard, so it would have raised the
              // card here rather than closing it.)
              await app.evalJS<void>(
                `(window.__tug.closePane(${JSON.stringify(JOTS_PANE)}), null)`,
              );
              await app.waitForCondition<boolean>(
                `document.querySelectorAll('.tug-pane[data-lens="right"]').length === 1`,
                { timeoutMs: 8_000 },
              );
              await settled(app);
              const alone = await railRects(app);
              const survivor = alone[LENS_PANE];
              expect(
                Math.abs(survivor.top - GAP),
                "the survivor takes the whole run, top",
              ).toBeLessThanOrEqual(EPSILON);
              expect(
                Math.abs(survivor.bottom - (vp.h - GAP_BOTTOM)),
                "and bottom",
              ).toBeLessThanOrEqual(EPSILON);
              await flushSave(app);
              expect(
                railOnDisk(tugbankPath),
                "and the arrangement is untouched — a card closing may not destroy it",
              ).toEqual(beforeClose);

              // Reopened through the shortcut's "not showing → show" state.
              await app.dispatchControlAction("toggle-jots");
              await waitForSplitFrames(app, 2);
              const reopened = await railRects(app);
              const orderedAgain = Object.values(reopened).sort(
                (a, b) => a.top - b.top,
              );
              expect(
                Math.abs(
                  orderedAgain[1].top - orderedAgain[0].bottom - GAP,
                ),
                "the split re-applies, tiled as before",
              ).toBeLessThanOrEqual(EPSILON);
              expect(
                await railOrderOnScreen(app),
                "and at the order it had, not at a default",
              ).toEqual(orderBefore);
            }

            // ── The blob on disk carries the whole arrangement. ──
            await flushSave(app);
            const diskRail = railOnDisk(tugbankPath);
            expect(diskRail?.mode, "the mode reached disk").toBe("split");
            expect(diskRail?.order, "and so did the order").toEqual(
              await railOrderOnScreen(app),
            );
            expect(
              diskRail?.shares,
              "and the heights the seam drag set",
            ).toBeDefined();

            // ── 6. Stack again: today's behavior, restored exactly. ──
            //
            // Addressed by rail membership rather than by the seeded pane id:
            // Jots was closed and reopened above, so it stands in a NEW pane.
            {
              await app.nativeClickAtElement(
                `.tug-pane[data-rail-member="jots"] ${BADGE}`,
              );
              await waitForMenu(app, true);
              expect(
                await rowLabels(app),
                "a split rail offers the other two verbs",
              ).toContain("Equalize Heights");
              await clickMenuRow(app, "Stack");
              await waitForSplitFrames(app, 0);
              const restacked = Object.values(await railRects(app));
              expect(restacked.length, "both members still stand").toBe(2);
              const [a, b] = restacked;
              expect(
                Math.abs(a.top - b.top),
                "the members share a top edge again",
              ).toBeLessThanOrEqual(EPSILON);
              expect(
                Math.abs(a.height - b.height),
                "and a height — two frames the browser cannot tell apart",
              ).toBeLessThanOrEqual(EPSILON);
              expect(Math.abs(a.top - GAP)).toBeLessThanOrEqual(EPSILON);
              expect(
                Math.abs(a.bottom - (vp.h - GAP_BOTTOM)),
                "across the whole run, exactly as an unsplit rail",
              ).toBeLessThanOrEqual(EPSILON);
            }
          } finally {
            await app.close().catch(() => undefined);
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "the split picker reads top to bottom and checks the focused member",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0401-sidebar-split-picker",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({ state: deckShape(), focusCardId: "L" });
            await app.waitForCondition<boolean>(
              `document.querySelectorAll('.tug-pane[data-lens="right"]').length === 2`,
              { timeoutMs: 8_000 },
            );

            await app.dispatchControlAction("set-rail-mode", {
              side: "right",
              mode: "split",
            });
            await waitForSplitFrames(app, 2);

            // Every member of a split shows a badge: nothing is occluded, so
            // each is entitled to say where it stands.
            expect(
              await app.evalJS<number>(
                `document.querySelectorAll(${JSON.stringify(BADGE)}).length`,
              ),
              "both members show a badge in a split",
            ).toBe(2);

            // The check follows FOCUS, not depth — and saying so takes the door
            // that does not move focus. Clicking a badge activates its own pane
            // first (the button carries no `data-no-activate`), so opening
            // Jots' badge would make Jots the focused member and the assertion
            // would pass for the wrong reason. Cmd-clicking the title bar opens
            // the same picker WITHOUT raising the pane clicked, which is
            // exactly the state worth asserting: focus on one member, the
            // picker open on the other.
            await app.nativeClickAtElement(
              `${frame(LENS_PANE)} .tug-pane-title-bar`,
            );
            await app.waitForCondition<boolean>(
              `window.__tug.getActiveCardId() === "L"`,
              { timeoutMs: 5_000 },
            );
            await app.click(`${frame(JOTS_PANE)} .tug-pane-title-bar`, {
              metaKey: true,
            });
            await waitForMenu(app, true);
            expect(
              await app.evalJS<string | null>(
                `window.__tug.getActiveCardId()`,
              ),
              "the Cmd-click opened the picker without raising Jots",
            ).toBe("L");
            expect(
              await checkedRowPaneId(app),
              "the check marks the focused member, not the topmost one",
            ).toBe(LENS_PANE);

            // The rows read in rail order, top to bottom — the order the eye
            // reads the rail in.
            const railOrderPaneIds = await app.evalJS<string[]>(
              `Array.from(document.querySelectorAll('.tug-pane[data-rail-split]'))
                .sort(function (a, b) {
                  return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
                })
                .map(function (el) { return el.getAttribute("data-pane-id"); })`,
            );
            const rowPaneIds = await app.evalJS<string[]>(
              `Array.from(document.querySelectorAll(${JSON.stringify(ROW)}))
                .map(function (el) { return el.getAttribute("data-item-id"); })`,
            );
            expect(rowPaneIds, "rows list in rail order, top to bottom").toEqual(
              railOrderPaneIds,
            );
          } finally {
            await app.close().catch(() => undefined);
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
