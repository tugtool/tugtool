/**
 * session-tag-store.ts — per-session mnemonic-tag cache for the Z4B chip.
 *
 * The tag lives authoritatively in tugcast's ledger and rides the `SessionRow`
 * shape on `list_sessions_ok` rows and `session_updated` pushes. The chooser
 * reads tags straight off those rows, but the Z4B chip needs the tag for *its
 * bound session* by id — so this tiny store indexes `tugSessionId → tag` and the
 * chip subscribes by id ([L02]).
 *
 * Populated from three sources (see `action-dispatch.ts`): a client spawn sets
 * it **optimistically** to the provisional tag so the chip shows one instantly
 * "from the drop"; `session_updated` pushes and `list_sessions_ok` / card-binding
 * rows make it **authoritative** (the server's claimed-or-suffixed tag). A blank
 * tag clears the entry.
 *
 * A faithful clone of `session-name-store.ts` — no reverse `tag → session_id`
 * map in v1; the deferred typed-`/resume <tag>` command adds one when it needs
 * it.
 *
 * @module lib/session-tag-store
 */

class SessionTagStore {
  private tags = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The tag for `tugSessionId`, or `null` when untagged. */
  getTag = (tugSessionId: string): string | null =>
    this.tags.get(tugSessionId) ?? null;

  /** Every tag currently known — the re-roll exclusion set for minting. */
  knownTags = (): ReadonlySet<string> => new Set(this.tags.values());

  /**
   * Set (trimmed) or clear (`null` / blank) the tag for `tugSessionId`. No-op
   * + no notify when unchanged, so a redundant wire echo doesn't churn React.
   */
  setTag(tugSessionId: string, tag: string | null): void {
    const trimmed = tag?.trim() ?? "";
    const current = this.tags.get(tugSessionId) ?? null;
    if (trimmed.length === 0) {
      if (current === null) return;
      this.tags.delete(tugSessionId);
    } else {
      if (current === trimmed) return;
      this.tags.set(tugSessionId, trimmed);
    }
    for (const listener of this.listeners) listener();
  }
}

/** Module-scope singleton — mirrors the other per-card stores' usage shape. */
export const sessionTagStore = new SessionTagStore();
