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
import { type ReactElement, useEffect, useState, useSyncExternalStore } from "react";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import { authStore, useAuth } from "@/lib/auth-store";
import { useVersionGateOpen, deriveTugSetupOpen } from "@/lib/macos-support";
import { getConnection } from "@/lib/connection-singleton";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { readSetupSeen, putSetupSeen } from "@/settings-api";
import { useDeckManager } from "@/deck-manager-context";
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
const DEV_FORCE_SETUP: "claude_missing" | "logged_out" | "open_session" | false =
  false;

/**
 * A step's lifecycle status, encoded by the left-hand pulsing dot ([D105]):
 * `pending` (dimmed), `active` (the user's turn — a CTA shows), `busy` (an
 * async action in flight), `error` (failed — a retry CTA shows), `done`.
 */
type StepStatus = "pending" | "active" | "busy" | "error" | "done";

const DOT_SIZE = 14;

/** Map a step status onto the dot's role + state ([D02]/[D105]). */
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
      <TugProgressIndicator
        variant="pulsing-dot"
        size={DOT_SIZE}
        role={role}
        state={state}
        className="tug-setup-step-dot"
        aria-hidden
      />
      <div className="tug-setup-step-main">
        <span className="tug-setup-step-label">{label}</span>
        {detail && <span className="tug-setup-step-detail">{detail}</span>}
        {cta && status !== "busy" && (
          <div className="tug-setup-step-actions">
            <TugPushButton
              emphasis={status === "error" ? "outlined" : "filled"}
              role={status === "error" ? "danger" : "action"}
              onClick={cta.onClick}
            >
              {cta.label}
            </TugPushButton>
          </div>
        )}
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

  // First launch: show the wizard up front and immediately, even before the
  // auth probe answers, rather than flashing a blank deck. The flag is read
  // once at mount (tugbank is ready before React mounts) and persisted on the
  // first run so later launches fall through to the normal probe-driven path.
  const [firstRun] = useState(() => {
    const client = getTugbankClient();
    return client ? !readSetupSeen(client) : false;
  });
  useEffect(() => {
    if (firstRun) putSetupSeen(true);
  }, [firstRun]);

  // While the probe is still in flight on a first launch, the login state is
  // unknown — render a "checking" body instead of guessing step statuses.
  const probing = !forced && firstRun && loggedIn === null;

  // The version gate takes precedence: while it is open, TugSetup suppresses
  // itself so the two app-modals never stack (Spec S02).
  const gateOpen = useVersionGateOpen();
  const open = deriveTugSetupOpen(
    gateOpen,
    forced !== false || notReady || needsFirstSession || probing,
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

  // The ordered steps, each a pulsing-dot row ([D105]). During the first-run
  // probe the login state is unknown, so we render a "checking" body rather
  // than guess statuses.
  type Step = {
    key: string;
    status: StepStatus;
    label: string;
    detail?: string;
    cta?: { label: string; onClick: () => void };
  };

  const claudeStep: Step = installing
    ? { key: "install", status: "busy", label: "Claude Code installed", detail: "Installing Claude Code…" }
    : installError
      ? {
          key: "install",
          status: "error",
          label: "Claude Code installed",
          detail: `Install failed: ${installError}`,
          cta: { label: "Retry Install", onClick: handleInstall },
        }
      : claudeMissing
        ? {
            key: "install",
            status: "active",
            label: "Claude Code installed",
            detail: "Tug will install it for you.",
            cta: { label: "Install Claude Code", onClick: handleInstall },
          }
        : { key: "install", status: "done", label: "Claude Code installed", detail: "Claude Code is ready." };

  const signInStep: Step = claudeMissing
    ? { key: "signin", status: "pending", label: "Sign in to Claude" }
    : signingIn
      ? { key: "signin", status: "busy", label: "Sign in to Claude", detail: "Finish signing in in your browser…" }
      : effectiveLoggedIn
        ? {
            key: "signin",
            status: "done",
            label: account?.email ? `Signed in as ${account.email}` : "Signed in to Claude",
            detail: account?.subscriptionType ? `${account.subscriptionType} subscription.` : undefined,
          }
        : {
            key: "signin",
            status: "active",
            label: "Sign in to Claude",
            detail: "Tug runs sessions with your Claude subscription.",
            cta: { label: "Sign In", onClick: handleSignIn },
          };

  const openStep: Step = effectiveLoggedIn
    ? {
        key: "open",
        status: "active",
        label: "Open your first session",
        detail: "Open your first Dev card to start.",
        cta: { label: "Open a Dev Card", onClick: handleOpenSession },
      }
    : { key: "open", status: "pending", label: "Open your first session" };

  const probingSteps: Step[] = [
    { key: "install", status: "busy", label: "Claude Code installed", detail: "Looking for Claude Code…" },
    { key: "signin", status: "pending", label: "Sign in to Claude" },
    { key: "open", status: "pending", label: "Open your first session" },
  ];

  const steps: Step[] = probing
    ? probingSteps
    : [claudeStep, signInStep, openStep];

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
            <p>
              {probing
                ? "Checking your setup…"
                : "A couple of steps to get your AI IDE ready."}
            </p>
          </AlertDialog.Description>

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
