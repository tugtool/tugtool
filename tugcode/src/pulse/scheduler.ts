/**
 * BeatScheduler — the daemon's beat discipline as pure logic.
 *
 * Event-driven, coalescing, stale-dropping, idle-silent:
 *
 *  - Facts accumulate in a pending queue (bounded; oldest dropped).
 *  - A beat fires no sooner than `coalesceMs` after the first pending
 *    fact (gathering the burst) and no sooner than `minIntervalMs`
 *    after the previous dispatch (rate bound while facts flow).
 *  - One beat is in flight at a time. A reply older than `staleMs`
 *    is dropped, not emitted — a late line describing a previous
 *    state is worse than no line. An in-flight beat whose reply never
 *    arrives stops blocking after `staleMs`.
 *  - No pending facts → no beats. Idle is silent.
 *
 * Every method takes explicit wall-clock ms — the class never reads a
 * clock — so the whole discipline is unit-testable with a fake clock.
 * The caller (main loop) polls `takeBeat` on a coarse interval.
 *
 * @module pulse/scheduler
 */

import type { PulseFact } from "./types";

export interface BeatSchedulerOptions {
  /** Gather window after the first pending fact. */
  coalesceMs?: number;
  /** Minimum spacing between beat dispatches. */
  minIntervalMs?: number;
  /** Replies older than this are dropped; also unblocks a dead beat. */
  staleMs?: number;
  /** Digest size bound — a beat carries at most this many facts. */
  maxFactsPerBeat?: number;
  /** Pending-queue bound — oldest facts beyond this are dropped. */
  maxPending?: number;
}

export const BEAT_DEFAULTS: Required<BeatSchedulerOptions> = {
  coalesceMs: 1_500,
  minIntervalMs: 6_000,
  staleMs: 4_000,
  maxFactsPerBeat: 12,
  maxPending: 50,
};

/** A dispatched beat: id for reply pairing + the coalesced facts. */
export interface DispatchedBeat {
  id: number;
  facts: PulseFact[];
}

export class BeatScheduler {
  private readonly opts: Required<BeatSchedulerOptions>;
  private pending: PulseFact[] = [];
  /** Arrival time of the oldest pending fact (coalesce anchor). */
  private firstPendingAt: number | null = null;
  private lastDispatchAt: number | null = null;
  private inflight: { id: number; dispatchedAt: number } | null = null;
  private nextBeatId = 1;
  /** Count of facts dropped by the pending-queue bound (observability). */
  droppedFacts = 0;

  constructor(options: BeatSchedulerOptions = {}) {
    this.opts = { ...BEAT_DEFAULTS, ...options };
  }

  /** Queue a fact. Oldest facts beyond `maxPending` are dropped. */
  addFact(fact: PulseFact, atMs: number): void {
    this.pending.push(fact);
    if (this.firstPendingAt === null) this.firstPendingAt = atMs;
    while (this.pending.length > this.opts.maxPending) {
      this.pending.shift();
      this.droppedFacts++;
    }
  }

  /**
   * The beat to dispatch now, or null. A returned beat is marked
   * in flight; pair its eventual reply through {@link resolveBeat}.
   */
  takeBeat(atMs: number): DispatchedBeat | null {
    if (this.inflight !== null) {
      if (atMs - this.inflight.dispatchedAt <= this.opts.staleMs) {
        return null; // genuinely busy
      }
      // The in-flight beat went stale without a reply — stop letting
      // it block. Its late reply (if any) fails the id check.
      this.inflight = null;
    }
    if (this.pending.length === 0 || this.firstPendingAt === null) return null;

    const coalesceReady = this.firstPendingAt + this.opts.coalesceMs;
    const intervalReady =
      this.lastDispatchAt === null
        ? 0
        : this.lastDispatchAt + this.opts.minIntervalMs;
    if (atMs < Math.max(coalesceReady, intervalReady)) return null;

    // Keep the NEWEST facts when the burst exceeds the digest bound —
    // a late line about the oldest event in a flood is the staleness
    // failure in miniature.
    const overflow = Math.max(0, this.pending.length - this.opts.maxFactsPerBeat);
    const facts = this.pending.slice(overflow);
    this.droppedFacts += overflow;
    this.pending = [];
    this.firstPendingAt = null;
    this.lastDispatchAt = atMs;
    const beat = { id: this.nextBeatId++, facts };
    this.inflight = { id: beat.id, dispatchedAt: atMs };
    return beat;
  }

  /**
   * A reply arrived for beat `id`. Returns whether to emit it —
   * false when the reply is stale or the beat was already abandoned.
   */
  resolveBeat(id: number, atMs: number): { emit: boolean } {
    if (this.inflight === null || this.inflight.id !== id) {
      return { emit: false }; // abandoned beat's straggler
    }
    const fresh = atMs - this.inflight.dispatchedAt <= this.opts.staleMs;
    this.inflight = null;
    return { emit: fresh };
  }

  /** Pending-fact count (observability / tests). */
  pendingCount(): number {
    return this.pending.length;
  }
}
