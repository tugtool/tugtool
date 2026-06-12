/**
 * warm-queue — cooperative speculative warming of the render-once
 * parse cache.
 *
 * Rows that exist in store state but have not rendered yet (the
 * replay fold reduces an entire transcript while the snapshot stays
 * pinned; windowed rows sit outside the mount range) can have their
 * markdown parsed AHEAD of need, so the eventual mount render is a
 * pure cache hit instead of a parse cliff.
 *
 * Scheduling is deliberately boring: plain `setTimeout(0)` chunks
 * (macrotask-class — never `requestAnimationFrame`, which is banned
 * for render-coupled work), each chunk parsing entries until its
 * time-slice budget (~8ms) expires, then re-arming. The queue writes
 * ONLY to the parse cache — no DOM, no React state, no notifies — so
 * it cannot interact with React scheduling or paint at all; a row
 * that renders later simply finds its parse ready.
 *
 * Priority: drain is LIFO (newest enqueued first). During a replay
 * fold the viewport lands at the transcript's bottom (follow-bottom),
 * so the most recently enqueued rows are the nearest-to-viewport
 * ones. User-triggered work always wins automatically: the render
 * path parses through the same `ensureParsed` chokepoint, and
 * whichever side arrives first does the work — the queue skips
 * entries whose text is already cached.
 *
 * One queue instance per session store; `cancel()` rides the store's
 * dispose.
 */

import { ensureParsed } from "./parse-cache";

/** Continuous-work budget per drain chunk. */
const WARM_SLICE_MS = 8;

interface WarmEntry {
  identity: string;
  /**
   * Lazy text read — resolved at drain time so the entry warms the
   * LATEST value (a streaming row enqueued mid-delta warms its final
   * text, not the partial it was enqueued with). `null` skips the
   * entry (path cleared / store gone).
   */
  readText: () => string | null;
}

export interface WarmQueueOptions {
  /**
   * Scheduler seam — defaults to `setTimeout(cb, 0)`. Tests inject a
   * captured-callback scheduler to drain deterministically.
   */
  schedule?: (cb: () => void) => void;
  /** Clock seam for the slice budget — defaults to `performance.now`. */
  now?: () => number;
  /** Slice budget override (tests). */
  sliceMs?: number;
}

export class WarmQueue {
  private readonly scope: object;
  private readonly schedule: (cb: () => void) => void;
  private readonly now: () => number;
  private readonly sliceMs: number;
  private readonly entries: WarmEntry[] = [];
  private readonly queuedIdentities = new Set<string>();
  private armed = false;
  private cancelled = false;
  /** Diagnostic counters (read by tests / perf summaries). */
  private _warmed = 0;
  private _chunks = 0;

  constructor(scope: object, options?: WarmQueueOptions) {
    this.scope = scope;
    this.schedule =
      options?.schedule ?? ((cb: () => void) => setTimeout(cb, 0));
    this.now = options?.now ?? (() => performance.now());
    this.sliceMs = options?.sliceMs ?? WARM_SLICE_MS;
  }

  /**
   * Enqueue a row identity for warming. Re-enqueueing an identity
   * already waiting is a no-op (the drain reads the latest text
   * anyway); identities drain LIFO.
   */
  enqueue(identity: string, readText: () => string | null): void {
    if (this.cancelled) return;
    if (this.queuedIdentities.has(identity)) return;
    this.queuedIdentities.add(identity);
    this.entries.push({ identity, readText });
    this.arm();
  }

  /** Stop everything; pending entries are dropped. Idempotent. */
  cancel(): void {
    this.cancelled = true;
    this.entries.length = 0;
    this.queuedIdentities.clear();
  }

  /** Entries still waiting (diagnostics/tests). */
  pending(): number {
    return this.entries.length;
  }

  /** Rows actually parsed by the queue (diagnostics/tests). */
  warmedCount(): number {
    return this._warmed;
  }

  /** Drain chunks executed (diagnostics/tests). */
  chunkCount(): number {
    return this._chunks;
  }

  private arm(): void {
    if (this.armed || this.cancelled || this.entries.length === 0) return;
    this.armed = true;
    this.schedule(() => this.drainChunk());
  }

  private drainChunk(): void {
    this.armed = false;
    if (this.cancelled) return;
    this._chunks += 1;
    const start = this.now();
    while (this.entries.length > 0) {
      const entry = this.entries.pop()!;
      this.queuedIdentities.delete(entry.identity);
      const text = entry.readText();
      if (text !== null && text !== "") {
        // `ensureParsed` is hit-or-parse: an already-warm identity
        // (the render path got there first) costs a lookup only.
        ensureParsed(this.scope, entry.identity, text);
        this._warmed += 1;
      }
      if (this.now() - start >= this.sliceMs) break;
    }
    this.arm();
  }
}
