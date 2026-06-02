/**
 * `pendingCompactionStore` — the hand-off between `/compact`'s two halves.
 *
 * `/compact` summarizes the current session, then spawns a *fresh*
 * session (the `/clear` path) to continue with that summary as its seed.
 * But the fresh session isn't live yet when the spawn is sent — the seed
 * can only be delivered once it binds (the `dev-session-restore` "session
 * live" hook). This store carries the pending seed across that gap,
 * keyed by the fresh session's `tugSessionId`: the `/compact` handler
 * `set`s it at spawn time; the live-hook `take`s it (read-and-clear) and
 * seeds the new session.
 *
 * `preTokens` is the pre-compaction context size for the divider label
 * (null when unknown).
 *
 * Module-level singleton, matching the other per-session helper stores.
 */

export interface PendingCompaction {
  /** The captured summary to seed the fresh session with. */
  summary: string;
  /** Pre-compaction context tokens for the divider label, or null. */
  preTokens: number | null;
}

class PendingCompactionStore {
  private readonly pending = new Map<string, PendingCompaction>();

  /** Record a pending seed for a freshly-spawned session. */
  set(tugSessionId: string, entry: PendingCompaction): void {
    this.pending.set(tugSessionId, entry);
  }

  /**
   * Read-and-clear the pending seed for `tugSessionId`. Returns `null`
   * when there is none (the common case — most sessions aren't born from
   * a compaction). Single-use: the live-hook calls this once when the
   * session binds.
   */
  take(tugSessionId: string): PendingCompaction | null {
    const entry = this.pending.get(tugSessionId);
    if (entry === undefined) return null;
    this.pending.delete(tugSessionId);
    return entry;
  }

  /** Discard a pending seed without consuming it (e.g. spawn failed). */
  clear(tugSessionId: string): void {
    this.pending.delete(tugSessionId);
  }
}

export const pendingCompactionStore = new PendingCompactionStore();
