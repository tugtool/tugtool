/**
 * `compactionProgressStore` — drives the `/compact` progress sheet.
 *
 * Native `/compact` dispatches as a stream-json user message and compacts in
 * place (same session, same JSONL). It is a ~20 s opaque run with no streamed
 * volume to meter, so the sheet is pane-modal and **indeterminate**: the run is
 * either in flight or settled. This singleton is the seam between the session-card
 * handler that opens the run (`begin`) and drives it off `codeSessionStore`
 * snapshots (`succeed` / `cancel` / `fail`), and the sheet that renders off the
 * same store. The card watches the terminal `outcome` to raise the closing
 * bulletin and `clear`.
 *
 * `null` snapshot = idle (no compaction, no sheet). A non-null snapshot with
 * `outcome === null` is a run in flight; a non-null snapshot with a terminal
 * `outcome` is a just-settled run awaiting the card's bulletin + `clear`.
 *
 * Both manual `/compact` and native auto-compaction stream a `compact_boundary`,
 * but only a manual `/compact` opens this run — the progress sheet and closing
 * bulletin are scoped to the explicit command.
 *
 * Module-level singleton, matching the other per-session helper stores
 * ([L02] external state reaches React through `useSyncExternalStore`).
 */

/** How a compaction run settled. */
export type CompactionOutcome = "succeeded" | "canceled" | "failed";

export interface CompactionProgress {
  /**
   * The card that initiated the run. The store is a global singleton, so
   * the closing bulletin is scoped to this card — other dev cards observe
   * the same state but only the initiator reacts.
   */
  readonly cardId: string;
  /** Terminal outcome, or `null` while the run is still in flight. */
  readonly outcome: CompactionOutcome | null;
  /** Human-readable reason when `outcome === "failed"`, else `null`. */
  readonly failureReason: string | null;
}

class CompactionProgressStore {
  private state: CompactionProgress | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable between notifications — safe for `useSyncExternalStore`. */
  getSnapshot = (): CompactionProgress | null => this.state;

  /** Open an in-flight run for `cardId`. */
  begin(cardId: string): void {
    this.state = { cardId, outcome: null, failureReason: null };
    this.emit();
  }

  /** Mark the run succeeded (compaction ink observed in place). */
  succeed(): void {
    this.settle("succeeded", null);
  }

  /** Mark the run canceled (user interrupted the compaction). */
  cancel(): void {
    this.settle("canceled", null);
  }

  /** Mark the run failed, carrying a reason for the closing bulletin. */
  fail(reason: string): void {
    this.settle("failed", reason);
  }

  /** Reset to idle — drops the sheet and ends the run. */
  clear(): void {
    if (this.state === null) return;
    this.state = null;
    this.emit();
  }

  private settle(outcome: CompactionOutcome, failureReason: string | null): void {
    // Settle only an in-flight run; a second terminal call is a no-op so
    // racing paths (Cancel button vs. the turn settling) can't double-fire.
    if (this.state === null || this.state.outcome !== null) return;
    this.state = { ...this.state, outcome, failureReason };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const compactionProgressStore = new CompactionProgressStore();
