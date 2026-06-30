/**
 * TugSetup — the app-wide, blocking setup wizard. A sub-component of TugAlert:
 * it reuses TugAlert's app-modal chrome (Radix AlertDialog portalled into the
 * canvas overlay, the `tug-alert-overlay`/`tug-alert-content` classes at
 * z-index 99990/99991 that actually block the deck) and adds a multi-step
 * checklist body. Mounted once at the deck root; while open, nothing behind it
 * is reachable — setup is strictly required for an AI IDE.
 *
 * The steps, driven by the app-level {@link authStore} (one `claude auth
 * status` probe surfaced via `check_auth`) plus the deck's card count:
 *   1. Claude Code installed & reachable — Tug-managed install + recheck.
 *   2. Signed in to Claude — browser OAuth shell-out.
 *   3. Open your first session — pops the first Dev card.
 *
 * ("Installed" and "reachable" collapse into one step: Tug resolves `claude`
 * via PATH then `~/.local/bin` — see `resolveClaudePath`/`claude_executable` —
 * so a binary the installer drops in `~/.local/bin` is reachable without any
 * shell-PATH edit. There is no realistic "installed but unreachable" state.)
 *
 * Pure read of the stores ([L02]/[L24]); the `check_auth` probe is fired
 * imperatively from `main.tsx`.
 */

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { type ReactElement, useState, useSyncExternalStore } from "react";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import { authStore, useAuth } from "@/lib/auth-store";
import { useVersionGateOpen, deriveTugSetupOpen } from "@/lib/macos-support";
import { getConnection } from "@/lib/connection-singleton";
import { useDeckManager } from "@/deck-manager-context";
import { TugPushButton } from "./tug-push-button";
import { TugProgressIndicator } from "./tug-progress-indicator";
import "./tug-alert.css";
import "./tug-setup.css";

// TEMP dev affordance (dev builds only): flip to a state to force the wizard
// while signed in, so it can be iterated under HMR. Leave `false`; the
// `import.meta.env.DEV` guard folds it out of production.
const DEV_FORCE_SETUP: "claude_missing" | "logged_out" | "open_session" | false =
  false;

function StepRow({
  status,
  label,
  children,
}: {
  status: "done" | "active" | "pending";
  label: string;
  children?: ReactElement | false | null;
}): ReactElement {
  const mark = status === "done" ? "✓" : status === "active" ? "→" : "○";
  return (
    <li className="tug-setup-step" data-status={status}>
      <span className="tug-setup-step-mark" aria-hidden="true">
        {mark}
      </span>
      <div className="tug-setup-step-main">
        <span className="tug-setup-step-label">{label}</span>
        {children}
      </div>
    </li>
  );
}

export function TugSetup(): ReactElement {
  const { loggedIn, reason, account, signingIn, installing, installError } =
    useAuth();
  const deck = useDeckManager();
  const deckState = useSyncExternalStore(deck.subscribe, deck.getSnapshot);
  const cardCount = deckState.cards.length;
  const [openedFirstSession, setOpenedFirstSession] = useState(false);

  const forced = import.meta.env.DEV ? DEV_FORCE_SETUP : false;
  const forcedLoggedIn = forced === "open_session";
  const forcedReason =
    forced === "claude_missing"
      ? "claude_missing"
      : forced === "logged_out"
        ? "logged_out"
        : reason;

  const effectiveLoggedIn = forced ? forcedLoggedIn : loggedIn === true;
  const claudeMissing = forced
    ? forcedReason === "claude_missing"
    : reason === "claude_missing";

  const notReady = forced ? !forcedLoggedIn : loggedIn === false;
  const needsFirstSession =
    effectiveLoggedIn && cardCount === 0 && !openedFirstSession;
  // The version gate takes precedence: while it is open, TugSetup suppresses
  // itself so the two app-modals never stack (Spec S02).
  const gateOpen = useVersionGateOpen();
  const open = deriveTugSetupOpen(
    gateOpen,
    forced !== false || notReady || needsFirstSession,
  );

  const handleInstall = (): void => {
    authStore.setInstalling(true);
    getConnection()?.sendControlFrame("install_claude");
  };
  const handleSignIn = (): void => {
    authStore.setSigningIn(true);
    getConnection()?.sendControlFrame("claude_sign_in");
  };
  const handleOpenSession = (): void => {
    deck.addCard("dev");
    setOpenedFirstSession(true);
  };

  const overlayRoot = useCanvasOverlay();

  // Step statuses.
  const claudeStatus: "done" | "active" | "pending" = claudeMissing
    ? "active"
    : "done";
  const signInStatus: "done" | "active" | "pending" = effectiveLoggedIn
    ? "done"
    : claudeMissing
      ? "pending"
      : "active";
  const openStatus: "done" | "active" | "pending" = effectiveLoggedIn
    ? "active"
    : "pending";

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal container={overlayRoot}>
        <AlertDialog.Overlay className="tug-alert-overlay" />
        <AlertDialog.Content
          className="tug-alert-content tug-setup"
          data-slot="tug-setup"
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <AlertDialog.Title className="tug-setup-title">
            Set up Tug
          </AlertDialog.Title>
          <AlertDialog.Description className="tug-setup-subtitle" asChild>
            <p>A couple of steps to get your AI IDE ready.</p>
          </AlertDialog.Description>

          <ol className="tug-setup-steps">
            <StepRow status={claudeStatus} label="Claude Code installed">
              {claudeMissing && (
                <>
                  <span className="tug-setup-step-detail">
                    {installError
                      ? `Install failed: ${installError}`
                      : "Tug will install it for you."}
                  </span>
                  <div className="tug-setup-step-actions">
                    {installing ? (
                      <span className="tug-setup-step-status">
                        <TugProgressIndicator
                          variant="spinner"
                          size={14}
                          state="running"
                          aria-hidden
                        />
                        <span>Installing Claude Code…</span>
                      </span>
                    ) : (
                      <TugPushButton emphasis="filled" onClick={handleInstall}>
                        {installError ? "Retry Install" : "Install Claude Code"}
                      </TugPushButton>
                    )}
                  </div>
                </>
              )}
            </StepRow>

            <StepRow
              status={signInStatus}
              label={
                effectiveLoggedIn && account?.email
                  ? `Signed in as ${account.email}`
                  : "Sign in to Claude"
              }
            >
              {signInStatus === "active" &&
                (signingIn ? (
                  <span className="tug-setup-step-status">
                    <TugProgressIndicator
                      variant="spinner"
                      size={14}
                      state="running"
                      aria-hidden
                    />
                    <span>Waiting for browser sign-in…</span>
                  </span>
                ) : (
                  <>
                    <span className="tug-setup-step-detail">
                      Tug runs sessions with your Claude subscription.
                    </span>
                    <div className="tug-setup-step-actions">
                      <TugPushButton emphasis="filled" onClick={handleSignIn}>
                        Sign In
                      </TugPushButton>
                    </div>
                  </>
                ))}
            </StepRow>

            <StepRow status={openStatus} label="Open your first session">
              {openStatus === "active" && (
                <div className="tug-setup-step-actions">
                  <TugPushButton emphasis="filled" onClick={handleOpenSession}>
                    Open a Dev Card
                  </TugPushButton>
                </div>
              )}
            </StepRow>
          </ol>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
