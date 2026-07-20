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
 *   2. Logged in to Claude — browser OAuth shell-out.
 *   3. Open your first session — pops the first Session card. First-run only:
 *      a set-up user whose deck goes empty mid-life gets the lightweight
 *      TugCreateSessionCard sibling, not the wizard.
 *
 * ("Installed" and "reachable" collapse into one step: Tug resolves `claude`
 * via PATH then `~/.local/bin` — see `resolveClaudePath`/`claude_executable` —
 * so a binary the installer drops in `~/.local/bin` is reachable without any
 * shell-PATH edit. There is no realistic "installed but unreachable" state.)
 *
 * Each step is a bespoke pulsing-dot row ([D106]): the dot encodes lifecycle,
 * a CTA (or a success check) hangs on the right. The unhappy paths are
 * first-class designed states, not fallthroughs ([P10], #tugsetup-states):
 *   - install failed → `authStore.installError` → an error row + Retry;
 *   - sign-in cancelled / browser never returned → `authStore.signInFailed`
 *     (set when an attempt resolves still-logged-out, or by the local timeout)
 *     → an error row + Try Again;
 *   - transport down mid-setup → `transportStateStore` → a calm "Reconnecting…"
 *     body (only swaps an already-open wizard; never pops setup on a set-up
 *     user — the app-wide reconnect banner owns that);
 *   - version too old → `TugVersionGate`, a sibling app-modal that takes
 *     precedence (Spec S02); logged-out mid-session → the per-card session-card
 *     auth banner safety net.
 *
 * Pure read of the stores ([L02]/[L24]) — `authStore`, the deck, the transport
 * and version-gate stores; the `check_auth` probe is fired imperatively from
 * `main.tsx`. The sign-in timeout is the one imperative effect (it schedules a
 * store call, it does not mirror state).
 */

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { CircleCheck, Rocket } from "lucide-react";
import { type ReactElement, useEffect, useState, useSyncExternalStore } from "react";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import { authStore, useAuth } from "@/lib/auth-store";
import { useVersionGateOpen, deriveTugSetupOpen } from "@/lib/macos-support";
import { useAppTransportState } from "@/lib/transport-state-store";
import { getConnection } from "@/lib/connection-singleton";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { readSetupSeen, readSetupSuppressed, putSetupSeen } from "@/settings-api";
import { useDeckManager } from "@/deck-manager-context";
import { subscriptionLabel, pendingOpenStepCopy } from "./tug-setup-copy";
import { TugPushButton } from "./tug-push-button";
import {
  TugProgressIndicator,
  type TugProgressIndicatorRole,
  type TugProgressIndicatorState,
} from "./tug-progress-indicator";
import "./tug-alert.css";
import "./tug-setup.css";

// TEMP dev affordance (dev builds only): flip to a state to force the wizard
// while signed in, so it can be iterated under HMR. Leave `false`; the
// `import.meta.env.DEV` guard folds it out of production.
const SESSION_FORCE_SETUP: "claude_missing" | "logged_out" | "open_session" | false =
  false;

/**
 * A step's lifecycle status, encoded by the left-hand pulsing dot ([D106]):
 * `pending` (dimmed), `active` (the user's turn — a CTA shows), `busy` (an
 * async action in flight), `error` (failed — a retry CTA shows), `done`.
 */
type StepStatus = "pending" | "active" | "busy" | "error" | "done";

const DOT_SIZE = 14;

/**
 * How long to wait on a browser sign-in before offering a re-try (ms). Generous
 * — the verification email can be slow and the user may step away — so we only
 * give up after 10 minutes (a late `claude_auth_result` still wins).
 */
const SIGN_IN_TIMEOUT_MS = 600_000;

/** Map a step status onto the dot's role + state ([D02]/[D106]). */
function dotVisual(status: StepStatus): {
  role: TugProgressIndicatorRole;
  state: TugProgressIndicatorState;
} {
  switch (status) {
    case "pending":
      return { role: "inherit", state: "stopped" };
    case "active":
      return { role: "action", state: "running" };
    case "busy":
      return { role: "agent", state: "running" };
    case "error":
      return { role: "danger", state: "aborted" };
    case "done":
      return { role: "success", state: "completed" };
  }
}

function StepRow({
  status,
  label,
  detail,
  cta,
}: {
  status: StepStatus;
  label: string;
  detail?: string;
  cta?: { label: string; onClick: () => void };
}): ReactElement {
  const { role, state } = dotVisual(status);
  return (
    <li className="tug-setup-step" data-status={status}>
      <div className="tug-setup-step-main">
        <div className="tug-setup-step-headline">
          <TugProgressIndicator
            variant="pulsing-dot"
            size={DOT_SIZE}
            role={role}
            state={state}
            className="tug-setup-step-dot"
            aria-hidden
          />
          <span className="tug-setup-step-label">{label}</span>
        </div>
        {detail && <span className="tug-setup-step-detail">{detail}</span>}
      </div>
      {status === "done" ? (
        <div className="tug-setup-step-action">
          <CircleCheck className="tug-setup-step-check" size={28} aria-hidden="true" />
        </div>
      ) : cta ? (
        <div className="tug-setup-step-action">
          <TugPushButton
            size="sm"
            emphasis={status === "error" ? "outlined" : "filled"}
            role={status === "error" ? "danger" : "action"}
            disabled={status === "busy"}
            onClick={cta.onClick}
          >
            {cta.label}
          </TugPushButton>
        </div>
      ) : null}
    </li>
  );
}

export function TugSetup(): ReactElement {
  const { loggedIn, reason, account, signingIn, signInFailed, installing, verifyingInstall, installError } =
    useAuth();
  const transport = useAppTransportState();
  const deck = useDeckManager();
  const deckState = useSyncExternalStore(deck.subscribe, deck.getSnapshot);
  const cardCount = deckState.cards.length;
  const [openedFirstSession, setOpenedFirstSession] = useState(false);

  const forced = import.meta.env.DEV ? SESSION_FORCE_SETUP : false;
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

  // First launch: show the wizard up front and immediately, even before the
  // auth probe answers, rather than flashing a blank deck. The flag is read
  // once at mount (tugbank is ready before React mounts) and persisted on the
  // first run so later launches fall through to the normal probe-driven path.
  const [firstRun] = useState(() => {
    const client = getTugbankClient();
    return client ? !readSetupSeen(client) : false;
  });

  // The "open your first session" step claims the empty deck only on a
  // genuine first run. A set-up user whose deck goes empty mid-life (last
  // card closed, or a relaunch with an empty layout) gets TugCreateSessionCard —
  // the lightweight sibling app-modal — not the full wizard.
  const needsFirstSession =
    firstRun && effectiveLoggedIn && cardCount === 0 && !openedFirstSession;

  // App-test suppression, read once at mount like `firstRun`: tugcast seeds
  // the flag when the app-test harness launched this instance, so the
  // blocking wizard never opens under a focus/selection-driven test. A
  // TugSetup-specific test opts back in via the harness (flag seeded false).
  const [suppressed] = useState(() => {
    const client = getTugbankClient();
    return client ? readSetupSuppressed(client) : false;
  });
  useEffect(() => {
    if (firstRun) putSetupSeen(true);
  }, [firstRun]);

  // Sign-in safety net: the CLI's `claude auth login` blocks on its own browser
  // OAuth callback with no backend timeout, so a user who abandons the browser
  // would otherwise leave the wizard stuck on "Waiting…" forever. Bound the
  // wait; on expiry, surface the recoverable failure (a late success still
  // wins — `applyResult` clears the flag).
  useEffect(() => {
    if (!signingIn) return;
    const timer = window.setTimeout(
      () => authStore.markSignInTimedOut(),
      SIGN_IN_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [signingIn]);

  // While the probe is still in flight on a first launch, the login state is
  // unknown — render a "checking" body instead of guessing step statuses.
  const probing = !forced && firstRun && loggedIn === null;

  // The version gate takes precedence: while it is open, TugSetup suppresses
  // itself so the two app-modals never stack (Spec S02).
  const gateOpen = useVersionGateOpen();
  const open = deriveTugSetupOpen(
    gateOpen,
    !suppressed && (forced !== false || notReady || needsFirstSession || probing),
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
    deck.addCard("session");
    setOpenedFirstSession(true);
  };

  const overlayRoot = useCanvasOverlay();

  // The ordered steps, each a pulsing-dot row ([D106]). During the first-run
  // probe the login state is unknown, so we render a "checking" body rather
  // than guess statuses.
  type Step = {
    key: string;
    status: StepStatus;
    label: string;
    detail?: string;
    cta?: { label: string; onClick: () => void };
  };

  const claudeStep: Step = installing || verifyingInstall
    ? {
        key: "install",
        status: "busy",
        label: "Install Claude Code",
        detail: "This can take a moment.",
        cta: { label: "Installing…", onClick: handleInstall },
      }
    : installError
      ? {
          key: "install",
          status: "error",
          label: "Install Claude Code",
          detail: `Install failed: ${installError}`,
          cta: { label: "Retry", onClick: handleInstall },
        }
      : claudeMissing
        ? {
            key: "install",
            status: "active",
            label: "Install Claude Code",
            detail: "Tug will install it for you.",
            cta: { label: "Install", onClick: handleInstall },
          }
        : { key: "install", status: "done", label: "Claude Code installed", detail: "Claude Code is ready." };

  const signInStep: Step = claudeMissing
    ? { key: "signin", status: "pending", label: "Log in to Claude" }
    : signingIn
      ? {
          key: "signin",
          status: "busy",
          label: "Log in to Claude",
          detail: "Use your browser to log in…",
          cta: { label: "Logging in…", onClick: handleSignIn },
        }
      : effectiveLoggedIn
        ? {
            key: "signin",
            status: "done",
            label: account?.email ? `Logged in as ${account.email}` : "Logged in to Claude",
            detail: subscriptionLabel(account?.subscriptionType),
          }
        : signInFailed
          ? {
              key: "signin",
              status: "error",
              label: "Log in to Claude",
              detail: "Log-in didn't finish. The browser may have been closed.",
              cta: { label: "Try Again", onClick: handleSignIn },
            }
          : {
              key: "signin",
              status: "active",
              label: "Log in to Claude",
              detail: "Tug runs sessions with your Claude subscription.",
              cta: { label: "Log In", onClick: handleSignIn },
            };

  const openStep: Step = effectiveLoggedIn
    ? {
        key: "open",
        status: "active",
        label: "Start a Claude Code session",
        detail: "Open a Session card to get started",
        cta: { label: "Open a Session Card", onClick: handleOpenSession },
      }
    : // Pending (logged-out) preview: with cards already open — the
      // logout-with-work case — this reads "Continue working" and re-login
      // auto-closes the wizard back to them, rather than nudging a new card.
      { key: "open", status: "pending", ...pendingOpenStepCopy(cardCount) };

  const probingSteps: Step[] = [
    { key: "install", status: "busy", label: "Install Claude Code", detail: "Looking for Claude Code…" },
    { key: "signin", status: "pending", label: "Log in to Claude" },
    { key: "open", status: "pending", label: "Start a Claude Code session" },
  ];

  // Transport down mid-setup: replace the body with a calm "Reconnecting…" row
  // rather than a dead wizard (#tugsetup-states). This only changes the body of
  // an already-open wizard — it is deliberately NOT part of the `open`
  // derivation, so a transport blip never pops setup on an already-set-up user
  // (the app-wide reconnect banner covers that case).
  const transportDown = transport !== "online";
  const reconnectingSteps: Step[] = [
    {
      key: "reconnect",
      status: "busy",
      label: "Reconnecting…",
      detail: "Lost the connection to Tug. Setup will resume automatically.",
    },
  ];

  const steps: Step[] = transportDown
    ? reconnectingSteps
    : probing
      ? probingSteps
      : [claudeStep, signInStep, openStep];

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal container={overlayRoot}>
        <AlertDialog.Overlay className="tug-alert-overlay" />
        <AlertDialog.Content
          className="tug-alert-content tug-setup"
          data-slot="tug-setup"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {/* In-jail key sink ([P13]): AlertDialog.Content's FocusScope is
              always trapped — it yanks focus back from anywhere outside the
              jail. The engine's park must land INSIDE it (the engine parks
              at the innermost mounted sink), or every park while the wizard
              is up is answered by a Radix refocus and the two systems
              fight. */}
          <div
            data-tug-key-sink=""
            tabIndex={-1}
            className="tug-key-sink"
            aria-label="Keyboard"
          />
          {/* Shared one-line modal header (tugx-header.css) — the alert
              header classes with no message: icon centered on the title. */}
          <div className="tug-alert-body" data-icon-role="action">
            <div className="tug-alert-icon" aria-hidden="true">
              <Rocket />
            </div>
            <div className="tug-alert-text">
              <AlertDialog.Title className="tug-alert-title">
                Set Up Tug
              </AlertDialog.Title>
            </div>
          </div>

          <ol className="tug-setup-steps">
            {steps.map((step) => (
              <StepRow
                key={step.key}
                status={step.status}
                label={step.label}
                detail={step.detail}
                cta={step.cta}
              />
            ))}
          </ol>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
