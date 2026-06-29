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

/**
 * Why the user is signed out — drives which setup-checklist step is active:
 * `claude_missing` = the CLI isn't installed; `logged_out` = installed but not
 * signed in. `null` when logged in (or not yet probed).
 */
export type AuthReason = "claude_missing" | "logged_out";

export interface AuthSnapshot {
  /** `null` until the first probe answers; then the known login state. */
  loggedIn: boolean | null;
  /** Which signed-out step is active, or `null` when logged in / unknown. */
  reason: AuthReason | null;
  /** Account details for display ("Signed in as … — Max"), when logged in. */
  account: AuthAccount | null;
  /** True between sending `claude_sign_in` and the next `claude_auth_result`. */
  signingIn: boolean;
  /** True while a Tug-managed `install_claude` is running. */
  installing: boolean;
  /** Last install error, or `null`. Cleared when a new install starts. */
  installError: string | null;
}

const INITIAL: AuthSnapshot = {
  loggedIn: null,
  reason: null,
  account: null,
  signingIn: false,
  installing: false,
  installError: null,
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

  /** Mark a sign-in attempt in flight (the wizard shows "Waiting for browser sign-in…"). */
  setSigningIn(signingIn: boolean): void {
    if (this._snapshot.signingIn === signingIn) return;
    this._snapshot = { ...this._snapshot, signingIn };
    this.notify();
  }

  /** Mark a Tug-managed install in flight (clears any prior install error). */
  setInstalling(installing: boolean): void {
    this._snapshot = { ...this._snapshot, installing, installError: null };
    this.notify();
  }

  /** Apply a `claude_install_result`: ends the install, records any error. */
  applyInstallResult(ok: boolean, error: string | null): void {
    this._snapshot = {
      ...this._snapshot,
      installing: false,
      installError: ok ? null : (error ?? "install failed"),
    };
    this.notify();
  }

  /** Apply a `claude_auth_result`: records login state and clears `signingIn`. */
  applyResult(
    loggedIn: boolean,
    reason: AuthReason | null,
    account: AuthAccount | null,
  ): void {
    this._snapshot = {
      ...this._snapshot,
      loggedIn,
      reason: loggedIn ? null : reason,
      account: loggedIn ? account : null,
      signingIn: false,
      installing: false,
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
  const reason: AuthReason | null =
    payload.reason === "claude_missing"
      ? "claude_missing"
      : payload.reason === "logged_out"
        ? "logged_out"
        : null;
  authStore.applyResult(
    loggedIn,
    reason,
    loggedIn
      ? {
          email: str(payload.email),
          subscriptionType: str(payload.subscriptionType),
          authMethod: str(payload.authMethod),
        }
      : null,
  );
}

/** Apply a `claude_install_result` CONTROL payload (`{ok, error}`). */
export function applyInstallResultPayload(payload: Record<string, unknown>): void {
  authStore.applyInstallResult(
    payload.ok === true,
    typeof payload.error === "string" ? payload.error : null,
  );
}
