/**
 * `AskUserQuestionToolBlock` — Layer-2 wrapper for Claude Code's
 * `AskUserQuestion` tool.
 *
 * The tool itself has two surfaces in the transcript:
 *
 *   1. The inline `QuestionDialog` ([D13]) — `tide-question-dialog.tsx`
 *      — renders the live prompt with radio / check buttons and
 *      submits the user's choices back to Claude. It exists only
 *      while the request is the session's `pendingQuestion`; once
 *      answered it renders `null`.
 *
 *   2. This wrapper — the durable `tool_use` artifact left in the
 *      turn after the dialog clears. Before this step it rendered
 *      through `DefaultToolWrapper`, which painted two stacked
 *      `JsonTreeBlock`s ("input" + "result") of the raw wire shape.
 *      That works for genuine drift but is wrong for a known tool
 *      whose round-trip is plain Q&A — the reader doesn't want the
 *      `questions[]` schema, they want to see what was asked and
 *      what they answered.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `ToolWrapperChrome` owns the frame: a question-mark icon + the
 *    tool name + a short args summary (the question count).
 *  - **Body — ready state:** a numbered list of `Q → A` pairs. The
 *    question text reads as the prompt, the chosen label (or
 *    comma-separated labels for multi-select) reads as the response.
 *    No `JsonTreeBlock`, no raw schema. When no answer is recorded
 *    yet, the row reads "(no answer)" in muted prose — the same
 *    fallback the spoken summary uses.
 *  - **Body — streaming state:** the dialog is the live surface; the
 *    wrapper paints a short "Waiting for your answer…" placeholder
 *    so the row reserves space and reads honestly about what's in
 *    flight.
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
 * module and calls `registerToolWrapper("askuserquestion", …)`
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
 *  - [D11] `AskUserQuestion` is promoted out of the `DefaultToolWrapper`
 *    fallback now that the wrapper is bespoke; the unknown-tool
 *    caution disappears automatically.
 *
 * @module components/tugways/cards/tool-wrappers/ask-user-question-tool-block
 */

import "./ask-user-question-tool-block.css";

import React from "react";
import { MessageCircleQuestion } from "lucide-react";

import {
  parseQuestions,
  type ParsedQuestion,
} from "@/components/tugways/chrome/tide-question-dialog";
import type { ControlRequestForward } from "@/lib/code-session-store";

import {
  StreamingPlaceholder,
  ToolWrapperChrome,
} from "./tool-wrapper-chrome";
import type { ToolWrapperProps } from "./types";

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
// Component
// ---------------------------------------------------------------------------

export const AskUserQuestionToolBlock: React.FC<ToolWrapperProps> = ({
  toolName,
  input,
  structuredResult,
  textOutput,
  status,
  caution,
}) => {
  const questions = React.useMemo(() => parseInputQuestions(input), [input]);
  const answers = React.useMemo(
    () => readAnswers(input, structuredResult),
    [input, structuredResult],
  );
  const summary = React.useMemo(
    () => composeAnswerSummary(questions, answers),
    [questions, answers],
  );
  const answeredCount = summary.filter((s) => s.answers.length > 0).length;
  const args = composeQuestionCountLabel(questions.length, answeredCount);
  const argsSummary =
    args === "" ? undefined : (
      <span
        className="ask-user-question-tool-block-args"
        data-slot="ask-user-question-tool-block-args"
      >
        {args}
      </span>
    );

  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
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
  // the chrome's error band rather than the body.
  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="ask-user-question-tool-block-error-output">
        {textOutput}
      </span>
    ) : undefined;

  return (
    <ToolWrapperChrome
      rootSlot="ask-user-question-tool-block"
      toolName={toolName}
      toolIcon={<MessageCircleQuestion size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolWrapperChrome>
  );
};
