/**
 * gallery-configure-tug.tsx — design spike for the ConfigureTug happy-path polish
 * ([#step-9] of roadmap/onboarding-and-install.md).
 *
 * ConfigureTug's real states only exist on a clean machine (Claude missing, signed
 * out, no cards) — states that are awkward to reach on a dev box. This card
 * simulates the whole setup flow from purely local state so the wizard's copy,
 * rhythm, and step-row visuals can be designed under HMR without standing up a
 * fresh guest.
 *
 * Two surfaces:
 *   1. Step-row states in isolation — one `SetupStepRow` per lifecycle status,
 *      so the row's pulsing-dot / label / detail / CTA can be tuned directly.
 *   2. Simulated flow — a scenario picker drives a full 3-step model through the
 *      happy path and the unhappy branches ([#step-10] preview), rendered inside
 *      a panel that mimics the real wizard body.
 *
 * The step row is a bespoke row: a `pulsing-dot` on the left, a requirement /
 * direction line, a detail message for state / progress / completion, and a CTA
 * (or a success check) on the right. Nothing here touches the real `authStore`.
 *
 * @module components/tugways/cards/gallery-configure-tug
 */

import React, { useState } from "react";
import { CircleCheck, Rocket, X } from "lucide-react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { TugFileChooser } from "@/components/tugways/tug-file-chooser";
import {
  TugProgressIndicator,
  type TugProgressIndicatorRole,
  type TugProgressIndicatorState,
} from "@/components/tugways/tug-progress-indicator";
import {
  pendingOpenStepCopy,
  localAiOfferDetail,
  localAiProgressValue,
} from "@/components/tugways/configure-tug-copy";

/** The catalog's one `offered` entry, for the on-device AI scenarios. */
const OFFER_NAME = "Qwen3 4B Instruct";
const OFFER_BYTES = 2_278_969_697;
const OFFER_NOTES = "Enhances command parsing & session summaries.";

/** The prefill the projects-folder scenarios show. */
const PROJECT_DIR = "/Users/ken/tug";
import "./gallery.css";
import "./gallery-configure-tug.css";

// ---------------------------------------------------------------------------
// Step model
// ---------------------------------------------------------------------------

/**
 * A setup step's lifecycle status — the spike's design vocabulary:
 *   pending — not yet reached (dimmed, quiet dot)
 *   active  — the user's turn; a CTA is shown
 *   busy    — an async action is in flight (install / browser sign-in)
 *   error   — the action failed; a retry CTA is shown
 *   done    — satisfied
 */
type StepStatus = "pending" | "active" | "busy" | "error" | "done";

interface StepCta {
  label: string;
  onClick?: () => void;
}

interface SetupStepModel {
  key: string;
  /** Requirement / direction line — the step's heading. */
  label: string;
  /** State / progress / completion message under the label. */
  detail?: string;
  /** Extra content under the detail line — a download's progress bar. */
  body?: React.ReactElement;
  status: StepStatus;
  cta?: StepCta;
  /** A quieter alternative to the primary CTA, e.g. declining an offer. */
  secondaryCta?: StepCta;
}

/** Map a step status onto the left-hand `pulsing-dot`'s role + state. */
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

const DOT_SIZE = 14;

/** Mirrors PROGRESS_BAR_HEIGHT in configure-tug.tsx. */
const PROGRESS_BAR_HEIGHT = 6;

// ---------------------------------------------------------------------------
// SetupStepRow — the bespoke spike row
// ---------------------------------------------------------------------------

function SetupStepRow({ step }: { step: SetupStepModel }): React.ReactElement {
  const { role, state } = dotVisual(step.status);
  return (
    <li className="cg-configure-tug-step" data-step={step.key} data-status={step.status}>
      <div className="cg-configure-tug-step-main">
        <div className="cg-configure-tug-step-headline">
          <TugProgressIndicator
            variant="pulsing-dot"
            size={DOT_SIZE}
            role={role}
            state={state}
            className="cg-configure-tug-step-dot"
            aria-hidden
          />
          <span className="cg-configure-tug-step-label">{step.label}</span>
        </div>
        {step.detail && (
          <span className="cg-configure-tug-step-detail">{step.detail}</span>
        )}
        {step.body && <div className="cg-configure-tug-step-body">{step.body}</div>}
      </div>
      {step.status === "done" ? (
        <div className="cg-configure-tug-step-action">
          <CircleCheck className="cg-configure-tug-step-check" size={28} aria-hidden />
        </div>
      ) : step.cta || step.secondaryCta ? (
        <div className="cg-configure-tug-step-action">
          {step.secondaryCta && (
            <TugPushButton size="sm" emphasis="ghost" onClick={step.secondaryCta.onClick}>
              {step.secondaryCta.label}
            </TugPushButton>
          )}
          {step.cta && (
            <TugPushButton
              size="sm"
              emphasis={step.status === "error" ? "outlined" : "filled"}
              role={step.status === "error" ? "danger" : "action"}
              disabled={step.status === "busy"}
              onClick={step.cta.onClick}
            >
              {step.cta.label}
            </TugPushButton>
          )}
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — step states in isolation
// ---------------------------------------------------------------------------

const ISOLATED_STEPS: SetupStepModel[] = [
  {
    key: "pending",
    label: "Start a Claude Code session",
    detail: "Waiting on the steps above.",
    status: "pending",
  },
  {
    key: "active",
    label: "Log in to Claude",
    detail: "Tug runs sessions with your Claude subscription.",
    status: "active",
    cta: { label: "Log In" },
  },
  {
    key: "busy",
    label: "Log in to Claude",
    detail: "Use your browser to log in…",
    status: "busy",
    cta: { label: "Logging in…" },
  },
  {
    key: "error",
    label: "Install Claude Code",
    detail: "Install failed: network unreachable.",
    status: "error",
    cta: { label: "Retry" },
  },
  {
    key: "done",
    label: "Logged in as ken@example.com",
    detail: "Claude Max plan",
    status: "done",
  },
];

// ---------------------------------------------------------------------------
// Section 2 — simulated flow
// ---------------------------------------------------------------------------

type Scenario =
  | "probing"
  | "fresh"
  | "installing"
  | "install_failed"
  | "signed_out"
  | "signing_in"
  | "signin_failed"
  | "local_ai_offer"
  | "local_ai_downloading"
  | "local_ai_canceled"
  | "local_ai_failed"
  | "local_ai_skipped"
  | "project_dir_choose"
  | "project_dir_creating"
  | "project_dir_failed"
  | "ready_to_open"
  | "continue_working"
  | "complete"
  | "transport_down";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "probing", label: "Probing" },
  { key: "fresh", label: "Fresh (install)" },
  { key: "installing", label: "Installing" },
  { key: "install_failed", label: "Install failed" },
  { key: "signed_out", label: "Signed out" },
  { key: "signing_in", label: "Logging in" },
  { key: "signin_failed", label: "Log-in failed" },
  { key: "local_ai_offer", label: "On-device AI offer" },
  { key: "local_ai_downloading", label: "On-device AI downloading" },
  { key: "local_ai_canceled", label: "On-device AI canceled" },
  { key: "local_ai_failed", label: "On-device AI failed" },
  { key: "local_ai_skipped", label: "On-device AI skipped" },
  { key: "project_dir_choose", label: "Projects folder" },
  { key: "project_dir_creating", label: "Projects folder creating" },
  { key: "project_dir_failed", label: "Projects folder failed" },
  { key: "ready_to_open", label: "Ready to open" },
  { key: "continue_working", label: "Continue working" },
  { key: "complete", label: "Complete" },
  { key: "transport_down", label: "Transport down" },
];

interface FlowModel {
  steps: SetupStepModel[];
}

function buildFlow(
  scenario: Scenario,
  go: (next: Scenario) => void,
): FlowModel {
  const install = (overrides: Partial<SetupStepModel>): SetupStepModel => ({
    key: "install",
    label: "Install Claude Code",
    status: "pending",
    ...overrides,
  });
  const signin = (overrides: Partial<SetupStepModel>): SetupStepModel => ({
    key: "signin",
    label: "Log in to Claude",
    status: "pending",
    ...overrides,
  });
  const localAi = (overrides: Partial<SetupStepModel>): SetupStepModel => ({
    key: "local-ai",
    label: "Add on-device AI (optional)",
    status: "pending",
    ...overrides,
  });
  const open = (overrides: Partial<SetupStepModel>): SetupStepModel => ({
    key: "open",
    label: "Start a Claude Code session",
    status: "pending",
    ...overrides,
  });
  const projectDir = (overrides: Partial<SetupStepModel>): SetupStepModel => ({
    key: "project-dir",
    label: "Choose your projects folder",
    status: "pending",
    ...overrides,
  });
  // The real step's body — a directory chooser prefilled with the resolved
  // default. Read-only here: the spike drives states from the picker, not from
  // what is typed.
  const projectDirChooser = (
    label: string,
    failed = false,
  ): React.ReactElement => (
    <>
      <TugFileChooser
        value={PROJECT_DIR}
        onChange={() => {}}
        base={PROJECT_DIR}
        kind="directory"
        size="md"
        aria-label="Projects folder"
      />
      <TugPushButton
        size="sm"
        emphasis={failed ? "outlined" : "filled"}
        role={failed ? "danger" : "action"}
      >
        {label}
      </TugPushButton>
    </>
  );
  const installed = install({
    status: "done",
    label: "Claude Code installed",
    detail: "Claude Code is ready.",
  });
  const signedIn = signin({
    status: "done",
    label: "Logged in as ken@example.com",
    detail: "Claude Max plan",
  });
  const localAiDone = localAi({
    status: "done",
    label: "On-device AI",
    detail: "Skipped.",
  });

  switch (scenario) {
    case "probing":
      return {
        steps: [
          install({ status: "busy", detail: "Looking for Claude Code…" }),
          signin({}),
          open({}),
        ],
      };
    case "fresh":
      return {
        steps: [
          install({
            status: "active",
            detail: "Tug will install it for you.",
            cta: { label: "Install", onClick: () => go("installing") },
          }),
          signin({}),
          open({}),
        ],
      };
    case "installing":
      return {
        steps: [
          install({
            status: "busy",
            detail: "This can take a moment.",
            cta: { label: "Installing…", onClick: () => {} },
          }),
          signin({}),
          open({}),
        ],
      };
    case "install_failed":
      return {
        steps: [
          install({
            status: "error",
            detail: "Install failed: network unreachable.",
            cta: { label: "Retry", onClick: () => go("installing") },
          }),
          signin({}),
          open({}),
        ],
      };
    case "signed_out":
      return {
        steps: [
          install({ status: "done", label: "Claude Code installed", detail: "Claude Code is ready." }),
          signin({
            status: "active",
            detail: "Tug runs sessions with your Claude subscription.",
            cta: { label: "Log In", onClick: () => go("signing_in") },
          }),
          open({}),
        ],
      };
    case "signing_in":
      return {
        steps: [
          install({ status: "done", label: "Claude Code installed", detail: "Claude Code is ready." }),
          signin({
            status: "busy",
            detail: "Use your browser to log in…",
            cta: { label: "Logging in…", onClick: () => {} },
          }),
          open({}),
        ],
      };
    case "signin_failed":
      return {
        steps: [
          install({ status: "done", label: "Claude Code installed", detail: "Claude Code is ready." }),
          signin({
            status: "error",
            detail: "Log-in didn't finish. The browser may have been closed.",
            cta: { label: "Try Again", onClick: () => go("signing_in") },
          }),
          open({}),
        ],
      };
    case "local_ai_offer":
      return {
        steps: [
          install({ status: "done", label: "Claude Code installed", detail: "Claude Code is ready." }),
          signin({ status: "done", label: "Logged in as ken@example.com", detail: "Claude Max plan" }),
          localAi({
            status: "active",
            label: "Add on-device AI (optional)",
            detail: localAiOfferDetail(OFFER_NAME, OFFER_BYTES, OFFER_NOTES),
            cta: { label: "Download", onClick: () => go("local_ai_downloading") },
            secondaryCta: { label: "Skip", onClick: () => go("local_ai_skipped") },
          }),
          open({ status: "pending", detail: "Add or skip on-device AI." }),
        ],
      };
    case "local_ai_downloading":
      return {
        steps: [
          install({ status: "done", label: "Claude Code installed", detail: "Claude Code is ready." }),
          signin({ status: "done", label: "Logged in as ken@example.com", detail: "Claude Max plan" }),
          localAi({
            status: "busy",
            label: "Adding on-device AI",
            body: (
              <>
                <TugProgressIndicator
                  variant="bar"
                  size={PROGRESS_BAR_HEIGHT}
                  role="agent"
                  state="running"
                  value={OFFER_BYTES * 0.42}
                  max={OFFER_BYTES}
                  showValue
                  formatValue={localAiProgressValue}
                />
                <TugIconButton
                  size="2xs"
                  icon={<X aria-hidden="true" />}
                  aria-label="Cancel download"
                  title="Cancel download"
                  onClick={() => go("local_ai_offer")}
                />
              </>
            ),
          }),
          open({ status: "pending", detail: "Add or skip on-device AI." }),
        ],
      };
    case "local_ai_canceled":
      return {
        steps: [
          install({ status: "done", label: "Claude Code installed", detail: "Claude Code is ready." }),
          signin({ status: "done", label: "Logged in as ken@example.com", detail: "Claude Max plan" }),
          localAi({
            status: "active",
            label: "Add on-device AI (optional)",
            detail: "Download canceled",
            cta: { label: "Download", onClick: () => go("local_ai_downloading") },
            secondaryCta: { label: "Skip", onClick: () => go("local_ai_skipped") },
          }),
          open({ status: "pending", detail: "Add or skip on-device AI." }),
        ],
      };
    case "local_ai_failed":
      return {
        steps: [
          install({ status: "done", label: "Claude Code installed", detail: "Claude Code is ready." }),
          signin({ status: "done", label: "Logged in as ken@example.com", detail: "Claude Max plan" }),
          localAi({
            status: "error",
            label: "Add on-device AI",
            detail: "Download failed: checksum mismatch for model.safetensors.",
            cta: { label: "Retry", onClick: () => go("local_ai_downloading") },
            secondaryCta: { label: "Skip", onClick: () => go("local_ai_skipped") },
          }),
          open({ status: "pending", detail: "Add or skip on-device AI." }),
        ],
      };
    case "local_ai_skipped":
      return {
        steps: [
          install({ status: "done", label: "Claude Code installed", detail: "Claude Code is ready." }),
          signin({ status: "done", label: "Logged in as ken@example.com", detail: "Claude Max plan" }),
          localAiDone,
          projectDir({}),
          open({ status: "pending", detail: "Choose your projects folder." }),
        ],
      };
    case "project_dir_choose":
      return {
        steps: [
          installed,
          signedIn,
          localAiDone,
          projectDir({
            status: "active",
            detail: "Tug opens here when nothing else is in front.",
            body: projectDirChooser("Use This Folder"),
          }),
          open({ status: "pending", detail: "Choose your projects folder." }),
        ],
      };
    case "project_dir_creating":
      return {
        steps: [
          installed,
          signedIn,
          localAiDone,
          projectDir({
            status: "busy",
            detail: "Creating the folder…",
            body: projectDirChooser("Creating…"),
          }),
          open({ status: "pending", detail: "Choose your projects folder." }),
        ],
      };
    case "project_dir_failed":
      return {
        steps: [
          installed,
          signedIn,
          localAiDone,
          projectDir({
            status: "error",
            detail: `Couldn't create ${PROJECT_DIR}.`,
            body: projectDirChooser("Retry", true),
          }),
          open({ status: "pending", detail: "Choose your projects folder." }),
        ],
      };
    case "ready_to_open":
      return {
        steps: [
          installed,
          signedIn,
          localAiDone,
          projectDir({ status: "done", label: "Projects folder", detail: PROJECT_DIR }),
          open({
            status: "active",
            detail: "Open a Session card to get started",
            cta: { label: "Open a Session Card", onClick: () => go("complete") },
          }),
        ],
      };
    case "continue_working":
      // Logged out with cards still open (the logout-with-work case): the
      // third step previews the return to work via the real
      // `pendingOpenStepCopy` helper — re-login auto-closes the wizard back
      // to those cards, so there is no active CTA here. [P04]
      return {
        steps: [
          install({ status: "done", label: "Claude Code installed", detail: "Claude Code is ready." }),
          signin({
            status: "active",
            detail: "Tug runs sessions with your Claude subscription.",
            cta: { label: "Log In", onClick: () => go("complete") },
          }),
          open({ status: "pending", ...pendingOpenStepCopy(3) }),
        ],
      };
    case "complete":
      return {
        steps: [
          installed,
          signedIn,
          localAiDone,
          projectDir({ status: "done", label: "Projects folder", detail: PROJECT_DIR }),
          open({ status: "done", detail: "Opening Session card…" }),
        ],
      };
    case "transport_down":
      return {
        steps: [
          {
            key: "reconnect",
            label: "Reconnecting…",
            detail: "Lost the connection to Tug. Setup will resume automatically.",
            status: "busy",
          },
        ],
      };
  }
}

function ScenarioPicker({
  scenario,
  onPick,
}: {
  scenario: Scenario;
  onPick: (next: Scenario) => void;
}): React.ReactElement {
  return (
    <div className="cg-configure-tug-scenarios">
      {SCENARIOS.map((s) => (
        <TugPushButton
          key={s.key}
          size="sm"
          emphasis={s.key === scenario ? "filled" : "ghost"}
          onClick={() => onPick(s.key)}
        >
          {s.label}
        </TugPushButton>
      ))}
    </div>
  );
}

function WizardPreview({
  flow,
}: {
  flow: FlowModel;
}): React.ReactElement {
  return (
    <div className="cg-configure-tug-preview-panel" data-slot="setup-preview">
      <div className="cg-configure-tug-header">
        <Rocket className="cg-configure-tug-icon" size={32} aria-hidden />
        <div className="cg-configure-tug-preview-title">Configure Tug</div>
      </div>
      <ol className="cg-configure-tug-steps">
        {flow.steps.map((step) => (
          <SetupStepRow key={step.key} step={step} />
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryConfigureTug
// ---------------------------------------------------------------------------

export function GalleryConfigureTug(): React.ReactElement {
  const [scenario, setScenario] = useState<Scenario>("fresh");
  const flow = buildFlow(scenario, setScenario);

  return (
    <div className="cg-content" data-testid="gallery-configure-tug">
      <div className="cg-section">
        <TugLabel className="cg-section-title">Simulated flow</TugLabel>
        <TugLabel size="2xs" emphasis="calm">
          Pick a scenario to drive the wizard body. CTAs advance one hop forward.
        </TugLabel>
        <ScenarioPicker scenario={scenario} onPick={setScenario} />
        <WizardPreview flow={flow} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Step-row states (bespoke row)
        </TugLabel>
        <div className="cg-configure-tug-rows-frame">
          <ol className="cg-configure-tug-steps">
            {ISOLATED_STEPS.map((step) => (
              <SetupStepRow key={step.key} step={step} />
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
