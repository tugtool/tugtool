/**
 * ThroughputMeter — a per-session rolling record of streamed output
 * velocity, binned into fixed wall-clock buckets. Feeds the PULSE
 * sparkline's "how hard is the model working right now" display.
 *
 * Units are arbitrary-but-consistent (the strip feeds streamed character
 * counts); the sparkline auto-scales, so the absolute number never shows.
 *
 * NOT React state: this is high-churn data mutated on every streamed delta
 * and read imperatively by the sparkline canvas via rAF. It deliberately
 * stays out of the store snapshot ([L02]) and never drives a re-render
 * ([L06] — appearance is painted straight to canvas).
 *
 * @module lib/throughput-meter
 */

/** Width of one bucket, in ms. */
export const THROUGHPUT_BIN_MS = 1_000;
/** Number of buckets retained — the sparkline's visible window. */
export const THROUGHPUT_WINDOW_BINS = 45;

export class ThroughputMeter {
  private readonly bins: Float64Array;
  private readonly binMs: number;
  /** Absolute index (floor(ms/binMs)) of the newest bin; -1 until first use. */
  private headBin = -1;

  constructor(
    binMs: number = THROUGHPUT_BIN_MS,
    windowBins: number = THROUGHPUT_WINDOW_BINS,
  ) {
    this.binMs = binMs;
    this.bins = new Float64Array(windowBins);
  }

  /** Add `units` of streamed output observed at `atMs`. */
  record(units: number, atMs: number): void {
    if (!(units > 0)) return;
    const bin = Math.floor(atMs / this.binMs);
    this.advanceTo(bin);
    this.bins[this.indexFor(bin)] += units;
  }

  /**
   * Snapshot the window oldest→newest as of `nowMs`. Advancing past idle
   * bins zero-fills them, so a stalled turn decays to a flat line on its
   * own — no separate "clear" call needed.
   */
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

  /** Roll the head forward to `bin`, zero-filling the newly exposed slots. */
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
