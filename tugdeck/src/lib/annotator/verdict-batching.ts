/**
 * Verdict batching — one notification per batch of answers, not one per
 * answer.
 *
 * The resolvers answer serially: the file index drains a FIFO one query
 * at a time, commit queries correlate one requestId at a time, and the
 * filesystem probe answers per chunk. Delivered raw, each answer would
 * provoke its own re-annotation round over every container still waiting
 * — cost O(answers × waiting containers). Folding a burst of answers into
 * one notification collapses that to O(batches × waiting containers),
 * and a batch's worth of latency on a link becoming clickable is beneath
 * notice.
 *
 * The batcher attaches to its sources lazily — on the first subscriber,
 * off with the last — so an unmounted transcript costs the stores
 * nothing.
 *
 * @module lib/annotator/verdict-batching
 */

/** How long answers accumulate before one notification goes out. */
const BATCH_WINDOW_MS = 100;

/** What the batcher needs from a resolver store. */
export interface VerdictSource {
  subscribe: (listener: () => void) => () => void;
}

/**
 * Coalesce several stores' verdict notifications into batched emissions.
 * `subscribe` is the one op, shaped like every other store's so consumers
 * need no new protocol.
 */
export class VerdictBatcher {
  private readonly listeners = new Set<() => void>();
  private detachers: Array<() => void> | null = null;
  private windowHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly sources: readonly VerdictSource[]) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.detachers === null) {
      this.detachers = this.sources.map((source) =>
        source.subscribe(this.onAnswer),
      );
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0 || this.detachers === null) return;
      for (const detach of this.detachers) detach();
      this.detachers = null;
      if (this.windowHandle !== null) {
        clearTimeout(this.windowHandle);
        this.windowHandle = null;
      }
    };
  };

  /** An answer landed; open the batch window if it isn't already open. */
  private onAnswer = (): void => {
    if (this.windowHandle !== null) return;
    this.windowHandle = setTimeout(() => {
      this.windowHandle = null;
      for (const listener of this.listeners) listener();
    }, BATCH_WINDOW_MS);
  };
}
