/**
 * App-level Claude login state — the single source of truth for the auth gate.
 *
 * Fed exclusively by `claude_auth_result` CONTROL frames (the deck sends
 * `check_auth` on connect / before the picker, and `claude_sign_in` from a
 * sign-in affordance; tugcast answers both with `claude_auth_result`). The
 * app-wide sign-in sheet, the session-picker gate, and the per-card auth
 * banner all read this one store, so a single result frame resolves every
 * surface at once.
 *
 * **Laws:** [L02] external state enters React through `useSyncExternalStore`
 * only — this store exposes `subscribe + getSnapshot` and is read via that
 * hook (see `useAuth`). The snapshot is replaced (never mutated in place) so
 * `useSyncExternalStore` sees a fresh reference on every change.
 */

import { useSyncExternalStore } from "react";

export interface AuthAccount {
  email: string | null;
  subscriptionType: string | null;
  authMethod: string | null;
}

export interface AuthSnapshot {
  /** `null` until the first probe answers; then the known login state. */
  loggedIn: boolean | null;
  /** Account details for display ("Signed in as … — Max"), when logged in. */
  account: AuthAccount | null;
  /** True between sending `claude_sign_in` and the next `claude_auth_result`. */
  signingIn: boolean;
}

const INITIAL: AuthSnapshot = {
  loggedIn: null,
  account: null,
  signingIn: false,
};

class AuthStore {
  private _snapshot: AuthSnapshot = INITIAL;
  private _listeners: Array<() => void> = [];

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  };

  getSnapshot = (): AuthSnapshot => this._snapshot;

  /** Mark a sign-in attempt in flight (the sheet/banner show "Finish in your browser…"). */
  setSigningIn(signingIn: boolean): void {
    if (this._snapshot.signingIn === signingIn) return;
    this._snapshot = { ...this._snapshot, signingIn };
    this.notify();
  }

  /** Apply a `claude_auth_result`: records login state and clears `signingIn`. */
  applyResult(loggedIn: boolean, account: AuthAccount | null): void {
    this._snapshot = {
      loggedIn,
      account: loggedIn ? account : null,
      signingIn: false,
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of this._listeners) listener();
  }
}

export const authStore = new AuthStore();

/** React read of the app auth state ([L02]). */
export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(authStore.subscribe, authStore.getSnapshot);
}

/**
 * Apply a `claude_auth_result` CONTROL payload to the store. Tolerant of the
 * wire shape (`loggedIn` plus optional `email`/`subscriptionType`/`authMethod`).
 */
export function applyAuthResultPayload(payload: Record<string, unknown>): void {
  const loggedIn = payload.loggedIn === true;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  authStore.applyResult(
    loggedIn,
    loggedIn
      ? {
          email: str(payload.email),
          subscriptionType: str(payload.subscriptionType),
          authMethod: str(payload.authMethod),
        }
      : null,
  );
}
