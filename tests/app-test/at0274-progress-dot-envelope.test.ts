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
 * So this test seeks the real running animation and reads the dot back at
 * chosen instants:
 *
 *   - at the turn (30% of the cycle) the dot is at full size,
 *   - at the midpoint (50%) it has already begun sinking — which is only true
 *     if the legs are split; a symmetric breath peaks AT 50%,
 *   - the fall is still in progress at 70%, well above the trough.
 *
 * It also pins the weld: three animations run on the glyph (the dot's breath
 * plus the ring's radius and opacity, which are separate animations precisely
 * so they can carry different shapes), all on one duration.
 *
 * And it pins the two treatments. This is the only dot variant now, so one
 * component serves both a 10px status cell and a 28px Lens row — and it does
 * that by carrying two geometries, not by scaling one. The big one is the Lens
 * figure. The small one is the geometry of the glyph this variant replaced,
 * kept to the fraction, so that the surfaces adopting it (Z2 STATE, tool-call
 * headers, setup steps) get the new MOTION and no change of size at all.
 *
 * Both are asserted here, off the resolved matrix and the painted box rather
 * than off the custom properties — a variable that resolves but never reaches
 * the paint is exactly the failure this file exists to catch.
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
/** Opacity the ring is born at, and how hard its falloff is front-loaded. */
const BIRTH_OPACITY = 0.95;
const FADE_POWER = 1;
/** The pulse's stroke, as a multiple of the resting ring's. */
const PULSE_WEIGHT = 1.6;

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
/** The settled dot's scale in the quiet states (stopped / completed). */
const IDLE_DOT_SCALE = 0.85;

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
 * The pulse's stroke against the resting ring's, both as PAINTED px.
 *
 * Deliberately not asserted as a ratio equal to the weight. Borders quantize
 * to whole CSS px, so the weight is an intent the screen rounds: at a 32px
 * glyph the resting ring is 2px and a ×1.6 pulse paints 3px, a ratio of 1.5,
 * and at 20px both land on 1px and the ratio is 1. What must hold is that the
 * pulse is never LIGHTER than the ring it is compensating for.
 */
const strokes = `(function(){
  var glyph = document.querySelector(${JSON.stringify(GLYPH)});
  var ring = document.querySelector(${JSON.stringify(RING)});
  if (!glyph || !ring) return null;
  return {
    box: parseFloat(getComputedStyle(glyph).width),
    resting: parseFloat(getComputedStyle(glyph, "::after").borderTopWidth),
    pulse: parseFloat(getComputedStyle(ring).borderTopWidth),
    weight: getComputedStyle(glyph)
      .getPropertyValue("--tugx-progress-pulsing-dot-pulse-weight")
      .trim(),
  };
})()`;

/**
 * Every distinct pulse weight the card's running glyphs resolve to.
 *
 * This is the regression that motivated the knobs note in the stylesheet: the
 * defaults used to be DECLARED on the glyph, which beat anything the gallery
 * set on the indicator root one level up, so the whole weight bench rendered
 * at the shipped value — four identical dots under four different captions.
 * More than one value here means an override from outside actually lands.
 */
const distinctWeights = `(function(){
  var seen = {};
  Array.from(document.querySelectorAll(${JSON.stringify(GLYPH)})).forEach(
    function (g) {
      var w = getComputedStyle(g)
        .getPropertyValue("--tugx-progress-pulsing-dot-pulse-weight")
        .trim();
      seen[w || "(unset)"] = true;
    },
  );
  return Object.keys(seen).sort();
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

/**
 * The settled pose of the `completed` glyph whose box measures `px`, as painted.
 *
 * This is the parity probe. The small treatment is not "the big glyph scaled
 * down" — it is the geometry of the glyph this variant replaces, kept to the
 * fraction, so that adopting the new motion in a Z2 status cell or a tool-call
 * header changes the motion and nothing else. A settled marker in a row of type
 * has no business changing size because its animation was rewritten.
 *
 * `completed` is the right state to probe: it is where most small glyphs spend
 * most of their life, it is `quiet` (so it exercises the idle dot scale), and
 * it sits on the lowest rung of the PRESENCE ladder — which is exactly the
 * thing that must NOT apply down here.
 */
const settledPose = (px: number) => `(function(){
  var glyphs = Array.from(document.querySelectorAll(
    ${JSON.stringify(CARD)} + ' [data-slot="tug-progress-pulsing-dot"][data-state="completed"]'
  ));
  var g = glyphs.filter(function (el) {
    return Math.round(parseFloat(getComputedStyle(el).width)) === ${px};
  })[0];
  if (!g) return null;
  var dot = g.querySelector(".tug-progress-pulsing-dot-dot");
  var after = getComputedStyle(g, "::after");
  return {
    // The dot's painted diameter: its box times the scale the component seeds
    // inline for the static pose.
    dot:
      parseFloat(getComputedStyle(dot).width) *
      new DOMMatrixReadOnly(getComputedStyle(dot).transform).a,
    ring: parseFloat(after.width),
    border: parseFloat(after.borderTopWidth),
  };
})()`;

/**
 * The period every running glyph on the card resolved to, grouped by the
 * indicator that owns it.
 *
 * The period carries a small random jitter so that a column of them pulls apart
 * over time instead of beating as one mechanism. That randomness belongs to the
 * ITEM — one session in the Lens against the next — and emphatically not to the
 * glyph, because a single indicator can render two glyphs for one status
 * (`glyphPosition="both"` puts one either side of the label). Drawn per glyph,
 * those two slid out of phase against each other inside a single Z2 STATE cell,
 * which does not read as organic; it reads as a bug.
 *
 * So: within an indicator, every glyph shares one period. Across indicators,
 * the periods differ.
 */
const driftCensus = `(function(){
  var pairs = [];
  var seen = {};
  Array.from(
    document.querySelectorAll(${JSON.stringify(CARD)} + " .tug-progress-indicator")
  ).forEach(function (ind) {
    var dots = Array.from(ind.querySelectorAll(
      '[data-slot="tug-progress-pulsing-dot"][data-state="running"] .tug-progress-pulsing-dot-dot'
    ));
    if (dots.length === 0) return;
    var periods = dots.map(function (d) {
      return getComputedStyle(d).animationDuration;
    });
    periods.forEach(function (p) { seen[p] = true; });
    if (periods.length > 1) pairs.push(periods);
  });
  return { pairs: pairs, distinct: Object.keys(seen) };
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
        // opacity as separate animations.
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

        // At the midpoint it is already sinking. This is the assertion that
        // fails if the envelope silently reverts to symmetric — a 50/50 breath
        // peaks here instead.
        const atMid = await app.evalJS<number>(scaleAt(0.5));
        expect(atMid).toBeLessThan(atTurn);
        expect(atMid).toBeGreaterThan(0.85);

        // Still falling at 70%, and still well clear of the 0.35 trough: the
        // exhale spends the whole back of the cycle getting there.
        const atLate = await app.evalJS<number>(scaleAt(0.7));
        expect(atLate).toBeLessThan(atMid);
        expect(atLate).toBeGreaterThan(0.45);

        // The rise is the quick leg. Measured as ground covered per unit of
        // cycle, not per sample: the two legs are different lengths, which is
        // the whole point, so only the rates are comparable.
        const atMidRise = await app.evalJS<number>(scaleAt(TURN / 2));
        const riseRate = (atMidRise - 0.35) / (TURN / 2);
        const fallRate = (atTurn - atLate) / (0.7 - TURN);
        expect(riseRate).toBeGreaterThan(fallRate * 1.5);

        // --- The ring the breath sheds ---------------------------------

        const ignition = TURN - ADVANCE;

        // Dark through the inhale: the ring exists the whole cycle, parked at
        // the dot's edge, and is only lit at ignition.
        expect(await app.evalJS<number>(ringOpacityAt(ignition - 0.05))).toBe(0);

        // Born near-solid. Anything much under this and the pulse reads as
        // already fading before it existed.
        const atIgnition = await app.evalJS<number>(ringOpacityAt(ignition));
        expect(atIgnition).toBeCloseTo(BIRTH_OPACITY, 2);

        // A third of the way through the ring's life it has lost a third of
        // its strength — the fall is even, so opacity tracks distance.
        const third = ignition + (1 - ignition) / 3;
        const atThird = await app.evalJS<number>(ringOpacityAt(third));
        expect(atThird).toBeCloseTo(BIRTH_OPACITY * (2 / 3) ** FADE_POWER, 2);

        // Gone by the end of the cycle, so the pulse never wraps into the next
        // one.
        expect(await app.evalJS<number>(ringOpacityAt(1))).toBeCloseTo(0, 3);

        const stroke = await app.evalJS<{
          box: number;
          resting: number;
          pulse: number;
          weight: string;
        }>(strokes);

        // An un-overridden glyph declares NO weight of its own — the shipped
        // value is a `var()` fallback. That is the whole reason an override
        // from an ancestor can win, so the empty read is the assertion, not a
        // gap in one.
        expect(stroke.weight).toBe("");

        // The fallback is nonetheless in force, in painted pixels: the resting
        // ring is `max(1px, box/16)` and the pulse is that times the weight,
        // each floored to whole CSS px by the engine. At a 20px glyph that is
        // 1px against 2px — which ×1.15 could not produce, since 1.25 × 1.15
        // floors back to the same 1px the resting ring gets.
        const restingExact = Math.max(1, stroke.box / 16);
        expect(stroke.resting).toBe(Math.floor(restingExact));
        expect(stroke.pulse).toBe(Math.floor(restingExact * PULSE_WEIGHT));

        // …and an override from outside the glyph reaches it. The gallery's
        // weight bench sets the variable on each indicator root; if the glyph
        // declared its own default again, every cell would collapse back to
        // the shipped value and this would see only the unset case.
        const weights = await app.evalJS<string[]>(distinctWeights);
        expect(weights.length).toBeGreaterThan(1);
        expect(weights).toContain("(unset)");
        expect(weights).toContain(String(PULSE_WEIGHT));

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
        expect(Number(small.reach)).toBeCloseTo(SMALL_REACH, 2);
        expect(small.ringEndScale).toBeCloseTo(SMALL_REACH, 2);
        expect(Number(small.trough)).toBeCloseTo(SMALL_TROUGH, 3);
        expect(Number(small.trough)).toBeGreaterThan(TROUGH_RATIO);

        // --- Parity: the small treatment IS the previous glyph -----------

        type Pose = { dot: number; ring: number; border: number };

        // The contract for every small call site — a Z2 status cell, a
        // tool-call header, a setup step. Those surfaces are adopting a new
        // ANIMATION; their settled pose must not move a pixel. So these are
        // asserted against the old glyph's formulas written out literally
        // (`size / 2`, the full box, a hairline) rather than against anything
        // this component derives, which is the only way the check can catch a
        // drift in the derivation itself.
        for (const px of [12, 14, 16]) {
          const pose = await app.evalJS<Pose>(settledPose(px));
          expect(pose).not.toBeNull();
          expect(pose.dot).toBeCloseTo((px / 2) * IDLE_DOT_SCALE, 1);
          expect(pose.ring).toBeCloseTo(px, 1);
          expect(pose.border).toBe(1);
        }

        // …and the ladder is still there at the top, where the pixels to read
        // it exist. Same state, drawn in to its rung — the Lens behavior this
        // whole variant was built for.
        const bigPose = await app.evalJS<Pose>(settledPose(BIG_SIZE));
        expect(bigPose.ring).toBeLessThan(BIG_SIZE * 0.75);

        // --- The jitter separates items, not glyphs --------------------

        const drift = await app.evalJS<{
          pairs: string[][];
          distinct: string[];
        }>(driftCensus);

        // The card renders at least one paired indicator (`glyphPosition`
        // defaults to "both" in the Layout demo), and both of its glyphs run
        // the same period. Two dots that are one status must not slide apart.
        expect(drift.pairs.length).toBeGreaterThan(0);
        for (const periods of drift.pairs) {
          expect(new Set(periods).size).toBe(1);
        }

        // The jitter is still doing its job between separate indicators —
        // otherwise this would pass by having removed the randomness outright.
        expect(drift.distinct.length).toBeGreaterThan(1);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
