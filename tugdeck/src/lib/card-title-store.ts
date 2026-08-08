/**
 * CardTitleStore — per-card title override surfaced in pane chrome.
 *
 * A card's registered `defaultMeta.title` is the static label baked
 * into the registry at card type definition time ("Dev", "Git",
 * "Hello"). Some cards have a stateful identity beyond their type —
 * the Session card binds to a project at session pick time, and from
 * that moment forward the title bar should reflect *which* project
 * is loaded, not just "Dev".
 *
 * This store is the sanctioned channel for that override. Cards
 * write `set(cardId, "<override>")` once their identity resolves
 * and `clear(cardId)` (or unmount) when it goes away. The pane
 * subscribes via `useSyncExternalStore` and composes the override
 * with the registry title as `"<registry> — <override>"`.
 *
 * ## The masthead sidecar
 *
 * A card may also ask for a taller chrome tier by publishing a
 * {@link CardMastheadPayload} beside its string. The payload is a
 * **key, not a snapshot** — it names which session the chrome is
 * about, and the chrome resolves what to display from the identity
 * stores at render. That is deliberate: a snapshot here would make
 * this store a second notification path for identity, and there is
 * exactly one ({@link useSessionIdentity}).
 *
 * The string channel survives alongside it for **reader
 * compatibility**, not for notification: `get()` is what the tab bar,
 * the deck canvas, the Window menu, and the pane already consume.
 * Note what that means for a session card — its Line string is
 * `<project>/<callsign>`, and a callsign is immutable, so `set` is
 * effectively once per binding and nothing may be built on a re-`set`
 * firing.
 *
 * **Laws:**
 * - [L02] subscribable store, consumed via `useSyncExternalStore`
 *   (no `useEffect` copying through React state).
 * - [L09] / [L10] the pane (chrome) and the card (content) stay in
 *   their lanes; this store is the channel between them, not a
 *   prop drill or DOM query.
 * - [L24] structure-zone state shared across the pane / card
 *   boundary.
 *
 * @module lib/card-title-store
 */

/**
 * A card's request for the masthead chrome tier, and the key the chrome
 * resolves its content from. Never a snapshot of what to display.
 */
export interface CardMastheadPayload {
  readonly kind: "session-masthead";
  readonly sessionId: string;
}

class CardTitleStore {
  private readonly _overrides = new Map<string, string>();
  private readonly _mastheads = new Map<string, CardMastheadPayload>();
  private readonly _listeners = new Set<() => void>();

  /**
   * Set the title override for `cardId`, optionally with a masthead sidecar.
   * Idempotent.
   *
   * The equality guard compares the string **and** the payload. Comparing
   * only the string would drop a changed sidecar under an unchanged title —
   * and after the callsign became the whole string, an unchanged title is the
   * normal case, so the sidecar would arrive and notify nobody.
   */
  set(cardId: string, title: string, masthead?: CardMastheadPayload): void {
    const sameTitle = this._overrides.get(cardId) === title;
    const prev = this._mastheads.get(cardId);
    const sameMasthead =
      prev?.kind === masthead?.kind && prev?.sessionId === masthead?.sessionId;
    if (sameTitle && sameMasthead) return;
    this._overrides.set(cardId, title);
    if (masthead === undefined) this._mastheads.delete(cardId);
    else this._mastheads.set(cardId, masthead);
    this._notify();
  }

  /** Remove the title override (and any masthead) for `cardId`. */
  clear(cardId: string): void {
    if (!this._overrides.has(cardId) && !this._mastheads.has(cardId)) return;
    this._overrides.delete(cardId);
    this._mastheads.delete(cardId);
    this._notify();
  }

  /** Read the title override for `cardId`, or `null` when none. */
  get(cardId: string | null): string | null {
    if (cardId === null) return null;
    return this._overrides.get(cardId) ?? null;
  }

  /**
   * Read the masthead sidecar for `cardId`, or `null` when the card wants the
   * one-line bar. The returned object is stable while unchanged, so a pane may
   * snapshot it directly from `useSyncExternalStore`.
   */
  getMasthead(cardId: string | null): CardMastheadPayload | null {
    if (cardId === null) return null;
    return this._mastheads.get(cardId) ?? null;
  }

  /**
   * Monotonic revision, bumped on every change. A consumer that needs
   * *several* cards' overrides at once — the deck canvas, resolving the
   * titles of every pane in a slot's stack — has no single value to snapshot
   * and cannot call `get()` per card from `useSyncExternalStore` without
   * returning a fresh object each time. It subscribes to this instead and
   * reads the overrides it wants downstream of it, which keeps [L02] intact
   * with a snapshot that is stable by construction.
   */
  version = (): number => this._version;

  private _version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  private _notify(): void {
    // Bump BEFORE the listeners run: a `useSyncExternalStore` subscriber reads
    // the snapshot from inside its notification, and a revision incremented
    // afterwards would hand it the value it already had — the store would
    // notify and nothing would recompute.
    this._version += 1;
    for (const listener of this._listeners) listener();
  }
}

export const cardTitleStore = new CardTitleStore();
