/**
 * AT0276 — the pulsing dot never pops on a state change.
 *
 * A state change arrives on a frame nobody chose. A tool call finishes
 * mid-breath, with the dot at an arbitrary scale and possibly a ring halfway
 * through its travel, and the glyph has to arrive at its settled pose without
 * tearing. The first cut of the breathing dot gated its loops on `data-state`,
 * which meant CSS destroyed both animations the instant React committed: the
 * ring ceased to exist wherever it happened to be, and the dot jumped from
 * whatever scale it was painting straight to its resting one. At the 32px Lens
 * treatment that jump is 0.575 of the dot's diameter in a single frame.
 *
 * So the loops are gated on `data-breathing` / `data-emitting`, which the
 * component owns, and every state change is a crossing:
 *
 *   - a LIT pulse always finishes its travel — it was shed, it is leaving under
 *     its own momentum, and the work ending is no business of its;
 *   - a pulse that was never lit is never lit — holding the gate open would
 *     only let one more ring out of a glyph that has stopped working;
 *   - the dot is caught where it stands, pinned, and transitioned from there;
 *   - going back into `running`, the breath starts at the phase whose pose the
 *     dot already holds, so it picks the dot up rather than snapping it down to
 *     the trough.
 *
 * The headline assertions sample the PAINTED values every frame across a real
 * state change and bound the rate of change, rather than checking any of the
 * machinery above. A pop is a large delta over one frame's dt; the legitimate
 * settle is a bounded velocity. Expressed as a rate the test is indifferent to
 * frame drops — a stutter stretches dt and the delta with it — which a
 * per-frame-delta threshold is not.
 *
 * The gallery's Crossing bench is the driver: a state picker over the whole
 * size ladder, so one click crosses both treatments at once. The behavior under
 * test is the component's, not the gallery's.
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
const BENCH = `${CARD} [data-bench="crossing"]`;
const GLYPH = `${BENCH} [data-slot="tug-progress-pulsing-dot"]`;

/** The state picker's segment for `value`. */
const segment = (value: string) => `${BENCH} [data-choice-value="${value}"]`;

/**
 * The two sizes sampled — one from each treatment.
 *
 * 32 is the big one and the interesting one: it carries the PRESENCE ladder, so
 * a `completed` dot rests at 0.425 while the breath ranges over 0.35–1.0. That
 * is the largest pose change in the component, and the one the old cut showed
 * most plainly. 12 is the small treatment — a tool-call header or a Z2 status
 * cell — where the swing is shallow but the static ring appears from nothing.
 */
const SAMPLED_SIZES = [32, 12] as const;

/** How long the sampler runs, in ms — comfortably past the 260ms settle. */
const SAMPLE_MS = 900;

/**
 * Ceiling on the dot's rate of change, in scale units per ms.
 *
 * The breath's own peak velocity is ~0.0017/ms (0.65 of range over a 600ms
 * rise, cosine). The settle's is ~0.005/ms (0.575 of range over 260ms, on an
 * ease-out whose slope peaks near 2.2× the average). A cut is the entire 0.575
 * inside one frame — 0.034/ms at 60Hz, and still 0.017/ms if the sampler only
 * catches it across a doubled frame. This sits between the two with room on
 * both sides.
 */
const MAX_SCALE_RATE = 0.015;

/**
 * Ceiling on how fast the emitted ring may LOSE opacity, per ms.
 *
 * Only falls are bounded: the ring is born in a deliberate step, lit in a
 * hairline between two easing stops at the same position, so its rise is
 * discontinuous by design. Its fall is not — it thins evenly over the ~1460ms
 * of its travel, ~0.0007/ms. Cutting it mid-flight drops up to 0.95 in a frame.
 */
const MAX_RING_FADE_RATE = 0.01;

/**
 * Ceiling on the static ring's rate of change, in px of diameter per ms.
 *
 * The settled ring's diameter is the state's PRESENCE, so at the big treatment
 * a 32px glyph going `completed` draws in from 32px to 16px — over the settle
 * that is 0.06px/ms, and in one frame it would be ~1px/ms. At the small
 * treatment presence is 1 at every state and this is flat, which is the right
 * answer there rather than an untested one.
 *
 * Its OPACITY is the other half of the same gesture and is deliberately not
 * sampled: WebKit stops reporting a resolved `opacity` for a pseudo-element
 * once a transition has touched it — the value comes back as an empty string
 * for the rest of the element's life. That half is pinned by
 * {@link crossingCensus} instead, off the live transition rather than the
 * paint.
 */
const MAX_STATIC_RATE = 0.2;

/** Cycle position where the ring is lit — past this, a pulse exists. */
const IGNITION = 0.27;

interface Sample {
  t: number;
  state: string | null;
  emitting: boolean;
  breathing: boolean;
  scale: number;
  ringOpacity: number;
  staticWidth: number;
}

/**
 * Start a per-frame sampler over the bench's glyphs at {@link SAMPLED_SIZES}.
 *
 * Everything read here is PAINTED, not declared: the dot's scale comes off the
 * resolved matrix (which includes the running animation), and both opacities
 * off the computed style. A crossing that looked right in the attributes and
 * still tore on screen is exactly the failure this file exists to catch.
 */
const installSampler = `(function(){
  var sizes = ${JSON.stringify(SAMPLED_SIZES)};
  var glyphs = Array.from(document.querySelectorAll(${JSON.stringify(GLYPH)}));
  var targets = sizes.map(function (px) {
    return glyphs.filter(function (el) {
      return Math.round(parseFloat(getComputedStyle(el).width)) === px;
    })[0];
  });
  if (targets.some(function (t) { return !t; })) return false;
  window.__dotSamples = sizes.map(function () { return []; });
  var start = performance.now();
  function tick(now) {
    targets.forEach(function (g, i) {
      var dot = g.querySelector(".tug-progress-pulsing-dot-dot");
      var ring = g.querySelector(".tug-progress-pulsing-dot-ring");
      window.__dotSamples[i].push({
        t: now - start,
        state: g.getAttribute("data-state"),
        emitting: g.hasAttribute("data-emitting"),
        breathing: g.hasAttribute("data-breathing"),
        scale: new DOMMatrixReadOnly(getComputedStyle(dot).transform).a,
        ringOpacity: Number(getComputedStyle(ring).opacity) || 0,
        staticWidth: parseFloat(getComputedStyle(g, "::after").width)
      });
    });
    if (now - start < ${SAMPLE_MS}) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return true;
})()`;

const readSamples = `JSON.stringify(window.__dotSamples)`;

/**
 * True once the sampler has a few frames of the PRE-change state banked.
 *
 * Without this the click can outrun the first `requestAnimationFrame`, and a
 * series that begins after the crossing measures the settle's tail with nothing
 * to compare it to — every rate below would pass trivially.
 */
const SAMPLER_ARMED = `Array.isArray(window.__dotSamples) && window.__dotSamples[0].length >= 5`;

/** True once the sampler has run its full span. */
const SAMPLER_DONE = `Array.isArray(window.__dotSamples) && window.__dotSamples[0].length > 0 && window.__dotSamples[0][window.__dotSamples[0].length - 1].t >= ${SAMPLE_MS - 40}`;

/**
 * Pause every animation on the bench and seek it to `fraction` of the cycle.
 *
 * This is how the pulse's phase becomes a controlled variable. A free-running
 * glyph is somewhere random when the click lands, so "was a ring in flight?"
 * would be a coin toss; paused and seeked, the component's release logic reads
 * exactly the progress named here.
 *
 * The delay is not a detail to skip. A glyph that entered `running` from a
 * settled state carries a NEGATIVE `animation-delay` — that is the phase match
 * that lets the breath pick the dot up where it stood — and `currentTime` is
 * measured from before it. Seeking to `duration * fraction` on such a glyph
 * lands at `fraction + |delay| / duration` instead, which for the phases this
 * file drives is the difference between an unlit ring and a lit one.
 */
const seekAll = (fraction: number) => `(function(){
  var glyphs = Array.from(document.querySelectorAll(${JSON.stringify(GLYPH)}));
  var n = 0;
  glyphs.forEach(function (g) {
    g.getAnimations({ subtree: true }).forEach(function (a) {
      var t = a.effect.getTiming();
      if (!t.duration) return;
      a.pause();
      a.currentTime = (t.delay || 0) + t.duration * ${fraction};
      n++;
    });
  });
  return n;
})()`;

/**
 * What is actually MOVING on the bench glyph whose box measures `px`, read
 * immediately after a crossing.
 *
 * The rate bounds above prove nothing tore; this proves the settle is a
 * transition rather than a very small cut, and it is the only way to see the
 * static ring's fade at all (see {@link MAX_STATIC_RATE}). It is also how the
 * held pulse is checked at its strongest: not "the attribute is still set" but
 * "both emit animations are still running on a glyph whose state has already
 * changed".
 */
const crossingCensus = (px: number) => `(function(){
  var g = Array.from(document.querySelectorAll(${JSON.stringify(GLYPH)}))
    .filter(function (el) {
      return Math.round(parseFloat(getComputedStyle(el).width)) === ${px};
    })[0];
  if (!g) return null;
  var anims = g.getAnimations({ subtree: true });
  function transition(prop, pseudo) {
    return anims.filter(function (a) {
      return a.transitionProperty === prop &&
        (a.effect.pseudoElement || null) === pseudo;
    })[0];
  }
  var dot = transition("transform", null);
  var fade = transition("opacity", "::after");
  return {
    state: g.getAttribute("data-state"),
    emitting: g.hasAttribute("data-emitting"),
    breathing: g.hasAttribute("data-breathing"),
    dotSettleMs: dot ? dot.effect.getTiming().duration : 0,
    staticFadeMs: fade ? fade.effect.getTiming().duration : 0,
    running: anims.filter(function (a) { return !!a.animationName; })
      .map(function (a) { return a.animationName; }).sort()
  };
})()`;

interface Census {
  state: string | null;
  emitting: boolean;
  breathing: boolean;
  dotSettleMs: number;
  staticFadeMs: number;
  running: string[];
}

/** Whether any glyph on the bench is still holding its emitter open. */
const anyEmitting = `Array.from(document.querySelectorAll(${JSON.stringify(GLYPH)}))
  .some(function (g) { return g.hasAttribute("data-emitting"); })`;

/** The settled scale of the bench glyph whose box measures `px`. */
const scaleAtSize = (px: number) => `(function(){
  var g = Array.from(document.querySelectorAll(${JSON.stringify(GLYPH)}))
    .filter(function (el) {
      return Math.round(parseFloat(getComputedStyle(el).width)) === ${px};
    })[0];
  if (!g) return -1;
  var dot = g.querySelector(".tug-progress-pulsing-dot-dot");
  return new DOMMatrixReadOnly(getComputedStyle(dot).transform).a;
})()`;

/**
 * The fastest change per ms across a sampled series, and where it happened.
 *
 * `signed` restricts the search to falls (-1) or rises (+1); 0 takes both.
 */
function peakRate(
  series: readonly Sample[],
  read: (s: Sample) => number,
  signed: -1 | 0 | 1,
): { rate: number; at: number; from: number; to: number } {
  let worst = { rate: 0, at: 0, from: 0, to: 0 };
  for (let i = 1; i < series.length; i++) {
    const dt = series[i].t - series[i - 1].t;
    if (dt <= 0) continue;
    const from = read(series[i - 1]);
    const to = read(series[i]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const delta = to - from;
    if (signed === -1 && delta >= 0) continue;
    if (signed === 1 && delta <= 0) continue;
    const rate = Math.abs(delta) / dt;
    if (rate > worst.rate) worst = { rate, at: series[i].t, from, to };
  }
  return worst;
}

describe.skipIf(!SHOULD_RUN)("AT0276: pulsing-dot state crossing", () => {
  test(
    "a state change is a transition, and a lit pulse always finishes",
    async () => {
      const app = await launchTugApp({ testName: "at0276-progress-dot-crossing" });
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
          `document.querySelector(${JSON.stringify(GLYPH)}) !== null`,
          { timeoutMs: 6000 },
        );
        // The bench mounts running; wait for the loops to exist before driving
        // anything through them.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(GLYPH)}).getAnimations({ subtree: true }).length > 0`,
          { timeoutMs: 6000 },
        );

        // --- Leaving `running` -------------------------------------------
        //
        // A free-running crossing, sampled frame by frame. Nothing is paused or
        // seeked here on purpose: this is the ordinary case, the click landing
        // wherever it lands in the breath.
        expect(await app.evalJS<boolean>(installSampler)).toBe(true);
        await app.waitForCondition<boolean>(SAMPLER_ARMED, { timeoutMs: 4000 });
        await app.click(segment("completed"));

        // Read while the settle is still in flight — a transition only exists
        // for as long as it is running.
        for (const size of SAMPLED_SIZES) {
          const census = await app.evalJS<Census>(crossingCensus(size));
          expect(census.state, `${size}px: state committed`).toBe("completed");
          expect(census.breathing, `${size}px: breath released`).toBe(false);
          expect(
            census.dotSettleMs,
            `${size}px: the dot is easing to its settled pose, not cut to it`,
          ).toBe(260);
          expect(
            census.staticFadeMs,
            `${size}px: the settled ring is fading in, not materializing`,
          ).toBe(260);
        }

        await app.waitForCondition<boolean>(SAMPLER_DONE, { timeoutMs: 6000 });

        const leaving = JSON.parse(
          await app.evalJS<string>(readSamples),
        ) as Sample[][];
        expect(leaving).toHaveLength(SAMPLED_SIZES.length);

        for (const [index, size] of SAMPLED_SIZES.entries()) {
          const series = leaving[index];
          const label = `${size}px running→completed`;
          // The sampler has to have spanned the change, or it is measuring
          // nothing and every rate below is trivially zero.
          expect(
            series.filter((s) => s.state === "running").length,
            `${label}: sampled before the change`,
          ).toBeGreaterThan(1);
          expect(
            series.filter((s) => s.state === "completed").length,
            `${label}: sampled after the change`,
          ).toBeGreaterThan(4);

          const dot = peakRate(series, (s) => s.scale, 0);
          expect(
            dot.rate,
            `${label}: dot jumped ${dot.from.toFixed(3)}→${dot.to.toFixed(3)} at ${dot.at.toFixed(0)}ms`,
          ).toBeLessThan(MAX_SCALE_RATE);

          const ring = peakRate(series, (s) => s.ringOpacity, -1);
          expect(
            ring.rate,
            `${label}: pulse cut ${ring.from.toFixed(3)}→${ring.to.toFixed(3)} at ${ring.at.toFixed(0)}ms`,
          ).toBeLessThan(MAX_RING_FADE_RATE);

          const settled = peakRate(series, (s) => s.staticWidth, 0);
          expect(
            settled.rate,
            `${label}: static ring snapped ${settled.from.toFixed(1)}→${settled.to.toFixed(1)}px at ${settled.at.toFixed(0)}ms`,
          ).toBeLessThan(MAX_STATIC_RATE);
        }

        // The big treatment's ring draws in from the full box to its PRESENCE
        // rung. That it travelled at all is what makes the bound above mean
        // something — a ring that never moved passes any rate test.
        expect(
          leaving[0][leaving[0].length - 1].staticWidth,
          "32px: the settled ring drew in to its presence rung",
        ).toBeCloseTo(16, 0);

        // --- Re-entering `running` ---------------------------------------
        //
        // The same measurement in the other direction. The failure mode here is
        // different in kind: the breath would start at its 0% keyframe — the
        // trough — dropping a `completed` 32px dot from 0.425 to 0.35 in one
        // frame. The fix is a phase-matched negative delay, and what it buys is
        // visible in the same rate bound.
        const before32 = await app.evalJS<number>(scaleAtSize(32));
        expect(await app.evalJS<boolean>(installSampler)).toBe(true);
        await app.waitForCondition<boolean>(SAMPLER_ARMED, { timeoutMs: 4000 });
        await app.click(segment("running"));
        await app.waitForCondition<boolean>(SAMPLER_DONE, { timeoutMs: 6000 });

        const entering = JSON.parse(
          await app.evalJS<string>(readSamples),
        ) as Sample[][];
        for (const [index, size] of SAMPLED_SIZES.entries()) {
          const series = entering[index];
          const label = `${size}px completed→running`;
          expect(
            series.filter((s) => s.state === "running").length,
            `${label}: sampled after the change`,
          ).toBeGreaterThan(4);

          const dot = peakRate(series, (s) => s.scale, 0);
          expect(
            dot.rate,
            `${label}: dot jumped ${dot.from.toFixed(3)}→${dot.to.toFixed(3)} at ${dot.at.toFixed(0)}ms`,
          ).toBeLessThan(MAX_SCALE_RATE);

          const settled = peakRate(series, (s) => s.staticWidth, 0);
          expect(
            settled.rate,
            `${label}: static ring snapped ${settled.from.toFixed(1)}→${settled.to.toFixed(1)}px at ${settled.at.toFixed(0)}ms`,
          ).toBeLessThan(MAX_STATIC_RATE);
        }

        // The phase match, stated directly: the first frame of the breath is
        // the pose the settled dot was already holding, not the trough.
        const firstRunning = entering[0].find((s) => s.breathing);
        expect(firstRunning).toBeDefined();
        expect(
          firstRunning!.scale,
          "the breath picked the dot up where it stood",
        ).toBeCloseTo(before32, 2);

        // --- A lit pulse is held ------------------------------------------
        //
        // Phase as a controlled variable: paused and seeked past ignition,
        // there is definitely a ring in flight when the state changes.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(GLYPH)}).getAnimations({ subtree: true }).length > 0`,
          { timeoutMs: 6000 },
        );
        expect(await app.evalJS<number>(seekAll(0.4))).toBeGreaterThan(0);
        await app.click(segment("completed"));
        const held = await app.evalJS<Census>(crossingCensus(12));
        expect(held.state, "the state has already changed").toBe("completed");
        expect(
          held.emitting,
          "a pulse lit at 40% of the cycle keeps flying",
        ).toBe(true);
        expect(
          held.running,
          "every part of the pulse — radius, opacity, stroke — outlives the state",
        ).toEqual([
          "tugx-progress-pulsing-dot-emit-expand",
          "tugx-progress-pulsing-dot-emit-fade",
          "tugx-progress-pulsing-dot-emit-thicken",
        ]);

        // --- A pulse that was never lit is not held -----------------------
        //
        // Before ignition the ring is parked at the dot's edge and fully faded.
        // There is no gesture to honor, and holding the gate open would let one
        // more ring out of a glyph that has already stopped working.
        await app.click(segment("running"));
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(GLYPH)}).getAnimations({ subtree: true }).length > 0`,
          { timeoutMs: 6000 },
        );
        expect(
          await app.evalJS<number>(seekAll(IGNITION - 0.1)),
        ).toBeGreaterThan(0);
        await app.click(segment("completed"));
        expect(
          await app.evalJS<boolean>(anyEmitting),
          "a ring that was never lit is released immediately",
        ).toBe(false);
        expect(
          (await app.evalJS<Census>(crossingCensus(12))).running,
          "and its animations are gone with it",
        ).toEqual([]);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
