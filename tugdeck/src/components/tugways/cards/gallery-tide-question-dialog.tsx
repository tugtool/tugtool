/**
 * gallery-tide-question-dialog.tsx — live `QuestionDialog` fixture
 * for the Component Gallery.
 *
 * Mounts the real `QuestionDialog` against a minimal `CodeSessionStore`
 * double so the dialog can be exercised end-to-end (multi-question
 * wizard, single-select auto-advance, Submit, Cancel) without a real
 * Claude session. Use this card to iterate on QuestionDialog visuals
 * without needing to ask the model to ask a question.
 *
 * The mock implements only the surface QuestionDialog reads:
 *   - `subscribe(listener) → unsubscribe`
 *   - `getSnapshot()` → `{ pendingQuestion: ControlRequestForward | null }`
 *   - `respondQuestion(requestId, { answers })`
 *   - `popInteractive()` (Cancel walks through this)
 *
 * A "Reset request" button beneath the dialog re-arms the pending
 * question so multiple round-trips can be tested in one session.
 *
 * @module components/tugways/cards/gallery-tide-question-dialog
 */

import React from "react";

import { QuestionDialog } from "@/components/tugways/chrome/tide-question-dialog";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugPushButton } from "@/components/tugways/tug-push-button";
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

// Mirrors the user's "calculator" walkthrough screenshot — 4 single-
// select questions, varied option lists, sensible recommended defaults.
const LIVE_CALCULATOR_REQUEST: ControlRequestForward = {
  request_id: "gallery-tide-question-dialog:calculator",
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
          {
            label: "Basic four plus modulo",
            description: "+ − × ÷ %",
          },
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
          {
            label: "double",
            description: "IEEE-754 64-bit floating point",
          },
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
// GalleryTideQuestionDialog
// ---------------------------------------------------------------------------

export function GalleryTideQuestionDialog(): React.ReactElement {
  const [liveResult, setLiveResult] = React.useState<string>("(pending)");

  const liveStore = React.useMemo(
    () => new MockQuestionStore(LIVE_CALCULATOR_REQUEST),
    [],
  );

  // Wrap respondQuestion + popInteractive so the gallery section can
  // echo the outcome. The wrappers still call the original methods so
  // QuestionDialog's pending-state machine clears as in production.
  React.useEffect(() => {
    const originalRespond = liveStore.respondQuestion;
    const originalPop = liveStore.popInteractive;
    liveStore.respondQuestion = (requestId, payload) => {
      originalRespond(requestId, payload);
      const summary = Object.entries(payload.answers)
        .map(([q, a]) => `${q.slice(0, 30)}… → ${String(a)}`)
        .join("\n");
      setLiveResult(`Submitted:\n${summary}`);
    };
    liveStore.popInteractive = () => {
      originalPop();
      setLiveResult("Cancelled");
    };
    return () => {
      liveStore.respondQuestion = originalRespond;
      liveStore.popInteractive = originalPop;
    };
  }, [liveStore]);

  const handleReset = React.useCallback(() => {
    liveStore.arm(LIVE_CALCULATOR_REQUEST);
    setLiveResult("(pending)");
  }, [liveStore]);

  return (
    <div className="cg-content" data-testid="gallery-tide-question-dialog">
      <div className="cg-section">
        <TugLabel className="cg-section-title">Live QuestionDialog</TugLabel>
        <div style={labelStyle}>
          The real <code>QuestionDialog</code> mounted against a minimal
          mock <code>CodeSessionStore</code>. Click an option to commit
          a single-select answer and auto-advance. Submit fires the real
          <code>respondQuestion</code> path; Cancel fires{" "}
          <code>popInteractive</code>. Reset re-arms the pending request.
        </div>
        <QuestionDialog
          input={{ kind: "question", request: LIVE_CALCULATOR_REQUEST }}
          context={{ session: liveStore as unknown as CodeSessionStore }}
        />
        <div style={{ ...resultStyle, whiteSpace: "pre-wrap" }}>
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
