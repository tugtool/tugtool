/**
 * AT0274 — the pulsing-dot's breath envelope is asymmetric, and the ring
 * is welded to its turn.
 *
 * The glyph's timing carries no shape in its keyframes: each `@keyframes` block
 * is two stops, and the whole curve lives in `linear()` easings held in custom
 * properties. That makes the curve tunable from anywhere in the cascade — and
 * it makes it silently losable, since a stylesheet that fails to resolve one of
 * those variables still animates, just linearly and symmetrically. Nothing
 * about the DOM would look wrong.
 *
 * So this test seeks the real running animation and reads it back at chosen
 * instants: the dot's breath (peak at the turn, already sinking at the
 * midpoint), the ring it sheds (dark through the inhale, near-solid at
 * ignition, gone by the end of the cycle, its stroke opening from a hairline as
 * it travels), and the two geometries one component serves — a 12px status cell
 * and a 32px Lens row.
 *
 * The gallery card is just a convenient host for a running glyph at a known
 * size; the behavior under test is the component's, not the gallery's.
 *
 * @covers tugdeck/src/components/tugways/internal/tug-progress-pulsing-dot.tsx
 * @covers tugdeck/src/components/tugways/internal/tug-progress-pulsing-dot.css
 * @covers tugdeck/src/components/tugways/cards/gallery-tug-progress-indicator.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-card-id="A"]';
const GLYPH = `${CARD} [data-slot="tug-progress-pulsing-dot"][data-state="running"]`;
const DOT = `${GLYPH} .tug-progress-pulsing-dot-dot`;
const RING = `${GLYPH} .tug-progress-pulsing-dot-ring`;

/** The turn of the shipped envelope, as a fraction of the cycle. */
const TURN = 0.3;
/** The ring is lit this far ahead of the turn — the ignition advance. */
const ADVANCE = 0.03;
/** Opacity the ring is born at. */
const BIRTH_OPACITY = 0.95;

/** The big treatment's dot ratio; the small treatment keeps the old 0.5. */
const DOT_RATIO = 0.6;
const SMALL_DOT_RATIO = 0.5;
/** The authored trough, before the small-size floor raises it. */
const TROUGH_RATIO = 0.35;
/** The small treatment's trough — a shallow modulation, not a full breath. */
const SMALL_TROUGH = 0.7;

/** A size in the big treatment — every size derivation inert here. */
const BIG_SIZE = 32;
/** A size in the small treatment, where the previous glyph's geometry holds. */
const SMALL_SIZE = 12;
/** How far past the box the ring is let out at {@link SMALL_SIZE} and under. */
const SMALL_REACH = 1.75;

/**
 * Seek every animation on the glyph to `fraction` of the cycle and report the
 * dot's scale there, as a fraction of its box.
 *
 * The seek pauses first: a running animation would advance between the write
 * and the read. `getComputedStyle` on the transform returns a resolved matrix,
 * and the breath is a uniform scale sitting on top of the -50%/-50% centering
 * translate — which lands in the matrix's translation components, not its
 * scale ones — so component `a` IS the scale.
 */
const scaleAt = (fraction: number) => `(function(){
  var glyph = document.querySelector(${JSON.stringify(GLYPH)});
  var dot = document.querySelector(${JSON.stringify(DOT)});
  if (!glyph || !dot) return -1;
  var anims = glyph.getAnimations({ subtree: true });
  if (anims.length === 0) return -2;
  var duration = anims[0].effect.getTiming().duration;
  anims.forEach(function (a) { a.pause(); a.currentTime = duration * ${fraction}; });
  var m = new DOMMatrixReadOnly(getComputedStyle(dot).transform);
  return m.a;
})()`;

/**
 * Seek as above and report the emitted ring's opacity — the pulse's strength
 * at that instant in the cycle.
 */
const ringOpacityAt = (fraction: number) => `(function(){
  var glyph = document.querySelector(${JSON.stringify(GLYPH)});
  var ring = document.querySelector(${JSON.stringify(RING)});
  if (!glyph || !ring) return -1;
  var anims = glyph.getAnimations({ subtree: true });
  if (anims.length === 0) return -2;
  var duration = anims[0].effect.getTiming().duration;
  anims.forEach(function (a) { a.pause(); a.currentTime = duration * ${fraction}; });
  return parseFloat(getComputedStyle(ring).opacity);
})()`;

/**
 * Seek as above and report the pulse's stroke, both as declared and as it lands
 * on the screen.
 *
 * The ring expands by `transform: scale`, and a border on a scaled element
 * paints at border × scale — so one declared width is a hairline at the ring's
 * birth radius and opens as it travels. `apparent` is what the eye gets;
 * `border` is the single declared width, which does not change.
 */
const ringStrokeAt = (fraction: number) => `(function(){
  var glyph = document.querySelector(${JSON.stringify(GLYPH)});
  var ring = document.querySelector(${JSON.stringify(RING)});
  if (!glyph || !ring) return null;
  var anims = glyph.getAnimations({ subtree: true });
  if (anims.length === 0) return null;
  var duration = anims[0].effect.getTiming().duration;
  anims.forEach(function (a) { a.pause(); a.currentTime = duration * ${fraction}; });
  var cs = getComputedStyle(ring);
  var border = parseFloat(cs.borderTopWidth);
  return {
    border: border,
    apparent: border * new DOMMatrixReadOnly(cs.transform).a,
  };
})()`;

/**
 * The size-derived geometry of the running glyph whose box measures `px`,
 * read off the element AND off the paint.
 *
 * The glyph is one variant serving every size from a 10px status cell to a
 * 32px Lens row, and two of its numbers cannot be constant across that range:
 * how far the ring travels, and how deep the breath goes. Both are ratios
 * against a box, and both stop working when the box gets small — inside a 12px
 * glyph the ring's whole journey is ~2.5px of radius. So the component derives
 * them from the size and publishes them as `-auto` variables.
 *
 * Seeking to the end of the cycle puts the expand easing at 1, which is exactly
 * the ring's terminal scale — so `ringEndScale` is the reach as PAINTED, not
 * merely as declared. A hair short of the end, though: these loops are
 * infinite, and `currentTime = duration` is the first frame of the NEXT
 * iteration, which reads back the ring's birth radius instead.
 */
const geometryAtSize = (px: number) => `(function(){
  var glyphs = Array.from(document.querySelectorAll(${JSON.stringify(GLYPH)}));
  var g = glyphs.filter(function (el) {
    return Math.round(parseFloat(getComputedStyle(el).width)) === ${px};
  })[0];
  if (!g) return null;
  var ring = g.querySelector(".tug-progress-pulsing-dot-ring");
  var anims = g.getAnimations({ subtree: true });
  if (anims.length === 0 || !ring) return null;
  var duration = anims[0].effect.getTiming().duration;
  anims.forEach(function (a) { a.pause(); a.currentTime = duration * 0.999; });
  var cs = getComputedStyle(g);
  var dot = g.querySelector(".tug-progress-pulsing-dot-dot");
  return {
    reach: cs.getPropertyValue("--tugx-progress-pulsing-dot-emit-reach-auto").trim(),
    trough: cs.getPropertyValue("--tugx-progress-pulsing-dot-dot-scale-min-auto").trim(),
    dotBox: parseFloat(getComputedStyle(dot).width),
    ringEndScale: new DOMMatrixReadOnly(getComputedStyle(ring).transform).a,
  };
})()`;

/** Names + durations of every animation the running glyph is carrying. */
const animationCensus = `(function(){
  var glyph = document.querySelector(${JSON.stringify(GLYPH)});
  if (!glyph) return null;
  var anims = glyph.getAnimations({ subtree: true });
  return {
    names: anims.map(function (a) { return a.animationName; }).sort(),
    durations: Array.from(new Set(anims.map(function (a) {
      return a.effect.getTiming().duration;
    }))),
  };
})()`;

describe.skipIf(!SHOULD_RUN)("AT0274: pulsing-dot breath envelope", () => {
  test(
    "the dot peaks at the turn, not the midpoint, and the ring rides the same clock",
    async () => {
      const app = await launchTugApp({ testName: "at0274-progress-dot-envelope" });
      try {
        await app.seedDeckState({
          state: {
            cards: [
              {
                id: "A",
                componentId: "gallery-tug-progress-indicator",
                title: "TugProgressIndicator",
                closable: true,
              },
            ],
            panes: [
              {
                id: "p1",
                position: { x: 40, y: 40 },
                size: { width: 720, height: 620 },
                cardIds: ["A"],
                activeCardId: "A",
                title: "",
                acceptsFamilies: ["maker"],
              },
            ],
            activePaneId: "p1",
            hasFocus: true,
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DOT)}) !== null`,
          { timeoutMs: 6000 },
        );
        // The glyph animates on mount; wait for the effects to exist before
        // seeking any of them.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(GLYPH)}).getAnimations({ subtree: true }).length > 0`,
          { timeoutMs: 6000 },
        );

        // Three loops, one clock: the dot's breath, plus the ring's radius and
        // opacity as separate animations — separate because their shapes
        // differ, welded because their duration does not. The stroke is not a
        // fourth: it opens as a consequence of the radius, since a border on a
        // scaled element paints at border × scale.
        const census = await app.evalJS<{
          names: string[];
          durations: number[];
        }>(animationCensus);
        expect(census.names).toEqual([
          "tugx-progress-pulsing-dot-breathe",
          "tugx-progress-pulsing-dot-emit-expand",
          "tugx-progress-pulsing-dot-emit-fade",
        ]);
        expect(census.durations).toHaveLength(1);

        // At the turn the dot is at full size. Loose tolerance: the easing is a
        // sampled `linear()`, so the peak stop is exact but the read is off a
        // resolved matrix.
        const atTurn = await app.evalJS<number>(scaleAt(TURN));
        expect(atTurn).toBeGreaterThan(0.99);
        expect(atTurn).toBeLessThanOrEqual(1.001);

        // At the midpoint it is already sinking, and it is still sinking at
        // 70%. This is the assertion that fails if the envelope silently
        // reverts to symmetric — a 50/50 breath peaks at the midpoint instead.
        const atMid = await app.evalJS<number>(scaleAt(0.5));
        expect(atMid).toBeLessThan(atTurn);
        const atLate = await app.evalJS<number>(scaleAt(0.7));
        expect(atLate).toBeLessThan(atMid);
        expect(atLate).toBeGreaterThan(0.45);

        // --- The ring the breath sheds ---------------------------------

        const ignition = TURN - ADVANCE;

        // Dark through the inhale: the ring exists the whole cycle, parked at
        // the dot's edge, and is only lit at ignition. Born near-solid —
        // anything much under that and the pulse reads as already fading
        // before it existed — and gone by the end of the cycle, so it never
        // wraps into the next one.
        expect(await app.evalJS<number>(ringOpacityAt(ignition - 0.05))).toBe(0);
        expect(await app.evalJS<number>(ringOpacityAt(ignition))).toBeCloseTo(
          BIRTH_OPACITY,
          2,
        );
        expect(await app.evalJS<number>(ringOpacityAt(1))).toBeCloseTo(0, 3);

        // The stroke is a hairline where the ring is born and opens as it
        // travels — sharp where it is brightest and closest to the dot's edge,
        // soft by the time it is leaving. It is ONE declared width doing that,
        // because the ring is scaled and a border paints at border × scale, so
        // the declared width is constant across the flight and only the
        // apparent one grows. Asserted loosely at the birth end, since borders
        // resolve to device pixels.
        type Stroke = { border: number; apparent: number };
        const born = await app.evalJS<Stroke>(ringStrokeAt(ignition));
        expect(born.apparent).toBeGreaterThan(0.4);
        expect(born.apparent).toBeLessThan(1.25);

        const midFlight = await app.evalJS<Stroke>(ringStrokeAt(0.5));
        expect(midFlight.border).toBeCloseTo(born.border, 3);
        expect(midFlight.apparent).toBeGreaterThan(born.apparent);

        const leaving = await app.evalJS<Stroke>(ringStrokeAt(0.999));
        expect(leaving.apparent).toBeGreaterThan(born.apparent * 1.4);

        // --- One variant, every size ------------------------------------

        type Geometry = {
          reach: string;
          trough: string;
          dotBox: number;
          ringEndScale: number;
        };

        // In the big treatment every derivation is inert: the dot takes 0.6 of
        // the box, the ring stops at the box edge so the glyph is layout-safe,
        // and the trough floor never binds (0.35 of a 19.2px dot is 6.7px).
        const big = await app.evalJS<Geometry>(geometryAtSize(BIG_SIZE));
        expect(big.dotBox).toBeCloseTo(BIG_SIZE * DOT_RATIO, 1);
        expect(Number(big.reach)).toBe(1);
        expect(big.ringEndScale).toBeCloseTo(1, 2);
        expect(Number(big.trough)).toBeCloseTo(TROUGH_RATIO, 3);

        // In the small treatment the dot drops to the previous glyph's ratio,
        // the ring is let out past the box — asserted on the resolved matrix,
        // so this is the scale it is actually painted at, not the variable's
        // value — and the breath narrows to a shallow modulation, since a dot
        // this size cannot spend half its diameter on every cycle.
        const small = await app.evalJS<Geometry>(geometryAtSize(SMALL_SIZE));
        expect(small.dotBox).toBeCloseTo(SMALL_SIZE * SMALL_DOT_RATIO, 1);
        expect(small.ringEndScale).toBeCloseTo(SMALL_REACH, 2);
        expect(Number(small.trough)).toBeCloseTo(SMALL_TROUGH, 3);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
