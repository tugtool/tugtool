/**
 * App-wide Claude sign-in gate. Mounted once at the deck root (a sibling of
 * DeckCanvas), it covers the whole app when the user is signed out so auth is
 * resolved BEFORE any cards or the session picker appear — auth is strictly
 * required for an AI IDE. A thin consumer of the reusable {@link TugAppDialog}
 * (the app-modal mechanism, not a bespoke overlay) reading the app-level
 * {@link authStore}; the same `claude_auth_result` frame that feeds the store
 * dismisses this gate, the picker gate, and the per-card banner together.
 *
 * The `check_auth` probe that populates the store is fired imperatively on
 * every `connectionDidOpen` (see `main.tsx`), not from a component effect, per
 * [L02]/[L24]: this component is a pure read of `authStore`.
 */

import { type ReactElement } from "react";
import { authStore, useAuth } from "@/lib/auth-store";
import { getConnection } from "@/lib/connection-singleton";
import { TugPushButton } from "./tug-push-button";
import { TugProgressIndicator } from "./tug-progress-indicator";
import { TugAppDialog } from "./tug-app-dialog";
import "./auth-gate.css";

// TEMP dev affordance (dev builds only): flip to `true` to force the gate
// while signed in, so its look can be iterated under HMR. Leave `false`; the
// `import.meta.env.DEV` guard folds it out of production.
const DEV_FORCE_AUTH_GATE = true;

export function AuthGate(): ReactElement {
  const { loggedIn, signingIn } = useAuth();
  const forced = import.meta.env.DEV && DEV_FORCE_AUTH_GATE;
  const open = forced || loggedIn === false;

  const handleSignIn = (): void => {
    const connection = getConnection();
    if (!connection) {
      console.warn("AuthGate: connection unavailable for sign-in");
      return;
    }
    authStore.setSigningIn(true);
    connection.sendControlFrame("claude_sign_in");
  };

  return (
    <TugAppDialog
      open={open}
      icon="🔑"
      title="Sign in to Claude"
      footer={
        signingIn ? (
          // Not a button — a non-interactive status while the browser OAuth
          // completes (the gate resolves itself on `claude_auth_result`).
          <div className="tug-auth-gate-progress">
            <TugProgressIndicator
              variant="spinner"
              size={16}
              state="running"
              aria-hidden
            />
            <span>Waiting for browser sign-in…</span>
          </div>
        ) : (
          <TugPushButton emphasis="filled" onClick={handleSignIn}>
            Sign In
          </TugPushButton>
        )
      }
    >
      Tug runs sessions with your Claude subscription. Sign in to start working
      on your projects.
      {signingIn && (
        <p className="tug-auth-gate-hint">
          Complete sign-in in the browser window that opened — this resolves
          automatically.
        </p>
      )}
    </TugAppDialog>
  );
}
