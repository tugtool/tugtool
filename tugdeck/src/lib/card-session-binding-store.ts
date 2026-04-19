/**
 * CardSessionBindingStore — per-card session binding for workspace filter routing.
 *
 * Maps `cardId → { tugSessionId, workspaceKey, projectDir }`. The binding is
 * populated from the `spawn_session_ok` CONTROL ack (where tugcast echoes the
 * canonical `workspace_key`) and consumed by `useCardWorkspaceKey`, which
 * `Tugcard` uses to build its `FeedStore` workspace-value filter.
 *
 * **Laws:** [L02] External state enters React through `useSyncExternalStore`
 * only — this store exposes `subscribe + getSnapshot` and is read via
 * `useCardWorkspaceKey`, never through component state.
 *
 * @module lib/card-session-binding-store
 */

/**
 * User's choice of session mode when the card was opened. Populated from
 * the `spawn_session_ok` CONTROL ack, which echoes the value tugdeck sent
 * on `spawn_session`. "new" matches the fresh-by-default behavior of
 * the fresh-by-default behavior; "resume" carries the explicit
 * resume intent.
 */
export type CardSessionMode = "new" | "resume";

export interface CardSessionBinding {
  readonly tugSessionId: string;
  readonly workspaceKey: string;
  readonly projectDir: string;
  readonly sessionMode: CardSessionMode;
  /**
   * Claude's own session id, captured from the first `session_init`
   * frame the bound `CodeSessionStore` observes. `null` until that
   * frame arrives — in the spawn-handshake window the binding exists
   * (set by `spawn_session_ok`) but Claude hasn't yet emitted its id.
   *
   * Persisted records (sessions, prompt history, future ledger rows)
   * all key on `claudeSessionId`. `tugSessionId` is a tugcast-side
   * routing key only; reads that surface a session to the user —
   * picker, history, notices — consume `claudeSessionId`.
   *
   * Cleared along with the binding on `clearBinding` (close or
   * resume-failed unbind path).
   */
  readonly claudeSessionId: string | null;
}

export class CardSessionBindingStore {
  private _bindings: Map<string, CardSessionBinding> = new Map();
  private _listeners: Array<() => void> = [];

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  };

  getSnapshot = (): Map<string, CardSessionBinding> => this._bindings;

  getBinding = (cardId: string): CardSessionBinding | undefined =>
    this._bindings.get(cardId);

  setBinding = (cardId: string, binding: CardSessionBinding): void => {
    const next = new Map(this._bindings);
    next.set(cardId, binding);
    this._bindings = next;
    for (const listener of this._listeners) listener();
  };

  clearBinding = (cardId: string): void => {
    if (!this._bindings.has(cardId)) return;
    const next = new Map(this._bindings);
    next.delete(cardId);
    this._bindings = next;
    for (const listener of this._listeners) listener();
  };

  /**
   * Attach Claude's emitted session id to an existing binding. Called
   * once per session, when the bound `CodeSessionStore` first observes
   * `session_init`. No-op if the card has no binding (e.g. the close
   * path raced with the `session_init` frame).
   *
   * Replaces the binding's value in place and notifies subscribers.
   * `useTideCardServices` deliberately keys its construction effect on
   * `binding?.tugSessionId` (not the binding object), so this update
   * does NOT tear down the bound services.
   */
  bindClaudeSessionId = (cardId: string, claudeSessionId: string): void => {
    const existing = this._bindings.get(cardId);
    if (!existing) return;
    if (existing.claudeSessionId === claudeSessionId) return;
    const next = new Map(this._bindings);
    next.set(cardId, { ...existing, claudeSessionId });
    this._bindings = next;
    for (const listener of this._listeners) listener();
  };
}

/** Module-scope singleton — mirrors FeedStore's usage shape. */
export const cardSessionBindingStore = new CardSessionBindingStore();
