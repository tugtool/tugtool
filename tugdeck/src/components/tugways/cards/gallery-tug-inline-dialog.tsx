/**
 * gallery-tug-inline-dialog.tsx — concrete usages of `TugInlineDialog`
 * for the Component Gallery.
 *
 * One card, two sections — each a real consumer of `TugInlineDialog`
 * mounted against a minimal `CodeSessionStore` double. Tuning the
 * primitive's tokens or layout immediately reflects in both sections
 * so changes can be evaluated against the two callsites we actually
 * ship.
 *
 *   1. PermissionDialog — caution-shield request for a Bash command,
 *      with the `permission_suggestions` scope-picker radio stack.
 *      Mock store implements `subscribe` / `getSnapshot.pendingApproval`
 *      / `respondApproval`.
 *   2. QuestionDialog — 4-question wizard (the "calculator" walkthrough),
 *      single-select with auto-advance. Mock store implements
 *      `subscribe` / `getSnapshot.pendingQuestion` / `respondQuestion`
 *      / `popInteractive`.
 *
 * Each section has a Reset button beneath the dialog that re-arms the
 * pending request, so multiple Allow / Deny / Submit / Cancel
 * round-trips can be exercised in the same session.
 *
 * @module components/tugways/cards/gallery-tug-inline-dialog
 */

import React from "react";

import { PermissionDialog } from "@/components/tugways/chrome/dev-permission-dialog";
import { QuestionDialog } from "@/components/tugways/chrome/dev-question-dialog";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugSeparator } from "@/components/tugways/tug-separator";
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

// ---------------------------------------------------------------------------
// Mock CodeSessionStore — minimal surface for PermissionDialog
// ---------------------------------------------------------------------------

interface PermissionSnapshot {
  pendingApproval: ControlRequestForward | null;
}

class MockPermissionStore {
  private _pending: ControlRequestForward | null;
  private _listeners: Array<() => void> = [];
  // Cache the snapshot object so a useSyncExternalStore selector
  // doesn't see a fresh reference on every call (would loop).
  private _snapshot: PermissionSnapshot;

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

  getSnapshot = (): PermissionSnapshot => this._snapshot;

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
  request_id: "gallery-tug-inline-dialog:bash",
  is_question: false,
  tool_name: "Bash",
  input: { command: "tokei" },
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
// Mock CodeSessionStore — minimal surface for QuestionDialog
// ---------------------------------------------------------------------------

interface QuestionSnapshot {
  pendingQuestion: ControlRequestForward | null;
}

class MockQuestionStore {
  private _pending: ControlRequestForward | null;
  private _listeners: Array<() => void> = [];
  private _snapshot: QuestionSnapshot;

  constructor(initial: ControlRequestForward) {
    this._pending = initial;
    this._snapshot = { pendingQuestion: initial };
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  };

  getSnapshot = (): QuestionSnapshot => this._snapshot;

  respondQuestion = (
    requestId: string,
    _payload: { answers: Record<string, unknown> },
  ): void => {
    if (this._pending?.request_id === requestId) {
      this._clear();
    }
  };

  popInteractive = (): void => {
    this._clear();
  };

  arm(request: ControlRequestForward): void {
    this._pending = request;
    this._snapshot = { pendingQuestion: request };
    this._notify();
  }

  private _clear(): void {
    this._pending = null;
    this._snapshot = { pendingQuestion: null };
    this._notify();
  }

  private _notify(): void {
    for (const listener of this._listeners.slice()) listener();
  }
}

// Mirrors the user's "calculator" walkthrough — 4 single-select
// questions, varied option lists, sensible recommended defaults.
const LIVE_CALCULATOR_REQUEST: ControlRequestForward = {
  request_id: "gallery-tug-inline-dialog:calculator",
  is_question: true,
  tool_name: "AskUserQuestion",
  input: {
    questions: [
      {
        question: "How should the calculator accept input?",
        multiSelect: false,
        options: [
          {
            label: "Interactive REPL",
            description:
              "Prompt the user in a loop, read one expression per line until they quit",
          },
          {
            label: "Command-line args",
            description:
              "Read the expression from argv, e.g. `calc 2 + 3`, then exit",
          },
          {
            label: "Both modes",
            description: "Use argv if provided, otherwise fall back to a REPL",
          },
        ],
      },
      {
        question: "Which operations should it support?",
        multiSelect: false,
        options: [
          { label: "Basic four", description: "+ − × ÷" },
          { label: "Basic four plus modulo", description: "+ − × ÷ %" },
          {
            label: "Scientific",
            description: "+ − × ÷ % plus sin/cos/tan, log, exp, etc.",
          },
        ],
      },
      {
        question: "What number type should it use?",
        multiSelect: false,
        options: [
          { label: "double", description: "IEEE-754 64-bit floating point" },
          {
            label: "long double",
            description: "Wider float, platform-dependent precision",
          },
          {
            label: "GMP arbitrary precision",
            description: "Big numbers; linked against libgmp",
          },
        ],
      },
      {
        question: "How polished should error handling be?",
        multiSelect: false,
        options: [
          {
            label: "Minimal",
            description: "Print errno-style messages, exit non-zero",
          },
          {
            label: "Friendly",
            description: "Catch parse errors, print a hint with caret",
          },
          {
            label: "Full",
            description:
              "Friendly errors + suggestions; retry the prompt in REPL mode",
          },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// GalleryTugInlineDialog
// ---------------------------------------------------------------------------

export function GalleryTugInlineDialog(): React.ReactElement {
  const [permissionResult, setPermissionResult] =
    React.useState<string>("(pending)");
  const [questionResult, setQuestionResult] =
    React.useState<string>("(pending)");

  const permissionStore = React.useMemo(
    () => new MockPermissionStore(LIVE_BASH_REQUEST),
    [],
  );
  const questionStore = React.useMemo(
    () => new MockQuestionStore(LIVE_CALCULATOR_REQUEST),
    [],
  );

  // Wrap respondApproval so this section echoes the outcome. The
  // wrapper still calls the real method so PermissionDialog's
  // pending-state machine clears as it does in production.
  React.useEffect(() => {
    const original = permissionStore.respondApproval;
    permissionStore.respondApproval = (requestId, payload) => {
      original(requestId, payload);
      const summary =
        payload.decision === "allow"
          ? `Allowed${payload.message !== undefined ? ` — scope: ${payload.message}` : ""}`
          : "Denied";
      setPermissionResult(summary);
    };
    return () => {
      permissionStore.respondApproval = original;
    };
  }, [permissionStore]);

  // Wrap respondQuestion + popInteractive on the QuestionDialog store
  // similarly.
  React.useEffect(() => {
    const originalRespond = questionStore.respondQuestion;
    const originalPop = questionStore.popInteractive;
    questionStore.respondQuestion = (requestId, payload) => {
      originalRespond(requestId, payload);
      const summary = Object.entries(payload.answers)
        .map(([q, a]) => `${q.slice(0, 30)}… → ${String(a)}`)
        .join("\n");
      setQuestionResult(`Submitted:\n${summary}`);
    };
    questionStore.popInteractive = () => {
      originalPop();
      setQuestionResult("Cancelled");
    };
    return () => {
      questionStore.respondQuestion = originalRespond;
      questionStore.popInteractive = originalPop;
    };
  }, [questionStore]);

  const handleResetPermission = React.useCallback(() => {
    permissionStore.arm(LIVE_BASH_REQUEST);
    setPermissionResult("(pending)");
  }, [permissionStore]);
  const handleResetQuestion = React.useCallback(() => {
    questionStore.arm(LIVE_CALCULATOR_REQUEST);
    setQuestionResult("(pending)");
  }, [questionStore]);

  return (
    <div className="cg-content" data-testid="gallery-tug-inline-dialog">
      {/* ---- 1. PermissionDialog ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">PermissionDialog</TugLabel>
        <div style={labelStyle}>
          The real <code>PermissionDialog</code> mounted on a mock{" "}
          <code>CodeSessionStore</code>. Caution-shield iconRole; scope
          picker in <code>options</code>; <code>Deny</code> /{" "}
          <code>Allow</code> in trailing <code>actions</code>.
        </div>
        <PermissionDialog
          input={{ kind: "permission", request: LIVE_BASH_REQUEST }}
          context={{
            session: permissionStore as unknown as CodeSessionStore,
          }}
        />
        <div style={resultStyle}>
          Result: <strong>{permissionResult}</strong>
        </div>
        <div style={{ marginTop: "0.5rem" }}>
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="xs"
            onClick={handleResetPermission}
          >
            Reset request
          </TugPushButton>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 2. QuestionDialog ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">QuestionDialog</TugLabel>
        <div style={labelStyle}>
          The real <code>QuestionDialog</code> mounted on a mock{" "}
          <code>CodeSessionStore</code>. Info iconRole; question
          accordion in the body slot; wizard nav (Back / Next) above the
          accordion; <code>Cancel</code> / <code>Submit</code> in
          trailing <code>actions</code>.
        </div>
        <QuestionDialog
          input={{ kind: "question", request: LIVE_CALCULATOR_REQUEST }}
          context={{
            session: questionStore as unknown as CodeSessionStore,
          }}
        />
        <div style={{ ...resultStyle, whiteSpace: "pre-wrap" }}>
          Result: <strong>{questionResult}</strong>
        </div>
        <div style={{ marginTop: "0.5rem" }}>
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="xs"
            onClick={handleResetQuestion}
          >
            Reset request
          </TugPushButton>
        </div>
      </div>
    </div>
  );
}
