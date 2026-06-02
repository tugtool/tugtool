/**
 * `compactionProgressStore` — drives the `/compact` progress sheet.
 *
 * `/compact` runs in two halves that live in different modules: the
 * `dev-card` handler watches the (suppressed) summarization turn, then the
 * `dev-session-restore` live-hook seeds the fresh session once it binds.
 * Neither half can present a sheet on its own. This singleton is the seam:
 * the handler `begin`s a run and ticks `setProgress` as the summary streams;
 * the live-hook calls `succeed` once the fresh session is seeded; Cancel /
 * failure call `cancel` / `fail`. A pane-modal progress sheet renders off
 * this store (via `useSyncExternalStore`), and the card watches the terminal
 * `outcome` to raise the closing bulletin and `clear`.
 *
 * `null` snapshot = idle (no compaction, no sheet). A non-null snapshot with
 * `outcome === null` is a run in flight; a non-null snapshot with a terminal
 * `outcome` is a just-settled run awaiting the card's bulletin + `clear`.
 *
 * Only a manual `/compact` touches this store — native auto-compaction never
 * does, so the progress sheet and closing bulletin are scoped to the manual
 * command.
 *
 * Module-level singleton, matching the other per-session helper stores
 * ([L02] external state reaches React through `useSyncExternalStore`).
 */

/** The active half of a manual compaction run. */
export type CompactionRunPhase = "summarizing" | "respawning";

/** How a compaction run settled. */
export type CompactionOutcome = "succeeded" | "canceled" | "failed";

export interface CompactionProgress {
  /**
   * The card that initiated the run. The store is a global singleton, so
   * the closing bulletin is scoped to this card — other dev cards observe
   * the same state but only the initiator reacts.
   */
  readonly cardId: string;
  /** Which half of the run is active. */
  readonly phase: CompactionRunPhase;
  /** Determinate fraction 0..1 for the progress bar. */
  readonly value: number;
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

  /** Open a run for `cardId` at the summarizing phase, value 0. */
  begin(cardId: string): void {
    this.state = {
      cardId,
      phase: "summarizing",
      value: 0,
      outcome: null,
      failureReason: null,
    };
    this.emit();
  }

  /**
   * Update the in-flight phase + bar value. No-op once the run has
   * settled (a late streaming tick after Cancel must not reopen the bar)
   * or when idle.
   */
  setProgress(phase: CompactionRunPhase, value: number): void {
    if (this.state === null || this.state.outcome !== null) return;
    this.state = { ...this.state, phase, value };
    this.emit();
  }

  /** Mark the run succeeded (fresh session seeded). */
  succeed(): void {
    this.settle("succeeded", null);
  }

  /** Mark the run canceled (user interrupted the summarization). */
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
    // racing paths (Cancel button vs. the turn ending) can't double-fire.
    if (this.state === null || this.state.outcome !== null) return;
    this.state = { ...this.state, value: 1, outcome, failureReason };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const compactionProgressStore = new CompactionProgressStore();
