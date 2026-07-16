/**
 * sessions-entry-collapse-store.ts — per-entry collapse state for the Lens
 * Sessions section, shared by the body and the band's header actions ([P05]).
 *
 * Expand-all / Collapse-all live in the section BAND (rendered by
 * `LensSection`), while the per-entry collapse is read by the section BODY
 * (`SessionsSectionBody`) — two sibling React subtrees that share only the
 * `host`. A module store is the honest [L02]/[L24] bridge: both subtrees
 * subscribe via `useSyncExternalStore`, the header's bulk actions and the
 * body's per-entry toggles mutating the same set.
 *
 * The set holds the COLLAPSED ids; an id absent from it is OPEN, so a fresh
 * entry a snapshot introduces renders open (open-once default). An internal
 * `seen` set records every id the store has been shown, so `collapseAll`
 * covers the whole seen set — an entry absent when the user collapses
 * everything comes back collapsed rather than popping open (the behavior the
 * body's old `seenSectionsRef` gave, now outliving the body's mount).
 *
 * Because the store is a module singleton, a user's per-entry fold now
 * persists across a section collapse/expand and a Lens close/reopen (the body
 * remounts, but the store does not) — an intended improvement over the
 * body-local `useState` it replaces, keyed by stable entry id.
 *
 * @module lib/sessions-entry-collapse-store
 */

export class SessionsEntryCollapseStore {
  /** The COLLAPSED entry ids. Absent ⇒ open (open-once default). */
  private collapsed = new Set<string>();
  /** Every id the store has been shown — the reach of `collapseAll`. */
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<() => void>();
  /** Stable snapshot identity — replaced only when `collapsed` changes. */
  private snapshot: ReadonlySet<string> = new Set();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The current collapsed set — stable identity until a mutation. */
  getSnapshot = (): ReadonlySet<string> => this.snapshot;

  /** Whether `id` is currently collapsed (absent ⇒ open). */
  isCollapsed = (id: string): boolean => this.collapsed.has(id);

  /**
   * Record ids the section is currently showing so `collapseAll` reaches
   * them later. Pure bookkeeping — never notifies (the seen set drives no
   * appearance on its own).
   */
  markSeen(ids: Iterable<string>): void {
    for (const id of ids) this.seen.add(id);
  }

  /**
   * Set `id`'s collapsed state to `next`. Also marks it seen (a toggled
   * entry is by definition on screen). No-op + no notify when unchanged.
   */
  toggle(id: string, next: boolean): void {
    this.seen.add(id);
    if (next === this.collapsed.has(id)) return;
    if (next) this.collapsed.add(id);
    else this.collapsed.delete(id);
    this.emit();
  }

  /** Open every entry. */
  expandAll(): void {
    if (this.collapsed.size === 0) return;
    this.collapsed.clear();
    this.emit();
  }

  /** Collapse the whole seen set (not just what is on screen right now). */
  collapseAll(): void {
    let changed = this.collapsed.size !== this.seen.size;
    for (const id of this.seen) {
      if (!this.collapsed.has(id)) {
        this.collapsed.add(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** @internal — reset for a fresh unit test. */
  _resetForTest(): void {
    this.collapsed = new Set();
    this.seen.clear();
    this.snapshot = new Set();
    this.listeners.clear();
  }

  private emit(): void {
    this.snapshot = new Set(this.collapsed);
    for (const listener of this.listeners) listener();
  }
}

/** Module-scope singleton — the shared per-entry collapse state. */
export const sessionsEntryCollapseStore = new SessionsEntryCollapseStore();
