/**
 * ConfigureTug — the app-wide, blocking setup wizard. A sub-component of TugAlert:
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
 *   3. Add on-device AI — optional, first-run only, and the one step the user
 *      may decline. Offers what the catalog marks `offered`; Download hands
 *      the acquisition to tugcast, Skip records that the offer was waved away
 *      so the wizard stops asking.
 *   4. Choose your projects folder — a path chooser prefilled with `~/tug`.
 *      Confirming creates the directory and writes it to tugbank as the
 *      app-wide default project directory.
 *   5. Open your first session — pops the first Session card. First-run only:
 *      a set-up user whose deck goes empty mid-life is left alone with it.
 *
 * Both middle steps gate the one below them. Whether a local model is
 * installed decides where command and summary work runs, and where projects
 * live decides what Open Quickly and the session picker reach for — so both
 * answers are settled before the wizard hands over a session. "Settled" is not
 * "finished with Tug": the model acquisition lives in tugcast, so a quit
 * mid-download is picked back up by its startup auto-resume.
 *
 * Two ways in. The wizard opens itself when setup isn't done (the steps above),
 * and the Tug-menu "Configure Tug…" item opens it on demand on an app that is
 * already set up — `ConfigureTugRequest` stops any live turns first, then flips
 * `configure-tug-request-store`. The on-demand wizard differs in three ways: it is
 * dismissible (a Done button, and Escape), it shows the on-device AI row
 * outside a first run (that row is usually why the user came), and it drops
 * the "open your first session" step. When setup is genuinely incomplete the
 * required claim wins and no exit is offered.
 *
 * ("Installed" and "reachable" collapse into one step: Tug resolves `claude`
 * via PATH then `~/.local/bin` — see `resolveClaudePath`/`claude_executable` —
 * so a binary the installer drops in `~/.local/bin` is reachable without any
 * shell-PATH edit. There is no realistic "installed but unreachable" state.)
 *
 * Each step is a bespoke pulsing-dot row ([D106]): the dot encodes lifecycle,
 * a CTA (or a success check) hangs on the right. The unhappy paths are
 * first-class designed states, not fallthroughs ([P10], roadmap/archive/onboarding-and-install.md#tugsetup-states):
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
import { CircleCheck, Rocket, X } from "lucide-react";
import { type ReactElement, useEffect, useState, useSyncExternalStore } from "react";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import { authStore, useAuth } from "@/lib/auth-store";
import { useVersionGateOpen, deriveConfigureTugOpen } from "@/lib/macos-support";
import { useAppTransportState } from "@/lib/transport-state-store";
import { getConnection } from "@/lib/connection-singleton";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import {
  readSetupSeen,
  readSetupSuppressed,
  putSetupSeen,
  putLocalModelDeclined,
  putDefaultProjectPath,
  DEFAULT_PROJECT_PATH_DOMAIN,
  DEFAULT_PROJECT_PATH_KEY,
  DEFAULT_PROJECT_DIR_LEAF,
} from "@/settings-api";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import { useHostFacts } from "@/lib/host-facts-store";
import { makeDirectory } from "@/lib/fs-mkdir";
import type { TaggedValue } from "@/lib/tugbank-client";
import {
  getLocalModelStore,
  useLocalModel,
} from "@/lib/local-model-store";
import {
  useConfigureTugOnDemand,
  closeConfigureTugOnDemand,
} from "@/lib/configure-tug-request-store";
import { useDeckManager } from "@/deck-manager-context";
import { countWorkCards } from "@/deck-store-selectors";
import {
  subscriptionLabel,
  pendingOpenStepCopy,
  localAiOfferDetail,
  localAiProgressValue,
} from "./configure-tug-copy";
import { TugPushButton } from "./tug-push-button";
import { TugIconButton } from "./tug-icon-button";
import { TugFileChooser } from "./tug-file-chooser";
import {
  TugProgressIndicator,
  type TugProgressIndicatorRole,
  type TugProgressIndicatorState,
} from "./tug-progress-indicator";
import "./tug-alert.css";
import "./configure-tug.css";

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
 * Track height of the download's progress bar. Thin enough to read as a rule
 * under the label rather than a second object competing with it.
 */
const PROGRESS_BAR_HEIGHT = 6;

/**
 * How long to wait on a browser sign-in before offering a re-try (ms). Generous
 * — the verification email can be slow and the user may step away — so we only
 * give up after 10 minutes (a late `claude_auth_result` still wins).
 */
const SIGN_IN_TIMEOUT_MS = 600_000;

/** Read the explicit default project path out of a tugbank entry. */
function parseProjectPath(entry: TaggedValue | undefined): string {
  if (entry && entry.kind === "string" && typeof entry.value === "string") {
    return entry.value;
  }
  return "";
}

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
  stepKey,
  status,
  label,
  detail,
  body,
  cta,
  secondaryCta,
}: {
  stepKey: string;
  status: StepStatus;
  label: string;
  detail?: string;
  body?: ReactElement;
  cta?: { label: string; onClick: () => void };
  secondaryCta?: { label: string; onClick: () => void };
}): ReactElement {
  const { role, state } = dotVisual(status);
  return (
    <li className="configure-tug-step" data-step={stepKey} data-status={status}>
      <div className="configure-tug-step-main">
        <div className="configure-tug-step-headline">
          <TugProgressIndicator
            variant="pulsing-dot"
            size={DOT_SIZE}
            role={role}
            state={state}
            className="configure-tug-step-dot"
            aria-hidden
          />
          <span className="configure-tug-step-label">{label}</span>
        </div>
        {detail && <span className="configure-tug-step-detail">{detail}</span>}
        {body && <div className="configure-tug-step-body">{body}</div>}
      </div>
      {status === "done" ? (
        <div className="configure-tug-step-action">
          <CircleCheck className="configure-tug-step-check" size={28} aria-hidden="true" />
        </div>
      ) : cta || secondaryCta ? (
        <div className="configure-tug-step-action">
          {secondaryCta && (
            <TugPushButton size="sm" emphasis="ghost" onClick={secondaryCta.onClick}>
              {secondaryCta.label}
            </TugPushButton>
          )}
          {cta && (
            <TugPushButton
              size="sm"
              emphasis={status === "error" ? "outlined" : "filled"}
              role={status === "error" ? "danger" : "action"}
              disabled={status === "busy"}
              onClick={cta.onClick}
            >
              {cta.label}
            </TugPushButton>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function ConfigureTug(): ReactElement {
  const { loggedIn, reason, account, signingIn, signInFailed, installing, verifyingInstall, installError } =
    useAuth();
  const transport = useAppTransportState();
  const deck = useDeckManager();
  const deckState = useSyncExternalStore(deck.subscribe, deck.getSnapshot);
  // The Lens stands at its pin on any restored deck, so it must not read as
  // "this deck already holds work" — count everything but the Lens.
  const cardCount = countWorkCards(deckState);
  const [openedFirstSession, setOpenedFirstSession] = useState(false);
  const localModel = useLocalModel();
  // The Tug-menu "Configure Tug…" route: the wizard opened by request on an app that
  // is already set up. ConfigureTugRequest has already stopped any live turns by
  // the time this flips.
  const onDemand = useConfigureTugOnDemand();
  // Declining on-device AI is remembered the same way as opening the first
  // session: a local latch for this wizard's lifetime. The durable record is
  // the `setup-declined` flag written to tugbank.
  const [declinedLocalAi, setDeclinedLocalAi] = useState(false);

  // The projects-folder step. The stored path is external state [L02]; the
  // chooser's in-flight text is a draft that exists only until the user
  // confirms, and `null` means "showing the resolved default".
  const storedProjectPath = useTugbankValue(
    DEFAULT_PROJECT_PATH_DOMAIN,
    DEFAULT_PROJECT_PATH_KEY,
    parseProjectPath,
    "",
  );
  const hostFacts = useHostFacts();
  const resolvedProjectPath =
    storedProjectPath !== ""
      ? storedProjectPath
      : hostFacts?.home
        ? `${hostFacts.home.replace(/\/+$/, "")}/${DEFAULT_PROJECT_DIR_LEAF}`
        : "";
  const [projectPathDraft, setProjectPathDraft] = useState<string | null>(null);
  const projectPathValue = projectPathDraft ?? resolvedProjectPath;
  // Confirmed during this wizard's lifetime — the same latch shape the
  // local-AI skip uses, so an on-demand revisit can change the answer and
  // still see the row settle.
  const [projectDirConfirmed, setProjectDirConfirmed] = useState(false);
  const [projectDirBusy, setProjectDirBusy] = useState(false);
  const [projectDirError, setProjectDirError] = useState<string | null>(null);

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
  // genuine first run. A set-up user whose deck goes empty mid-life (last card
  // closed, or a relaunch with an empty layout) is left alone with it.
  const needsFirstSession =
    firstRun && effectiveLoggedIn && cardCount === 0 && !openedFirstSession;

  // App-test suppression, read once at mount like `firstRun`: tugcast seeds
  // the flag when the app-test harness launched this instance, so the
  // blocking wizard never opens under a focus/selection-driven test. A
  // ConfigureTug-specific test opts back in via the harness (flag seeded false).
  const [suppressed] = useState(() => {
    const client = getTugbankClient();
    return client ? readSetupSuppressed(client) : false;
  });
  useEffect(() => {
    if (firstRun) putSetupSeen(true);
  }, [firstRun]);

  // Each on-demand visit starts fresh: a Skip from a previous visit is a
  // durable tugbank flag, not a latch that should outlive the wizard it was
  // clicked in.
  useEffect(() => {
    if (onDemand) {
      setDeclinedLocalAi(false);
      setProjectDirConfirmed(false);
      setProjectDirError(null);
      setProjectPathDraft(null);
    }
  }, [onDemand]);

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

  // The version gate takes precedence: while it is open, ConfigureTug suppresses
  // itself so the two app-modals never stack (Spec S02).
  const gateOpen = useVersionGateOpen();
  // Two ways in, with different exits. `required` is the wizard's own claim on
  // the app — setup isn't done, so there is nothing to dismiss to. On demand
  // the app IS set up and the user asked to look, so the wizard is theirs to
  // close. When both are true the required claim wins and Done stays hidden.
  const required =
    !suppressed && (forced !== false || notReady || needsFirstSession || probing);
  const open = deriveConfigureTugOpen(gateOpen, required || onDemand);

  // Which wizard the user is looking at, latched for as long as the panel is on
  // screen. Radix keeps the content mounted through its close animation, so
  // reading `onDemand` live would re-shape the steps under the fade: Done
  // clears the flag, and the dismissible layout would visibly turn back into
  // the required one on the way out. Latching while closed holds the picture
  // still. The adjust-during-render form (not an effect) means the shape is
  // right on the first painted frame of an open, with no flash either.
  const [showingOnDemand, setShowingOnDemand] = useState(false);
  if (open && showingOnDemand !== onDemand) setShowingOnDemand(onDemand);
  const dismissible = showingOnDemand && !required;

  const handleInstall = (): void => {
    authStore.setInstalling(true);
    getConnection()?.sendControlFrame("install_claude");
  };
  const handleSignIn = (): void => {
    authStore.setSigningIn(true);
    getConnection()?.sendControlFrame("claude_sign_in");
  };
  const handleAddLocalAi = (modelId: string): void => {
    // A download in flight is itself the record that the offer was taken, so
    // a previous Skip stops standing.
    putLocalModelDeclined(false);
    getLocalModelStore()?.download(modelId);
  };
  const handleCancelLocalAi = (): void => {
    getLocalModelStore()?.cancelDownload();
  };
  const handleSkipLocalAi = (): void => {
    putLocalModelDeclined(true);
    setDeclinedLocalAi(true);
  };
  const handleConfirmProjectDir = (): void => {
    const path = projectPathValue.trim();
    if (path === "") return;
    setProjectDirBusy(true);
    setProjectDirError(null);
    void makeDirectory(path)
      .then((created) => (created ? putDefaultProjectPath(path) : null))
      .then((storedPath) => {
        setProjectDirBusy(false);
        // Confirmed means tugbank holds it. A directory we made but couldn't
        // record is not a setting, and the step must not tick over as if the
        // choice took.
        if (storedPath === null) {
          setProjectDirError(path);
          return;
        }
        setProjectPathDraft(null);
        setProjectDirConfirmed(true);
      });
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
    /** Extra content under the detail line — the download's progress bar. */
    body?: ReactElement;
    cta?: { label: string; onClick: () => void };
    /** A quieter alternative to the primary CTA, e.g. declining an offer. */
    secondaryCta?: { label: string; onClick: () => void };
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

  // On-device AI: the one optional step. It offers what the catalog marks as
  // `offered` — with the v1 catalog that is a single entry, so the row names it
  // outright rather than putting a picker in front of a first-run user. It
  // never gates the step below it: a download runs in tugcast, so opening the
  // first session (and closing the wizard) leaves it running, and tugcast's
  // startup auto-resume backstops a quit mid-download.
  const offeredModels = localModel.models.filter((entry) => entry.offered);
  const offer =
    offeredModels.find((entry) => entry.recommended) ?? offeredModels[0] ?? null;
  const localAiStep: Step | null = (() => {
    if (offer === null) return null;
    const key = "local-ai";
    if (offer.state === "installed") {
      return { key, status: "done", label: "On-device AI ready", detail: offer.displayName };
    }
    // A declined offer reads "Skipped." — except when the user opened the
    // wizard themselves, which is exactly the gesture for changing that
    // answer. Skipping again during this visit (`declinedLocalAi`) still
    // settles the row, so the Skip button has visible effect either way.
    if (
      declinedLocalAi ||
      (localModel.setupDeclined && !showingOnDemand)
    ) {
      return { key, status: "done", label: "On-device AI", detail: "Skipped." };
    }
    if (!effectiveLoggedIn) {
      return { key, status: "pending", label: "Add on-device AI" };
    }
    const inFlight =
      localModel.download?.model === offer.id ? localModel.download : null;
    if (inFlight !== null || offer.state === "downloading") {
      const received = inFlight?.receivedBytes ?? offer.receivedBytes ?? 0;
      const total = inFlight?.totalBytes || offer.totalBytes;
      // The bar takes the detail line's place rather than stacking under it —
      // its own readout carries the bytes, so the downloading row stays the
      // same two lines as every other row. Before the total is known there is
      // nothing to count, so the bar runs indeterminate with no readout.
      // Cancel rides the bar's own row as an ✕ rather than a worded button in
      // the row's action slot, which would tower over a 6px track.
      return {
        key,
        status: "busy",
        label: "Adding on-device AI",
        body: (
          <>
            {total > 0 ? (
              <TugProgressIndicator
                variant="bar"
                size={PROGRESS_BAR_HEIGHT}
                role="agent"
                state="running"
                value={received}
                max={total}
                showValue
                formatValue={localAiProgressValue}
              />
            ) : (
              <TugProgressIndicator
                variant="bar"
                size={PROGRESS_BAR_HEIGHT}
                role="agent"
                state="running"
              />
            )}
            <TugIconButton
              size="2xs"
              icon={<X aria-hidden="true" />}
              aria-label="Cancel download"
              title="Cancel download"
              onClick={handleCancelLocalAi}
            />
          </>
        ),
      };
    }
    // A download the user stopped is not a failure — the row stays the live
    // offer it was, with the cancel reported and the same two ways forward.
    if (localModel.lastCanceled) {
      return {
        key,
        status: "active",
        label: "Add on-device AI (optional)",
        detail: "Download canceled",
        cta: { label: "Download", onClick: () => handleAddLocalAi(offer.id) },
        secondaryCta: { label: "Skip", onClick: handleSkipLocalAi },
      };
    }
    if (localModel.lastError !== null) {
      return {
        key,
        status: "error",
        label: "Add on-device AI",
        detail: `Download failed: ${localModel.lastError}`,
        cta: { label: "Retry", onClick: () => handleAddLocalAi(offer.id) },
        secondaryCta: { label: "Skip", onClick: handleSkipLocalAi },
      };
    }
    return {
      key,
      status: "active",
      label: "Add on-device AI (optional)",
      detail: localAiOfferDetail(offer.displayName, offer.totalBytes, offer.notes),
      cta: { label: "Download", onClick: () => handleAddLocalAi(offer.id) },
      secondaryCta: { label: "Skip", onClick: handleSkipLocalAi },
    };
  })();

  // Whether the on-device AI row is on screen at all, and whether the user has
  // answered it. An unanswered offer holds the session step shut: the answer
  // decides where command and summary work runs, and it is far easier to make
  // once, here, than to go looking for later.
  const localAiShown = (firstRun || showingOnDemand) && localAiStep !== null;
  const localAiSettled = !localAiShown || localAiStep?.status === "done";

  // Where the user's projects live. Always ends up persisted explicitly: the
  // session picker's seed chain reads the explicit value, so a post-setup user
  // who never touches Settings still gets their folder rather than falling
  // through to the launch hint.
  const projectDirStep: Step = (() => {
    const key = "project-dir";
    if (!effectiveLoggedIn) {
      return { key, status: "pending", label: "Choose your projects folder" };
    }
    // Settled: confirmed just now, or already chosen on a previous run. An
    // on-demand visit is the gesture for changing it, so it re-opens there.
    if (projectDirConfirmed || (storedProjectPath !== "" && !showingOnDemand)) {
      return {
        key,
        status: "done",
        label: "Projects folder",
        detail: projectDirConfirmed ? projectPathValue : storedProjectPath,
      };
    }
    // The chooser and its confirm button ride the body together on one
    // full-width line, rather than the button hanging in the row's action
    // slot. The action slot would take a fixed column out of the row's width,
    // and the field — the thing this step is actually about — would get what
    // was left. On its own line it gets the whole row.
    const chooser = (label: string): ReactElement => (
      <>
        <TugFileChooser
          value={projectPathValue}
          onChange={setProjectPathDraft}
          base={projectPathValue !== "" ? projectPathValue : (hostFacts?.home ?? "/")}
          kind="directory"
          size="md"
          onSubmit={handleConfirmProjectDir}
          disabled={projectDirBusy}
          aria-label="Projects folder"
        />
        <TugPushButton
          size="sm"
          emphasis={projectDirError !== null ? "outlined" : "filled"}
          role={projectDirError !== null ? "danger" : "action"}
          disabled={projectDirBusy}
          onClick={handleConfirmProjectDir}
        >
          {label}
        </TugPushButton>
      </>
    );
    if (projectDirBusy) {
      return {
        key,
        status: "busy",
        label: "Choose your projects folder",
        detail: "Creating the folder…",
        body: chooser("Creating…"),
      };
    }
    if (projectDirError !== null) {
      return {
        key,
        status: "error",
        label: "Choose your projects folder",
        detail: `Couldn't create ${projectDirError}.`,
        body: chooser("Retry"),
      };
    }
    return {
      key,
      status: "active",
      label: "Choose your projects folder",
      detail: "Tug opens here when nothing else is in front.",
      body: chooser("Use This Folder"),
    };
  })();

  const projectDirSettled = projectDirStep.status === "done";

  const openStep: Step = !effectiveLoggedIn
    ? // Pending (logged-out) preview: with cards already open — the
      // logout-with-work case — this reads "Continue working" and re-login
      // auto-closes the wizard back to them, rather than nudging a new card.
      { key: "open", status: "pending", ...pendingOpenStepCopy(cardCount) }
    : !localAiSettled
      ? {
          key: "open",
          status: "pending",
          label: "Start a Claude Code session",
          detail: "Add or skip on-device AI.",
        }
      : !projectDirSettled
        ? {
            key: "open",
            status: "pending",
            label: "Start a Claude Code session",
            detail: "Choose your projects folder.",
          }
        : {
          key: "open",
          status: "active",
          label: "Start a Claude Code session",
          detail: "Open a Session card to get started",
          cta: { label: "Open a Session Card", onClick: handleOpenSession },
        };

  const probingSteps: Step[] = [
    { key: "install", status: "busy", label: "Install Claude Code", detail: "Looking for Claude Code…" },
    { key: "signin", status: "pending", label: "Log in to Claude" },
    { key: "open", status: "pending", label: "Start a Claude Code session" },
  ];

  // Transport down mid-setup: replace the body with a calm "Reconnecting…" row
  // rather than a dead wizard (roadmap/archive/onboarding-and-install.md#tugsetup-states). This only changes the body of
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
      : [
          claudeStep,
          signInStep,
          // On demand the on-device-AI row is the point of the visit, so it
          // shows outside a first run too.
          ...(localAiShown && localAiStep !== null ? [localAiStep] : []),
          projectDirStep,
          // …and the "open your first session" row is dead weight on a deck
          // that already has work in it; Done takes its place.
          ...(dismissible ? [] : [openStep]),
        ];

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal container={overlayRoot}>
        <AlertDialog.Overlay className="tug-alert-overlay" />
        <AlertDialog.Content
          className="tug-alert-content configure-tug"
          data-slot="configure-tug"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            // Required setup has no exit. A wizard the user opened themselves
            // does — Escape is the same act as Done.
            e.preventDefault();
            if (dismissible) closeConfigureTugOnDemand();
          }}
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
                Configure Tug
              </AlertDialog.Title>
            </div>
          </div>

          <ol className="configure-tug-steps">
            {steps.map((step) => (
              <StepRow
                key={step.key}
                stepKey={step.key}
                status={step.status}
                label={step.label}
                detail={step.detail}
                body={step.body}
                cta={step.cta}
                secondaryCta={step.secondaryCta}
              />
            ))}
          </ol>

          {dismissible && (
            <div className="tug-alert-actions">
              <TugPushButton
                size="sm"
                emphasis="primary"
                role="action"
                persistentDefaultRing
                onClick={closeConfigureTugOnDemand}
              >
                Done
              </TugPushButton>
            </div>
          )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
