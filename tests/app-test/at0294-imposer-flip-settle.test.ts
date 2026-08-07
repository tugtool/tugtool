/**
 * at0294-imposer-flip-settle.test.ts — the imposer settles by FLIP, and leaves
 * nothing behind.
 *
 * An arrangement change moves every derived frame at once. The motion is no
 * longer a transition on `left`/`top`/`width` — that re-runs layout for every
 * moving frame on every frame of the motion — but FLIP: the new geometry is
 * committed in one layout pass and each moved frame is tweened by a transform
 * that starts at the inverse of the move and ends at nothing
 * (`deck-canvas.tsx`, `lib/pane-flip.ts`).
 *
 * Three things have to hold, and the third is the one with teeth.
 *
 * The motion must be transform-only, or it is not the cheap kind: a keyframe
 * touching a layout property puts the effect back on the main thread and the
 * whole point is lost (`roadmap/jul30-perf-brief.md#i1-sparkline-exception`).
 *
 * The frames must land where the imposer says, which is hand-computable from
 * `imposeRect`'s rule: the band is the span inset by a gap at each end, and a
 * slot sits `slot / (count - 1)` of the way along whatever the band has left
 * over after the pane's own width.
 *
 * And no frame may keep an inline `transform` afterwards. TugAnimator commits
 * an animation's final value into `el.style` when it completes — whatever
 * `fill` says — and React never clears it, because `transform` is not a key
 * TugPane renders. A frame wearing any transform is a containing block for its
 * `position: fixed` descendants, and TugSheet portals into the frame while
 * completion popups, alerts, and banners all position from viewport
 * coordinates. The residue would offset all of them by the pane's origin, and
 * only after the FIRST arrangement change — so this test asserts the inline
 * style directly (the computed value of an untransformed element is `none`,
 * which would pass vacuously), asserts it again after a SECOND settle, and
 * then measures the consequence: a fixed-position probe planted inside a frame
 * must resolve against the viewport, not against the pane.
 *
 * A slot assignment carries a fourth rule. It raises the card it slots, and
 * the raise is a precondition of the motion rather than its epilogue — a frame
 * that rose only at the end would spend the whole crossing underneath the
 * panes it is on its way to sitting in front of. The converse is asserted too:
 * z-order moves nothing, so a bare raise must arm no settle window.
 *
 * Scenario:
 *   1. Seed a two-up deck with a pinned Lens on the right.
 *   2. Flip the Lens to the left. Mid-window: the container wears
 *      `data-imposer-settling` and every animation on a frame is transform-only.
 *   3. After land: no animations, no attribute, no inline transform, and the
 *      frames sit where `imposeRect` says.
 *   4. Flip back. Assert the no-residue rule a second time, then plant the
 *      fixed-position probe.
 *   5. A slot assignment: the frame is already on top when its tween starts,
 *      and a bare pane raise arms no window at all.
 *   6. Retarget: a second change dispatched inside the first one's window.
 *      Tweens are replaced, not stacked, and the final geometry is still right.
 *
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 * @covers tugdeck/src/components/tugways/tug-pane.css
 * @covers tugdeck/src/lib/pane-flip.ts
 * @covers tugdeck/src/lib/layout-imposer.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** The imposition gaps (`lib/layout-imposer.ts`). */
const GAP = 5;
const LENS_WIDTH = 300;
const PANE_WIDTH = 420;
/** The settle window (`IMPOSITION_SETTLE_MS`), with room for the tween to land. */
const SETTLE_MS = 300;
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

/** Every animation currently running on a pane frame, with its keyframes'
 *  property names — the census the transform-only rule is read from. */
interface FrameAnimation {
  paneId: string;
  properties: string[];
}

async function frameAnimations(app: App): Promise<FrameAnimation[]> {
  return app.evalJS<FrameAnimation[]>(
    `document.getAnimations()
      .map(function (a) {
        var target = a.effect && a.effect.target;
        if (!target || !target.classList || !target.classList.contains("tug-pane")) return null;
        var props = {};
        (a.effect.getKeyframes() || []).forEach(function (kf) {
          Object.keys(kf).forEach(function (k) { props[k] = true; });
        });
        return {
          paneId: target.getAttribute("data-pane-id") || "",
          properties: Object.keys(props).sort(),
        };
      })
      .filter(function (x) { return x !== null; })`,
  );
}

/** The inline (not computed) `transform` of every frame, by pane id. */
async function inlineTransforms(app: App): Promise<Record<string, string>> {
  return app.evalJS<Record<string, string>>(
    `Array.from(document.querySelectorAll(${JSON.stringify(FRAMES)}))
      .reduce(function (out, el) {
        out[el.getAttribute("data-pane-id")] = el.style.transform || "";
        return out;
      }, {})`,
  );
}

async function settling(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.querySelector("[data-imposer-settling]") !== null`,
  );
}

async function setLensSide(app: App, side: "left" | "right"): Promise<void> {
  await app.evalJS<null>(
    `(window.__tug.dispatchControlAction("set-sidebar-side", { componentId: "lens", side: ${JSON.stringify(
      side,
    )} }), null)`,
  );
}

async function setImposition(app: App, kind: string): Promise<void> {
  await app.evalJS<null>(
    `(window.__tug.dispatchControlAction("set-imposition", { kind: ${JSON.stringify(
      kind,
    )} }), null)`,
  );
}

async function viewportWidth(app: App): Promise<number> {
  return app.evalJS<number>(`window.innerWidth`);
}

/**
 * Where `imposeRect` puts a slot's left edge, hand-computed: the span is the
 * canvas minus the Lens's side, the band is the span inset by a gap at each
 * end, and the slot rides `slot / (count - 1)` of the leftover travel.
 *
 * `lensWidth` is MEASURED rather than taken from the seed, and re-measured at
 * each assertion rather than once at rest. A pane renders at its stored width
 * raised to its stack's size floor, and an arrangement change re-runs the space
 * allocator, which may hand the Lens a different width than the one seeded here
 * — so neither the seeded number nor an earlier reading is the number the band
 * is inset by. The slot arithmetic is what this checks; the width the Lens
 * arrives at is `at0303`'s business, and the floor is `at0284`'s.
 */
function expectedLeft(
  slot: number,
  count: number,
  viewport: number,
  lensSide: "left" | "right",
  lensWidth: number,
): number {
  const inset = lensWidth + GAP;
  const spanX = lensSide === "left" ? inset : 0;
  const spanWidth = viewport - inset;
  const band = spanWidth - GAP * 2;
  const travel = Math.max(0, band - PANE_WIDTH);
  const fraction = count < 2 ? 0.5 : slot / (count - 1);
  return spanX + GAP + fraction * travel;
}

async function lensWidth(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector('.tug-pane[data-pane-id="pLens"]').getBoundingClientRect().width`,
  );
}

/** The resolved stacking order of a frame — the number `deck-canvas` derives
 *  from the pane's place in the store array. */
async function frameZIndex(app: App, paneId: string): Promise<number> {
  return app.evalJS<number>(
    `Number(getComputedStyle(document.querySelector('.tug-pane[data-pane-id="${paneId}"]')).zIndex)`,
  );
}

async function frameLeft(app: App, paneId: string): Promise<number> {
  return app.evalJS<number>(
    `document.querySelector('.tug-pane[data-pane-id="${paneId}"]').getBoundingClientRect().left`,
  );
}

const wait = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!SHOULD_RUN)(
  "at0294 — the imposer settles by transform-only FLIP and leaves no residue",
  () => {
    test(
      "transform-only mid-window, correct geometry at land, and no inline transform after two settles",
      async () => {
        const app = await launchTugApp({
          testName: "at0294-imposer-flip-settle",
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(FRAMES)}).length === 3`,
            { timeoutMs: 5_000 },
          );
          await wait(AFTER_LAND_MS);

          const vp = await viewportWidth(app);

          // --- Settle one: the Lens crosses to the left. -------------------
          await setLensSide(app, "left");

          // Mid-window. The container marks the gesture, and every animation
          // running on a frame touches transform and nothing else — a single
          // layout property in this census is the whole regression.
          await app.waitForCondition<boolean>(
            `document.querySelector("[data-imposer-settling]") !== null`,
            { timeoutMs: 2_000 },
          );
          {
            const census = await frameAnimations(app);
            expect(census.length).toBeGreaterThan(0);
            for (const anim of census) {
              expect(anim.properties.filter((p) => p !== "offset" &&
                p !== "computedOffset" && p !== "easing" && p !== "composite"))
                .toEqual(["transform"]);
            }
          }

          // --- After land. -------------------------------------------------
          await wait(AFTER_LAND_MS);
          expect(await settling(app)).toBe(false);
          expect(await frameAnimations(app)).toEqual([]);

          // The residue rule, read off the INLINE style. A frame that never
          // wore a transform computes to `none`, so the computed value would
          // pass here whatever happened.
          {
            const inline = await inlineTransforms(app);
            expect(Object.values(inline).every((v) => v === "")).toBe(true);
          }

          // And the frames are where the imposer says, not a tween's length
          // short of it.
          {
            const lens = await lensWidth(app);
            expect(await frameLeft(app, "p1")).toBeCloseTo(
              expectedLeft(0, 2, vp, "left", lens),
              0,
            );
            expect(await frameLeft(app, "p2")).toBeCloseTo(
              expectedLeft(1, 2, vp, "left", lens),
              0,
            );
          }

          // --- Settle two: back to the right. ------------------------------
          // The residue only appears after a settle has completed, so a
          // first-gesture-only test would miss a clear that runs once.
          await setLensSide(app, "right");
          await wait(AFTER_LAND_MS);
          {
            const inline = await inlineTransforms(app);
            expect(Object.values(inline).every((v) => v === "")).toBe(true);
          }
          expect(await frameLeft(app, "p1")).toBeCloseTo(
            expectedLeft(0, 2, vp, "right", await lensWidth(app)),
            0,
          );

          // The consequence the residue would actually cause: a frame wearing
          // a transform becomes the containing block for its fixed-position
          // descendants — which is what TugSheet portals into and what every
          // popup positions against. The probe resolves at the viewport
          // origin only if the frame is not one.
          {
            const probeOrigin = await app.evalJS<{ x: number; y: number }>(
              `(function () {
                var frame = document.querySelector('.tug-pane[data-pane-id="p2"]');
                var probe = document.createElement("div");
                probe.style.position = "fixed";
                probe.style.left = "0px";
                probe.style.top = "0px";
                probe.style.width = "1px";
                probe.style.height = "1px";
                frame.appendChild(probe);
                var r = probe.getBoundingClientRect();
                probe.remove();
                return { x: r.left, y: r.top };
              })()`,
            );
            expect(probeOrigin.x).toBeCloseTo(0, 0);
            expect(probeOrigin.y).toBeCloseTo(0, 0);
          }
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "assigning a slot raises the frame before it starts crossing, and a bare raise arms nothing",
      async () => {
        const app = await launchTugApp({
          testName: "at0294-imposer-flip-raise",
        });
        try {
          // Focus B, so p2 is the frame on top and a raise of p1 is
          // observable: without one, A crosses to p2's slot underneath it.
          await app.seedDeckState({ state: deckShape(), focusCardId: "B" });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(FRAMES)}).length === 3`,
            { timeoutMs: 5_000 },
          );
          await wait(AFTER_LAND_MS);
          const vp = await viewportWidth(app);
          const lens = await lensWidth(app);
          expect(await frameZIndex(app, "p1")).toBeLessThan(
            await frameZIndex(app, "p2"),
          );

          // A bare raise reorders the panes array and moves no frame, so it
          // must arm no settle window — one would hold every session card's
          // notifications for the length of a motion that never happens.
          // Raised and lowered again, so the assignment below still has a
          // raise to make.
          for (const paneId of ["p1", "p2"]) {
            await app.evalJS<null>(
              `(window.__tug.dispatchControlAction("focus-pane", { paneId: ${JSON.stringify(
                paneId,
              )} }), null)`,
            );
            await wait(120);
            expect(await settling(app)).toBe(false);
            expect(await frameAnimations(app)).toEqual([]);
          }
          expect(await frameZIndex(app, "p1")).toBeLessThan(
            await frameZIndex(app, "p2"),
          );

          // Now the gesture the Lens's slot picker dispatches: put A at the
          // slot B already holds. A moves, so it tweens — and by the time it
          // does, it is already the frame on top.
          await app.evalJS<null>(
            `(window.__tug.dispatchControlAction("assign-slot", { cardId: "A", slot: 1 }), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector("[data-imposer-settling]") !== null`,
            { timeoutMs: 2_000 },
          );
          {
            const census = await frameAnimations(app);
            expect(census.map((a) => a.paneId)).toContain("p1");
            expect(await frameZIndex(app, "p1")).toBeGreaterThan(
              await frameZIndex(app, "p2"),
            );
          }

          await wait(AFTER_LAND_MS);
          expect(await settling(app)).toBe(false);
          expect(await frameLeft(app, "p1")).toBeCloseTo(
            expectedLeft(1, 2, vp, "right", lens),
            0,
          );
          expect(await frameZIndex(app, "p1")).toBeGreaterThan(
            await frameZIndex(app, "p2"),
          );
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "a second arrangement change inside the window replaces the tweens rather than stacking them",
      async () => {
        const app = await launchTugApp({
          testName: "at0294-imposer-flip-retarget",
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(FRAMES)}).length === 3`,
            { timeoutMs: 5_000 },
          );
          await wait(AFTER_LAND_MS);
          const vp = await viewportWidth(app);

          // Two changes inside one window. The second measures each frame's
          // live visual rect — which includes the running tween's transform —
          // so the new motion starts where the eye is.
          await setLensSide(app, "left");
          await wait(Math.floor(SETTLE_MS / 3));
          await setImposition(app, "one-up");

          // At most one tween per frame at any moment: a stacked pair would
          // show the same pane id twice.
          {
            const census = await frameAnimations(app);
            const ids = census.map((a) => a.paneId);
            expect(new Set(ids).size).toBe(ids.length);
          }

          await wait(AFTER_LAND_MS);
          expect(await settling(app)).toBe(false);
          expect(await frameAnimations(app)).toEqual([]);
          {
            const inline = await inlineTransforms(app);
            expect(Object.values(inline).every((v) => v === "")).toBe(true);
          }

          // One-up puts every imposed frame at the same centred place, and the
          // Lens now holds the left — so the retarget landed on the arrangement
          // the LAST change asked for, not the first.
          const centred = expectedLeft(0, 1, vp, "left", await lensWidth(app));
          expect(await frameLeft(app, "p1")).toBeCloseTo(centred, 0);
          expect(await frameLeft(app, "p2")).toBeCloseTo(centred, 0);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
