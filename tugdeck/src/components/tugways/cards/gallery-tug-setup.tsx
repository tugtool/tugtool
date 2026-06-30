/**
 * gallery-tug-setup.tsx — design spike for the TugSetup happy-path polish
 * ([#step-9] of roadmap/onboarding-and-install.md).
 *
 * TugSetup's real states only exist on a clean machine (Claude missing, signed
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
 * @module components/tugways/cards/gallery-tug-setup
 */

import React, { useState } from "react";
import { CircleCheck, Rocket } from "lucide-react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  TugProgressIndicator,
  type TugProgressIndicatorRole,
  type TugProgressIndicatorState,
} from "@/components/tugways/tug-progress-indicator";
import "./gallery.css";
import "./gallery-tug-setup.css";

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
  status: StepStatus;
  cta?: StepCta;
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

// ---------------------------------------------------------------------------
// SetupStepRow — the bespoke spike row
// ---------------------------------------------------------------------------

function SetupStepRow({ step }: { step: SetupStepModel }): React.ReactElement {
  const { role, state } = dotVisual(step.status);
  return (
    <li className="cg-setup-step" data-status={step.status}>
      <TugProgressIndicator
        variant="pulsing-dot"
        size={DOT_SIZE}
        role={role}
        state={state}
        className="cg-setup-step-dot"
        aria-hidden
      />
      <div className="cg-setup-step-main">
        <span className="cg-setup-step-label">{step.label}</span>
        {step.detail && (
          <span className="cg-setup-step-detail">{step.detail}</span>
        )}
      </div>
      {step.status === "done" ? (
        <div className="cg-setup-step-action">
          <CircleCheck className="cg-setup-step-check" size={28} aria-hidden />
        </div>
      ) : step.cta ? (
        <div className="cg-setup-step-action">
          <TugPushButton
            size="sm"
            emphasis={step.status === "error" ? "outlined" : "filled"}
            role={step.status === "error" ? "danger" : "action"}
            disabled={step.status === "busy"}
            onClick={step.cta.onClick}
          >
            {step.cta.label}
          </TugPushButton>
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
    label: "Sign in to Claude",
    detail: "Tug runs sessions with your Claude subscription.",
    status: "active",
    cta: { label: "Sign In" },
  },
  {
    key: "busy",
    label: "Sign in to Claude",
    detail: "Finish signing in in your browser…",
    status: "busy",
    cta: { label: "Signing in…" },
  },
  {
    key: "error",
    label: "Claude Code installed",
    detail: "Install failed: network unreachable.",
    status: "error",
    cta: { label: "Retry Install" },
  },
  {
    key: "done",
    label: "Signed in as ken@example.com",
    detail: "Claude Max subscription.",
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
  | "ready_to_open"
  | "complete"
  | "transport_down";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "probing", label: "Probing" },
  { key: "fresh", label: "Fresh (install)" },
  { key: "installing", label: "Installing" },
  { key: "install_failed", label: "Install failed" },
  { key: "signed_out", label: "Signed out" },
  { key: "signing_in", label: "Signing in" },
  { key: "signin_failed", label: "Sign-in failed" },
  { key: "ready_to_open", label: "Ready to open" },
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
    label: "Claude Code installed",
    status: "pending",
    ...overrides,
  });
  const signin = (overrides: Partial<SetupStepModel>): SetupStepModel => ({
    key: "signin",
    label: "Sign in to Claude",
    status: "pending",
    ...overrides,
  });
  const open = (overrides: Partial<SetupStepModel>): SetupStepModel => ({
    key: "open",
    label: "Start a Claude Code session",
    status: "pending",
    ...overrides,
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
            cta: { label: "Install Claude Code", onClick: () => go("installing") },
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
            cta: { label: "Retry Install", onClick: () => go("installing") },
          }),
          signin({}),
          open({}),
        ],
      };
    case "signed_out":
      return {
        steps: [
          install({ status: "done", detail: "Claude Code is ready." }),
          signin({
            status: "active",
            detail: "Tug runs sessions with your Claude subscription.",
            cta: { label: "Sign In", onClick: () => go("signing_in") },
          }),
          open({}),
        ],
      };
    case "signing_in":
      return {
        steps: [
          install({ status: "done", detail: "Claude Code is ready." }),
          signin({
            status: "busy",
            detail: "Finish signing in in your browser…",
            cta: { label: "Signing in…", onClick: () => {} },
          }),
          open({}),
        ],
      };
    case "signin_failed":
      return {
        steps: [
          install({ status: "done", detail: "Claude Code is ready." }),
          signin({
            status: "error",
            detail: "Sign-in didn't finish. The browser may have been closed.",
            cta: { label: "Try Again", onClick: () => go("signing_in") },
          }),
          open({}),
        ],
      };
    case "ready_to_open":
      return {
        steps: [
          install({ status: "done", detail: "Claude Code is ready." }),
          signin({ status: "done", label: "Signed in as ken@example.com", detail: "Claude Max subscription." }),
          open({
            status: "active",
            detail: "Open a Dev card to get started",
            cta: { label: "Open a Dev Card", onClick: () => go("complete") },
          }),
        ],
      };
    case "complete":
      return {
        steps: [
          install({ status: "done", detail: "Claude Code is ready." }),
          signin({ status: "done", label: "Signed in as ken@example.com", detail: "Claude Max subscription." }),
          open({ status: "done", detail: "Opening Dev card…" }),
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
    <div className="cg-setup-scenarios">
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
    <div className="cg-setup-preview-panel" data-slot="setup-preview">
      <div className="cg-setup-header">
        <Rocket className="cg-setup-icon" size={32} aria-hidden />
        <div className="cg-setup-preview-title">Set up Tug</div>
      </div>
      <ol className="cg-setup-steps">
        {flow.steps.map((step) => (
          <SetupStepRow key={step.key} step={step} />
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryTugSetup
// ---------------------------------------------------------------------------

export function GalleryTugSetup(): React.ReactElement {
  const [scenario, setScenario] = useState<Scenario>("fresh");
  const flow = buildFlow(scenario, setScenario);

  return (
    <div className="cg-content" data-testid="gallery-tug-setup">
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
        <div className="cg-setup-rows-frame">
          <ol className="cg-setup-steps">
            {ISOLATED_STEPS.map((step) => (
              <SetupStepRow key={step.key} step={step} />
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
