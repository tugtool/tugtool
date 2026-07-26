/**
 * AT0274 — the large-pulsing-dot's breath envelope is asymmetric, and the ring
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
 * The gallery card is just a convenient host for a running glyph at a known
 * size; the behavior under test is the component's, not the gallery's.
 *
 * @covers tugdeck/src/components/tugways/internal/tug-progress-large-pulsing-dot.tsx
 * @covers tugdeck/src/components/tugways/internal/tug-progress-large-pulsing-dot.css
 * @covers tugdeck/src/components/tugways/cards/gallery-tug-progress-indicator.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-card-id="A"]';
const GLYPH = `${CARD} [data-slot="tug-progress-large-pulsing-dot"][data-state="running"]`;
const DOT = `${GLYPH} .tug-progress-large-pulsing-dot-dot`;
const RING = `${GLYPH} .tug-progress-large-pulsing-dot-ring`;

/** The turn of the shipped envelope, as a fraction of the cycle. */
const TURN = 0.3;
/** The ring is lit this far ahead of the turn — the ignition advance. */
const ADVANCE = 0.03;
/** Opacity the ring is born at, and how hard its falloff is front-loaded. */
const BIRTH_OPACITY = 0.95;
const FADE_POWER = 1;
/** The pulse's stroke, as a multiple of the resting ring's. */
const PULSE_WEIGHT = 1.6;

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
      .getPropertyValue("--tugx-progress-large-pulsing-dot-pulse-weight")
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
        .getPropertyValue("--tugx-progress-large-pulsing-dot-pulse-weight")
        .trim();
      seen[w || "(unset)"] = true;
    },
  );
  return Object.keys(seen).sort();
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

describe.skipIf(!SHOULD_RUN)("AT0274: large-pulsing-dot breath envelope", () => {
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
          "tugx-progress-large-pulsing-dot-breathe",
          "tugx-progress-large-pulsing-dot-emit-expand",
          "tugx-progress-large-pulsing-dot-emit-fade",
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
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
