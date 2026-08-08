/**
 * `SparklineTape` — the tape's policy, driven with an injected clock and
 * injected timers against a recording surface.
 *
 * This is the real production class, not a stand-in: the clock and the timers
 * are seams the component owns in production, and the surface is the tape's
 * real output port. What the tests read is the ORDER and CONTENT of the calls
 * the tape makes, which is the thing the design is a statement about.
 *
 * @module lib/__tests__/sparkline-tape
 */

import { describe, expect, test } from "bun:test";

import { RateMeter } from "@/lib/activity-meter";
import { drawSparkline, type SparklinePoint } from "@/lib/sparkline-geometry";
import {
  DORMANT_AFTER_MS,
  EPOCH_MS,
  HIDDEN_PAUSE_DELAY_MS,
  RATE_WINDOW_MS,
  REBASE_ACK_TIMEOUT_MS,
  SAMPLE_MS,
  SparklineTape,
  type SparklineSurface,
  type SparklineTapeOptions,
} from "@/lib/sparkline-tape";

/**
 * Where the injected clock starts — a `performance.now()`-shaped value, not a
 * wall-clock one. That shape is load-bearing for the rate-decay case: the
 * meter there is recorded on REAL wall clock, so the tape only reads it
 * correctly if its wall-clock seam is intact. Move this to a wall-clock base
 * and that test stops being able to fail.
 */
const CLOCK_BASE = 50_000;

// ----------------------------------------------------------------- harness

interface SurfaceCall {
  kind: "paint" | "setEpochStart" | "pause" | "resume" | "stampChannel";
  /** `paint` / `stampChannel`: the epoch origin the call carried. */
  t0?: number;
  /** `paint`: the acknowledgement sequence, or null for an ordinary paint. */
  ack?: number | null;
  /** `paint`: how many points went out. */
  points?: number;
  /** `paint`: the newest plotted value — what the right edge is drawing. */
  lastV?: number;
  /** `stampChannel`: the channel stamped. */
  channel?: string | null;
  /** `setEpochStart`: the origin written. */
  timelineMs?: number;
}

/** A timer wheel the test advances by hand. Nothing here is wall-clock bound. */
class FakeScheduler {
  t = CLOCK_BASE;
  private seq = 1;
  private readonly timers = new Map<
    number,
    { due: number; every: number | null; fn: () => void }
  >();

  now = (): number => this.t;

  setTimeout = (fn: () => void, ms: number): number => {
    const handle = this.seq++;
    this.timers.set(handle, { due: this.t + ms, every: null, fn });
    return handle;
  };

  setInterval = (fn: () => void, ms: number): number => {
    const handle = this.seq++;
    this.timers.set(handle, { due: this.t + ms, every: Math.max(1, ms), fn });
    return handle;
  };

  clearTimeout = (handle: number): void => {
    this.timers.delete(handle);
  };

  clearInterval = (handle: number): void => {
    this.timers.delete(handle);
  };

  /** Run every timer due within `ms`, in due order, then land on the target. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let nextHandle = -1;
      let nextDue = Number.POSITIVE_INFINITY;
      for (const [handle, timer] of this.timers) {
        if (timer.due < nextDue) {
          nextDue = timer.due;
          nextHandle = handle;
        }
      }
      if (nextHandle < 0 || nextDue > target) break;
      this.t = nextDue;
      const timer = this.timers.get(nextHandle);
      if (timer === undefined) continue;
      if (timer.every === null) this.timers.delete(nextHandle);
      else timer.due = nextDue + timer.every;
      timer.fn();
    }
    this.t = target;
  }

  get pending(): number {
    return this.timers.size;
  }
}

const FULL_SCALE = 10;
const BIN_MS = 250;
const AMPLITUDE = 20; // ⇒ a 2px deadband is 0.1 in plotted units
const WINDOW_BINS = 40;

/**
 * A window whose trailing rolling second sums to `level` × full scale, with
 * zeros behind it — so the tape's change scan sees a real step near the right
 * edge and the plotted value is exactly `level`.
 */
function seriesOf(level: number): number[] {
  const hotBins = Math.round(RATE_WINDOW_MS / BIN_MS);
  const out = new Array<number>(WINDOW_BINS).fill(0);
  for (let i = WINDOW_BINS - hotBins; i < WINDOW_BINS; i++) {
    out[i] = (level * FULL_SCALE) / hotBins;
  }
  return out;
}

/**
 * The two invariants the whole rebase design exists to guarantee, asserted
 * over a recorded trace:
 *
 *  - ORDERING — every `setEpochStart(t)` is preceded by a `paint` that carried
 *    `t` and asked for an acknowledgement. No origin ever moves ahead of the
 *    pixels for it, and no origin moves on the back of an unacknowledged
 *    paint.
 *  - SINGLE `t0` — between two origin moves, every ordinary paint agrees on
 *    the committed origin. The one exception is the single rebase paint that
 *    proposes the next one, and there is exactly one of those per interval.
 */
function assertRebaseOrdering(calls: SurfaceCall[]): void {
  let committed: number | undefined;
  let proposed = new Set<number>();
  for (const call of calls) {
    if (call.kind === "paint") {
      if (call.ack !== null && call.ack !== undefined) {
        proposed.add(call.t0 ?? Number.NaN);
        continue;
      }
      committed ??= call.t0;
      expect(call.t0).toBe(committed);
      continue;
    }
    if (call.kind !== "setEpochStart") continue;
    // One origin may be proposed more than once — an orphaned sequence is
    // re-issued on the next tick — but never two DIFFERENT origins, and the
    // one that lands is the one that was painted.
    expect([...proposed]).toEqual([call.timelineMs ?? Number.NaN]);
    committed = call.timelineMs;
    proposed = new Set();
  }
}

/**
 * Take the tape off screen the way the observer does, and let the out-of-view
 * hysteresis expire. Raw intersection alone is NOT hidden — that is the whole
 * point of {@link HIDDEN_PAUSE_DELAY_MS} — so any test that wants a genuinely
 * paused tape has to sit through the wait, and any test that wants to prove the
 * wait works calls `setVisible` directly.
 */
function hide(h: Harness): void {
  h.tape.setVisible(false);
  h.clock.advance(HIDDEN_PAUSE_DELAY_MS);
}

interface Harness {
  clock: FakeScheduler;
  calls: SurfaceCall[];
  tape: SparklineTape;
  /** Every paint's `t0`, in order. */
  paints: () => SurfaceCall[];
  kinds: () => string[];
}

function makeHarness(
  overrides: Partial<SparklineTapeOptions> = {},
  surfaceOverrides: Partial<SparklineSurface> = {},
  /**
   * How long the surface takes to answer a paint that asked for an ack. `null`
   * models a surface that never answers at all — a released painter, a dead
   * worker, a `dispose` that raced the paint.
   */
  ackDelayMs: number | null = 0,
): Harness {
  const clock = new FakeScheduler();
  const calls: SurfaceCall[] = [];
  let built: SparklineTape | null = null;
  const surface: SparklineSurface = {
    paint(points, t0, ack) {
      calls.push({
        kind: "paint",
        t0,
        ack,
        points: points.length,
        lastV: points.length > 0 ? points[points.length - 1].v : undefined,
      });
      if (ack === null || ackDelayMs === null) return;
      // Always asynchronous — a surface that acks from inside paint() is a
      // programming error the tape asserts against.
      clock.setTimeout(() => built?.onPainted(ack), ackDelayMs);
    },
    setEpochStart(timelineMs) {
      calls.push({ kind: "setEpochStart", timelineMs });
    },
    pause() {
      calls.push({ kind: "pause" });
    },
    resume() {
      calls.push({ kind: "resume" });
    },
    stampChannel(channel, t0) {
      calls.push({ kind: "stampChannel", channel, t0 });
    },
    ...surfaceOverrides,
  };
  const options: SparklineTapeOptions = {
    now: clock.now,
    getSeries: () => seriesOf(0),
    binMs: BIN_MS,
    fullScale: FULL_SCALE,
    curve: (x) => x,
    amplitude: AMPLITUDE,
    pxPerSec: 64 / 15,
    motion: true,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    ...overrides,
  };
  const tape = new SparklineTape(surface, options);
  built = tape;
  return {
    clock,
    calls,
    tape,
    paints: () => calls.filter((c) => c.kind === "paint"),
    kinds: () => calls.map((c) => c.kind),
  };
}

// ------------------------------------------------------------------- tests

describe("SparklineTape — birth", () => {
  test("a tape with no activity is born inert: one paint, no timers", () => {
    const h = makeHarness();
    h.tape.start(h.clock.now());

    expect(h.paints()).toHaveLength(1);
    expect(h.kinds()).toEqual(["paint"]);
    expect(h.clock.pending).toBe(0);
    expect(h.tape.debugState().state).toBe("flat-dormant");
  });

  test("a tape with recent activity is born live and runs a settle burst", () => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    const t0 = h.clock.now();
    h.tape.start(t0);

    // Mount: one paint, for the point the wake made true. The epoch is
    // already where the scroll's origin put it, so there is nothing to rebase.
    expect(h.paints()).toHaveLength(1);
    expect(h.tape.debugState().state).toBe("live");

    // Stability alone must NOT stop the burst: the value is pinned at 0.5 from
    // the first tick, but the last event's rolling window is still draining.
    h.clock.advance(SAMPLE_MS * 4);
    expect(h.paints()).toHaveLength(5);

    // One tick past RATE_WINDOW_MS + binMs the burst has both conditions and
    // retires itself.
    h.clock.advance(SAMPLE_MS * 4);
    expect(h.paints()).toHaveLength(6);
  });
});

describe("SparklineTape — change recognition", () => {
  test("sub-deadband drift accumulates and eventually registers as change", () => {
    // Control: a level held exactly. Nothing after the birth step is change,
    // so the flat-off deadline stays anchored at mount.
    const held = makeHarness({ getSeries: () => seriesOf(0.5) });
    const heldStart = held.clock.now();
    held.tape.start(heldStart);
    for (let i = 0; i < 8; i++) {
      held.clock.advance(SAMPLE_MS);
      held.tape.onActivity();
    }
    held.clock.advance(DORMANT_AFTER_MS - (held.clock.now() - heldStart) + 200);
    expect(held.tape.debugState().state).toBe("flat-dormant");

    // Ramp: each step is 0.04 — well under the 0.1 deadband — but the
    // reference only advances on a RECOGNIZED change, so the drift is measured
    // against a fixed point and trips it after three steps.
    let level = 0.5;
    const ramp = makeHarness({ getSeries: () => seriesOf(level) });
    const rampStart = ramp.clock.now();
    ramp.tape.start(rampStart);
    for (let i = 0; i < 8; i++) {
      level += 0.04;
      ramp.clock.advance(SAMPLE_MS);
      ramp.tape.onActivity();
    }
    ramp.clock.advance(DORMANT_AFTER_MS - (ramp.clock.now() - rampStart) + 200);
    expect(ramp.tape.debugState().state).toBe("live");
  });
});

describe("SparklineTape — the flat-off finisher", () => {
  test("fires DORMANT_AFTER_MS after the last recognized change", () => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    const start = h.clock.now();
    h.tape.start(start);

    h.clock.advance(DORMANT_AFTER_MS - 500);
    expect(h.tape.debugState().state).toBe("live");

    h.clock.advance(600);
    expect(h.tape.debugState().state).toBe("flat-dormant");
    expect(h.clock.pending).toBe(0);
  });

  test("reschedules when a later change lands during the wait", () => {
    let level = 0.5;
    const h = makeHarness({ getSeries: () => seriesOf(level) });
    const start = h.clock.now();
    h.tape.start(start);

    h.clock.advance(5_000);
    level = 0.9;
    h.tape.onActivity();
    h.clock.advance(SAMPLE_MS * 2); // let the burst draw the new level

    // The original deadline passes without the tape retiring…
    h.clock.advance(DORMANT_AFTER_MS - (h.clock.now() - start) + 200);
    expect(h.tape.debugState().state).toBe("live");

    // …and it retires a full window after the change that moved it.
    h.clock.advance(6_000);
    expect(h.tape.debugState().state).toBe("flat-dormant");
  });
});

describe("SparklineTape — reduced motion", () => {
  test("never touches the scroll and re-seeds its origin on every append", () => {
    let level = 0.5;
    const h = makeHarness({ getSeries: () => seriesOf(level), motion: false });
    h.tape.start(h.clock.now());

    for (let i = 0; i < 4; i++) {
      level += 0.2;
      h.clock.advance(SAMPLE_MS);
      h.tape.onActivity();
      // The origin follows the newest sample, so the picture stands still.
      expect(h.tape.committedT0()).toBe(h.clock.now());
    }

    expect(h.kinds()).not.toContain("setEpochStart");
    expect(h.kinds()).not.toContain("pause");
    expect(h.kinds()).not.toContain("resume");
  });
});

describe("SparklineTape — the dominant-channel stamp", () => {
  test("stamps at mount and again only when the channel changes", () => {
    let channel: string | null = "text";
    const h = makeHarness({
      getSeries: () => seriesOf(0.5),
      getColorChannel: () => channel,
    });
    h.tape.start(h.clock.now());

    const stamps = () => h.calls.filter((c) => c.kind === "stampChannel");
    expect(stamps()).toHaveLength(1);
    expect(stamps()[0].channel).toBe("text");

    h.clock.advance(SAMPLE_MS * 2);
    expect(stamps()).toHaveLength(1); // steady hue rewrites nothing

    channel = "tools";
    h.tape.onActivity();
    h.clock.advance(SAMPLE_MS);
    expect(stamps()).toHaveLength(2);
    expect(stamps()[1].channel).toBe("tools");
  });
});

describe("SparklineTape — the rate decay the wall-clock seam protects", () => {
  test("a stalled stream drains to baseline", () => {
    // The REAL meter, binned exactly as the activity store bins it. What this
    // pins is `RateMeter.series` advancing its absolute bin index — the only
    // thing that zero-fills idle bins, and therefore the only thing that makes
    // a stopped stream fall back to a flat line. Hand the meter a clock it
    // does not share and the window never advances, the tape holds its last
    // level forever, and the failure reads as a data bug.
    const meter = new RateMeter(BIN_MS, WINDOW_BINS);
    const h = makeHarness({ getSeries: (nowMs) => meter.series(nowMs) });
    const plotted = (): number => {
      const seen = h.paints();
      return seen.length > 0 ? (seen[seen.length - 1].lastV ?? Number.NaN) : Number.NaN;
    };

    // The meter is recorded on REAL wall clock, exactly as the store records
    // it, while the tape runs on a monotonic clock ≈1e5. The only thing that
    // makes the two meet is the tape's `wallOffset` seam; delete it and every
    // `series()` call takes `RateMeter.advanceTo`'s early return, the window
    // never advances, and the assertions below go red.
    const wallBase = Date.now();
    const wallAt = (t: number): number => wallBase + (t - CLOCK_BASE);

    h.tape.start(h.clock.now());
    expect(h.tape.debugState().state).toBe("flat-dormant");

    // A burst: four bins of real units, recorded on the store's clock.
    for (let i = 0; i < 4; i++) {
      meter.record(FULL_SCALE / 4, wallAt(h.clock.now()));
      h.tape.onActivity();
      h.clock.advance(BIN_MS);
    }
    expect(h.tape.debugState().state).toBe("live");
    expect(plotted()).toBeGreaterThan(0.5);

    // Nothing more is recorded. Past the rolling window plus one bin, every
    // bin the burst touched has aged out and the pen must be back at baseline.
    h.clock.advance(RATE_WINDOW_MS + BIN_MS + SAMPLE_MS * 2);
    expect(plotted()).toBe(0);
  });
});

describe("SparklineTape — one clock", () => {
  test("proposedT0 lands exactly on epoch multiples of the scroll's origin", () => {
    const h = makeHarness();
    const origin = h.clock.now();
    h.tape.start(origin);

    for (let ms = 0; ms < EPOCH_MS * 4; ms += 1_337) {
      const proposed = h.tape.proposedT0(origin + ms);
      const n = Math.floor(ms / EPOCH_MS);
      expect(proposed).toBe(origin + n * EPOCH_MS);
      // The transform the tape implies for that origin never runs past the
      // canvas: it is bounded below by one epoch's width.
      const implied = (-(origin + ms - proposed) / 1000) * (64 / 15);
      expect(implied).toBeLessThanOrEqual(0);
      expect(implied).toBeGreaterThanOrEqual((-EPOCH_MS / 1000) * (64 / 15));
    }
  });

  test("crossing a boundary advances committedT0 by exactly one epoch, once", () => {
    let level = 0.2;
    const h = makeHarness({ getSeries: () => seriesOf(level) });
    const origin = h.clock.now();
    h.tape.start(origin);
    expect(h.tape.committedT0()).toBe(origin);

    // Keep the tape live across the boundary so its own tick is running:
    // alternating the level clears the deadband on every tick.
    const seen = new Set<number>([h.tape.committedT0()]);
    for (let elapsed = 0; elapsed < EPOCH_MS + 2_000; elapsed += SAMPLE_MS) {
      level = level === 0.2 ? 0.8 : 0.2;
      h.clock.advance(SAMPLE_MS);
      h.tape.onActivity();
      seen.add(h.tape.committedT0());
    }

    expect(h.tape.debugState().state).toBe("live");
    expect([...seen].sort((a, b) => a - b)).toEqual([origin, origin + EPOCH_MS]);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(1);
  });

  test("every paint carries the committed origin until setEpochStart moves it", () => {
    let level = 0.2;
    const h = makeHarness({ getSeries: () => seriesOf(level) });
    const origin = h.clock.now();
    h.tape.start(origin);
    for (let elapsed = 0; elapsed < EPOCH_MS + 2_000; elapsed += SAMPLE_MS) {
      level = level === 0.2 ? 0.8 : 0.2;
      h.clock.advance(SAMPLE_MS);
      h.tape.onActivity();
    }
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(1);
    assertRebaseOrdering(h.calls);
  });

  test("both store-facing callbacks see the same converted clock", () => {
    const seriesOffsets: number[] = [];
    const channelOffsets: number[] = [];
    let clockRef: () => number = () => 0;
    const h = makeHarness({
      getSeries: (nowMs) => {
        seriesOffsets.push(nowMs - clockRef());
        return seriesOf(0.5);
      },
      getColorChannel: (nowMs) => {
        channelOffsets.push(nowMs - clockRef());
        return "text";
      },
    });
    clockRef = h.clock.now;
    h.tape.start(h.clock.now());
    h.clock.advance(SAMPLE_MS * 3);

    expect(seriesOffsets.length).toBeGreaterThan(1);
    expect(channelOffsets.length).toBeGreaterThan(1);
    // Whatever the offset is, it is ONE offset: constant across the run, the
    // same for both callbacks, and equal to wall-minus-monotonic.
    const offsets = new Set([...seriesOffsets, ...channelOffsets]);
    expect(offsets.size).toBe(1);
    const [offset] = [...offsets];
    expect(Math.abs(offset - (Date.now() - CLOCK_BASE))).toBeLessThan(1_000);
  });
});

describe("SparklineTape — the acknowledgement contract", () => {
  test("an ordinary paint carries no ack", () => {
    let level = 0.2;
    const h = makeHarness({ getSeries: () => seriesOf(level) });
    h.tape.start(h.clock.now());
    for (let i = 0; i < 6; i++) {
      level = level === 0.2 ? 0.8 : 0.2;
      h.clock.advance(SAMPLE_MS);
      h.tape.onActivity();
    }
    // The 4 Hz sample path stays one-directional: only a rebase may ask.
    for (const paint of h.paints()) expect(paint.ack).toBeNull();
  });

  test("acking from inside paint() throws — the deferral contract, pinned", () => {
    // The on-main painter draws synchronously; acking from inside paint()
    // would move the scroll from within the very paint acknowledging it. That
    // path defers through queueMicrotask, and THIS is what stops the deferral
    // being tidied away by a reader who cannot see why it is there.
    let victim: SparklineTape | null = null;
    const reentrant: SparklineSurface = {
      paint() {
        victim?.onPainted(1);
      },
      setEpochStart() {},
      pause() {},
      resume() {},
      stampChannel() {},
    };
    victim = new SparklineTape(reentrant, {
      now: () => CLOCK_BASE,
      getSeries: () => seriesOf(0),
      binMs: BIN_MS,
      fullScale: FULL_SCALE,
      curve: (x) => x,
      amplitude: AMPLITUDE,
      pxPerSec: 64 / 15,
      motion: true,
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {},
    });
    expect(() => victim?.start(CLOCK_BASE)).toThrow(/synchronously/);
  });

  test("ack latency does not disturb the tape's state machine", () => {
    const drive = (ackDelayMs: number | null): string => {
      let level = 0.2;
      const h = makeHarness({ getSeries: () => seriesOf(level) }, {}, ackDelayMs);
      h.tape.start(h.clock.now());
      for (let i = 0; i < 8; i++) {
        level = level === 0.2 ? 0.8 : 0.2;
        h.clock.advance(SAMPLE_MS);
        h.tape.onActivity();
      }
      h.clock.advance(DORMANT_AFTER_MS + 500);
      return h.tape.debugState().state;
    };
    // Prompt, slow, and never: dormancy is not ack-gated, so all three agree.
    expect(drive(0)).toBe(drive(400));
    expect(drive(0)).toBe(drive(null));
  });
});

describe("SparklineTape — the ack-gated rebase", () => {
  /** Drive a live tape across `spanMs`, keeping its own tick running. */
  const driveLive = (h: Harness, spanMs: number, level: { v: number }): void => {
    for (let elapsed = 0; elapsed < spanMs; elapsed += SAMPLE_MS) {
      level.v = level.v === 0.2 ? 0.8 : 0.2;
      h.clock.advance(SAMPLE_MS);
      h.tape.onActivity();
    }
  };

  test("the ordering invariant holds across every scenario the suite drives", () => {
    // Busy, idle, dormant-and-woken, hidden-and-shown — one trace each, all
    // walked by the same two invariants.
    const level = { v: 0.2 };
    const busy = makeHarness({ getSeries: () => seriesOf(level.v) });
    busy.tape.start(busy.clock.now());
    driveLive(busy, EPOCH_MS + 5_000, level);
    assertRebaseOrdering(busy.calls);

    const idle = makeHarness({ getSeries: () => seriesOf(0.5) });
    idle.tape.start(idle.clock.now());
    idle.clock.advance(EPOCH_MS * 2);
    idle.tape.onActivity();
    idle.clock.advance(5_000);
    assertRebaseOrdering(idle.calls);

    const scrolled = makeHarness({ getSeries: () => seriesOf(0.5) });
    scrolled.tape.start(scrolled.clock.now());
    hide(scrolled);
    scrolled.clock.advance(EPOCH_MS + 1_000);
    scrolled.tape.setVisible(true);
    scrolled.clock.advance(2_000);
    assertRebaseOrdering(scrolled.calls);
  });

  test("a rollover paints and asks, and moves nothing until it is answered", () => {
    const level = { v: 0.2 };
    const h = makeHarness({ getSeries: () => seriesOf(level.v) }, {}, null);
    h.tape.start(h.clock.now());
    const origin = h.tape.committedT0();
    driveLive(h, EPOCH_MS, level);

    const asked = h.paints().filter((p) => p.ack !== null);
    expect(asked).toHaveLength(1);
    expect(asked[0].t0).toBe(origin + EPOCH_MS);
    // Nothing has answered, and the watchdog has not run yet.
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(0);
    expect(h.tape.committedT0()).toBe(origin);
  });

  test("a flat tape earns no shortcut: its rollover asks too", () => {
    // Born live, then left alone until it retires. Its picture is provably
    // flat, and it STILL goes through the ack — because drawSparkline clears
    // the canvas and starts at the oldest point, so a rollover moves the
    // viewport onto cleared pixels whether the tape is flat or not.
    const h = makeHarness({ getSeries: () => seriesOf(0.5) }, {}, null);
    h.tape.start(h.clock.now());
    h.clock.advance(EPOCH_MS + 1_000);
    expect(h.tape.debugState().state).toBe("flat-dormant");

    h.tape.onActivity(); // below deadband → no wake, no rebase
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(0);

    hide(h);
    h.tape.setVisible(true);
    const asked = h.paints().filter((p) => p.ack !== null);
    expect(asked.length).toBeGreaterThan(0);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(0);
  });

  test("a superseded sequence never lands, however its acks are ordered", () => {
    const level = { v: 0.2 };
    const h = makeHarness({ getSeries: () => seriesOf(level.v) }, {}, null);
    h.tape.start(h.clock.now());
    const origin = h.tape.committedT0();
    driveLive(h, EPOCH_MS, level);

    const first = h.paints().filter((p) => p.ack !== null);
    expect(first).toHaveLength(1);
    const stale = first[0].ack ?? 0;

    // The canvas is re-claimed under the tape: the sequence is orphaned and
    // the next tick proposes the same origin afresh.
    h.tape.cancelRebase();
    driveLive(h, SAMPLE_MS, level);
    const asked = h.paints().filter((p) => p.ack !== null);
    expect(asked).toHaveLength(2);
    const newest = asked[1].ack ?? 0;
    expect(newest).toBeGreaterThan(stale);

    // Deliver them out of order. Only the newest may move anything.
    h.tape.onPainted(stale);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(0);
    h.tape.onPainted(newest);
    expect(h.tape.committedT0()).toBe(origin + EPOCH_MS);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(1);
    assertRebaseOrdering(h.calls);
  });

  test("a surface that never acks still converges, on the watchdog", () => {
    const level = { v: 0.2 };
    const h = makeHarness({ getSeries: () => seriesOf(level.v) }, {}, null);
    h.tape.start(h.clock.now());
    const origin = h.tape.committedT0();
    driveLive(h, EPOCH_MS, level);
    expect(h.tape.committedT0()).toBe(origin);

    h.clock.advance(REBASE_ACK_TIMEOUT_MS + 10);
    expect(h.tape.committedT0()).toBe(origin + EPOCH_MS);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(1);
    assertRebaseOrdering(h.calls);
  });

  test("a wake whose ack is lost still resumes — a paused tape is the failure", () => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5) }, {}, null);
    h.tape.start(h.clock.now());
    const origin = h.tape.committedT0();

    hide(h);
    expect(h.kinds()).toContain("pause");
    h.clock.advance(EPOCH_MS + 1_000);
    // Activity arriving while hidden does not wake, but it does mean there is
    // something to show on re-entry — so this is the wake that resumes.
    h.tape.onActivity();
    const mark = h.calls.length;
    h.tape.setVisible(true);

    // The rebase is in flight and nothing will ever answer it, so the scroll
    // is still stopped: this is the failure the watchdog exists to bound.
    expect(h.kinds().slice(mark)).not.toContain("resume");
    h.clock.advance(REBASE_ACK_TIMEOUT_MS + 10);

    expect(h.tape.committedT0()).toBe(origin + EPOCH_MS);
    const order = h.kinds().slice(mark);
    expect(order.indexOf("resume")).toBeGreaterThan(order.indexOf("setEpochStart"));
  });

  test("a late ack after the watchdog committed is a no-op", () => {
    const level = { v: 0.2 };
    const h = makeHarness({ getSeries: () => seriesOf(level.v) }, {}, null);
    h.tape.start(h.clock.now());
    driveLive(h, EPOCH_MS, level);
    const asked = h.paints().filter((p) => p.ack !== null);
    h.clock.advance(REBASE_ACK_TIMEOUT_MS + 10);
    const committed = h.tape.committedT0();

    h.tape.onPainted(asked[asked.length - 1].ack ?? 0);
    expect(h.tape.committedT0()).toBe(committed);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(1);
  });

  test("cancelRebase orphans the ack and disarms the watchdog", () => {
    const level = { v: 0.2 };
    const h = makeHarness({ getSeries: () => seriesOf(level.v) }, {}, null);
    h.tape.start(h.clock.now());
    const origin = h.tape.committedT0();
    driveLive(h, EPOCH_MS, level);
    const asked = h.paints().filter((p) => p.ack !== null);

    h.tape.cancelRebase();
    h.tape.onPainted(asked[asked.length - 1].ack ?? 0);
    h.clock.advance(REBASE_ACK_TIMEOUT_MS + 10);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(0);
    expect(h.tape.committedT0()).toBe(origin);

    // …and the tape re-proposes on its next tick rather than being stuck.
    driveLive(h, SAMPLE_MS * 2, level);
    expect(h.paints().filter((p) => p.ack !== null).length).toBeGreaterThan(
      asked.length,
    );
  });

  test("a tape paused across a boundary rolls over on resume", () => {
    // Proof that the trigger is the clock comparison and not anim.onfinish:
    // a paused animation never finishes, so onfinish could never fire here.
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    h.tape.start(h.clock.now());
    const origin = h.tape.committedT0();

    hide(h);
    h.clock.advance(EPOCH_MS * 3 + 1_000);
    expect(h.tape.committedT0()).toBe(origin);

    h.tape.setVisible(true);
    h.clock.advance(SAMPLE_MS);
    expect(h.tape.committedT0()).toBe(origin + 3 * EPOCH_MS);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(1);
  });
});

describe("SparklineTape — off screen is a pause, not a teardown", () => {
  test("a hidden→visible cycle pauses, then paints, moves, and resumes in order", () => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    h.tape.start(h.clock.now());
    expect(h.tape.debugState().state).toBe("live");

    hide(h);
    expect(h.tape.debugState().state).toBe("hidden-paused");
    expect(h.kinds()).toContain("pause");

    // Long enough off screen to cross a boundary, so the wake has a real
    // rebase to gate on rather than an immediate resume.
    h.clock.advance(EPOCH_MS + 1_000);
    h.tape.onActivity(); // remembered, not acted on — the tape is off screen
    const mark = h.calls.length;
    h.tape.setVisible(true);
    h.clock.advance(SAMPLE_MS);

    const order = h.kinds().slice(mark);
    // Paint first, then the origin, then the scroll. Resuming before the
    // origin moved would run the scroll from a stale one.
    expect(order.indexOf("paint")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("setEpochStart")).toBeGreaterThan(order.indexOf("paint"));
    expect(order.indexOf("resume")).toBeGreaterThan(order.indexOf("setEpochStart"));
    assertRebaseOrdering(h.calls);
  });

  test("a cycle longer than one epoch resumes with exactly one origin move", () => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    h.tape.start(h.clock.now());
    const origin = h.tape.committedT0();

    hide(h);
    h.clock.advance(EPOCH_MS * 4 + 3_000);
    h.tape.onActivity();
    h.tape.setVisible(true);
    h.clock.advance(SAMPLE_MS);

    // Four epochs went by while the scroll was stopped, and they are collapsed
    // into one move — not four, and not none.
    expect(h.tape.committedT0()).toBe(origin + 4 * EPOCH_MS);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(1);
  });

  test("a flat tape takes the same ack-gated path and still never tears down", () => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    h.tape.start(h.clock.now());
    h.clock.advance(DORMANT_AFTER_MS + 500);
    expect(h.tape.debugState().state).toBe("flat-dormant");
    const origin = h.tape.committedT0();

    hide(h);
    h.clock.advance(EPOCH_MS + 1_000);
    h.tape.setVisible(true);
    h.clock.advance(SAMPLE_MS);

    // Flatness earns no shortcut: the origin still moved through a paint.
    expect(h.tape.committedT0()).toBe(origin + EPOCH_MS);
    assertRebaseOrdering(h.calls);
    // And the scroll is still stopped — the tape had nothing recent to show,
    // so it stays inert rather than being restarted by the rebase.
    const order = h.kinds();
    expect(order.lastIndexOf("pause")).toBeGreaterThan(order.lastIndexOf("resume"));
  });

  test("entering either dormancy emits no paint and no origin move", () => {
    // Flat-off: the finisher stops the tape, it does not rebase it.
    const flat = makeHarness({ getSeries: () => seriesOf(0.5) });
    flat.tape.start(flat.clock.now());
    flat.clock.advance(DORMANT_AFTER_MS - 2_000);
    const flatMark = flat.calls.length;
    flat.clock.advance(2_500);
    expect(flat.tape.debugState().state).toBe("flat-dormant");
    expect(flat.kinds().slice(flatMark)).toEqual(["pause"]);

    // Hidden: nothing is disturbed at all — no `t0` move, no repaint, no
    // rebuild. The picture is arbitrary, and it is left exactly as it was.
    // Let the settle burst retire first so what is left in the trace is only
    // what going off screen did.
    const hidden = makeHarness({ getSeries: () => seriesOf(0.5) });
    hidden.tape.start(hidden.clock.now());
    hidden.clock.advance(RATE_WINDOW_MS + BIN_MS + SAMPLE_MS * 2);
    const hiddenMark = hidden.calls.length;
    hide(hidden);
    expect(hidden.kinds().slice(hiddenMark)).toEqual(["pause"]);
  });

  test("hidden past its deadline settles to flat-dormant without a second pause", () => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    h.tape.start(h.clock.now());
    hide(h);
    expect(h.tape.debugState().state).toBe("hidden-paused");
    const pauses = () => h.kinds().filter((k) => k === "pause").length;
    expect(pauses()).toBe(1);

    // The flat-off finisher keeps running while hidden: whether the last
    // change has scrolled off is a fact about the data, not about who is
    // looking. It converges on the more specific state, and the scroll — which
    // is already stopped — is not stopped again.
    h.clock.advance(DORMANT_AFTER_MS + 500);
    expect(h.tape.debugState().state).toBe("flat-dormant");
    expect(pauses()).toBe(1);
    expect(h.clock.pending).toBe(0);
  });

  test("activity while hidden is remembered, not acted on, and wakes on re-entry", () => {
    let level = 0.2;
    const h = makeHarness({ getSeries: () => seriesOf(level) });
    h.tape.start(h.clock.now());
    hide(h);
    const mark = h.calls.length;

    // A real change lands while the tape is off screen. Nothing is drawn —
    // there is nobody to draw for — but the tape remembers that its window is
    // no longer quiet.
    level = 0.8;
    h.clock.advance(2_000);
    h.tape.onActivity();
    expect(h.calls.slice(mark)).toHaveLength(0);
    expect(h.tape.debugState().state).toBe("hidden-paused");

    // Re-entry rebuilds from the caller's real history and resumes live.
    h.tape.setVisible(true);
    expect(h.tape.debugState().state).toBe("live");
    expect(h.kinds().slice(mark)).toContain("paint");
    expect(h.kinds().slice(mark)).toContain("resume");
  });

  test("no scenario in the suite ever recreates or cancels the scroll", () => {
    // The falsifiable form of "off screen is a pause": the surface has no
    // teardown verb at all, so the only motion calls a trace may contain are
    // pause/resume/setEpochStart. A design that tore down would need one.
    const level = { v: 0.2 };
    const h = makeHarness({ getSeries: () => seriesOf(level.v) });
    h.tape.start(h.clock.now());
    for (let i = 0; i < 6; i++) {
      hide(h);
      h.clock.advance(SAMPLE_MS * 3);
      h.tape.setVisible(true);
      level.v = level.v === 0.2 ? 0.8 : 0.2;
      h.tape.onActivity();
      h.clock.advance(SAMPLE_MS * 3);
    }
    const allowed = new Set(["paint", "setEpochStart", "pause", "resume", "stampChannel"]);
    for (const kind of h.kinds()) expect(allowed.has(kind)).toBe(true);
    assertRebaseOrdering(h.calls);
  });
});

describe("SparklineTape — the visibility gate does not flap", () => {
  /** A live tape, and a count of how many times its scroll was stopped. */
  const liveTape = (): { h: Harness; pauses: () => number } => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    h.tape.start(h.clock.now());
    expect(h.tape.debugState().state).toBe("live");
    return { h, pauses: () => h.kinds().filter((k) => k === "pause").length };
  };

  test("a crossing that reverses inside the window pauses nothing", () => {
    const { h, pauses } = liveTape();
    h.tape.setVisible(false);
    h.clock.advance(HIDDEN_PAUSE_DELAY_MS - 50);
    h.tape.setVisible(true);
    h.clock.advance(HIDDEN_PAUSE_DELAY_MS * 2);

    // The tape never learned it had left: re-entry cancelled the wait, so
    // there was nothing to wake from and nothing to rebuild.
    expect(pauses()).toBe(0);
    expect(h.tape.debugState().state).toBe("live");
  });

  test("a crossing that outlasts the window pauses exactly once", () => {
    const { h, pauses } = liveTape();
    h.tape.setVisible(false);
    h.clock.advance(HIDDEN_PAUSE_DELAY_MS + 50);
    expect(pauses()).toBe(1);
    expect(h.tape.debugState().state).toBe("hidden-paused");

    // Still out of view, and still one pause — the gate does not re-arm
    // against an element that never came back.
    h.clock.advance(HIDDEN_PAUSE_DELAY_MS * 4);
    h.tape.setVisible(false);
    expect(pauses()).toBe(1);
  });

  test("a flap storm inside one window arms one wait and stops nothing", () => {
    const { h, pauses } = liveTape();
    // Twenty alternations spread across less than one hysteresis window — the
    // shape a row near a list's clip edge makes while the rows around it
    // re-measure on every pulse beat.
    for (let i = 0; i < 20; i++) {
      h.tape.setVisible(false);
      h.clock.advance(HIDDEN_PAUSE_DELAY_MS / 40);
      h.tape.setVisible(true);
      h.clock.advance(HIDDEN_PAUSE_DELAY_MS / 40);
    }
    expect(pauses()).toBe(0);
    expect(h.tape.debugState().state).toBe("live");

    // One more crossing, left to stand: exactly ONE wait was armed by the
    // storm, so exactly one pause comes out of it — not twenty.
    h.tape.setVisible(false);
    h.clock.advance(HIDDEN_PAUSE_DELAY_MS + 50);
    expect(pauses()).toBe(1);
  });

  test("every state change is reported exactly once, and quiet means quiet", () => {
    const seen: string[] = [];
    const h = makeHarness({
      getSeries: () => seriesOf(0.5),
      onTransition: (from, to) => seen.push(`${from} → ${to}`),
    });
    h.tape.start(h.clock.now());
    expect(seen).toEqual(["flat-dormant → live"]);

    // A flap storm is the case that matters: the dev log is how a human reads
    // whether the gate is churning, so a storm that changes nothing must
    // WRITE nothing, or a quiet log would stop meaning anything.
    for (let i = 0; i < 20; i++) {
      h.tape.setVisible(false);
      h.clock.advance(HIDDEN_PAUSE_DELAY_MS / 40);
      h.tape.setVisible(true);
      h.clock.advance(HIDDEN_PAUSE_DELAY_MS / 40);
    }
    expect(seen).toEqual(["flat-dormant → live"]);

    hide(h);
    expect(seen).toEqual(["flat-dormant → live", "live → hidden-paused"]);
  });
});

describe("SparklineTape — registration is verified, not assumed", () => {
  /**
   * A live tape, plus the animation position that would make it perfectly
   * registered right now. Every case below offsets from that by a known number
   * of CSS px, so the band boundaries are read in the units the band is stated
   * in.
   */
  const registered = (): { h: Harness; atDriftPx: (px: number) => number } => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    h.tape.start(h.clock.now());
    const pxPerSec = 64 / 15;
    return {
      h,
      atDriftPx: (px) =>
        h.clock.now() - h.tape.committedT0() + (px / pxPerSec) * 1000,
    };
  };

  test("the band, both signs: ignore, nudge, and escalate", () => {
    const { h, atDriftPx } = registered();
    for (const sign of [1, -1]) {
      // Slop smaller than the line the tape is drawn with.
      expect(h.tape.checkRegistration(atDriftPx(sign * 0.4)).kind).toBe("ok");
      expect(h.tape.checkRegistration(atDriftPx(sign * 0.99)).kind).toBe("ok");

      // Correctable in place: the write puts the scroll back onto the origin
      // the pixels on screen were already drawn for.
      const nudge = h.tape.checkRegistration(atDriftPx(sign * 1.5));
      expect(nudge.kind).toBe("nudge");
      if (nudge.kind === "nudge") expect(nudge.startTimeMs).toBe(h.tape.committedT0());

      // The boundary itself escalates — the band is CAPPED, not open-ended,
      // and that is the whole reason an unrepainted write is allowed below it.
      expect(h.tape.checkRegistration(atDriftPx(sign * 2)).kind).toBe("rebase");
      expect(h.tape.checkRegistration(atDriftPx(sign * 400)).kind).toBe("rebase");
    }
  });

  test("a scroll that is not running is never merely nudged", () => {
    const { h } = registered();
    // Not "slightly out of register" — not registered at all. A nudge writes a
    // start time and walks away; only the ack-gated path can put this right.
    expect(h.tape.checkRegistration(null).kind).toBe("rebase");
  });

  test("reduced motion has no registration to keep", () => {
    const h = makeHarness({ getSeries: () => seriesOf(0.5), motion: false });
    h.tape.start(h.clock.now());
    expect(h.tape.checkRegistration(null).kind).toBe("ok");
    expect(h.tape.checkRegistration(999_999).kind).toBe("ok");
  });

  test("a nudge verdict moves nothing on its own", () => {
    const { h, atDriftPx } = registered();
    const mark = h.calls.length;
    for (let i = 0; i < 10; i++) h.tape.checkRegistration(atDriftPx(1.5));
    // The verdict is a statement, not an action: `committedT0` is untouched and
    // no origin moved, so the ordering and single-`t0` invariants are unharmed
    // by the self-check existing at all.
    expect(h.calls.slice(mark)).toHaveLength(0);
    assertRebaseOrdering(h.calls);
  });

  test("an escalation re-registers through the ack, onto the same origin", () => {
    const { h, atDriftPx } = registered();
    const origin = h.tape.committedT0();
    expect(h.tape.checkRegistration(atDriftPx(400)).kind).toBe("rebase");

    const mark = h.calls.length;
    h.tape.resyncRegistration();
    h.clock.advance(1);

    // The picture was right and the SCROLL was wrong, so the origin it lands
    // back on is the one already committed — the case an ordinary rebase's
    // "nothing to do" early return would swallow.
    const emitted = h.calls.slice(mark);
    expect(emitted[0].kind).toBe("paint");
    expect(emitted[0].t0).toBe(origin);
    expect(emitted[0].ack).not.toBeNull();
    expect(emitted.some((c) => c.kind === "setEpochStart")).toBe(true);
    expect(h.tape.committedT0()).toBe(origin);
    assertRebaseOrdering(h.calls);
  });

  test("the check runs on the live tick and nowhere else", () => {
    let ticks = 0;
    const h = makeHarness({
      getSeries: () => seriesOf(0.5),
      onLiveTick: () => {
        ticks += 1;
      },
    });
    h.tape.start(h.clock.now());
    h.clock.advance(SAMPLE_MS * 4);
    expect(ticks).toBeGreaterThan(0);

    // Off screen: the settle burst is stopped, so the check costs nothing.
    // (The hysteresis window itself is still live time, so the count is taken
    // once the tape has actually gone.)
    hide(h);
    const whileHidden = ticks;
    h.clock.advance(SAMPLE_MS * 20);
    expect(ticks).toBe(whileHidden);

    // And once the tape retires, likewise — an idle tape runs zero work, which
    // is the standing contract the self-check must not break.
    h.tape.setVisible(true);
    h.clock.advance(DORMANT_AFTER_MS + 1_000);
    expect(h.tape.debugState().state).toBe("flat-dormant");
    const whileFlat = ticks;
    h.clock.advance(SAMPLE_MS * 20);
    expect(ticks).toBe(whileFlat);
  });

  test("a stalled animation clock escalates at most once while it is stalled", () => {
    // The Q01 shape: the animation's position holds while the tape's clock runs
    // on, so the divergence grows without bound. Gated on visibility in the
    // component, the tape sees exactly one escalation — the resync on return.
    const { h } = registered();
    const frozen = h.clock.now() - h.tape.committedT0();
    h.clock.advance(EPOCH_MS / 2);

    // Every tick's verdict would be `rebase`; the component runs none of them
    // while hidden, and one when it comes back.
    expect(h.tape.checkRegistration(frozen).kind).toBe("rebase");
    h.tape.resyncRegistration();
    h.clock.advance(REBASE_ACK_TIMEOUT_MS + 10);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(1);
    assertRebaseOrdering(h.calls);
  });
});

describe("SparklineTape — surviving a canvas swapped out from under it", () => {
  test("repaint redraws the committed picture and moves nothing", () => {
    // The canvas was re-claimed at a new resolution: the new worker entry
    // starts with an EMPTY tape, and the tape effect does not re-run for a
    // resolution change. A live tape would recover on its next settle tick; a
    // flat-dormant one has no next tick, so without this it would stay blank
    // until its next activity — possibly never.
    const h = makeHarness({ getSeries: () => seriesOf(0.5) });
    h.tape.start(h.clock.now());
    h.clock.advance(DORMANT_AFTER_MS + 500);
    expect(h.tape.debugState().state).toBe("flat-dormant");

    const mark = h.calls.length;
    h.tape.repaint();
    const emitted = h.calls.slice(mark);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].kind).toBe("paint");
    expect(emitted[0].t0).toBe(h.tape.committedT0());
    // A repaint is not a rebase: it redraws what is already true.
    expect(emitted[0].ack).toBeNull();
    expect(emitted[0].points).toBeGreaterThan(0);
  });

  test("cancel-then-repaint mid-rebase leaves the tape able to roll over again", () => {
    const level = { v: 0.2 };
    const h = makeHarness({ getSeries: () => seriesOf(level.v) }, {}, null);
    h.tape.start(h.clock.now());
    const origin = h.tape.committedT0();
    for (let elapsed = 0; elapsed < EPOCH_MS; elapsed += SAMPLE_MS) {
      level.v = level.v === 0.2 ? 0.8 : 0.2;
      h.clock.advance(SAMPLE_MS);
      h.tape.onActivity();
    }
    const orphaned = h.paints().filter((p) => p.ack !== null);
    expect(orphaned).toHaveLength(1);

    // Exactly what the claim effect does when it swaps painters underneath a
    // tape with a rebase in flight.
    h.tape.cancelRebase();
    h.tape.repaint();

    // The orphaned sequence can never land, and its watchdog is disarmed —
    // otherwise the origin would move on the back of pixels drawn onto a
    // canvas that no longer exists.
    h.tape.onPainted(orphaned[0].ack ?? 0);
    h.clock.advance(REBASE_ACK_TIMEOUT_MS + 10);
    expect(h.calls.filter((c) => c.kind === "setEpochStart")).toHaveLength(0);
    expect(h.tape.committedT0()).toBe(origin);

    // And the tape is not stuck: its next tick re-proposes the same rollover.
    level.v = 0.8;
    h.clock.advance(SAMPLE_MS);
    h.tape.onActivity();
    const reissued = h.paints().filter((p) => p.ack !== null);
    expect(reissued.length).toBeGreaterThan(1);
    expect(reissued[reissued.length - 1].t0).toBe(origin + EPOCH_MS);
    assertRebaseOrdering(h.calls);
  });
});

describe("the wall-clock seam is not re-crossed", () => {
  test("`Date.now(` appears exactly once across the tape path", async () => {
    const files = [
      "src/lib/sparkline-tape.ts",
      "src/components/tugways/tug-sparkline.tsx",
    ];
    let occurrences = 0;
    for (const path of files) {
      const source = await Bun.file(new URL(`../../../${path}`, import.meta.url)).text();
      // Comments name the seam freely; only real calls count.
      occurrences += source
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n")
        .split("Date.now(").length - 1;
    }
    // Not zero and not two: removing the conversion kills the rate decay, and
    // adding a second one is how two clocks get used interchangeably again.
    expect(occurrences).toBe(1);
  });
});

describe("drawSparkline — the staircase, pinned", () => {
  test("emits the held tail and the area's two baseline closers", () => {
    const ops: string[] = [];
    const round = (n: number): number => Math.round(n * 100) / 100;
    const ctx = {
      setTransform: () => ops.push("setTransform"),
      clearRect: () => ops.push("clearRect"),
      beginPath: () => ops.push("beginPath"),
      moveTo: (x: number, y: number) => ops.push(`moveTo ${round(x)} ${round(y)}`),
      lineTo: (x: number, y: number) => ops.push(`lineTo ${round(x)} ${round(y)}`),
      closePath: () => ops.push("closePath"),
      fill: () => ops.push("fill"),
      stroke: () => ops.push("stroke"),
      globalAlpha: 1,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineJoin: "round",
      lineCap: "round",
    } as unknown as CanvasRenderingContext2D;

    const t0 = 0;
    const tape: SparklinePoint[] = [
      { t: 0, v: 0 },
      { t: 1000, v: 0.5 },
      { t: 2000, v: 1 },
    ];
    drawSparkline(
      ctx,
      {
        width: 60,
        svgWidth: 100,
        height: 22,
        dpr: 2,
        baselineY: 20.5,
        amplitude: 20,
        pxPerSec: 4,
        retainMs: 19_000,
      },
      { line: "#fff", area: "#fff", lineAlpha: 0.85, areaAlpha: 0.16, lineWidth: 1 },
      tape,
      t0,
    );

    expect(ops).toEqual([
      "setTransform",
      "clearRect",
      "beginPath",
      "moveTo 60 20.5",
      "lineTo 64 20.5", // flat hold across the first second…
      "lineTo 64 10.5", // …then the step
      "lineTo 68 10.5",
      "lineTo 68 0.5",
      "lineTo 100 0.5", // the held tail, past the right edge
      "lineTo 100 20.5", // area: down to the baseline…
      "lineTo 60 20.5", // …and back along it
      "closePath",
      "fill",
      "beginPath",
      "moveTo 60 20.5",
      "lineTo 64 20.5",
      "lineTo 64 10.5",
      "lineTo 68 10.5",
      "lineTo 68 0.5",
      "lineTo 100 0.5",
      "stroke",
    ]);
  });
});
