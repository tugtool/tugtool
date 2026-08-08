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
 * rows make it **authoritative** (the callsign the ledger claimed). A blank
 * tag clears the entry.
 *
 * **The authoritative answer can differ from the optimistic one, and this store
 * is where the swap lands.** A tag any session ever minted is spent forever (the
 * ledger's append-only `minted_tags` arbiter), so a collision does not get a
 * numeric suffix — the ledger rerolls a complete fresh pair. A callsign shown
 * "from the drop" may therefore change **once**, seconds after spawn, when
 * {@link SessionTagStore.seedTag} takes the ledger's word; after that it is
 * immutable for the life of the session. See `session-tag.ts`'s header.
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
  private version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * A monotonic token that bumps on every change — the whole-store
   * `useSyncExternalStore` snapshot, for a consumer that derives something from
   * MANY tags at once (the Lens Sessions list filters on its rows' labels) and
   * so cannot subscribe by a single id.
   */
  getVersion = (): number => this.version;

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
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /**
   * Non-clobbering populate for the broadcast/seed paths (`session_updated`,
   * `list_sessions_ok`, card-binding rows, the spawn ack). A tag is monotonic —
   * once minted it never legitimately becomes blank — so a `null`/blank push
   * (a row read before the tag landed, or a stale echo) must NOT wipe a good
   * cached tag back to the id-hash fallback. Only a real value writes; a blank
   * is a no-op. A different real value still overwrites — that is the ledger
   * rerolling a collided mint, and adopting it here is what keeps the optimistic
   * tag from outliving its one chance to be wrong. Explicit clears go through
   * `setTag`.
   */
  seedTag(tugSessionId: string, tag: string | null): void {
    if ((tag?.trim() ?? "").length === 0) return;
    this.setTag(tugSessionId, tag);
  }
}

/** Module-scope singleton — mirrors the other per-card stores' usage shape. */
export const sessionTagStore = new SessionTagStore();
