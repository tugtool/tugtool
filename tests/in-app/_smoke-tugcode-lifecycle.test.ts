/**
 * _smoke-tugcode-lifecycle.test.ts — Phase B harness-owned tugcode
 * lifecycle smoke (parent harness plan #step-5 / selection plan
 * Pass 7A). SCRATCH FILE — folded into `_smoke-em.test.ts` at Step
 * 7's commit and deleted there.
 *
 * ## What this file pins
 *
 * The Swift `startTugcode` / `stopTugcode` RPC verbs added in
 * harness Step 5. The harness spawns and tears down a tugcode
 * subprocess that's independent of production's tugcast →
 * tugcode-per-AI-session path.
 *
 *   1. **start + stop round-trip** — `app.startTugcode({ mode: "stub" })`
 *      returns `{ pid }`; `app.stopTugcode()` resolves without
 *      throwing. After stop, a second start succeeds (state cleared).
 *
 *   2. **already-running guard** — calling `startTugcode` while a
 *      child is already running throws `TugcodeLaunchError` (the
 *      Swift handler refuses to spawn a second).
 *
 *   3. **latency measurement** — 10 start+stop cycles, record the
 *      median. Result printed to the test's stderr so it shows up
 *      in the test log; the number resolves harness plan [Q03]
 *      (per-test-file vs per-harness-launch lifecycle).
 *
 * ## Gating
 *
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs
 * without `TUGAPP_IN_APP_TEST=1` skip every test.
 *
 * Tugcode binary path is resolved Swift-side via the
 * `TUGAPP_TUGCODE_BINARY` env var, set by `just test-in-app-fast`
 * to `<repo>/tugrust/target/debug/tugcode`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import { TugcodeLaunchError } from "./_harness/errors";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

describe.skipIf(!SHOULD_RUN)("phase B tugcode-lifecycle smoke", () => {
  test("startTugcode + stopTugcode round-trip resolves with pid", async () => {
    const app = await launchTugApp({ testName: "smoke-tugcode-lifecycle-rt" });
    try {
      const result = await app.startTugcode({ mode: "stub" });
      expect(typeof result.pid).toBe("number");
      expect(result.pid).toBeGreaterThan(0);

      // Second start succeeds after stop (handler state clears).
      await app.stopTugcode();
      const result2 = await app.startTugcode({ mode: "stub" });
      expect(result2.pid).toBeGreaterThan(0);
      expect(result2.pid).not.toBe(result.pid); // fresh subprocess
      await app.stopTugcode();
    } finally {
      await app.close();
    }
  });

  test("startTugcode while already running throws TugcodeLaunchError", async () => {
    const app = await launchTugApp({ testName: "smoke-tugcode-lifecycle-already-running" });
    try {
      await app.startTugcode({ mode: "stub" });

      let caught: unknown = null;
      try {
        await app.startTugcode({ mode: "stub" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(TugcodeLaunchError);
      expect((caught as TugcodeLaunchError).name).toBe("TugcodeLaunchError");
      expect((caught as TugcodeLaunchError).message).toContain("already running");

      await app.stopTugcode();
    } finally {
      await app.close();
    }
  });

  test("startTugcode/stopTugcode latency: 10 cycles, median recorded", async () => {
    const app = await launchTugApp({ testName: "smoke-tugcode-lifecycle-latency" });
    try {
      const samples: number[] = [];
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        await app.startTugcode({ mode: "stub" });
        await app.stopTugcode();
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const median = samples[5];
      const min = samples[0];
      const max = samples[9];
      // Surface to stderr so the wall-clock shows up in the
      // Justfile's per-file log block. `[Q03] resolved` line is
      // greppable from the result note.
      process.stderr.write(
        `\n[smoke-tugcode-lifecycle] [Q03] start+stop wall-clock: median=${median.toFixed(1)}ms min=${min.toFixed(1)}ms max=${max.toFixed(1)}ms (10 cycles)\n`,
      );
      // Hard ceiling: a single spawn-then-kill cycle should never
      // exceed 1500ms on a healthy dev box. Failure here means
      // either the binary is huge / slow to load OR the kill
      // path is leaking the SIGKILL fallback.
      expect(median).toBeLessThan(1500);
    } finally {
      await app.close();
    }
  });
});
