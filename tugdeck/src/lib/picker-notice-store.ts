/**
 * picker-notice-store — one-shot per-card notices that survive the
 * unbind→remount cycle when the Dev picker re-presents itself.
 *
 * On resume-failed, the card observer unbinds so the picker
 * re-presents instead of silently rebranding the session under a
 * fresh claude id. The reason lives here for the picker to read
 * once and clear; nothing else persists across the remount.
 *
 * In-memory, module-scoped, single source of truth across the tab.
 * Not persisted — a reload should not surface a stale notice.
 */

/**
 * Notice categories surfaced by the Dev picker when it re-presents
 * itself after a failed, canceled, or timed-out restore.
 *
 * - `resume_failed` — tugcast emitted `SESSION_STATE: errored` for a
 *   restoring session, or the post-binding observer tripped on a
 *   resume failure.
 * - `restore_canceled` — user clicked Cancel in `DevRestoring`.
 * - `restore_timed_out` — restore-registry timeout elapsed without
 *   either a binding or an errored response.
 *
 * All three categories are retryable (the picker renders a Retry
 * button when `staleTugSessionId` + `staleProjectDir` are populated),
 * but each surfaces different copy to the user.
 */
export type PickerNoticeCategory =
  | "resume_failed"
  | "restore_canceled"
  | "restore_timed_out";

export interface PickerNotice {
  category: PickerNoticeCategory;
  /** Human-readable reason from the underlying cause. */
  message: string;
  /**
   * The tug-session-id we were trying to restore, carried through so
   * the Retry button can re-fire `spawn_session(mode=resume)` against
   * the same session.
   */
  staleTugSessionId?: string;
  /** The project path associated with the stale session, for Retry. */
  staleProjectDir?: string;
}

class PickerNoticeStore {
  private map = new Map<string, PickerNotice>();

  set(cardId: string, notice: PickerNotice): void {
    this.map.set(cardId, notice);
  }

  /**
   * Read and remove the notice for `cardId`. Single-shot — the picker
   * mounts, calls `consume`, renders the banner, and the next mount
   * starts clean.
   */
  consume(cardId: string): PickerNotice | null {
    const notice = this.map.get(cardId);
    if (notice) this.map.delete(cardId);
    return notice ?? null;
  }
}

export const pickerNoticeStore = new PickerNoticeStore();
