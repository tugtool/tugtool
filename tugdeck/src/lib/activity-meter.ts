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
 *  - **gauge** (`cpu | memory | disk`): a level, not a flow. OS samples
 *    arrive at ~1 Hz into 250 ms bins, so three of every four bins are
 *    empty; zero-filling would strobe the line between its real value and
 *    zero. Instead the gauge **sample-and-holds**: it returns the last
 *    observed value for any bin within a TTL (~2× the sample interval),
 *    decaying to zero only once samples actually stop.
 *
 * NOT React state: both are high-churn, mutated per frame and read
 * imperatively on the consumer's timer, painted straight to SVG ([L02],
 * [L06], [P03]).
 *
 * @module lib/activity-meter
 */

/** Width of one bin, in ms (4 Hz) — matches tugcode's `activity_delta` flush. */
export const ACTIVITY_BIN_MS = 250;
/** Bins retained — enough for a rolling ~1s rate with headroom. */
export const ACTIVITY_WINDOW_BINS = 40;
/**
 * Default gauge hold: a gauge value survives this long between samples
 * before decaying to zero. ~2× the 1 Hz OS sample interval so a single
 * dropped tick doesn't blink the level off.
 */
export const GAUGE_TTL_MS = 2_100;

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
 * Gauge meter: sample-and-hold. Holds the last observed value for `ttlMs`,
 * returning it for every bin in the window so the sparkline draws a flat
 * level at the current reading; once no sample has landed within the TTL
 * the level decays to zero.
 */
export class GaugeMeter implements ActivityMeterLike {
  private readonly windowBins: number;
  private readonly ttlMs: number;
  private latestValue: number | null = null;
  private latestAtMs = 0;

  constructor(
    windowBins: number = ACTIVITY_WINDOW_BINS,
    ttlMs: number = GAUGE_TTL_MS,
  ) {
    this.windowBins = windowBins;
    this.ttlMs = ttlMs;
  }

  record(value: number, atMs: number): void {
    if (!Number.isFinite(value)) return;
    this.latestValue = value;
    this.latestAtMs = atMs;
  }

  series(nowMs: number): number[] {
    const held = this.heldValue(nowMs);
    return new Array<number>(this.windowBins).fill(held);
  }

  raw(nowMs: number): number | null {
    if (this.latestValue === null) return null;
    return nowMs - this.latestAtMs <= this.ttlMs ? this.latestValue : null;
  }

  private heldValue(nowMs: number): number {
    if (this.latestValue === null) return 0;
    return nowMs - this.latestAtMs <= this.ttlMs ? this.latestValue : 0;
  }
}
