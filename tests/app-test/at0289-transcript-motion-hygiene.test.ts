/**
 * at0289 — motion hygiene on a RESTORED transcript: settled dots must
 * cost nothing.
 *
 * The seeded-gallery census (at0288) cannot see the defect class this
 * test gates, because it only exists on a cold-restored transcript: a
 * session restore mounts one `TugProgressPulsingDot` per historical
 * tool call, every one born in a settled state, and the 2026-07-29
 * audit measured what that population costs at rest. Two defects, two
 * assertions:
 *
 *   1. **Breadth.** Every settled dot holds an inline transform and its
 *      ring holds another, so the dot population was 82% of the audited
 *      card's stacking contexts (1,314 of 1,603) — walked twice by the
 *      compositing pass on every dirty frame, i.e. on every keystroke.
 *      Settled states must render settled DOM: zero transform-bearing
 *      glyph spans, zero dot/ring stacking contexts.
 *
 *   2. **Retention.** A transform written through the dot's live
 *      `transition: transform` AFTER first style resolution leaves a
 *      finished `CSSTransition` behind in `document.getAnimations()`
 *      forever (415 on the audited card), and the animation controller
 *      iterates the retained list on every rendering update. A plain
 *      cold restore at fixture scale retains ZERO (measured — the
 *      first-paint write resolves with the element's initial style), so
 *      the at-rest count is asserted zero unconditionally; the army on
 *      the audited card was raised by writes that landed after first
 *      paint (batched-replay state crossings). The INDUCED-CROSSING
 *      phase below performs exactly that write on one real dot span and
 *      asserts a settled dot is IMMUNE to it: static mode renders
 *      settled states without a live transition, so the write retains
 *      nothing (measured: removing the transition property also DROPS
 *      an already-retained finished transition, which is what clears
 *      any zombie a live crossing left behind when the glyph demotes).
 *
 * The fixture is `session-transcript-basic` (29 tool_use blocks),
 * restored through the production picker → spawn → reveal path, probed
 * after one settle window for the deck's own designed mount
 * choreography.
 *
 * The zero-asserting form of the breadth assertions was proven RED
 * against pre-swap code (Expected 0 / Received 64, naming the glyph
 * spans) before the end-state swap landed and turned them green.
 *
 * @covers tugdeck/src/lib/perf-monitor.ts
 * @covers tugdeck/src/components/tugways/internal/tug-progress-pulsing-dot.tsx
 * @covers tugdeck/src/components/tugways/blocks/block-header.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankWrite,
} from "./_harness/tugbank-helpers";
import { seedFixtureSession } from "./fixtures/resolve";
import {
  openFixtureSession,
  waitForTranscriptSettled,
} from "./fixtures/runner";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

interface HygieneProbe {
  dots: number;
  /** Dot/ring spans whose computed transform is not `none`. */
  transformedGlyphSpans: number;
  retainedTransitions: { count: number; targets: string[] };
  violations: unknown[];
  longRunning: number;
  stackingContexts: number;
  stackingHistogram: [string, number][];
}

const PROBE = `(function(){
  var census = window.tugPerfMonitor.animationCensus();
  var layers = window.tugPerfMonitor.layerTreeProbe();
  var glyphSpans = document.querySelectorAll(
    ".tug-progress-pulsing-dot-dot, .tug-progress-pulsing-dot-ring");
  var transformed = 0;
  for (var i = 0; i < glyphSpans.length; i++) {
    if (getComputedStyle(glyphSpans[i]).transform !== "none") transformed++;
  }
  return {
    dots: document.querySelectorAll('[data-slot="tug-progress-pulsing-dot"]').length,
    transformedGlyphSpans: transformed,
    retainedTransitions: census.retainedTransitions,
    violations: census.violations,
    longRunning: census.longRunning,
    stackingContexts: layers.stackingContexts,
    stackingHistogram: layers.stackingHistogram,
  };
})()`;

/**
 * The crossing write, performed on the first dot span: the same inline
 * `transform` assignment the component makes when a state crossing
 * settles, landing after first style resolution — the write class that
 * raised the audited card's retained-transition army.
 */
const INDUCE_CROSSING = `(function(){
  var dot = document.querySelector(".tug-progress-pulsing-dot-dot");
  if (dot === null) return false;
  dot.style.transform = "translate(-50%, -50%) scale(0.42)";
  return true;
})()`;

function histogramCount(
  histogram: [string, number][],
  needle: string,
): number {
  let n = 0;
  for (const [bucket, count] of histogram) {
    if (bucket.includes(needle)) n += count;
  }
  return n;
}

describe.skipIf(!SHOULD_RUN)("at0289: restored-transcript motion hygiene", () => {
  test(
    "a restored transcript's settled dots retain no transitions and hold no transforms",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const seeded = await seedFixtureSession(
        "session-transcript-basic",
        "at0289",
      );
      // Pre-seed the picker's recent-projects to ONLY the temp fixture
      // dir, BEFORE launch — so the picker autofills that path on mount
      // and lists only the fixture session (never the live archive).
      tugbankWrite(
        tugbankPath,
        "dev.tugtool.dev",
        "recent-projects",
        "json",
        JSON.stringify({ paths: [seeded.projectDir] }),
      );

      try {
        const app = await launchTugApp({
          testName: "at0289-transcript-motion-hygiene",
          env: { TUGBANK_PATH: tugbankPath },
        });
        try {
          await openFixtureSession(app, seeded);
          await waitForTranscriptSettled(app);
          // One settle window for the deck's own designed mount
          // choreography — anything finite and deliberate retires here.
          // What this test convicts is what persists PAST it.
          await new Promise((r) => setTimeout(r, 1_500));

          const probe = await app.evalJS<HygieneProbe>(PROBE);
          const dotContexts =
            histogramCount(probe.stackingHistogram, "tug-progress-pulsing-dot-dot") +
            histogramCount(probe.stackingHistogram, "tug-progress-pulsing-dot-ring");
          console.log(
            `\n=== at0289: restored ${seeded.fixture} ===\n` +
              `dots: ${probe.dots} | transformed glyph spans: ${probe.transformedGlyphSpans}\n` +
              `retained finished transitions: ${probe.retainedTransitions.count}` +
              (probe.retainedTransitions.targets.length > 0
                ? ` (${probe.retainedTransitions.targets.join(", ")})`
                : "") +
              `\nlong-running: ${probe.longRunning} | violations: ${probe.violations.length}\n` +
              `stacking contexts: ${probe.stackingContexts} (dot/ring: ${dotContexts})\n` +
              `histogram: ${JSON.stringify(probe.stackingHistogram)}`,
          );

          // The population is real: the fixture's tool calls each mount
          // a dot. Without this floor, an empty transcript would pass
          // every zero assertion vacuously.
          expect(
            probe.dots,
            "restored transcript mounted no pulsing dots — fixture or restore path broke",
          ).toBeGreaterThanOrEqual(20);

          // At rest: nothing retained, nothing in violation. This holds
          // on a plain cold restore even before the fixes (the army
          // needs post-first-paint writes; see the induced phase), and
          // it must hold forever after them.
          expect(
            probe.retainedTransitions,
            `retained transitions after settle:\n${JSON.stringify(probe.retainedTransitions, null, 2)}`,
          ).toEqual({ count: 0, targets: [] });
          expect(
            probe.violations,
            `census violations:\n${JSON.stringify(probe.violations, null, 2)}`,
          ).toEqual([]);

          // Breadth: settled states render settled DOM.
          expect(
            probe.transformedGlyphSpans,
            "settled dots still hold transforms — the glyph spans should be static DOM",
          ).toBe(0);
          expect(
            dotContexts,
            `dot/ring stacking contexts on a settled transcript:\n${JSON.stringify(probe.stackingHistogram, null, 2)}`,
          ).toBe(0);

          // Induced crossing: the post-first-paint write that raises
          // zombies. Last, so its mutation never pollutes the probes
          // above.
          expect(await app.evalJS<boolean>(INDUCE_CROSSING)).toBe(true);
          // The dot's settle transition is 260ms nominal; give it that
          // plus slack to finish, so what the census then sees is the
          // RETAINED object, not a running transition.
          await new Promise((r) => setTimeout(r, 800));
          const induced = await app.evalJS<HygieneProbe>(PROBE);
          console.log(
            `induced-crossing retained: ${induced.retainedTransitions.count} ` +
              `(${induced.retainedTransitions.targets.join(", ")})`,
          );
          // Static mode carries no live transition, so the same write
          // retains nothing — settled dots are immune to the defect. (The
          // detector itself was proven on pre-swap code: this same write
          // on a live-mode settled dot retained exactly one finished
          // transition, named `span.tug-progress-pulsing-dot-dot`.)
          expect(
            induced.retainedTransitions,
            `induced write retained a transition on a static dot:\n${JSON.stringify(induced.retainedTransitions, null, 2)}`,
          ).toEqual({ count: 0, targets: [] });
        } finally {
          await app.quitGracefully();
        }
      } finally {
        seeded.cleanup();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
