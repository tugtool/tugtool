/**
 * `QuestionDialog` — inline chrome for an `AskUserQuestion` prompt.
 *
 * Renders a `control_request_forward` event with `is_question: true`
 * (Claude is asking the user to choose) as an *inline* block in the
 * transcript flow per [D13] — the sibling of `PermissionDialog`. Where
 * the permission variant asks allow/deny, this variant presents one or
 * more questions, each with a list of options, and round-trips the
 * chosen labels back to Claude as a `question_answer` frame.
 *
 * **One state.** Unlike `PermissionDialog` (which collapses to a
 * resolved record), a question leaves no durable transcript artifact —
 * `handleRespondQuestion` clears `pendingQuestion` and sends the
 * answer, but records nothing into `TurnEntry.controlRequests`, and
 * the `question` `RenderInput` carries no `resolvedDecision`. So this
 * component has exactly one rendered state: the live dialog while the
 * request is the session's `pendingQuestion`. Once answered (or
 * skipped) it renders `null`.
 *
 * Layout (composed on `TugInlineDialog`):
 *
 *   +------------------------------------------+
 *   | [?]  Claude has a question               |
 *   |      {the question text}                 |
 *   |      ( ) Option A                        |
 *   |      ( ) Option B                        |
 *   |                     [Skip]  [Submit]     |
 *   +------------------------------------------+
 *
 * A single question puts its text in the dialog's `description`; a
 * multi-question `AskUserQuestion` payload puts a count lead-in there
 * and renders each question's text as a heading above its own option
 * group. Single-select questions render `radio` `TugDialogButton`s
 * (the first option pre-selected, mirroring `PermissionDialog`'s
 * scope-picker default so a bare Return commits a sane answer);
 * multi-select questions render `check` `TugDialogButton`s starting
 * empty.
 *
 * **Answer shape.** `respondQuestion` sends `answers` keyed by the
 * question *text*; the value is the selected option `label` (single)
 * or the labels joined by a bare `,` with no spaces (multi). This
 * matches tugcode's `formatQuestionAnswer` (`tugcode/src/control.ts`).
 *
 * **Skip.** Esc / the cancel button dismiss the dialog ([DT07]). A
 * question dialog still has to unblock Claude — the reducer holds
 * `pendingQuestion` and the `awaiting_approval` phase until a
 * `question_answer` lands — so dismiss sends an empty answer set
 * rather than dropping the frame.
 *
 * Laws:
 *  - [L02] external state (is this request still pending?) enters
 *    React via `useSyncExternalStore` over the `CodeSessionStore`.
 *  - [L06] appearance flows through CSS + `TugDialogButton`'s
 *    `data-*` attributes; React state holds only the logical
 *    selection set ([L24]).
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot` on the question-stack containers, this docstring.
 *  - [L20] component-token sovereignty — the dialog frame is
 *    delegated to `TugInlineDialog` (`--tugx-idialog-*`) and each
 *    option row to `TugDialogButton` (`--tugx-dialog-button-*`); this
 *    component owns only the small `--tugx-question-*` layout family.
 *  - [L24] state zoning — the per-question selection set is component
 *    data in `useState`; the rendered radio/check mark is CSS-driven.
 *
 * Decisions:
 *  - [D13] inline (not modal) prompts; primary action focused on
 *    mount by `TugInlineDialog` so Return submits.
 *
 * @module components/tugways/chrome/tide-question-dialog
 */

import "./tide-question-dialog.css";

import React from "react";
import { MessageCircleQuestion } from "lucide-react";

import { cn } from "@/lib/utils";
import { TugDialogButton } from "@/components/tugways/tug-dialog-button";
import { TugInlineDialog } from "@/components/tugways/tug-inline-dialog";
import type {
  CodeSessionStore,
  ControlRequestForward,
} from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * The `question` `RenderInput` shape, restated locally. The dispatch
 * owns the `RenderInput` union; restating the one variant this
 * component consumes keeps the import graph one-directional (the
 * dispatch imports this component for `KIND_RENDERERS.question`, so
 * this component must not import the dispatch).
 */
export interface QuestionRenderInput {
  kind: "question";
  request: ControlRequestForward;
}

/**
 * Context the dispatch threads through. Structurally a subset of the
 * dispatch's `DispatchContext` — only `session` is needed (the answer
 * round-trip goes through `respondQuestion`).
 */
export interface QuestionDialogContext {
  session: CodeSessionStore;
}

export interface QuestionDialogProps {
  input: QuestionRenderInput;
  context: QuestionDialogContext;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for the pure-logic test suite.
// ---------------------------------------------------------------------------

/** One answerable option of a parsed question. */
export interface ParsedQuestionOption {
  /** The label — also the value sent back in the `answers` frame. */
  label: string;
  /** Optional rich explanation rendered under the label, muted. */
  description?: string;
}

/**
 * One question, narrowed from the loose `AskUserQuestion` wire shape
 * to exactly what the dialog renders and answers against.
 */
export interface ParsedQuestion {
  /** The question text — also the KEY of this question's `answers` entry. */
  question: string;
  /** `true` → checkbox group (0+ answers); `false` → radio group (1 answer). */
  multiSelect: boolean;
  /** The selectable options. A question with none is dropped by {@link parseQuestions}. */
  options: ParsedQuestionOption[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Narrow a `control_request_forward` question payload to a clean
 * `ParsedQuestion[]`.
 *
 * The wire shape is `request.input` as Claude Code's `AskUserQuestion`
 * tool input — `{ questions: [{ question, header?, multiSelect?,
 * options?: [{ label, description? }] }] }` (see tugcode's
 * `protocol-types.ts`). `ControlRequestForward` types `input` as
 * `unknown` and is "intentionally loose", so this reads defensively:
 * a non-object input, a missing/!array `questions`, a question with
 * no text, or a question with no usable options each drop out rather
 * than throw. An all-dropped payload returns `[]` — the dialog then
 * renders its degenerate "couldn't be displayed" form so Claude can
 * still be unblocked.
 *
 * Pure; exported for the test suite.
 */
export function parseQuestions(
  request: ControlRequestForward,
): ParsedQuestion[] {
  const input = asRecord(request.input);
  const rawQuestions =
    input !== null && Array.isArray(input.questions) ? input.questions : [];
  const out: ParsedQuestion[] = [];
  for (const rawQuestion of rawQuestions) {
    const q = asRecord(rawQuestion);
    if (q === null) continue;
    const question = typeof q.question === "string" ? q.question : "";
    if (question.trim() === "") continue;
    const multiSelect = q.multiSelect === true;
    const options: ParsedQuestionOption[] = [];
    const rawOptions = Array.isArray(q.options) ? q.options : [];
    for (const rawOption of rawOptions) {
      const o = asRecord(rawOption);
      if (o === null) continue;
      const label = typeof o.label === "string" ? o.label : "";
      if (label.trim() === "") continue;
      const description =
        typeof o.description === "string" && o.description.trim() !== ""
          ? o.description
          : undefined;
      options.push({ label, description });
    }
    // A question with no answerable option can't round-trip — drop it.
    if (options.length === 0) continue;
    out.push({ question, multiSelect, options });
  }
  return out;
}

/**
 * The starting selection set, one entry per question. A single-select
 * question pre-selects its first option — mirroring `PermissionDialog`'s
 * scope-picker default so a bare Return commits a sane answer. A
 * multi-select question starts empty (the user opts in to each).
 *
 * Pure; exported for the test suite.
 */
export function initialQuestionSelections(
  questions: ReadonlyArray<ParsedQuestion>,
): string[][] {
  return questions.map((q) =>
    q.multiSelect || q.options.length === 0 ? [] : [q.options[0].label],
  );
}

/**
 * Apply a click on `optionLabel` to one question's current selection.
 * Single-select REPLACES (radio semantics — exactly one); multi-select
 * TOGGLES (checkbox semantics). Pure; exported for the test suite.
 */
export function applyQuestionSelection(
  question: ParsedQuestion,
  current: ReadonlyArray<string>,
  optionLabel: string,
): string[] {
  if (question.multiSelect) {
    return current.includes(optionLabel)
      ? current.filter((label) => label !== optionLabel)
      : [...current, optionLabel];
  }
  return [optionLabel];
}

/**
 * Build the `answers` record for a `question_answer` frame. Keyed by
 * each question's *text*; the value is the selected option label, or
 * — for a multi-select question — the labels joined by a bare `,`
 * with no spaces. This is the shape tugcode's `formatQuestionAnswer`
 * (`tugcode/src/control.ts`) expects.
 *
 * A question with no selection contributes an empty-string value
 * (Claude reads it as "no answer"). Pure; exported for the test suite.
 */
export function buildQuestionAnswers(
  questions: ReadonlyArray<ParsedQuestion>,
  selections: ReadonlyArray<ReadonlyArray<string>>,
): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    const picked = selections[index] ?? [];
    answers[question.question] = picked.join(",");
  });
  return answers;
}

// ---------------------------------------------------------------------------
// Per-question option group
// ---------------------------------------------------------------------------

/**
 * One question's option list. A single-select question is a
 * `role="radiogroup"` of `radio`-style `TugDialogButton`s; a
 * multi-select question is a `role="group"` of `check`-style ones.
 * `showHeading` renders the question text above the options — used
 * only in the multi-question layout (a single question's text is the
 * dialog's `description`).
 */
function QuestionChoiceGroup({
  question,
  selected,
  showHeading,
  onSelect,
}: {
  question: ParsedQuestion;
  selected: ReadonlyArray<string>;
  showHeading: boolean;
  onSelect: (optionLabel: string) => void;
}): React.ReactElement {
  const selectionStyle = question.multiSelect ? "check" : "radio";
  return (
    <div
      className="tide-question-dialog-question"
      data-slot="tide-question-dialog-question"
    >
      {showHeading ? (
        <div className="tide-question-dialog-question-heading">
          {question.question}
        </div>
      ) : null}
      <div
        className="tide-question-dialog-options"
        data-slot="tide-question-dialog-options"
        role={question.multiSelect ? "group" : "radiogroup"}
        aria-label={question.question}
      >
        {question.options.map((option) => (
          <TugDialogButton
            key={option.label}
            label={option.label}
            description={option.description}
            selected={selected.includes(option.label)}
            selectionStyle={selectionStyle}
            onClick={() => onSelect(option.label)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const QuestionDialog: React.FC<QuestionDialogProps> = ({
  input,
  context,
  className,
}) => {
  const { request } = input;
  const { session } = context;
  const requestId = request.request_id;

  const questions = React.useMemo(() => parseQuestions(request), [request]);

  // [L02] — "is this request still the session's pendingQuestion?" is
  // external state; it enters through `useSyncExternalStore`. The
  // moment `respondQuestion` dispatches, the reducer clears
  // `pendingQuestion` and notifies synchronously, so this flips to
  // `false` and the component renders `null` without an async gap.
  const isPending = React.useSyncExternalStore(
    session.subscribe,
    React.useCallback(
      () => session.getSnapshot().pendingQuestion?.request_id === requestId,
      [session, requestId],
    ),
  );

  // [L24] — the per-question selection set is component data. One
  // `string[]` per question (single-select holds 0–1 labels,
  // multi-select 0+). Seeded once; a genuinely new question remounts
  // this component (keyed by `request_id` at the call site), so the
  // seed never drifts under us.
  const [selections, setSelections] = React.useState<string[][]>(() =>
    initialQuestionSelections(questions),
  );

  // All callbacks are declared before the conditional return so the
  // hook order is invariant across the pending → `null` transition.
  const handleSelect = React.useCallback(
    (questionIndex: number, optionLabel: string) => {
      setSelections((prev) => {
        const question = questions[questionIndex];
        if (question === undefined) return prev;
        const next = prev.slice();
        next[questionIndex] = applyQuestionSelection(
          question,
          prev[questionIndex] ?? [],
          optionLabel,
        );
        return next;
      });
    },
    [questions],
  );

  const respond = React.useCallback(
    (answers: Record<string, string>) => {
      // Re-check against the live store rather than the rendered
      // `isPending` — robust against a double-click or a stale closure.
      const stillPending =
        session.getSnapshot().pendingQuestion?.request_id === requestId;
      if (!stillPending) return;
      session.respondQuestion(requestId, { answers });
    },
    [session, requestId],
  );

  const handleSubmit = React.useCallback(() => {
    respond(buildQuestionAnswers(questions, selections));
  }, [respond, questions, selections]);

  // Skip / dismiss — sends an empty answer set so Claude's
  // `AskUserQuestion` unblocks and the turn lifecycle resumes ([DT07]:
  // a dialog dismiss is a cancel response, not a turn cancellation).
  // Dropping the frame entirely would strand `pendingQuestion` and
  // hold the phase at `awaiting_approval`.
  const handleSkip = React.useCallback(() => {
    respond({});
  }, [respond]);

  if (!isPending) return null;

  const hasQuestions = questions.length > 0;
  const single = questions.length === 1 ? questions[0] : null;
  const description: React.ReactNode = !hasQuestions
    ? "Claude sent a question that could not be displayed."
    : single !== null
      ? single.question
      : `Claude is asking ${questions.length} questions.`;

  return (
    <TugInlineDialog
      icon={<MessageCircleQuestion />}
      iconRole="info"
      title={questions.length > 1 ? "Claude has questions" : "Claude has a question"}
      description={description}
      confirmLabel={hasQuestions ? "Submit" : "Dismiss"}
      confirmRole="action"
      cancelLabel={hasQuestions ? "Skip" : null}
      onConfirm={handleSubmit}
      onCancel={handleSkip}
      className={cn("tide-question-dialog", className)}
    >
      {hasQuestions ? (
        <div
          className="tide-question-dialog-questions"
          data-slot="tide-question-dialog-questions"
        >
          {questions.map((question, index) => (
            <QuestionChoiceGroup
              key={`${index}:${question.question}`}
              question={question}
              selected={selections[index] ?? []}
              showHeading={single === null}
              onSelect={(optionLabel) => handleSelect(index, optionLabel)}
            />
          ))}
        </div>
      ) : null}
    </TugInlineDialog>
  );
};
