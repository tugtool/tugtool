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
 * **One state.** Like `PermissionDialog` post-Step-3.5, a question
 * leaves no client-side recorded chrome — the durable record lives in
 * the conversation context via the matching tool_use / tool_result
 * pair (the `AskUserQuestionToolBlock` at the tool_use position IS
 * that recorded state). `handleRespondQuestion` clears
 * `pendingQuestion` and emits the outbound `question_answer` frame.
 * So this component has exactly one rendered state: the live dialog
 * while the request is the session's `pendingQuestion`. Once answered
 * (or skipped) it renders `null`.
 *
 * Layout (composed on `TugInlineDialog`'s header-bar primitive — see
 * [D01] / [D08]). Paged wizard. A single-question payload renders
 * inline (the question text goes in the dialog `description` and the
 * options fill the children slot). A multi-question payload renders
 * a vertical stack of *rows*, one per question, in three states:
 *
 *  - **done** — the user has picked at least one option. Row shows
 *    `✓ N. Question text · → chosen answer`. Clickable to jump back.
 *  - **current** — the row in focus. Shows `▸ N. Question text` and
 *    expands the options. Single-select picks auto-advance to the
 *    next row; multi-select waits for an explicit `Next`.
 *  - **pending** — not yet visited. Shows `○ N. Question text` only.
 *    Clickable to skip ahead.
 *
 * **Two control rows.** Dialog controls (`Cancel` / `Submit`) flow
 * into the primitive's trailing `actions` slot on the header row.
 * Wizard nav (`Back` / `Next`) shares a single row with the
 * progress summary (`{N} questions · {M} answered`) inside the body
 * slot, between the dialog description and the question accordion —
 * close enough to the questions for the touch target to feel coupled
 * to the row it mutates, but stable across question advances so the
 * button never moves out from under the mouse. Single-question
 * payloads omit the nav row (nothing to navigate, no progress to
 * summarize).
 *
 * The wizard exposes a **review state** at the end of the flow:
 * `currentIndex === questions.length` paints every row as its
 * post-interaction summary (no `current`), giving the user a final
 * pass over the answers before clicking `Submit`. `nextAdvanceIndex`
 * advances into review on the last question; the `Next` button
 * is disabled once in review.
 *
 * `Cancel` carries a confirmation popover (`TugConfirmPopover`,
 * imperative API). A stray click can't tear the AI's question down
 * without a second beat; the popover's confirm walks the family
 * `Cancel ≡ popInteractive` path. `Submit` is disabled until every
 * question carries a selection (matching the "no required answers
 * but submit gates on completeness" rule the user signed off on)
 * and is focused on mount so a Return key submits.
 *
 * **Auto-advance** on single-select is the headline GUI improvement
 * over the TUI's keyboard-only flow: picking an option commits the
 * selection and advances to the next row in one click. Multi-select
 * has no auto-advance — every pick is a deliberate toggle.
 *
 * **Answer shape.** `respondQuestion` sends `answers` keyed by the
 * question *text*; the value is the selected option `label` (single)
 * or the labels joined by a bare `,` with no spaces (multi). This
 * matches tugcode's `formatQuestionAnswer` (`tugcode/src/control.ts`).
 *
 * **Cancel ≡ Esc ≡ `popInteractive`** ([D02]). The Cancel button, the
 * Esc keypress (via the responder chain's `CANCEL_DIALOG` action), and
 * the prompt entry's Stop button all resolve to `session.popInteractive()`.
 * For a pending `AskUserQuestion` the queued-sends stack is empty, so
 * the pop falls through to `interrupt()` on the running turn; Claude
 * Code then emits the standard tool-rejected result ("The user doesn't
 * want to proceed…"). One gesture, one wire signal, one model reading
 * — no ambiguous empty-answers branch the assistant could misread as
 * "user chose defaults."
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
 *    delegated to `TugInlineDialog` (`--tugx-idialog-*`); each
 *    option row is a `TugDialogButton` (`--tugx-dialog-button-*`).
 *    This component owns only the small `--tugx-question-*`
 *    wizard-rail family.
 *  - [L23] in-progress answer state (selection set, visit set,
 *    wizard focus) is user data and must survive reload / cross-pane
 *    move / cold boot. The dialog opts into the [A9] Component State
 *    Preservation Protocol via {@link useSavedComponentState} +
 *    {@link useComponentStatePreservation}, keyed by
 *    `question-dialog/<request_id>` so the SAME request rehydrates
 *    its tuple but a NEW request mounts fresh. {@link seedQuestionDialogState}
 *    is the pure seed-merger consumed inside the `useState`
 *    initializers; the capture closure round-trips through it.
 *  - [L24] state zoning — the per-question selection set is component
 *    data in `useState`; the rendered radio/check mark is CSS-driven.
 *
 * Decisions:
 *  - [D13] inline (not modal) prompts; primary action focused on
 *    mount by this component (via `submitRef`) so Return submits.
 *    Three-layer survival contract: wire (tugcode in-flight snapshot)
 *    delivers the open request, reducer (`handleControlRequestForward`
 *    rehydrate branch) restores it to `pendingQuestion`, and this
 *    component's per-instance A9 opt-in restores the answers the user
 *    had filled in before the boundary fired.
 *
 * @module components/tugways/chrome/tide-question-dialog
 */

import "./tide-question-dialog.css";

import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  MessageCircleQuestion,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { TugInlineDialog } from "@/components/tugways/tug-inline-dialog";
import {
  TugConfirmPopover,
  type TugConfirmPopoverHandle,
} from "@/components/tugways/tug-confirm-popover";
import { TugDialogButton } from "@/components/tugways/tug-dialog-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "@/components/tugways/use-component-state-preservation";
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
 * The starting selection set, one entry per question. Every question
 * — single-select OR multi-select — pre-selects its first option, so
 * a bare Return commits a sane default answer for the whole wizard.
 * The user can deselect (multi-select) or pick a different option
 * (single-select) before advancing.
 *
 * Pure; exported for the test suite.
 */
export function initialQuestionSelections(
  questions: ReadonlyArray<ParsedQuestion>,
): string[][] {
  return questions.map((q) =>
    q.options.length === 0 ? [] : [q.options[0].label],
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

/**
 * Count how many questions have at least one selection (whether
 * preseeded or user-picked). Drives the `Submit` gate: the
 * confirm button lights up once every row carries *some* answer,
 * which is the literal precondition for round-tripping a non-empty
 * `answers` payload. Pure; exported for the test suite.
 */
export function countAnswered(
  selections: ReadonlyArray<ReadonlyArray<string>>,
): number {
  let count = 0;
  for (const s of selections) if (s.length > 0) count += 1;
  return count;
}

/**
 * Count how many questions the user has actively *confirmed* — i.e.
 * a row the user has clicked into and that carries a selection. This
 * is the count surfaced in the dialog description (`"3 questions ·
 * 1 answered"`) so the headline reflects engagement, not the seed.
 * `visited[i]` is `true` iff the user has interacted with row `i`
 * (picked an option there, or used `Next` to step off it).
 *
 * Pure; exported for the test suite.
 */
export function countConfirmedAnswers(
  selections: ReadonlyArray<ReadonlyArray<string>>,
  visited: ReadonlyArray<boolean>,
): number {
  let count = 0;
  for (let i = 0; i < selections.length; i += 1) {
    if (visited[i] && selections[i].length > 0) count += 1;
  }
  return count;
}

/**
 * Compute one row's wizard state from the three axes that drive it:
 * whether the row is the current focus, whether the user has
 * confirmed it, and whether it carries a selection. Encodes the
 * "preseeded but not yet confirmed" surface as `"recommended"` so
 * the renderer can paint a softer indicator than the success-toned
 * check used for genuine `"done"` rows.
 *
 *  - `current` — `isCurrent === true`.
 *  - `done` — user-confirmed and has a selection.
 *  - `recommended` — has a selection, but the user hasn't visited
 *    yet (single-select rows arrive preseeded with the first option,
 *    which is the recommendation; that state shouldn't read as
 *    "answered" until the user has actually engaged).
 *  - `pending` — empty selection and unvisited.
 *
 * Pure; exported for the test suite.
 */
export type QuestionRowStatus =
  | "current"
  | "done"
  | "recommended"
  | "pending";

export function rowStatus(
  isCurrent: boolean,
  visited: boolean,
  hasSelection: boolean,
): QuestionRowStatus {
  if (isCurrent) return "current";
  if (visited && hasSelection) return "done";
  if (hasSelection) return "recommended";
  return "pending";
}

/**
 * Pick the wizard's next focus after a single-select pick or a `Next`
 * click on the current row. Advances by one through the question
 * indices and then to `total` — the **review state**, in which no row
 * is current, every row paints its post-interaction summary, and the
 * user can scan the full set of answers before clicking `Submit`. The
 * review index "absorbs" further advance gestures so a user already
 * in review stays put.
 *
 * Pure; exported for the test suite. The function intentionally does
 * NOT skip ahead to the next *unanswered* row: jumping over a
 * deliberately-skipped middle question would surprise the user. A
 * targeted skip is one click on the desired row.
 */
export function nextAdvanceIndex(from: number, total: number): number {
  if (total <= 0) return 0;
  if (from + 1 <= total) return from + 1;
  return from;
}

/**
 * Compose the chosen-answer summary the `done` row paints inline.
 * Mirrors `composeAnswerSummary` in `ask-user-question-tool-block`
 * but reads `selections` (mid-flight wizard state) rather than the
 * post-turn merged answers. Returns the empty string for the empty
 * selection so the renderer can short-circuit the row decoration.
 *
 * Pure; exported for the test suite.
 */
export function composeRowAnswerLabel(
  selection: ReadonlyArray<string>,
): string {
  if (selection.length === 0) return "";
  return selection.join(", ");
}

// ---------------------------------------------------------------------------
// Preserved state — the [A9] capture payload
// ---------------------------------------------------------------------------

/**
 * The serialized payload the dialog captures into `bag.components`.
 * Mirrors the three `useState` fields that hold mid-flight wizard
 * progress; named so the wire shape has its own identity. The
 * framework treats this as opaque JSON.
 */
export interface QuestionDialogPreservedState {
  selections: string[][];
  visited: boolean[];
  currentIndex: number;
}

/** Stable preservation-key prefix for the dialog's per-request slot.
 *  Joined with the request id to form the scoped key
 *  `question-dialog/<request_id>` — namespace-distinct from any other
 *  component that might opt into [A9] inside the same card. */
export const QUESTION_DIALOG_PRESERVATION_KEY_PREFIX = "question-dialog/";

/**
 * Compose the scoped preservation key for one question-dialog
 * instance. Pure; exported for the test suite.
 */
export function questionDialogPreservationKey(requestId: string): string {
  return `${QUESTION_DIALOG_PRESERVATION_KEY_PREFIX}${requestId}`;
}

/** Type guard for the saved-state envelope read from the bag. JSON
 *  storage means we can't trust the shape blindly; a mismatch falls
 *  through to the default seed. */
function isPreservedQuestionState(
  value: unknown,
): value is QuestionDialogPreservedState {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.selections)) return false;
  for (const row of v.selections) {
    if (!Array.isArray(row)) return false;
    for (const label of row) {
      if (typeof label !== "string") return false;
    }
  }
  if (!Array.isArray(v.visited)) return false;
  for (const flag of v.visited) {
    if (typeof flag !== "boolean") return false;
  }
  if (typeof v.currentIndex !== "number" || !Number.isFinite(v.currentIndex)) {
    return false;
  }
  return true;
}

/**
 * Merge a possibly-saved state envelope with the default seeds to
 * produce the canonical `{ selections, visited, currentIndex }` tuple
 * the dialog should mount in. Defensive against a malformed payload
 * (returns the default seed) and against a length drift between the
 * saved state and the current `questions` array — the parallel arrays
 * are realigned to the question count so the indices the renderer
 * touches are always in range.
 *
 * Pure; exported for the test suite.
 */
export function seedQuestionDialogState(
  saved: unknown,
  questions: ReadonlyArray<ParsedQuestion>,
): QuestionDialogPreservedState {
  const defaults: QuestionDialogPreservedState = {
    selections: initialQuestionSelections(questions),
    visited: new Array(questions.length).fill(false) as boolean[],
    currentIndex: 0,
  };
  if (!isPreservedQuestionState(saved)) return defaults;

  // Realign to the current question count. Same `request_id` should
  // imply same payload, so this is defensive — a length mismatch falls
  // through to defaults for the slots that drifted.
  const selections: string[][] = defaults.selections.map((seed, index) => {
    const row = saved.selections[index];
    return Array.isArray(row) ? [...row] : seed;
  });
  const visited: boolean[] = defaults.visited.map((seed, index) => {
    const flag = saved.visited[index];
    return typeof flag === "boolean" ? flag : seed;
  });
  const clampedIndex = Math.max(
    0,
    Math.min(saved.currentIndex, questions.length),
  );
  return { selections, visited, currentIndex: clampedIndex };
}

// ---------------------------------------------------------------------------
// Per-question option group
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Row components — one per wizard state
// ---------------------------------------------------------------------------

interface QuestionRowProps {
  index: number;
  question: ParsedQuestion;
  status: QuestionRowStatus;
  selection: ReadonlyArray<string>;
  onSelect: (optionLabel: string) => void;
  onJump: () => void;
}

/** Pixel size for the lucide row-marker icons. Matches the heading
 *  `--tug-font-size-lg` glyph height so the icon and prose sit on the
 *  same optical baseline. */
const ROW_MARKER_ICON_SIZE = 14;

/**
 * Render the lucide marker for a row status. Centralized so the
 * status → icon mapping has one source of truth (the row CSS keys
 * tone colours off the same `data-status` attribute the parent row
 * stamps).
 *
 *  - `done`         → Check     (success-toned in CSS)
 *  - `recommended`  → CircleDot (info-toned; reads as "soft default")
 *  - `current`      → ChevronRight (link-toned; this row is "next")
 *  - `pending`      → Circle    (muted ring)
 */
function RowMarker({ status }: { status: QuestionRowStatus }): React.ReactElement {
  if (status === "done") {
    return <Check size={ROW_MARKER_ICON_SIZE} aria-hidden="true" />;
  }
  if (status === "recommended") {
    return <CircleDot size={ROW_MARKER_ICON_SIZE} aria-hidden="true" />;
  }
  if (status === "current") {
    return <ChevronRight size={ROW_MARKER_ICON_SIZE} aria-hidden="true" />;
  }
  return <Circle size={ROW_MARKER_ICON_SIZE} aria-hidden="true" />;
}

/**
 * A `done` or `recommended` row — the row carries a selection but is
 * not currently focused. Renders the heading and an inline `→ answer`
 * summary; clickable to jump back and edit. The status icon
 * distinguishes "you confirmed this" (`Check`) from "this is the
 * recommendation, you haven't engaged yet" (`CircleDot`). The whole
 * row is the click target so the user has a wide click region
 * without juggling nested anchors.
 */
function AnsweredRow({
  index,
  question,
  status,
  selection,
  onJump,
}: Pick<
  QuestionRowProps,
  "index" | "question" | "status" | "selection" | "onJump"
>): React.ReactElement {
  const labelPrefix =
    status === "done" ? "Edit answer to" : "Open recommendation for";
  return (
    <button
      type="button"
      className="tide-question-dialog-row"
      data-slot="tide-question-dialog-row"
      data-status={status}
      aria-label={`${labelPrefix} question ${index + 1}: ${question.question}`}
      onClick={onJump}
    >
      <span className="tide-question-dialog-row-marker" aria-hidden="true">
        <RowMarker status={status} />
      </span>
      <span className="tide-question-dialog-row-body">
        <span className="tide-question-dialog-row-heading">
          <span className="tide-question-dialog-row-heading-number">
            {index + 1}.
          </span>
          {question.question}
        </span>
        <span
          className="tide-question-dialog-row-answer"
          data-slot="tide-question-dialog-row-answer"
        >
          → {composeRowAnswerLabel(selection)}
        </span>
      </span>
    </button>
  );
}

/**
 * A `pending` row — not yet visited and no selection (only possible
 * for multi-select questions, which seed empty). Renders the heading
 * only, with the empty `Circle` marker. Clickable to skip ahead.
 */
function PendingRow({
  index,
  question,
  onJump,
}: Pick<QuestionRowProps, "index" | "question" | "onJump">): React.ReactElement {
  return (
    <button
      type="button"
      className="tide-question-dialog-row"
      data-slot="tide-question-dialog-row"
      data-status="pending"
      aria-label={`Skip to question ${index + 1}: ${question.question}`}
      onClick={onJump}
    >
      <span className="tide-question-dialog-row-marker" aria-hidden="true">
        <RowMarker status="pending" />
      </span>
      <span className="tide-question-dialog-row-body">
        <span className="tide-question-dialog-row-heading">
          <span className="tide-question-dialog-row-heading-number">
            {index + 1}.
          </span>
          {question.question}
        </span>
      </span>
    </button>
  );
}

/**
 * The option group a `current` row shows. Lifted out of `CurrentRow`
 * so the hidden measurement helper can mount the same DOM shape and
 * measure it — the answer to layout-stability across question swaps
 * is to know, up front, the largest options block any question
 * produces, and apply that as a `min-height` floor to the visible
 * current row's options area.
 */
function QuestionOptionGroup({
  question,
  selection,
  onSelect,
}: {
  question: ParsedQuestion;
  selection: ReadonlyArray<string>;
  onSelect: (optionLabel: string) => void;
}): React.ReactElement {
  const selectionStyle = question.multiSelect ? "check" : "radio";
  return (
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
          selected={selection.includes(option.label)}
          selectionStyle={selectionStyle}
          onClick={() => onSelect(option.label)}
        />
      ))}
    </div>
  );
}

/**
 * The `current` row — title + options. Back/Next live on their own
 * sub-row inside the body slot (between the dialog description and
 * the question accordion), not inside the row itself, so they keep a
 * stable on-screen position across question advances (the button
 * never jumps out from under the mouse). The options group is the
 * only place a `TugDialogButton` lives in the wizard, so the role /
 * aria semantics stay scoped to one row at a time (avoids cross-row
 * radio-group leaks).
 */
function CurrentRow({
  index,
  question,
  selection,
  optionsMinHeight,
  onSelect,
}: Pick<
  QuestionRowProps,
  "index" | "question" | "selection" | "onSelect"
> & {
  optionsMinHeight?: number;
}): React.ReactElement {
  // Apply the measured options floor to the options area only — the
  // heading stays at its natural height, and shorter questions just
  // see trailing whitespace below their options.
  // `undefined` while the measurement effect hasn't run yet (first
  // paint only); on every subsequent render the value is locked.
  const optionsStyle: React.CSSProperties | undefined =
    optionsMinHeight !== undefined
      ? { minHeight: `${optionsMinHeight}px` }
      : undefined;
  return (
    <div
      className="tide-question-dialog-row"
      data-slot="tide-question-dialog-row"
      data-status="current"
    >
      <div className="tide-question-dialog-row-header">
        <span className="tide-question-dialog-row-marker" aria-hidden="true">
          <RowMarker status="current" />
        </span>
        <span className="tide-question-dialog-row-heading">
          <span className="tide-question-dialog-row-heading-number">
            {index + 1}.
          </span>
          {question.question}
        </span>
      </div>
      <div
        className="tide-question-dialog-options-wrap"
        data-slot="tide-question-dialog-options-wrap"
        style={optionsStyle}
      >
        <QuestionOptionGroup
          question={question}
          selection={selection}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function QuestionRow(
  props: QuestionRowProps & { optionsMinHeight?: number },
): React.ReactElement {
  if (props.status === "current") return <CurrentRow {...props} />;
  if (props.status === "pending") return <PendingRow {...props} />;
  return <AnsweredRow {...props} />;
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

  // [L23] / [D13] — answer state is user data and must survive reload
  // / cross-pane / cold boot. The scoped key is per-request so a
  // genuinely new request mounts fresh while the SAME request
  // rehydrates its in-progress tuple. Read synchronously in render so
  // the three `useState` initializers below see the saved value on
  // first paint (no post-mount apply path).
  //
  // The [A9] protocol relies on the bag being populated before the
  // dialog mounts: `CardHost` restores `bag.components` synchronously
  // during card mount, and the dialog is keyed by `request_id` so a
  // re-mount on the same request fires fresh initializers against the
  // already-restored bag. A truly late-arriving `savedState` (an
  // async bag fault after first paint — not a path we exercise today)
  // would NOT retroactively land in the initializers: `useState`
  // reads its initializer exactly once on mount, and re-deriving
  // `seed` here only affects subsequent renders that don't consult
  // the initializer anyway.
  const preservationKey = questionDialogPreservationKey(requestId);
  const savedState = useSavedComponentState<QuestionDialogPreservedState>(
    preservationKey,
  );
  const seed = React.useMemo(
    () => seedQuestionDialogState(savedState, questions),
    [savedState, questions],
  );

  // [L24] — the per-question selection set is component data. One
  // `string[]` per question (single-select holds 0–1 labels,
  // multi-select 0+). Seeded once; a genuinely new question remounts
  // this component (keyed by `request_id` at the call site), so the
  // seed never drifts under us.
  const [selections, setSelections] = React.useState<string[][]>(
    () => seed.selections,
  );

  // Visit set, parallel to `selections`. `true` at index `i` means
  // the user has engaged with row `i` — picked an option there or
  // explicitly stepped off it via `Next`. Distinguishes a
  // user-confirmed `done` row from a preseeded `recommended` row in
  // `rowStatus`, and gates `countConfirmedAnswers` so the dialog
  // headline reports engagement, not the seed.
  const [visited, setVisited] = React.useState<boolean[]>(() => seed.visited);

  // Wizard focus — which row is currently expanded. Starts at the
  // first question. Click-jump and the per-row Back/Next mutate this.
  // Single-select picks also auto-advance to the next row.
  const [currentIndex, setCurrentIndex] = React.useState<number>(
    () => seed.currentIndex,
  );

  // Register the capture closure. The framework re-syncs the closure
  // on every render so the latest `selections` / `visited` /
  // `currentIndex` are always available at capture time.
  useComponentStatePreservation<QuestionDialogPreservedState>({
    componentStatePreservationKey: preservationKey,
    captureState: () => ({ selections, visited, currentIndex }),
  });

  // Layout-stability floor for the current row's options area. We
  // pre-render every question's option group inside a hidden
  // measurement helper, then lock the visible row's options area to
  // the tallest measurement. The dialog's overall height stops
  // depending on which row is current — clicking through Back/Next
  // never reflows the page below.
  //
  // `null` until the effect below runs; the first paint shows the
  // natural Q1 height without a floor, and the next render (a
  // synchronous re-render from `setState` inside `useLayoutEffect`)
  // applies the lock before any user interaction.
  const measureRef = React.useRef<HTMLDivElement | null>(null);
  const [optionsMinHeight, setOptionsMinHeight] = React.useState<
    number | undefined
  >(undefined);
  React.useLayoutEffect(() => {
    const el = measureRef.current;
    if (el === null) return;
    const rows = el.querySelectorAll<HTMLElement>(
      "[data-tide-question-measure]",
    );
    let max = 0;
    rows.forEach((row) => {
      const h = row.getBoundingClientRect().height;
      if (h > max) max = h;
    });
    // Round up so a sub-pixel fractional measurement never reads as
    // a one-pixel shrink on the next render.
    const ceil = Math.ceil(max);
    setOptionsMinHeight((prev) =>
      prev === undefined || ceil > prev ? ceil : prev,
    );
  }, [questions]);

  /** Mark `index` as user-engaged. Idempotent: the cheap reference
   *  equality check below means a no-op set doesn't trigger a render. */
  const markVisited = React.useCallback((index: number) => {
    setVisited((prev) => {
      if (prev[index] === true) return prev;
      const next = prev.slice();
      next[index] = true;
      return next;
    });
  }, []);

  // Callback hooks must precede the early return so the hook order is
  // invariant across the pending → `null` transition.
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
      // Any pick == engagement; promote `recommended` → `done`.
      markVisited(questionIndex);
      // Auto-advance is a single-select-only affordance — the user
      // confirmed picking == committing. Multi-select picks are
      // toggles; advancing on the first one would strand subsequent
      // checks.
      const question = questions[questionIndex];
      if (question !== undefined && !question.multiSelect) {
        setCurrentIndex((prev) =>
          prev === questionIndex ? nextAdvanceIndex(prev, questions.length) : prev,
        );
      }
    },
    [questions, markVisited],
  );

  /** Jump-via-rail-click is exploratory — the user hasn't committed
   *  anything yet by browsing, so we don't mark visited. They have
   *  to actually pick or use `Next` to lock in a row. */
  const handleJump = React.useCallback((target: number) => {
    setCurrentIndex(target);
  }, []);

  /** `Back` from the current row: don't mark the row we're leaving
   *  as visited. A user who back-tracked without engaging hasn't
   *  taken a stance. */
  const handleBack = React.useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : prev));
  }, []);

  /** `Next` from the current row IS a commit — even on multi-select,
   *  the click says "I'm done with this question". Mark visited and
   *  advance. */
  const handleAdvance = React.useCallback(() => {
    setCurrentIndex((prev) => {
      markVisited(prev);
      return nextAdvanceIndex(prev, questions.length);
    });
  }, [questions.length, markVisited]);

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

  // Cancel — the unified Stop / Esc gesture. `session.popInteractive()`
  // is the same path Escape walks through the responder chain
  // (`CANCEL_DIALOG` → `popInteractive`), and the same path the prompt
  // entry's Stop button uses: pops the newest queued send first, and
  // once the queue is empty calls `interrupt()` on the running turn.
  // For a pending `AskUserQuestion` the queue is empty so the
  // interrupt fires immediately, and Claude Code emits the standard
  // tool-rejected result ("The user doesn't want to proceed…"). One
  // gesture, one wire signal, one reading — no ambiguous empty-
  // answers branch the assistant can misread as "user chose
  // defaults."
  const handleCancel = React.useCallback(() => {
    session.popInteractive();
  }, [session]);

  // Keyboard handler — `1`..`9` selects option N (1-indexed) in the
  // current question. Bound on the questions wrapper, so it only
  // fires when focus is inside the dialog (we don't steal digit
  // typing from the prompt entry below the transcript).
  //
  // Enter is handled separately at the document level — see the
  // capture-phase listener below — because the prompt entry usually
  // holds focus while a question is pending, and we want Enter
  // pressed there to advance the wizard rather than submit a new
  // prompt.
  //
  // Escape is NOT intercepted: it bubbles up to the prompt entry's
  // `CANCEL_DIALOG` action which calls `popInteractive()` — same
  // gesture our `handleCancel` invokes — so letting it bubble keeps
  // Cancel ≡ Esc through one code path.
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (questions.length === 0) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key.length !== 1) return;
      const digit = e.key.charCodeAt(0) - 48; // "0".charCodeAt(0) === 48
      if (digit < 1 || digit > 9) return;
      const current = questions[currentIndex];
      if (current === undefined) return;
      const option = current.options[digit - 1];
      if (option === undefined) return;
      e.preventDefault();
      handleSelect(currentIndex, option.label);
    },
    [questions, currentIndex, handleSelect],
  );

  // Document-level Enter handler in CAPTURE phase. The prompt entry
  // below the transcript holds focus while the AI is awaiting an
  // answer — without this, pressing Return submits a new prompt
  // rather than advancing the wizard. Capture-phase + stopPropagation
  // intercepts Enter before the prompt entry's own keydown listener
  // sees it. Active only while `isPending`; cleaned up automatically
  // when the dialog unmounts or the request resolves.
  //
  // Modifier-Enter (Shift / Cmd / Ctrl / Alt) is left alone so the
  // prompt entry can still take a newline / send-from-anywhere
  // gesture if it has one.
  React.useEffect(() => {
    if (!isPending) return;
    if (questions.length === 0) return;
    const onDocumentKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Enter") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // If focus is inside the dialog and lands on an enabled button,
      // let the native click handle Enter (option-card pick, Back,
      // Cancel-popover trigger, the enabled Submit at review).
      const t = e.target;
      if (t instanceof HTMLButtonElement && !t.disabled) return;
      if (currentIndex < questions.length) {
        e.preventDefault();
        e.stopPropagation();
        handleAdvance();
      } else if (
        countConfirmedAnswers(selections, visited) === questions.length
      ) {
        e.preventDefault();
        e.stopPropagation();
        handleSubmit();
      }
    };
    document.addEventListener("keydown", onDocumentKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown, true);
    };
  }, [
    isPending,
    questions.length,
    currentIndex,
    selections,
    visited,
    handleAdvance,
    handleSubmit,
  ]);

  // Mount-time focus on the primary action so a Return key submits.
  // `TugInlineDialog` is a stateless presentation surface — callers
  // own focus management for whatever buttons they pass in `actions`.
  // Declared HERE, before the `!isPending` early return, so every
  // render of this component calls the same set of hooks in the same
  // order ([L02] / [L24] structure zone). A genuinely new request
  // remounts the whole component (keyed by `request_id` upstream).
  const submitRef = React.useRef<HTMLButtonElement | null>(null);
  React.useLayoutEffect(() => {
    if (isPending) submitRef.current?.focus();
  }, [isPending]);

  // Cancel guards itself with a confirmation popover: a stray click
  // shouldn't tear the AI's question down without a second beat. The
  // popover is anchored to the Cancel trigger via `TugConfirmPopover`'s
  // imperative API (`ref.confirm() → Promise<boolean>`); a `true`
  // resolution walks the family `Cancel ≡ popInteractive` path.
  // Declared above the early return for the same Rules-of-Hooks
  // reason as `submitRef`.
  const cancelPopoverRef = React.useRef<TugConfirmPopoverHandle | null>(null);
  const handleCancelClick = React.useCallback(() => {
    const popover = cancelPopoverRef.current;
    if (popover === null) {
      // No popover mounted (defensive — should never happen in the
      // hasQuestions branch). Fall through to the bare cancel.
      handleCancel();
      return;
    }
    void popover.confirm().then((confirmed) => {
      if (confirmed) handleCancel();
    });
  }, [handleCancel]);

  if (!isPending) return null;

  const hasQuestions = questions.length > 0;
  const single = questions.length === 1 ? questions[0] : null;
  const confirmedCount = countConfirmedAnswers(selections, visited);
  // `Submit` lights up when the user has actively confirmed every
  // question — i.e. landed on each row and committed an answer (the
  // preseed alone isn't enough). Forces the user to scan the full
  // set before submitting.
  const allAnswered = hasQuestions && confirmedCount === questions.length;

  // Dialog description — single question repeats its text here
  // verbatim (unchanged from the legacy layout); the multi-question
  // summary moves into the wizard-nav row alongside Back / Next, so
  // this prop is `undefined` for multi-question payloads.
  const dialogDescription: React.ReactNode | undefined = !hasQuestions
    ? "Claude sent a question that could not be displayed."
    : single !== null
      ? single.question
      : undefined;
  const wizardSummary: string | null =
    hasQuestions && single === null
      ? `${questions.length} questions · ${confirmedCount} answered`
      : null;

  // Wizard navigation state. `currentIndex === questions.length` is
  // the review state added at the end of the flow — no row is
  // current, every row paints its post-interaction summary, and the
  // user scans the full set of answers before submitting.
  const isFirstQuestion = currentIndex === 0;
  const isAtReview = currentIndex >= questions.length;

  // Dialog controls (Cancel / Submit, or just Dismiss when there
  // are no questions) flow into the primitive's trailing `actions`
  // slot. Wizard nav (Back / Next) and the question-progress summary
  // live together on their own row inside the body slot — see the
  // JSX below. Single-question payloads omit the wizard-nav row
  // entirely (nothing to navigate, no progress to report).
  const dialogActions: React.ReactNode = hasQuestions ? (
    <>
      <TugConfirmPopover
        ref={cancelPopoverRef}
        message="Cancel this question?"
        confirmLabel="Yes, cancel"
        cancelLabel="Keep going"
        confirmRole="danger"
        side="bottom"
      >
        <TugPushButton
          emphasis="outlined"
          role="danger"
          size="xs"
          onClick={handleCancelClick}
        >
          Cancel
        </TugPushButton>
      </TugConfirmPopover>
      <TugPushButton
        ref={submitRef}
        emphasis={isAtReview ? "filled" : "outlined"}
        role="action"
        size="xs"
        disabled={!allAnswered}
        onClick={handleSubmit}
      >
        Submit
      </TugPushButton>
    </>
  ) : (
    <TugPushButton
      ref={submitRef}
      emphasis="filled"
      role="action"
      size="xs"
      onClick={handleSubmit}
    >
      Dismiss
    </TugPushButton>
  );

  // Composes `TugInlineDialog`'s header-bar primitive. Dialog controls
  // (Cancel / Submit, or just Dismiss when there are no questions)
  // flow into `actions` on the header row. The wizard nav (Back / Next)
  // sits on its own row inside the body slot, between the dialog
  // description and the question accordion — close enough to the
  // questions for the touch target to feel coupled to the row it
  // mutates, but stable across question advances so the button
  // never moves under the mouse.
  //
  // The dialog mounts inside a host `<div>` so `handleKeyDown` (Enter
  // = advance / submit; digit = option-pick) catches events from
  // anywhere in the dialog — including when the disabled `Submit`
  // button holds focus at the start of the wizard.
  return (
    <div onKeyDown={handleKeyDown}>
    <TugInlineDialog
      icon={<MessageCircleQuestion />}
      iconRole="info"
      title={questions.length > 1 ? "Claude has questions" : "Claude has a question"}
      description={dialogDescription}
      actions={dialogActions}
      className={cn("tide-question-dialog", className)}
    >
      {wizardSummary !== null ? (
        <div
          className="tide-question-dialog-nav"
          data-slot="tide-question-dialog-nav"
        >
          <span className="tide-question-dialog-nav-summary">
            {wizardSummary}
          </span>
          <div className="tide-question-dialog-nav-buttons">
            <TugPushButton
              emphasis="outlined"
              role="action"
              size="xs"
              disabled={isFirstQuestion}
              onClick={handleBack}
            >
              <ArrowLeft size={14} aria-hidden="true" /> Back
            </TugPushButton>
            <TugPushButton
              emphasis={isAtReview ? "outlined" : "filled"}
              role="action"
              size="xs"
              disabled={isAtReview}
              onClick={handleAdvance}
            >
              Next <ArrowRight size={14} aria-hidden="true" />
            </TugPushButton>
          </div>
        </div>
      ) : null}
      {hasQuestions ? (
        <div
          className="tide-question-dialog-questions"
          data-slot="tide-question-dialog-questions"
        >
          {single !== null ? (
            // Single-question payload — no rail, no wizard chrome.
            // The question text is the dialog `description` (above)
            // and the options fill the children slot at full width.
            // No measurement / `optionsMinHeight` floor: a single
            // question's options always reflect themselves; there is
            // no second state to absorb.
            <CurrentRow
              index={0}
              question={single}
              selection={selections[0] ?? []}
              onSelect={(optionLabel) => handleSelect(0, optionLabel)}
            />
          ) : (
            <>
              {questions.map((question, index) => {
                const selection = selections[index] ?? [];
                const status = rowStatus(
                  index === currentIndex,
                  visited[index] === true,
                  selection.length > 0,
                );
                return (
                  <QuestionRow
                    key={`${index}:${question.question}`}
                    index={index}
                    question={question}
                    status={status}
                    selection={selection}
                    optionsMinHeight={optionsMinHeight}
                    onSelect={(optionLabel) => handleSelect(index, optionLabel)}
                    onJump={() => handleJump(index)}
                  />
                );
              })}

              {/* Hidden measurement helper. Renders every question's
                * option group in the same width context as the
                * visible row, but positioned out of the visual flow
                * via `tide-question-dialog-measure`. The effect
                * above measures each block's natural height and
                * locks the visible current row's options area to
                * the max. Mounted once and re-runs only when the
                * `questions` array reference changes. */}
              <div
                ref={measureRef}
                className="tide-question-dialog-measure"
                aria-hidden="true"
              >
                {questions.map((question, index) => (
                  <div
                    key={`measure:${index}:${question.question}`}
                    data-tide-question-measure
                  >
                    <QuestionOptionGroup
                      question={question}
                      selection={[]}
                      onSelect={NOOP_SELECT}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </TugInlineDialog>
    </div>
  );
};

/** Stable no-op so the measurement helper's `onSelect` closure
 *  identity never changes — it never fires because the helper's
 *  CSS sets `pointer-events: none`, but a stable reference still
 *  lets React skip re-rendering the inner buttons. */
const NOOP_SELECT = (): void => {};
