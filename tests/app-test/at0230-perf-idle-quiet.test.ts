/**
 * at0230 — perf guardrail: an idle Session card burns nothing.
 *
 * The no-perceivable-lag contract's IDLE budget (see
 * tugdeck/src/lib/perf-monitor.ts): with a session mounted, its
 * transcript settled, and nothing streaming, the renderer main thread
 * does no sustained work. Before the perf overhaul this failed
 * spectacularly — a per-session always-on sparkline animation plus
 * per-frame style/compositing recomputes kept the WebContent process at
 * a steady double-digit CPU share while the app sat untouched.
 *
 * The probe is self-contained (installed via evalJS, no reliance on the
 * app's own perf-monitor wiring): a 250ms heartbeat measures timer
 * drift across a multi-second window in which the harness deliberately
 * does NOT talk to the page (no polling — each RPC would be main-thread
 * work of our own making). Sustained rendering work shows up as
 * repeated drift; a healthy idle window shows at most scheduler jitter.
 *
 * Budget: zero drift beats ≥80ms across the window, with ONE beat of
 * grace ≤150ms for an unlucky GC. A regression to always-on per-frame
 * work (the July 2026 profile) trips this by an order of magnitude.
 *
 * @covers tugdeck/src/lib/perf-monitor.ts
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 * @covers tugdeck/src/lib/pulse-line/
 * @covers tugdeck/src/lib/session-activity-store.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";
import { seedFixtureSession } from "./fixtures/resolve";
import {
  openFixtureSession,
  waitForTranscriptSettled,
} from "./fixtures/runner";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/** Idle observation window. */
const IDLE_WINDOW_MS = 5_000;
/** Probe heartbeat period. */
const BEAT_MS = 250;
/** Drift below this is scheduler jitter, not work. */
const STALL_MS = 80;
/** One grace beat may reach this (GC); anything above is a regression. */
const GRACE_CEILING_MS = 150;

interface IdleProbeResult {
  beats: number;
  stalls: number;
  worstMs: number;
}

describe.skipIf(!SHOULD_RUN)("at0230: idle main thread stays quiet", () => {
  test(
    "a settled, idle session produces no sustained main-thread work",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const seeded = await seedFixtureSession(
        "session-transcript-margins",
        "at0230",
      );
      try {
        const app = await launchTugApp({
          testName: "at0230",
          env: { TUGBANK_PATH: tugbankPath },
          skipAccessibilityPreflight: true,
        });
        try {
          await openFixtureSession(app, seeded);
          await waitForTranscriptSettled(app);
          // Let the initial settle machinery (pin, anchor writer,
          // measurement stamps) finish before the window opens.
          await new Promise((r) => setTimeout(r, 1_500));

          await app.evalJS<null>(
            `(function(){
              var probe = { beats: 0, stalls: 0, worstMs: 0, done: false };
              window.__tugIdleProbe = probe;
              var BEAT = ${BEAT_MS};
              var expected = performance.now() + BEAT;
              var timer = setInterval(function(){
                var drift = performance.now() - expected;
                probe.beats += 1;
                if (drift >= ${STALL_MS}) {
                  probe.stalls += 1;
                  if (drift > probe.worstMs) probe.worstMs = drift;
                }
                expected = performance.now() + BEAT;
              }, BEAT);
              setTimeout(function(){
                clearInterval(timer);
                probe.done = true;
              }, ${IDLE_WINDOW_MS});
              return null;
            })()`,
          );

          // The whole point: NO page RPC while the window runs — the
          // harness itself must not manufacture main-thread work.
          await new Promise((r) => setTimeout(r, IDLE_WINDOW_MS + 500));

          const result = await app.evalJS<IdleProbeResult>(
            `(function(){
              var p = window.__tugIdleProbe;
              return { beats: p.beats, stalls: p.stalls, worstMs: Math.round(p.worstMs) };
            })()`,
          );

          // The window actually ran (≈ IDLE_WINDOW / BEAT beats).
          expect(result.beats).toBeGreaterThan(
            (IDLE_WINDOW_MS / BEAT_MS) * 0.7,
          );
          // At most one grace stall, and even that stays under the GC
          // ceiling. Sustained per-frame work produces a stall on
          // nearly every beat — an order of magnitude past this gate.
          expect(
            result.stalls,
            `idle window had ${result.stalls} stalls (worst ${result.worstMs}ms)`,
          ).toBeLessThanOrEqual(1);
          expect(
            result.worstMs,
            "an idle stall exceeded the GC grace ceiling",
          ).toBeLessThanOrEqual(GRACE_CEILING_MS);
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
