/**
 * session-name-store.ts — per-session name cache for the Z4B chip ([#step-13d]).
 *
 * The session name lives authoritatively in tugcast's ledger and rides the
 * `SessionRow` shape on `list_sessions_ok` rows and `session_updated` pushes.
 * The chooser reads names straight off those rows, but the Z4B chip needs the
 * name for *its bound session* by id — so this tiny store indexes
 * `tugSessionId → name` and the chip subscribes by id ([L02]).
 *
 * Populated from three sources (see `action-dispatch.ts`): the `/rename` surface
 * sets it **optimistically** so the chip updates instantly; `session_updated`
 * pushes and `list_sessions_ok` rows make it **authoritative** (a rename from
 * anywhere, or opening the chooser, fills it in). A blank name clears the entry.
 *
 * @module lib/session-name-store
 */

class SessionNameStore {
  private names = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The name for `tugSessionId`, or `null` when unnamed. */
  getName = (tugSessionId: string): string | null =>
    this.names.get(tugSessionId) ?? null;

  /**
   * Set (trimmed) or clear (`null` / blank) the name for `tugSessionId`. No-op
   * + no notify when unchanged, so a redundant wire echo doesn't churn React.
   */
  setName(tugSessionId: string, name: string | null): void {
    const trimmed = name?.trim() ?? "";
    const current = this.names.get(tugSessionId) ?? null;
    if (trimmed.length === 0) {
      if (current === null) return;
      this.names.delete(tugSessionId);
    } else {
      if (current === trimmed) return;
      this.names.set(tugSessionId, trimmed);
    }
    for (const listener of this.listeners) listener();
  }
}

/** Module-scope singleton — mirrors the other per-card stores' usage shape. */
export const sessionNameStore = new SessionNameStore();
