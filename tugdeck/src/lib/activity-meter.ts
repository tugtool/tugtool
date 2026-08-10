/**
 * Activity meters — the per-channel rolling-bin records behind the
 * {@link SessionActivityStore} ([P02]). Two aggregation kinds:
 *
 *  - **rate** (`text | tokens | tools | subagents`): work accumulated into
 *    fixed 250 ms wall-clock bins. `series` returns the per-bin counts
 *    oldest→newest; the sparkline sums the trailing window into a
 *    per-second rate. Advancing past idle bins zero-fills them, so a
 *    stalled turn decays to a flat line on its own. This is the
 *    ThroughputMeter behavior the deck used to derive locally, relocated
 *    intact so the compact strip's feel is unchanged.
 *
 *  - **gauge** (`cpu | memory | disk`): a level, not a flow. The gauge
 *    **sample-and-holds indefinitely** under the emitter's
 *    no-news-is-no-news contract: tugcast publishes a gauge only when it
 *    changes, and publishes a final zero when a session's subtree dies,
 *    so an unchanged level simply receives no frames — the hold is the
 *    truth, and there is no TTL to decay it into a lie.
 *
 * NOT React state: both are high-churn, mutated per sample and read
 * imperatively by consumers woken from the store's activity events,
 * painted outside React ([L02], [L06], [P03]).
 *
 * @module lib/activity-meter
 */

/** Width of one bin, in ms (4 Hz) — matches tugcode's `activity_delta` flush. */
export const ACTIVITY_BIN_MS = 250;
/**
 * Bins retained. The window serves two consumers, and the LARGER one sets it:
 * the rolling ~1s rate needs only a handful of trailing bins, but the
 * sparkline reconstructs its whole picture from these bins on every rebuild —
 * a wake from a hidden pause, a masthead remount when a stacked pane's
 * frontmost tab flips, a resolution change. `SparklineTape.rebuildTape`
 * reaches back `DORMANT_AFTER_MS` (the visible span plus the prune margin,
 * 19 s) and zero-seeds anything the bins do not cover, so a window shorter
 * than that FABRICATES emptiness over a span the screen was just showing:
 * the tape visibly clears and refills from the right. 80 bins is 20 s —
 * the reconstruction span with one second of slack. The invariant is pinned
 * by `sparkline-tape.test.ts`.
 */
export const ACTIVITY_WINDOW_BINS = 80;

/** Shared surface both meter kinds expose to the store. */
export interface ActivityMeterLike {
  record(value: number, atMs: number): void;
  /** Window snapshot oldest→newest as of `nowMs`. */
  series(nowMs: number): number[];
  /** Latest held value, or null when there is none (gauge) / for rates. */
  raw(nowMs: number): number | null;
}

/**
 * Rate meter: fixed-bin accumulation with zero-fill-on-advance decay.
 * Structurally the former `ThroughputMeter`, generalized to any rate
 * channel.
 */
export class RateMeter implements ActivityMeterLike {
  private readonly bins: Float64Array;
  private readonly binMs: number;
  /** Absolute index (floor(ms/binMs)) of the newest bin; -1 until first use. */
  private headBin = -1;

  constructor(
    binMs: number = ACTIVITY_BIN_MS,
    windowBins: number = ACTIVITY_WINDOW_BINS,
  ) {
    this.binMs = binMs;
    this.bins = new Float64Array(windowBins);
  }

  record(units: number, atMs: number): void {
    if (!(units > 0)) return;
    const bin = Math.floor(atMs / this.binMs);
    this.advanceTo(bin);
    this.bins[this.indexFor(bin)] += units;
  }

  series(nowMs: number): number[] {
    this.advanceTo(Math.floor(nowMs / this.binMs));
    const n = this.bins.length;
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const bin = this.headBin - (n - 1) + i;
      out[i] = bin < 0 ? 0 : this.bins[this.indexFor(bin)];
    }
    return out;
  }

  /** Rates have no held "current value"; the series carries their shape. */
  raw(): number | null {
    return null;
  }

  private advanceTo(bin: number): void {
    if (this.headBin < 0) {
      this.headBin = bin;
      return;
    }
    if (bin <= this.headBin) return;
    const n = this.bins.length;
    const gap = bin - this.headBin;
    if (gap >= n) {
      this.bins.fill(0);
    } else {
      for (let k = 1; k <= gap; k++) {
        this.bins[this.indexFor(this.headBin + k)] = 0;
      }
    }
    this.headBin = bin;
  }

  private indexFor(bin: number): number {
    const n = this.bins.length;
    return ((bin % n) + n) % n;
  }
}

/**
 * Gauge meter: sample-and-hold, held INDEFINITELY. The emitter's contract
 * is "no news is no news": tugcast's resource sampler publishes a gauge
 * channel only when its value changes, and publishes one final zero frame
 * when a session's subtree dies — so between frames the held level IS the
 * truth, and a time-based decay here would turn a steady reading into a
 * lie. The level moves on the next sample or falls to the emitter's final
 * zero; it never expires on its own.
 */
export class GaugeMeter implements ActivityMeterLike {
  private readonly windowBins: number;
  private latestValue: number | null = null;

  constructor(windowBins: number = ACTIVITY_WINDOW_BINS) {
    this.windowBins = windowBins;
  }

  record(value: number, _atMs: number): void {
    if (!Number.isFinite(value)) return;
    this.latestValue = value;
  }

  series(_nowMs: number): number[] {
    return new Array<number>(this.windowBins).fill(this.latestValue ?? 0);
  }

  raw(_nowMs: number): number | null {
    return this.latestValue;
  }
}
