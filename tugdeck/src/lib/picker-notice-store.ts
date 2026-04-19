/**
 * picker-notice-store — one-shot per-card notices that survive the
 * unbind→remount cycle when the Tide picker re-presents itself.
 *
 * Step 4.5.5 Phase B unbinds a card after `resume_failed` so the
 * picker re-presents instead of silently rebranding the session under
 * a fresh claude id. The reason lives here for the picker to read
 * once and clear; nothing else persists across the remount.
 *
 * In-memory, module-scoped, single source of truth across the tab.
 * Not persisted — a reload should not surface a stale notice.
 */

export interface PickerNotice {
  /**
   * What kind of notice this is. Currently only `resume_failed`; future
   * variants (e.g. `session_live_elsewhere` from Phase C) extend this
   * union.
   */
  category: "resume_failed";
  /** Human-readable reason from the underlying cause. */
  message: string;
  /** The session id that was attempted, if known. */
  staleSessionId?: string;
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
