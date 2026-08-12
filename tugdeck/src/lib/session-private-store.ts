/**
 * session-private-store.ts — per-session Gazette-privacy cache.
 *
 * `sessions.private` lives authoritatively in tugcast's ledger. The `/private`
 * command needs to know the current value to toggle it, and the session atom
 * needs it to show the resting state — so this store indexes
 * `tugSessionId → private` and each surface subscribes by id ([L02]).
 *
 * Three arms fill it, and between them a card is never left guessing: the
 * `spawn_session_ok` bind ack (which is how a card reloaded or resumed
 * mid-turn learns the flag without waiting for a later frame), the
 * `session_updated` push, and `/private`'s own ack. The flag also rides
 * `list_sessions_ok` rows on the wire, but nothing reads it there — the picker
 * shows no marker, and a listing is about sessions this deck may not be
 * holding.
 *
 * Privacy is a **resting state**, which is why it gets a store rather than
 * living in the ack: a transient "this session is now private" notice is gone
 * after a reload, and a session silently not being narrated with nothing on
 * screen to say why is precisely the resting lie this codebase refuses.
 *
 * The value is authoritative on every push — a row carrying `false` means the
 * session really is public — so there is no non-clobbering seed arm here. The
 * `/private` command writes optimistically so the marker turns over with the
 * gesture rather than a round trip later.
 *
 * @module lib/session-private-store
 */

class SessionPrivateStore {
  private readonly privateIds = new Set<string>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Whether `tugSessionId` is currently out of the Gazette. */
  isPrivate = (tugSessionId: string): boolean =>
    this.privateIds.has(tugSessionId);

  /**
   * Set the flag for `tugSessionId`. No-op + no notify when unchanged, so a
   * redundant wire echo doesn't churn React.
   */
  setPrivate(tugSessionId: string, isPrivate: boolean): void {
    if (this.privateIds.has(tugSessionId) === isPrivate) return;
    if (isPrivate) this.privateIds.add(tugSessionId);
    else this.privateIds.delete(tugSessionId);
    for (const listener of this.listeners) listener();
  }

  /** Forget a session entirely — a trashed row is neither private nor public. */
  forget(tugSessionId: string): void {
    this.setPrivate(tugSessionId, false);
  }
}

/** Module-scope singleton — mirrors the other per-session stores' usage shape. */
export const sessionPrivateStore = new SessionPrivateStore();
