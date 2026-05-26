/**
 * gallery-permission-dialog-compact.tsx — fidelity check for the new
 * `PermissionDialog` chrome.
 *
 * Two sections:
 *
 *   1. Proposal B (spec) — hand-rolled mockup of the agreed
 *      header-bar design. Reference rendering.
 *   2. Live PermissionDialog — the actual component mounted against
 *      a minimal `CodeSessionStore` double. Should look identical to
 *      section 1; any divergence is a rollout bug.
 *
 * The mock store is intentionally tiny — only the surface
 * `PermissionDialog` reads (`subscribe`, `getSnapshot().pendingApproval`,
 * `respondApproval`) is implemented. A "Reset request" button beneath
 * the live dialog re-arms `pendingApproval` so the user can click
 * Deny / Allow multiple times in the same session.
 *
 * @module components/tugways/cards/gallery-permission-dialog-compact
 */

import React from "react";
import { Shell, ShieldAlert } from "lucide-react";

import { TugInlineDialog } from "@/components/tugways/tug-inline-dialog";
import type { TugInlineDialogOption } from "@/components/tugways/tug-inline-dialog";
import { TugDialogButton } from "@/components/tugways/tug-dialog-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { PermissionDialog } from "@/components/tugways/chrome/tide-permission-dialog";
import type {
  CodeSessionStore,
  ControlRequestForward,
} from "@/lib/code-session-store";

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

const resultStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginTop: "8px",
};

// Same scope-option shape the production dialog builds from
// `permission_suggestions`.
const PERMISSION_SCOPE_OPTIONS: ReadonlyArray<TugInlineDialogOption> = [
  {
    value: "allow-once",
    label: "Allow once",
    description: "Allow this single invocation. No rule is added.",
  },
  {
    value: "allow-project",
    label: "Allow for this project",
  },
];

// ---------------------------------------------------------------------------
// Proposal B — header-bar (hand-rolled spec)
// ---------------------------------------------------------------------------

const HEADER_FRAME: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.875rem",
  width: "100%",
  padding: "0.625rem 0.75rem",
  background: "var(--tug7-surface-global-primary-normal-raised-rest)",
  color: "var(--tug7-element-global-text-normal-default-rest)",
  border: "1px solid var(--tug7-element-global-border-normal-default-rest)",
  borderRadius: "var(--tug-radius-md)",
  boxSizing: "border-box",
};

const HEADER_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.625rem",
};

const HEADER_TEXT_COL: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  alignItems: "baseline",
  gap: "0.5rem",
  flexWrap: "wrap",
};

const HEADER_TITLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.875rem",
  fontWeight: 600,
  lineHeight: 1.3,
};

const HEADER_DESCRIPTION: React.CSSProperties = {
  fontSize: "0.8125rem",
  lineHeight: 1.4,
  opacity: 0.8,
};

const HEADER_ICON: React.CSSProperties = {
  flex: "0 0 auto",
  color: "var(--tug7-element-global-text-normal-caution-rest)",
  display: "flex",
  alignItems: "center",
  // The icon's vertical center must line up with the title's first
  // line. Sizing the icon container to the title's line-height
  // (fontSize × lineHeight) and centering inside it does exactly that.
  height: "calc(0.875rem * 1.3)",
};

const HEADER_ACTIONS: React.CSSProperties = {
  display: "flex",
  gap: "0.375rem",
  flex: "0 0 auto",
};

const HEADER_OPTIONS: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  width: "100%",
  maxWidth: "450px",
  margin: "0 auto",
  // Tighter TugDialogButton rows beneath the header row.
  ["--tugx-dialog-button-padding-x" as string]: "0.625rem",
  ["--tugx-dialog-button-padding-y" as string]: "0.375rem",
  ["--tugx-dialog-button-gap-stack" as string]: "0.125rem",
  ["--tugx-dialog-button-label-size" as string]: "0.8125rem",
  ["--tugx-dialog-button-description-size" as string]: "0.75rem",
} as React.CSSProperties;

// ---------------------------------------------------------------------------
// Mock CodeSessionStore — minimal surface for PermissionDialog
// ---------------------------------------------------------------------------

/**
 * Surface PermissionDialog actually reads. The full
 * `CodeSessionStore` has dozens of methods; this card only
 * implements the three the dialog touches.
 */
class MockPermissionStore {
  private _pending: ControlRequestForward | null;
  private _listeners: Array<() => void> = [];
  // Cache the snapshot object so a useSyncExternalStore selector
  // doesn't see a fresh reference on every call (would loop).
  private _snapshot: { pendingApproval: ControlRequestForward | null };

  constructor(initial: ControlRequestForward) {
    this._pending = initial;
    this._snapshot = { pendingApproval: initial };
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  };

  getSnapshot = (): { pendingApproval: ControlRequestForward | null } => {
    return this._snapshot;
  };

  respondApproval = (
    requestId: string,
    _payload: { decision: "allow" | "deny"; message?: string },
  ): void => {
    if (this._pending?.request_id === requestId) {
      this._pending = null;
      this._snapshot = { pendingApproval: null };
      this._notify();
    }
  };

  /** Test-only: re-arm the pending request so the user can re-test. */
  arm(request: ControlRequestForward): void {
    this._pending = request;
    this._snapshot = { pendingApproval: request };
    this._notify();
  }

  private _notify(): void {
    for (const listener of this._listeners.slice()) listener();
  }
}

const LIVE_BASH_REQUEST: ControlRequestForward = {
  request_id: "gallery-permission-dialog-compact:bash",
  is_question: false,
  tool_name: "Bash",
  input: { command: "tokei qwodihqwd oqwih qwoihqw oqwdoihqwd qwdohqwd qwdoih qwdoihqwdoih " },
  permission_suggestions: [
    {
      behavior: "allow",
      destination: "project",
      rules: [{ ruleContent: "Bash(tokei)", toolName: "Bash" }],
      type: "addRule",
    },
  ],
};

// ---------------------------------------------------------------------------
// GalleryPermissionDialogCompact
// ---------------------------------------------------------------------------

export function GalleryPermissionDialogCompact(): React.ReactElement {
  const [proposalResult, setProposalResult] = React.useState<string>("—");
  const [proposalScope, setProposalScope] = React.useState<string>(
    PERMISSION_SCOPE_OPTIONS[0].value,
  );
  const [liveResult, setLiveResult] = React.useState<string>("(pending)");

  // Mock store for the live PermissionDialog instance. Created once;
  // re-armed via the Reset button when the user wants to test again.
  const liveStore = React.useMemo(
    () => new MockPermissionStore(LIVE_BASH_REQUEST),
    [],
  );

  // Wrap respondApproval so the gallery section can echo the outcome.
  // The wrapper still calls the real method so PermissionDialog's
  // pending-state machine clears as it does in production.
  React.useEffect(() => {
    const original = liveStore.respondApproval;
    liveStore.respondApproval = (requestId, payload) => {
      original(requestId, payload);
      const summary =
        payload.decision === "allow"
          ? `Allowed${payload.message !== undefined ? ` — scope: ${payload.message}` : ""}`
          : "Denied";
      setLiveResult(summary);
    };
    return () => {
      liveStore.respondApproval = original;
    };
  }, [liveStore]);

  const handleReset = React.useCallback(() => {
    liveStore.arm(LIVE_BASH_REQUEST);
    setLiveResult("(pending)");
  }, [liveStore]);

  // Shared description ReactNode — same shape the live
  // `PermissionDescription` synthesizes for a Bash request.
  const bashDescription = (
    <>
      This command requires approval ·{" "}
      <Shell
        size={12}
        aria-hidden="true"
        style={{ verticalAlign: "middle" }}
      />{" "}
      Bash · <code>tokei</code>
    </>
  );

  return (
    <div className="cg-content" data-testid="gallery-permission-dialog-compact">
      {/* ---- 1. Proposal B — Header bar (spec) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Proposal B — spec</TugLabel>
        <div style={labelStyle}>
          Reference rendering of the accepted design: small caution
          icon + title + inline description on the header row, with
          Deny / Allow trailing. The scope-picker stack is centered
          and capped at 450 px. Hand-rolled — does not touch the live
          component.
        </div>
        <div style={HEADER_FRAME}>
          <div style={HEADER_ROW}>
            <span style={HEADER_ICON} aria-hidden="true">
              <ShieldAlert size={20} />
            </span>
            <div style={HEADER_TEXT_COL}>
              <h3 style={HEADER_TITLE}>Permission requested</h3>
              <div style={HEADER_DESCRIPTION}>{bashDescription}</div>
            </div>
            <div style={HEADER_ACTIONS}>
              <TugPushButton
                emphasis="outlined"
                role="danger"
                size="xs"
                onClick={() => setProposalResult("Denied")}
              >
                Deny
              </TugPushButton>
              <TugPushButton
                emphasis="filled"
                role="action"
                size="xs"
                onClick={() =>
                  setProposalResult(`Allowed — scope: ${proposalScope}`)
                }
              >
                Allow
              </TugPushButton>
            </div>
          </div>
          <div
            style={HEADER_OPTIONS}
            role="radiogroup"
            aria-label="Permission scope"
          >
            {PERMISSION_SCOPE_OPTIONS.map((option) => (
              <TugDialogButton
                key={option.value}
                label={option.label}
                description={option.description}
                role="action"
                selected={proposalScope === option.value}
                selectionStyle="radio"
                onClick={() => setProposalScope(option.value)}
              />
            ))}
          </div>
        </div>
        <div style={resultStyle}>
          Result: <strong>{proposalResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 2. Live PermissionDialog instance ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Live PermissionDialog
        </TugLabel>
        <div style={labelStyle}>
          The actual component mounted against a minimal mock
          `CodeSessionStore`. Should be visually identical to the
          spec above — any drift is a rollout bug. Click Deny / Allow
          to fire the real `respondApproval` path; the dialog
          disappears (its production "pending-only" behavior). Use
          Reset to re-arm the pending request.
        </div>
        <PermissionDialog
          input={{ kind: "permission", request: LIVE_BASH_REQUEST }}
          context={{ session: liveStore as unknown as CodeSessionStore }}
        />
        <div style={resultStyle}>
          Result: <strong>{liveResult}</strong>
        </div>
        <div style={{ marginTop: "0.5rem" }}>
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="xs"
            onClick={handleReset}
          >
            Reset request
          </TugPushButton>
        </div>
      </div>
    </div>
  );
}
