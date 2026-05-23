/**
 * `AskUserQuestionToolBlock` — Layer-2 wrapper for Claude Code's
 * `AskUserQuestion` tool.
 *
 * The tool itself has two surfaces in the transcript, and they hand
 * off across the call's lifecycle so the user only ever sees ONE of
 * them at a time:
 *
 *   1. **Asking state (`status === "streaming"`).** The inline
 *      `QuestionDialog` ([D13]) — `tide-question-dialog.tsx` —
 *      renders the live prompt with radio / check buttons and
 *      submits the user's choices back to Claude. While the call is
 *      streaming, this wrapper renders `null` and stays out of the
 *      way: showing both a dialog and an "AskUserQuestion …"
 *      streaming row would leak implementation detail (two visible
 *      blocks for one conversational event). The dialog *is* the
 *      asking UI; nothing else is needed.
 *
 *   2. **Answered / ready state (`status === "ready"`).** The
 *      dialog has cleared its `pendingQuestion` and this wrapper
 *      takes over as the durable transcript artifact: a clean,
 *      numbered Q&A list. Before this step the wrapper rendered
 *      through `DefaultToolBlock`, which painted two stacked
 *      `JsonTreeBlock`s ("input" + "result") of the raw wire shape.
 *      That works for genuine drift but is wrong for a known tool
 *      whose round-trip is plain Q&A — the reader doesn't want the
 *      `questions[]` schema, they want to see what was asked and
 *      what they answered.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `ToolBlockChrome` owns the frame: a question-mark icon + the
 *    tool name + a short args summary (the question count).
 *  - **Body — ready state:** a numbered list of `Q → A` pairs. The
 *    question text reads as the prompt, the chosen label (or
 *    comma-separated labels for multi-select) reads as the response.
 *    No `JsonTreeBlock`, no raw schema. When no answer is recorded
 *    yet, the row reads "(no answer)" in muted prose — the same
 *    fallback the spoken summary uses.
 *  - **Body — error state:** the chrome's error band carries the
 *    failure text; the body drops.
 *
 * Wire shape:
 *  - `input.questions[]` — same `ParsedQuestion`-ish shape the
 *    `QuestionDialog` parses. Reused via {@link parseQuestions} so
 *    drift surfaces in both surfaces consistently.
 *  - The chosen answers arrive on the *completed* `tool_use_structured`
 *    (or merged back into `input.answers` per tugcode's
 *    `formatQuestionAnswer`) as `{ answers: Record<string, string> }`,
 *    keyed by question text, value is the chosen label(s). Defensive
 *    narrowing here means we read either surface (`structuredResult` or
 *    `input.answers`) so the wrapper renders correctly across the
 *    catalog's variations.
 *
 * Registration: `tide-assistant-renderer-dispatch.ts` imports this
 * module and calls `registerToolBlock("askuserquestion", …)`
 * alongside the other wrappers. The registry's lowercased keys
 * absorb wire-shape casing variants (`AskUserQuestion` /
 * `askuserquestion`) automatically.
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM
 *    attributes; the body composition is pure props derived via
 *    `useMemo`.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="ask-user-question-tool-block"` (delegated via the
 *    chrome's `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*`; the small Q&A
 *    list owns `--tugx-askquestion-*` (declared in the sibling
 *    `.css`). No cross-component token poaching.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — chrome owns frame, body owns the
 *    rendering. The body here is component-local because the Q&A
 *    summary surface is wrapper-specific (not a reusable body kind
 *    like `JsonTreeBlock`).
 *  - [D11] `AskUserQuestion` is promoted out of the `DefaultToolBlock`
 *    fallback now that the wrapper is bespoke; the unknown-tool
 *    caution disappears automatically.
 *
 * @module components/tugways/cards/tool-blocks/ask-user-question-tool-block
 */

import "./ask-user-question-tool-block.css";

import React from "react";
import { MessageCircleQuestion } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import { TugDialogButton } from "@/components/tugways/tug-dialog-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  applyQuestionSelection,
  initialQuestionSelections,
  parseQuestions,
  type ParsedQuestion,
} from "@/components/tugways/chrome/tide-question-dialog";
import type { ControlRequestForward } from "@/lib/code-session-store";

import { ToolBlockChrome } from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowing
// ---------------------------------------------------------------------------

/**
 * Read the answers map out of the merged tool wire. tugcode's
 * `formatQuestionAnswer` writes `answers` onto `updatedInput`, so the
 * map can arrive in either of two places after the round-trip:
 *
 *  - `input.answers` — when the catalog version surfaces the
 *    merged-back input as the visible `tool_use.input`.
 *  - `structuredResult.answers` — when the catalog emits a separate
 *    structured result for the call.
 *
 * Either way the inner shape is the same: `Record<question, label>`.
 * The narrower drops non-string values silently. Exported for the
 * unit tests.
 */
export function readAnswers(
  input: unknown,
  structuredResult: unknown,
): Record<string, string> {
  const fromStructured = readAnswersFromObject(structuredResult);
  if (fromStructured !== undefined) return fromStructured;
  return readAnswersFromObject(input) ?? {};
}

function readAnswersFromObject(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = (value as { answers?: unknown }).answers;
  if (raw === null || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Bridge the `unknown` wire `input` into the shape `parseQuestions`
 * (the question-dialog's parser) expects. We construct a synthetic
 * `ControlRequestForward` because `parseQuestions` lives in the
 * dialog module and was written against that interface — reusing it
 * keeps the parsing rules identical between the live dialog and the
 * post-answer wrapper.
 */
function parseInputQuestions(input: unknown): ParsedQuestion[] {
  // `ControlRequestForward` typing has more fields than we need;
  // narrow construction keeps the call site honest at the type level.
  const forward = {
    request_id: "",
    is_question: true,
    tool_name: "AskUserQuestion",
    input,
  } as unknown as ControlRequestForward;
  return parseQuestions(forward);
}

// ---------------------------------------------------------------------------
// Q&A summary — pure helper (exported for tests)
// ---------------------------------------------------------------------------

/** One row in the post-answer summary. */
export interface AnswerSummaryEntry {
  question: string;
  /** Labels the user chose. Multi-select round-trips as a comma-joined
   *  string; we split on `,` so the wrapper can render each pick on
   *  its own line. Empty when no answer was recorded. */
  answers: string[];
}

/**
 * Compose the Q&A summary the body renders: one entry per question
 * in the original order, each carrying the chosen answer label(s).
 * A question with no recorded answer carries `answers: []`; the
 * renderer paints that as "(no answer)" so the row stays useful for
 * follow-up rather than disappearing.
 *
 * Exported for the unit test.
 */
export function composeAnswerSummary(
  questions: ReadonlyArray<ParsedQuestion>,
  answers: Record<string, string>,
): AnswerSummaryEntry[] {
  return questions.map((q) => {
    const raw = answers[q.question];
    if (raw === undefined || raw === "") {
      return { question: q.question, answers: [] };
    }
    if (q.multiSelect) {
      // tugcode joins multi-select labels with a bare `,` (PN-5). Split
      // and trim defensively so a downstream layer that adds spaces
      // wouldn't break the row count.
      const parts = raw.split(",").map((p) => p.trim()).filter((p) => p !== "");
      return { question: q.question, answers: parts };
    }
    return { question: q.question, answers: [raw] };
  });
}

/**
 * Plain-text rendering of the Q&A summary for the args slot. Format:
 * `"N answered"` or `"N questions"` for the streaming case — short
 * enough to sit at the chrome header without crowding the caution /
 * actions slots.
 */
export function composeQuestionCountLabel(
  totalQuestions: number,
  answeredCount: number,
): string {
  if (totalQuestions === 0) return "";
  if (answeredCount === 0) {
    return `${totalQuestions} ${totalQuestions === 1 ? "question" : "questions"}`;
  }
  return `${answeredCount} of ${totalQuestions} answered`;
}

// ---------------------------------------------------------------------------
// Validation-error parsing — the salvage trigger
// ---------------------------------------------------------------------------

/**
 * One Zod issue from Claude Code's `AskUserQuestion` validator. The
 * `path` shape is always `["questions", N, "options"]` (or similar)
 * when the cap is violated. We narrow defensively because the wire
 * shape is whatever Claude Code's JSON serializer produced — fields
 * may be missing in older versions.
 */
export interface AskUserQuestionValidationIssue {
  code?: string;
  message?: string;
  path?: ReadonlyArray<string | number>;
  maximum?: number;
}

export interface AskUserQuestionValidationError {
  issues: AskUserQuestionValidationIssue[];
}

/**
 * Detect Claude Code's `InputValidationError` for `AskUserQuestion`.
 *
 * The error format the binary emits is:
 *
 *   InputValidationError: [ { "origin": "array", "code": "too_big",
 *     "maximum": 4, "inclusive": true,
 *     "path": [ "questions", 1, "options" ],
 *     "message": "Too big: expected array to have <=4 items" } ]
 *
 * The leading prefix is plain text and the bracketed payload is a
 * Zod-issue array. We parse the JSON tail and surface its issues so
 * the wrapper can branch into the salvage path. Returns `null` for
 * any unrecognised shape — the wrapper falls back to the generic
 * error band in that case.
 *
 * Pure; exported for unit tests.
 */
export function parseAskUserQuestionInputValidationError(
  textOutput: string | undefined,
): AskUserQuestionValidationError | null {
  if (textOutput === undefined || textOutput === "") return null;
  // The marker is loose because Claude Code occasionally tweaks the
  // wording; the JSON tail is the load-bearing piece.
  if (!textOutput.includes("InputValidationError")) return null;
  const start = textOutput.indexOf("[");
  if (start === -1) return null;
  // The payload ends at the last `]` to survive any trailing prose.
  const end = textOutput.lastIndexOf("]");
  if (end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(textOutput.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const issues: AskUserQuestionValidationIssue[] = [];
  for (const raw of parsed) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const issue: AskUserQuestionValidationIssue = {};
    if (typeof r.code === "string") issue.code = r.code;
    if (typeof r.message === "string") issue.message = r.message;
    if (Array.isArray(r.path)) {
      issue.path = r.path.filter(
        (p): p is string | number => typeof p === "string" || typeof p === "number",
      );
    }
    if (typeof r.maximum === "number") issue.maximum = r.maximum;
    issues.push(issue);
  }
  if (issues.length === 0) return null;
  return { issues };
}

/**
 * Build a short human-readable banner explaining what went wrong.
 * The wrapper paints this above the salvage wizard so the user
 * understands the bridge they're crossing. Pure; exported for tests.
 */
export function composeValidationErrorBanner(
  err: AskUserQuestionValidationError,
): string {
  // We surface the most common issue (`too_big` on an options array)
  // explicitly; everything else falls through to a generic line.
  for (const issue of err.issues) {
    if (
      issue.code === "too_big" &&
      issue.path !== undefined &&
      issue.path.includes("options")
    ) {
      const limit = issue.maximum ?? 4;
      return `Claude Code rejected this question — it allows at most ${limit} options per question. Answer it here anyway:`;
    }
  }
  return "Claude Code rejected this question. Answer it here anyway:";
}

/**
 * Compose the salvaged-answer message body the wrapper posts back
 * as a fresh user turn. Format mirrors the live dialog's terse
 * summary so the assistant reads "user answered the questions" in
 * a shape it would have seen had the tool succeeded.
 *
 * Example output for two questions:
 *
 *   My answers to your AskUserQuestion (the tool call hit Claude Code's
 *   options cap, so I'm answering directly):
 *   1. Which slice of the component system? → tugways body-kinds
 *   2. Which kind of inconsistency matters? → Prop API shape, File/CSS/test structure
 *
 * Pure; exported for tests.
 */
export function composeSalvagedAnswerMessage(
  questions: ReadonlyArray<ParsedQuestion>,
  answersByQuestion: ReadonlyMap<string, ReadonlyArray<string>>,
): string {
  const lines: string[] = [
    "My answers to your AskUserQuestion (the tool call hit Claude Code's options cap, so I'm answering directly):",
  ];
  questions.forEach((q, index) => {
    const picks = answersByQuestion.get(q.question) ?? [];
    const answerText = picks.length === 0 ? "(no answer)" : picks.join(", ");
    lines.push(`${index + 1}. ${q.question} → ${answerText}`);
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AskUserQuestionToolBlock: React.FC<ToolBlockProps> = ({
  toolName,
  input,
  structuredResult,
  textOutput,
  status,
  caution,
  session,
}) => {
  // Hooks must run unconditionally on every render — keep them above
  // any early returns so the hook order doesn't shift across status
  // transitions.
  const questions = React.useMemo(() => parseInputQuestions(input), [input]);
  const answers = React.useMemo(
    () => readAnswers(input, structuredResult),
    [input, structuredResult],
  );
  const summary = React.useMemo(
    () => composeAnswerSummary(questions, answers),
    [questions, answers],
  );

  // Salvage state — populated when the user finishes the salvage
  // wizard (we keep the locally-collected answers around so the
  // wrapper can flip from "asking out-of-band" to "answered out-of-
  // band" without losing context). Map keyed by question text,
  // value is the chosen labels.
  const [salvagedAnswers, setSalvagedAnswers] = React.useState<
    Map<string, string[]> | null
  >(null);
  // Cancel-out: the user clicked the salvage "Cancel" button. We
  // collapse the salvage UI and fall back to the chrome's error
  // band so the failed call is honestly visible — same as if the
  // wrapper had never offered salvage.
  const [salvageCancelled, setSalvageCancelled] = React.useState(false);

  // Try to detect the InputValidationError that fires when Claude
  // Code's schema rejects an `AskUserQuestion` call (most often the
  // ≤4-options cap). When detected, we mount the salvage UI inline:
  // the questions render with our renderer's no-cap option list,
  // and the user's answers post back as a follow-on user turn (see
  // `composeSalvagedAnswerMessage`).
  const validationError = React.useMemo(
    () => parseAskUserQuestionInputValidationError(textOutput),
    [textOutput],
  );
  const isSalvageable =
    status === "error" &&
    validationError !== null &&
    questions.length > 0 &&
    session !== undefined &&
    !salvageCancelled;

  // While the tool is in flight the inline `QuestionDialog` is the
  // user-facing surface — see the module docstring for the lifecycle
  // handoff. Rendering nothing here keeps the transcript reading as
  // a single conversational event (the dialog) rather than two
  // visible blocks for the same moment in the conversation. Once
  // the user answers the dialog clears, the tool transitions to
  // `ready`, and this wrapper mounts with the durable Q&A summary
  // in roughly the same vertical slot.
  if (status === "streaming") return null;
  // The headline count surfaces user-confirmed answers — either the
  // wire-side `answers` (a successful tool round-trip) or the
  // locally-collected `salvagedAnswers` (the recovery path).
  const headlineCount =
    salvagedAnswers !== null
      ? Array.from(salvagedAnswers.values()).filter((v) => v.length > 0).length
      : summary.filter((s) => s.answers.length > 0).length;
  const args = composeQuestionCountLabel(questions.length, headlineCount);
  // Render the question-count chip as a `TugBadge` so the args slot
  // shares the family status-chip vocabulary (`emphasis="tinted"` +
  // semantic role) instead of dropping in mono-styled prose.
  // `role="action"` for the count — the badge is a neutral progress
  // indicator, not a success / danger / caution signal.
  const argsSummary =
    args === "" ? undefined : (
      <TugBadge emphasis="tinted" role="action" size="sm">
        {args}
      </TugBadge>
    );

  let body: React.ReactNode;
  if (salvagedAnswers !== null) {
    // After the user finishes salvage, render the Q&A summary built
    // from the locally-collected answers. Same shape as the normal
    // post-answer view so the wrapper reads identically regardless
    // of which channel produced the result.
    body = (
      <SalvageAnsweredSummary
        questions={questions}
        answersByQuestion={salvagedAnswers}
      />
    );
  } else if (isSalvageable && session !== undefined && validationError !== null) {
    body = (
      <SalvageWizard
        questions={questions}
        bannerText={composeValidationErrorBanner(validationError)}
        onSubmit={(picksByQuestion) => {
          const text = composeSalvagedAnswerMessage(questions, picksByQuestion);
          session.send(text, []);
          setSalvagedAnswers(new Map(picksByQuestion));
        }}
        onCancel={() => setSalvageCancelled(true)}
      />
    );
  } else if (status === "error") {
    body = null;
  } else if (summary.length === 0) {
    body = (
      <div
        className="ask-user-question-tool-block-empty"
        data-slot="ask-user-question-tool-block-empty"
      >
        No question was recorded.
      </div>
    );
  } else {
    body = (
      <ol
        className="ask-user-question-tool-block-list"
        data-slot="ask-user-question-tool-block-list"
      >
        {summary.map((entry, index) => (
          <li
            key={`${index}:${entry.question}`}
            className="ask-user-question-tool-block-item"
            data-slot="ask-user-question-tool-block-item"
            data-answered={entry.answers.length > 0 ? "true" : "false"}
          >
            <div className="ask-user-question-tool-block-question">
              {entry.question}
            </div>
            <div
              className="ask-user-question-tool-block-answer"
              data-slot="ask-user-question-tool-block-answer"
            >
              {entry.answers.length === 0 ? (
                <span className="ask-user-question-tool-block-no-answer">
                  (no answer)
                </span>
              ) : entry.answers.length === 1 ? (
                <span>{entry.answers[0]}</span>
              ) : (
                <ul className="ask-user-question-tool-block-answer-multi">
                  {entry.answers.map((a, j) => (
                    <li key={j}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    );
  }

  // Errored calls carry the failure message in `textOutput` — route to
  // the chrome's error band rather than the body. Suppressed when
  // we've taken the salvage path (the inline banner says everything
  // the raw Zod blob would, more clearly), and also when the user has
  // already answered out-of-band (the Q&A summary is the surface).
  const showErrorBand =
    status === "error" &&
    salvagedAnswers === null &&
    !isSalvageable &&
    textOutput !== undefined &&
    textOutput.length > 0;
  const errorMessage = showErrorBand ? (
    <span data-slot="ask-user-question-tool-block-error-output">
      {textOutput}
    </span>
  ) : undefined;

  // When the salvage path is live (asking or answered) we don't want
  // the chrome's red error stripe over the top — the wrapper isn't
  // really "errored" from the user's POV anymore.
  const chromeStatus =
    salvagedAnswers !== null || isSalvageable ? "ready" : status;

  return (
    <ToolBlockChrome
      rootSlot="ask-user-question-tool-block"
      toolName={toolName}
      toolIcon={<MessageCircleQuestion size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={chromeStatus}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolBlockChrome>
  );
};

// ---------------------------------------------------------------------------
// Salvage wizard — flat-stack alternative to the live `QuestionDialog`
// ---------------------------------------------------------------------------

/**
 * Inline salvage UI for when Claude Code rejected an `AskUserQuestion`
 * call via its options-cap validator. Renders each question with its
 * full options list (no cap on our side), collects the picks, and
 * hands them to `onSubmit` so the host can format them and post as a
 * fresh user turn.
 *
 * Layout is deliberately flatter than the live `QuestionDialog`'s
 * wizard rail: salvage is a recovery path, not the primary surface,
 * and stacking the questions in document order is cheaper and avoids
 * mounting the dialog primitive (which is wired to the session's
 * `pendingQuestion` lifecycle the salvage path doesn't have).
 *
 * Pure presentational: holds its own selection state, calls
 * `onSubmit(picksByQuestion)` once when the user clicks Submit.
 */
function SalvageWizard({
  questions,
  bannerText,
  onSubmit,
  onCancel,
}: {
  questions: ReadonlyArray<ParsedQuestion>;
  bannerText: string;
  onSubmit: (picksByQuestion: Map<string, string[]>) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [selections, setSelections] = React.useState<string[][]>(() =>
    initialQuestionSelections(questions),
  );

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

  const handleSubmit = React.useCallback(() => {
    const map = new Map<string, string[]>();
    questions.forEach((q, i) => {
      map.set(q.question, [...(selections[i] ?? [])]);
    });
    onSubmit(map);
  }, [questions, selections, onSubmit]);

  return (
    <div
      className="ask-user-question-tool-block-salvage"
      data-slot="ask-user-question-tool-block-salvage"
    >
      <div
        className="ask-user-question-tool-block-salvage-banner"
        data-slot="ask-user-question-tool-block-salvage-banner"
        role="status"
      >
        {bannerText}
      </div>
      <ol
        className="ask-user-question-tool-block-salvage-list"
        data-slot="ask-user-question-tool-block-salvage-list"
      >
        {questions.map((question, index) => {
          const selection = selections[index] ?? [];
          const selectionStyle = question.multiSelect ? "check" : "radio";
          return (
            <li
              key={`${index}:${question.question}`}
              className="ask-user-question-tool-block-salvage-item"
              data-slot="ask-user-question-tool-block-salvage-item"
            >
              <div className="ask-user-question-tool-block-salvage-question">
                {index + 1}. {question.question}
              </div>
              <div
                className="ask-user-question-tool-block-salvage-options"
                role={question.multiSelect ? "group" : "radiogroup"}
                aria-label={question.question}
              >
                {question.options.map((option) => (
                  <TugDialogButton
                    key={option.label}
                    label={option.label}
                    description={option.description}
                    selected={selection.includes(option.label)}
                    selectionStyle={selectionStyle}
                    onClick={() => handleSelect(index, option.label)}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <div
        className="ask-user-question-tool-block-salvage-actions"
        data-slot="ask-user-question-tool-block-salvage-actions"
      >
        {/* Mac-HIG 3-button vocabulary: the destructive-secondary
         * "Cancel" sits at the leading edge separated from the
         * primary "Send answers" on the trailing edge. Outlined +
         * danger so the visual weight reads "I'm walking away from
         * this" without competing with the primary CTA. */}
        <TugPushButton emphasis="outlined" role="danger" onClick={onCancel}>
          Cancel
        </TugPushButton>
        <TugPushButton emphasis="filled" role="action" onClick={handleSubmit}>
          Send answers
        </TugPushButton>
      </div>
    </div>
  );
}

/**
 * Post-salvage Q&A summary. Same visible shape as the regular
 * post-tool answered view (numbered Q→A pairs) so the wrapper reads
 * identically regardless of which channel produced the result.
 */
function SalvageAnsweredSummary({
  questions,
  answersByQuestion,
}: {
  questions: ReadonlyArray<ParsedQuestion>;
  answersByQuestion: ReadonlyMap<string, ReadonlyArray<string>>;
}): React.ReactElement {
  return (
    <ol
      className="ask-user-question-tool-block-list"
      data-slot="ask-user-question-tool-block-list"
    >
      {questions.map((question, index) => {
        const picks = answersByQuestion.get(question.question) ?? [];
        return (
          <li
            key={`${index}:${question.question}`}
            className="ask-user-question-tool-block-item"
            data-slot="ask-user-question-tool-block-item"
            data-answered={picks.length > 0 ? "true" : "false"}
          >
            <div className="ask-user-question-tool-block-question">
              {question.question}
            </div>
            <div
              className="ask-user-question-tool-block-answer"
              data-slot="ask-user-question-tool-block-answer"
            >
              {picks.length === 0 ? (
                <span className="ask-user-question-tool-block-no-answer">
                  (no answer)
                </span>
              ) : picks.length === 1 ? (
                <span>{picks[0]}</span>
              ) : (
                <ul className="ask-user-question-tool-block-answer-multi">
                  {picks.map((a, j) => (
                    <li key={j}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
