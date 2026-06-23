/**
 * `QuestionWizard` — the interactive surface for an `AskUserQuestion`
 * prompt. Frameless: the durable transcript surface frames it. While a
 * question is live, `AskUserQuestionToolBlock` renders this wizard inside
 * its `BlockChrome` at the tool_use position, and morphs the SAME chrome
 * to the answered Q&A artifact once the user answers — the option/button
 * chrome simply disappears, with no width/treatment/position shift ([D13]).
 *
 * Renders a `control_request_forward` event with `is_question: true`
 * (Claude is asking the user to choose): one or more questions, each with
 * a list of options, round-tripping the chosen labels back to Claude as a
 * `question_answer` frame (or a freeform `response` via the decline path).
 *
 * **One state.** A question leaves no separate client-side chrome — the
 * durable record lives in the conversation context via the matching
 * tool_use / tool_result pair (the `AskUserQuestionToolBlock` at the
 * tool_use position IS that recorded state). `handleRespondQuestion`
 * clears `pendingQuestion` and emits the outbound frame. So this
 * component renders only while the request is the session's
 * `pendingQuestion`; once answered (or skipped) it renders `null` and the
 * host block paints the answered summary. The legacy `QuestionDialog`
 * export is now a thin dispatch adapter retained for symmetry.
 *
 * Layout: a frameless headline (icon + title), an optional description,
 * the body, and a foot action row (Cancel / Submit, or the decline
 * Back / Reply). Paged wizard, master–detail. A single-question
 * payload renders inline (the question text goes in the description
 * and the options fill the body). A
 * multi-question payload renders a *rail* of uniform summary rows —
 * one per question — above a single stationary *panel* that hosts the
 * current question's heading and options. Rail rows carry a status:
 *
 *  - **done** — the user has picked at least one option. Row shows
 *    `✓ N. Question text` over `→ chosen answer`. Clickable to jump
 *    back.
 *  - **current** — the row whose question fills the panel. `▸`
 *    marker, highlight band, live `→ answer` summary. Single-select
 *    picks auto-advance to the next row; multi-select waits for an
 *    explicit `Next`.
 *  - **pending** — not yet visited. `○` marker; the answer line is
 *    reserved but blank. Clickable to skip ahead.
 *
 * **Constant geometry.** The dialog sits at the transcript's live
 * edge, so any height change or content relocation mid-wizard shoves
 * the scroll under the user's eye. Three rules keep its geometry
 * fixed from open to submit: every rail row reserves its one-line
 * `→ answer` slot (clamped to one line, ellipsized) in every status;
 * the options panel never moves (the rail highlight moves instead)
 * and sizes to the tallest question via stacked hidden sizers (CSS
 * grid, one inert sizer per question under the live face — no JS
 * measurement); and the review state fills the same panel rather
 * than collapsing it.
 *
 * **Two control rows.** Dialog controls (`Cancel` / `Submit`) live in
 * the foot action row at the bottom of the wizard body. Wizard nav
 * (`Back` / `Next`) shares a single row with the
 * progress summary (`{N} questions · {M} answered`) inside the body
 * slot, between the dialog description and the question rail —
 * close enough to the questions for the touch target to feel coupled
 * to the row it mutates, but stable across question advances so the
 * button never moves out from under the mouse. Single-question
 * payloads omit the nav row (nothing to navigate, no progress to
 * summarize).
 *
 * The wizard exposes a **review state** at the end of the flow:
 * `currentIndex === questions.length` paints every rail row as its
 * post-interaction summary (no `current`) and fills the panel with a
 * review notice, giving the user a final pass over the answers before
 * clicking `Submit`. `nextAdvanceIndex` advances into review on the
 * last question; the `Next` button is disabled once in review.
 *
 * `Cancel` carries a confirmation popover (`TugConfirmPopover`,
 * imperative API). A stray click can't tear the AI's question down
 * without a second beat; the popover's confirm walks the family
 * `Cancel ≡ popInteractive` path. `Submit` is disabled until every
 * question carries a selection (matching the "no required answers
 * but submit gates on completeness" rule the user signed off on)
 * and is focused on mount so a Return key submits.
 *
 * **Space changes, Return advances** — uniform across arities (the
 * options are ONE {@link QuestionOptions} component — a `TugListView`
 * whose glyph is a radio dot or a checkbox). **Space / click** only
 * changes the selection and never advances: single-select REPLACES
 * (exactly one), multi-select TOGGLES (any number), so a user can freely
 * adjust before committing. **Return** commits the cursor option —
 * single replaces, multi *ensures-checked* (check if unchecked, leave if
 * checked) — and steps to the next question (`commitOnEnter: "act"` →
 * `handleOptionActivate`). On every advance the wizard blinks **each
 * selected row's** focus ring (one row single-select, all checked rows
 * multi-select) before moving on. So a keyboard user walks the whole
 * wizard with Return regardless of question arity.
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
 *  - [L06] appearance flows through CSS + the composed `TugListView` /
 *    `TugListRow` `data-*` attributes; React state holds only the
 *    logical selection set ([L24]).
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot` on the question-stack containers, this docstring.
 *  - [L20] component-token sovereignty — the durable frame is the host
 *    block's `BlockChrome`; the option list is a `TugListView` of
 *    `TugListRow`s (`--tugx-list-view-*` / `--tugx-list-row-*`). This
 *    component owns the `--tugx-question-*` wizard family and reads a few
 *    `--tugx-idialog-*` slots read-only for its lightweight foot-slot
 *    frame metrics (the inline-dialog primitive other dialogs still use
 *    defines them globally).
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
 * @module components/tugways/chrome/dev-question-dialog
 */

import "./dev-question-dialog.css";

import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  MessageCircleQuestion,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { TugTextarea } from "@/components/tugways/tug-textarea";
import {
  TugConfirmPopover,
  type TugConfirmPopoverHandle,
} from "@/components/tugways/tug-confirm-popover";
import { TugListRow } from "@/components/tugways/tug-list-row";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
  type TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugSeparator } from "@/components/tugways/tug-separator";
import {
  QuestionSummaryList,
  type QuestionRowStatus,
  type QuestionSummaryRowData,
} from "@/components/tugways/question-summary-list";
import { rowGridOrder, type SpatialOrder } from "@/components/tugways/spatial-order";
import { useFocusManager } from "@/components/tugways/use-focusable";
import { useFocusTrap } from "@/components/tugways/use-focus-trap";
import { useSpatialOrder } from "@/components/tugways/use-spatial-order";
import { useInlineDialogScope } from "@/components/tugways/use-inline-dialog-scope";
import { animate } from "@/components/tugways/tug-animator";
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

/**
 * Props for the frameless {@link QuestionWizard} — the interactive
 * surface itself, sans any outer frame. The hosting frame
 * (`AskUserQuestionToolBlock`'s `BlockChrome` in the transcript) wraps
 * it; the wizard owns only the question UI, the focus trap, and its
 * own foot action row. Takes the `request` + `session` directly (the
 * dispatch-shaped `{ input, context }` is the {@link QuestionDialog}
 * adapter's job).
 */
export interface QuestionWizardProps {
  request: ControlRequestForward;
  session: CodeSessionStore;
  /**
   * Fired the instant the user resolves the wizard — answers (the option
   * round-trip) or a freeform `response` (the decline path) — just before
   * the outbound frame goes out. The host (`AskUserQuestionToolBlock`)
   * captures this so its durable summary paints immediately from the
   * just-submitted data, with no empty-answer flash during the window
   * between `pendingQuestion` clearing and the tool_result arriving.
   */
  onResolve?: (payload: {
    answers?: Record<string, string>;
    response?: string;
  }) => void;
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
 * Whether question `i` carries an answer — either at least one selected
 * option label OR a non-blank free-text value ([P01]/[F1]). Free text
 * and option labels are mutually exclusive per question (engaging one
 * clears the other), so a single OR predicate captures "answered" for
 * every gate: the Submit enable, the rail `done`/`recommended` status,
 * and the headline count. Pure; exported for the test suite.
 */
export function questionAnswered(
  selection: ReadonlyArray<string> | undefined,
  freeText: string | undefined,
): boolean {
  return (selection?.length ?? 0) > 0 || (freeText ?? "").trim() !== "";
}

/**
 * Build the `answers` record for a `question_answer` frame. Keyed by
 * each question's *text*. A free-text answer ([P01]) wins when present
 * (non-blank) and is sent verbatim; otherwise the value is the selected
 * option label, or — for a multi-select question — the labels joined by
 * a bare `,` with no spaces. This is the shape tugcode's
 * `formatQuestionAnswer` (`tugcode/src/control.ts`) expects.
 *
 * A question with neither contributes an empty-string value (Claude
 * reads it as "no answer"). Pure; exported for the test suite.
 */
export function buildQuestionAnswers(
  questions: ReadonlyArray<ParsedQuestion>,
  selections: ReadonlyArray<ReadonlyArray<string>>,
  freeTexts?: ReadonlyArray<string>,
): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    const free = freeTexts?.[index] ?? "";
    if (free.trim() !== "") {
      // Free text is the answer verbatim — not joined, not a label.
      answers[question.question] = free;
      return;
    }
    const picked = selections[index] ?? [];
    answers[question.question] = picked.join(",");
  });
  return answers;
}

/**
 * Count how many questions carry an answer (selection or free text,
 * whether preseeded or user-supplied). Drives the `Submit` gate: the
 * confirm button lights up once every row carries *some* answer,
 * which is the literal precondition for round-tripping a non-empty
 * `answers` payload. Pure; exported for the test suite.
 */
export function countAnswered(
  selections: ReadonlyArray<ReadonlyArray<string>>,
  freeTexts?: ReadonlyArray<string>,
): number {
  let count = 0;
  for (let i = 0; i < selections.length; i += 1) {
    if (questionAnswered(selections[i], freeTexts?.[i])) count += 1;
  }
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
  freeTexts?: ReadonlyArray<string>,
): number {
  let count = 0;
  for (let i = 0; i < selections.length; i += 1) {
    if (visited[i] && questionAnswered(selections[i], freeTexts?.[i])) {
      count += 1;
    }
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
export type { QuestionRowStatus };

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
  freeText?: string,
): string {
  // Free text, when present, IS the answer ([P01]) — show it verbatim
  // (it supersedes any label, which is already cleared when free text is
  // engaged).
  if ((freeText ?? "").trim() !== "") return (freeText ?? "").trim();
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
  /** Per-question free-text answer ([P01]). Parallel to `selections`;
   *  an empty string means "no free text" (the option labels answer the
   *  question instead). Optional in the wire shape so an older saved
   *  envelope (pre-free-text) still validates and realigns ([F4]). */
  freeTexts?: string[];
  /** `Chat about this` decline mode ([P02]) — whether the dialog is
   *  showing the freeform reply field instead of the wizard. Optional
   *  for the same forward-compat reason as `freeTexts`. */
  declineMode?: boolean;
  /** In-progress decline reply text ([P02]). */
  declineText?: string;
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
  // `freeTexts` is optional ([F4]): absent is fine (older envelope), but
  // when present it must be a string[] — otherwise reject the whole
  // envelope rather than partially trust it.
  if (v.freeTexts !== undefined) {
    if (!Array.isArray(v.freeTexts)) return false;
    for (const text of v.freeTexts) {
      if (typeof text !== "string") return false;
    }
  }
  // Decline mode/text are optional ([P02]); when present they must be the
  // right primitive type or the whole envelope is rejected.
  if (v.declineMode !== undefined && typeof v.declineMode !== "boolean") {
    return false;
  }
  if (v.declineText !== undefined && typeof v.declineText !== "string") {
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
    freeTexts: new Array(questions.length).fill("") as string[],
    declineMode: false,
    declineText: "",
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
  // `freeTexts` realigns the same way; an absent/short saved array
  // (older envelope) falls back to the empty-string default per slot.
  const freeTexts: string[] = (defaults.freeTexts ?? []).map((seed, index) => {
    const text = saved.freeTexts?.[index];
    return typeof text === "string" ? text : seed;
  });
  const clampedIndex = Math.max(
    0,
    Math.min(saved.currentIndex, questions.length),
  );
  return {
    selections,
    visited,
    currentIndex: clampedIndex,
    freeTexts,
    declineMode: saved.declineMode ?? false,
    declineText: saved.declineText ?? "",
  };
}

// ---------------------------------------------------------------------------
// Per-question option group
// ---------------------------------------------------------------------------

// The wizard rail and the durable answered record render the SAME
// `QuestionSummaryList` (`question-summary-list.tsx`); the rail just maps the
// live wizard state (status / answer / jump) onto its `QuestionSummaryRowData`
// rows below. The status → marker mapping and the row box model live in that
// shared component, so the two surfaces match by construction.

/** The screen-reader action prefix for a rail row, by status (the rail rows
 *  are clickable jump targets, except the open `current` row). */
function railRowLabelPrefix(status: QuestionRowStatus): string {
  return status === "current"
    ? "Current question"
    : status === "done"
      ? "Edit answer to question"
      : status === "recommended"
        ? "Open recommendation for question"
        : "Skip to question";
}

/**
 * The current question's options — ONE component for both arities ([P02]/[P17]).
 * A flush {@link TugListView} of {@link TugListRow}s, authored into the dialog's
 * trapped focus group as a single item-group Tab stop (Tab lands the ring on the
 * list, arrows rove the cursor — which wears the focus ring). The ONLY axes that
 * vary are driven by `question.multiSelect`:
 *
 *  - **glyph** — a radio dot (single) or a checkbox (multi);
 *  - **aria** — `role="radiogroup"` of `role="radio"` rows (single) /
 *    `role="group"` of `role="checkbox"` rows (multi), each with `aria-checked`;
 *  - **Space / click** (`delegate.onSelect`) — change the selection, NEVER
 *    advance: single REPLACES (exactly one), multi TOGGLES (any number);
 *  - **Return** (`commitOnEnter: "act"` → `delegate.onActivate`) — both commit the
 *    cursor option (single replaces, multi *ensures-checked*) and advance.
 *
 * The selection-apply semantics live in the wizard's `handleOptionSelect` /
 * `handleOptionActivate`; this component only forwards the cursor option's label.
 * Selection stays consumer-owned (the wizard's `selections` tuple, [L24]),
 * published to the cells through {@link QuestionOptionsSelectionContext}, so the
 * list owns no selected index (no `singleSelect` / `selectionRequired`).
 */

/** The current row's selection labels, published to the option cells. */
const QuestionOptionsSelectionContext = React.createContext<
  ReadonlyArray<string>
>([]);

/**
 * Static, single-section data source over one question's options. The option set
 * (and arity) is fixed for a question's lifetime — a new question remounts the
 * list — so `subscribe` is a no-op and `getVersion` returns the array identity.
 */
class QuestionOptionsDataSource implements TugListViewDataSource {
  constructor(
    private readonly options: readonly ParsedQuestionOption[],
    private readonly multiSelect: boolean,
  ) {}
  numberOfItems(): number {
    return this.options.length;
  }
  idForIndex(index: number): string {
    // Labels are the answer values and are unique within a question.
    return this.options[index]?.label ?? `option-${index}`;
  }
  kindForIndex(): string {
    return "option";
  }
  /** Cell-renderer accessor — the option at `index`. */
  optionAt(index: number): ParsedQuestionOption | undefined {
    return this.options[index];
  }
  /** Cell-renderer accessor — the question's arity (drives glyph + aria role). */
  isMultiSelect(): boolean {
    return this.multiSelect;
  }
  subscribe(): () => void {
    return () => {};
  }
  getVersion(): unknown {
    return this.options;
  }
}

/**
 * One option row — a flush {@link TugListRow}: the option label over its muted
 * description, with a leading **radio dot** (single-select) or **checkbox**
 * (multi-select) marking selection. The row carries the item ARIA role
 * (`radio` / `checkbox`) + `aria-checked` so the list reads as a real selection
 * group (the wrapper is flattened to `presentation`, the container is the
 * `radiogroup` / `group`). Presentational; activation is the enclosing cell
 * wrapper's job (→ delegate `onSelect` / `onActivate`). Selected state is read
 * from {@link QuestionOptionsSelectionContext} so one renderer paints both
 * arities.
 */
const QuestionOptionCell: TugListViewCellRenderer<QuestionOptionsDataSource> =
  function QuestionOptionCell({
    index,
    dataSource,
  }: TugListViewCellProps<QuestionOptionsDataSource>): React.ReactElement {
    const selection = React.useContext(QuestionOptionsSelectionContext);
    const option = dataSource.optionAt(index);
    const label = option?.label ?? "";
    const multi = dataSource.isMultiSelect();
    const selected = selection.includes(label);
    return (
      <TugListRow
        title={label}
        subtitle={option?.description}
        subtitleMaxLines={4}
        selected={selected}
        selectedGlyph={multi ? "checkbox" : "radio"}
        role={multi ? "checkbox" : "radio"}
        aria-checked={selected}
        data-option-label={label}
      />
    );
  };

const QUESTION_OPTION_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<QuestionOptionsDataSource>
> = {
  option: QuestionOptionCell,
};

// ---------------------------------------------------------------------------
// Focus ordering — the wizard's controls as cycle stops inside the trap ([P16])
// ---------------------------------------------------------------------------

/** Tab order inside the dialog's trapped mode (disabled stops drop out). */
const QUESTION_CANCEL_ORDER = 0;
const QUESTION_SUBMIT_ORDER = 1;
const QUESTION_BACK_ORDER = 2;
const QUESTION_NEXT_ORDER = 3;
const QUESTION_OPTIONS_ORDER = 4;
/** The current question's free-text answer field ([P01]) — a focus stop
 *  after the options, and a spatial-grid node ([K1]). */
const QUESTION_FREETEXT_ORDER = 5;
// Decline mode ([P02], `Chat about this`). The action row is `Back` (reuses
// the wizard-nav Back slot — the nav row isn't rendered in decline mode) and
// `Reply` (the `Send reply` slot); plus the reply textarea and the
// wizard-mode `Chat about this` entry control — each a focus stop /
// spatial-grid node in the mode it belongs to. There is NO whole-question
// Cancel in decline mode: the user must `Back` to the questions first.
const QUESTION_SEND_REPLY_ORDER = 6;
const QUESTION_DECLINE_TEXT_ORDER = 8;
const QUESTION_CHAT_ABOUT_ORDER = 9;

interface QuestionOptionsProps {
  question: ParsedQuestion;
  selection: ReadonlyArray<string>;
  /** Click / Space on an option — changes the selection, never advances: single
   *  REPLACES (exactly one), multi TOGGLES (any number). */
  onSelect: (optionLabel: string) => void;
  /** Return on the cursor option (the list's `commitOnEnter: "act"`). The wizard
   *  commits it (single replaces, multi ensures-checked) and advances. */
  onActivate: (optionLabel: string) => void;
  /** Focus group the dialog authors this stop into (its trapped mode). */
  focusGroup: string;
  /** Order within {@link focusGroup}. */
  focusOrder: number;
}

/**
 * The current question's options — see the section docstring above. One
 * `TugListView` for both arities; `multiSelect` picks the glyph + aria roles, and
 * the two delegate callbacks (`onSelect` ← Space/click, `onActivate` ← Return)
 * forward the cursor option's label to the wizard, which owns the
 * replace-vs-toggle-vs-ensure semantics.
 */
const QuestionOptions: React.FC<QuestionOptionsProps> = ({
  question,
  selection,
  onSelect,
  onActivate,
  focusGroup,
  focusOrder,
}) => {
  const multi = question.multiSelect;
  const dataSource = React.useMemo(
    () => new QuestionOptionsDataSource(question.options, multi),
    [question.options, multi],
  );
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;
  const onActivateRef = React.useRef(onActivate);
  onActivateRef.current = onActivate;
  const optionsRef = React.useRef(question.options);
  optionsRef.current = question.options;
  // Seed the movement cursor on the question's currently-selected option (the
  // first one for a multi-select) rather than the top row, so when the wizard
  // advances into this question the cursor lands on a chosen row. Return then
  // re-commits that row (no change) and advances — `return, return, return` walks
  // the whole wizard without making unintended picks, and backing up to review
  // never silently re-answers a question. Falls back to the first option when
  // nothing is selected (the seed always pre-selects one, so this is defensive).
  const seedIndex = React.useMemo(() => {
    const i = question.options.findIndex((o) => selection.includes(o.label));
    return i >= 0 ? i : 0;
  }, [question.options, selection]);
  const delegate = React.useMemo<TugListViewDelegate>(
    () => ({
      // Space / click → `onSelect` (single replaces + advances; multi toggles).
      onSelect: (index) => {
        const opt = optionsRef.current[index];
        if (opt) onSelectRef.current(opt.label);
      },
      // Return on the cursor row → `onActivate` (the `commitOnEnter: "act"` path):
      // commit + advance, for BOTH arities.
      onActivate: (index) => {
        const opt = optionsRef.current[index];
        if (opt) onActivateRef.current(opt.label);
      },
    }),
    [],
  );

  return (
    <QuestionOptionsSelectionContext.Provider value={selection}>
      <TugListView<QuestionOptionsDataSource>
        dataSource={dataSource}
        delegate={delegate}
        cellRenderers={QUESTION_OPTION_CELL_RENDERERS}
        rowLayout="flush"
        inline
        className="dev-question-dialog-options-list"
        focusGroup={focusGroup}
        focusOrder={focusOrder}
        commitOnEnter="act"
        spatialCursor
        initialSelectedIndex={seedIndex}
        listRole={multi ? "group" : "radiogroup"}
        itemRole="presentation"
        aria-label={question.question}
      />
    </QuestionOptionsSelectionContext.Provider>
  );
};

/**
 * The inert face of one question's options for the panel's hidden sizers — the
 * SAME `TugListView` the live options render, in the same `options-list` wrapper,
 * so the sizer's box equals the live face's by construction. De-fanged for the
 * sizer stack: no `focusGroup` (no engine registration), `interactive={false}`
 * (inert rows, no DOM tab stops), no delegate — so the hidden copies add no Tab
 * stops and no second cursor. Stacked under the live face in the panel's grid
 * cell, the tallest sizer fixes the panel's height across every wizard state.
 * Selection doesn't affect row height (the glyph column is reserved either way),
 * so the sizer renders against the default empty selection.
 */
function QuestionOptionsSizer({
  question,
}: {
  question: ParsedQuestion;
}): React.ReactElement {
  const dataSource = React.useMemo(
    () => new QuestionOptionsDataSource(question.options, question.multiSelect),
    [question.options, question.multiSelect],
  );
  return (
    <TugListView<QuestionOptionsDataSource>
      dataSource={dataSource}
      cellRenderers={QUESTION_OPTION_CELL_RENDERERS}
      rowLayout="flush"
      inline
      interactive={false}
      className="dev-question-dialog-options-list"
      listRole={question.multiSelect ? "group" : "radiogroup"}
      itemRole="presentation"
      aria-label={question.question}
    />
  );
}

/** Placeholder for the free-text answer field — shared by the live
 *  field and its inert sizer so both reserve the same box. Lowercase and
 *  rendered a notch smaller than the typing font (see the `.css`). */
const FREE_TEXT_PLACEHOLDER = "or type your own answer…";

/** Default visible rows for the free-text answer field. */
const FREE_TEXT_ROWS = 3;

interface QuestionFreeTextProps {
  /** Current free-text value (controlled — lives in the wizard's `freeTexts`). */
  value: string;
  /** Typed input — sets the row's free text and clears its labels ([P01]). */
  onChange: (value: string) => void;
  /** Shift/⌘-Return = advance the wizard ([K3]); plain Return = newline. */
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Focus group + order — the field is one stop in the dialog's trap. */
  focusGroup: string;
  focusOrder: number;
}

/**
 * The current question's free-text answer field ([P01]) — a multi-line
 * {@link TugTextarea} (three rows by default) below the options. Always
 * present (constant geometry: it rides the panel sizers, and the panel's
 * min-height floor ratchets so typing past three rows never shrinks the
 * panel back), so it's a stable focus stop and spatial-grid node ([K1]) the
 * user can Tab/arrow into. Controlled: the value lives in the wizard's
 * `freeTexts` state (and the [A9] bag preserves it), so no
 * `componentStatePreservationKey` ([K2], uncontrolled-only). The substrate
 * editing responder (CUT/COPY/PASTE/SELECT_ALL/UNDO/REDO) is wired
 * automatically — `TugTextarea` registers it inside the card's provider.
 */
const QuestionFreeText: React.FC<QuestionFreeTextProps> = ({
  value,
  onChange,
  onKeyDown,
  focusGroup,
  focusOrder,
}) => {
  return (
    <div
      className="dev-question-dialog-freetext"
      data-slot="dev-question-dialog-freetext"
    >
      <TugTextarea
        className="dev-question-dialog-freetext-field"
        value={value}
        placeholder={FREE_TEXT_PLACEHOLDER}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        autoResize
        rows={FREE_TEXT_ROWS}
        maxRows={8}
        focusGroup={focusGroup}
        focusOrder={focusOrder}
        aria-label="Type your own answer"
        // While the field is empty the user hasn't committed to typing, so a
        // bare Up/Down should move the ring to the adjacent row rather than
        // dead-end on the (empty) caret ([P25] release seam). Once there's
        // text, the caret owns every arrow again.
        data-tug-arrow-release={value === "" ? "up down" : undefined}
      />
    </div>
  );
};

/**
 * The inert face of the free-text field for the panel's hidden sizers —
 * the SAME three-row box, disabled and unfocusable, so each sizer reserves
 * the field's height and the panel never resizes when the live field gains
 * or loses text. No `focusGroup` (no engine registration), no handlers.
 */
function QuestionFreeTextSizer(): React.ReactElement {
  return (
    <div className="dev-question-dialog-freetext" aria-hidden="true">
      <TugTextarea
        className="dev-question-dialog-freetext-field"
        rows={FREE_TEXT_ROWS}
        disabled
        readOnly
        tabIndex={-1}
        placeholder={FREE_TEXT_PLACEHOLDER}
      />
    </div>
  );
}

/**
 * The panel's question heading — `N. Question text`, repeated from
 * the rail so the options always sit directly under the question they
 * answer (the rail's current row may be several rows away from the
 * panel). Rendered identically inside the live face and each hidden
 * sizer so both faces wrap — and size — the same.
 */
function PanelHeading({
  index,
  question,
}: {
  index: number;
  question: ParsedQuestion;
}): React.ReactElement {
  return (
    <div className="dev-question-dialog-panel-heading">
      <span className="dev-question-dialog-panel-heading-number">
        {index + 1}.
      </span>
      {question.question}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const QuestionWizard: React.FC<QuestionWizardProps> = ({
  request,
  session,
  onResolve,
  className,
}) => {
  const requestId = request.request_id;
  const onResolveRef = React.useRef(onResolve);
  onResolveRef.current = onResolve;

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

  // [L24] / [P01] — per-question free-text answer, parallel to
  // `selections`. An empty string means "no free text" (the options
  // answer the question). A non-blank value IS that question's answer
  // and supersedes any option labels (engaging one clears the other).
  // User data → preserved via the [A9] bag alongside the other arrays.
  const [freeTexts, setFreeTexts] = React.useState<string[]>(
    () => seed.freeTexts ?? new Array(questions.length).fill(""),
  );

  // [P02] `Chat about this` — whether the dialog is in decline mode (the
  // freeform reply field replaces the wizard) and the in-progress reply
  // text. Both are user data → preserved via the [A9] bag. The reply is
  // controlled (value from React state), so no `componentStatePreservation
  // Key` on the textarea ([K2]).
  const [declineMode, setDeclineMode] = React.useState<boolean>(
    () => seed.declineMode ?? false,
  );
  const [declineText, setDeclineText] = React.useState<string>(
    () => seed.declineText ?? "",
  );

  // A bump-only counter that re-runs the flash-then-advance effect even when the
  // selection set itself didn't change. A multi-select Return commits-and-
  // advances by "checking" the cursor row — but if that row is ALREADY checked
  // the selection set is unchanged, so the effect (which keys off `selections`)
  // wouldn't fire. Bumping this on every multi-select Return guarantees the
  // flash + advance run regardless. Not user data; never preserved.
  const [flashTick, setFlashTick] = React.useState(0);

  // Register the capture closure. The framework re-syncs the closure
  // on every render so the latest `selections` / `visited` /
  // `currentIndex` are always available at capture time.
  useComponentStatePreservation<QuestionDialogPreservedState>({
    componentStatePreservationKey: preservationKey,
    captureState: () => ({
      selections,
      visited,
      currentIndex,
      freeTexts,
      declineMode,
      declineText,
    }),
  });

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

  /** Clear row `index`'s free text ([P01] mutual exclusivity) — called
   *  when the user picks an option, so a question is answered by EITHER
   *  options OR free text, never a blend. Idempotent. */
  const clearFreeText = React.useCallback((index: number) => {
    setFreeTexts((prev) => {
      if ((prev[index] ?? "") === "") return prev;
      const next = prev.slice();
      next[index] = "";
      return next;
    });
  }, []);

  // One focus group for the wizard's controls inside the trapped mode: Cancel
  // (0) → Submit (1) → Back (2) → Next (3) → current question's options (4).
  // Disabled stops drop out of the walk by the engine's interactivity filter.
  // Declared here (before the handlers) so they can name a re-seed target.
  const focusGroup = React.useId();

  // After a step change the nav handlers decide where the key view goes: `null`
  // means "leave it where it is" (so Back/Next keep focus across a Return), a
  // `group:order` key re-seeds it (boundary fallback / auto-advance / jump). A
  // layout effect (below the early return's hooks) consumes it on the next
  // `currentIndex` change. [L06]/[L03].
  const pendingFocusKeyRef = React.useRef<string | null>(null);

  // A commit-advance doesn't move the wizard instantly — that's jarring (the
  // options vanish before the eye registers the choice). Instead the commit lands
  // the selection, then a layout effect flashes the selected row(s) (a menu-style
  // confirmation blink) and advances on the flash's tail. `armAdvance` records the
  // intent here; the effect on `selections` / `flashTick` consumes it. `null` =
  // no pending advance (a multi-select toggle, or a commit that doesn't move).
  const pendingAdvanceRef = React.useRef<{
    to: number;
    focusKey: string | null;
  } | null>(null);

  // The dialog's outer element — held so the flash effect can find the chosen
  // option row to animate. The composed ref callback (with the cancel-responder
  // `attachRoot`) is built after `useInlineDialogScope` runs.
  const dialogRootRef = React.useRef<HTMLDivElement | null>(null);

  // Whether every question would be answered if `assumeVisited` were visited —
  // the gate the Next-boundary uses to choose Submit (all answered) vs Back. A
  // question counts as answered when it is visited (or the assumed one) AND
  // carries a selection. Reads the current render's `selections` / `visited`.
  const wouldAllBeAnswered = React.useCallback(
    (assumeVisited: number): boolean => {
      if (questions.length === 0) return false;
      return questions.every(
        (_q, i) =>
          (i === assumeVisited || (visited[i] ?? false)) &&
          questionAnswered(selections[i], freeTexts[i]),
      );
    },
    [questions, visited, selections, freeTexts],
  );

  // Callback hooks must precede the early return so the hook order is
  // invariant across the pending → `null` transition.

  // Arm the flash-then-advance for a commit on `questionIndex`. Called by Return
  // (`handleOptionActivate`) on either arity. Records the advance intent + the
  // post-advance focus target, and bumps `flashTick` so the flash effect fires
  // even when the commit left the selection set unchanged (a Return on an
  // already-checked multi-select row). Only the CURRENT row advances — a stale
  // activation on a non-current row mustn't move the wizard under the user.
  const armAdvance = React.useCallback(
    (questionIndex: number) => {
      if (currentIndex !== questionIndex) return;
      const total = questions.length;
      // Single-question payload: there is nothing to advance to (no next
      // question, no review to scan). A commit just flashes the pick and
      // moves the ring to Submit so a follow-up Return sends — and since
      // Submit is seeded as the key view on mount, the common "accept the
      // default" path is a single Return without ever leaving Submit.
      if (total === 1) {
        pendingAdvanceRef.current = {
          to: 0,
          focusKey: `${focusGroup}:${QUESTION_SUBMIT_ORDER}`,
        };
        setFlashTick((tick) => tick + 1);
        return;
      }
      const newIndex = nextAdvanceIndex(questionIndex, total);
      if (newIndex === questionIndex) return;
      pendingAdvanceRef.current = {
        to: newIndex,
        focusKey:
          newIndex < total
            ? `${focusGroup}:${QUESTION_OPTIONS_ORDER}`
            : `${focusGroup}:${
                wouldAllBeAnswered(questionIndex)
                  ? QUESTION_SUBMIT_ORDER
                  : QUESTION_BACK_ORDER
              }`,
      };
      setFlashTick((tick) => tick + 1);
    },
    [currentIndex, questions.length, focusGroup, wouldAllBeAnswered],
  );

  // Space / click on an option — change the selection, NEVER advance (uniform
  // across arities). Single-select REPLACES (radio semantics — exactly one),
  // multi-select TOGGLES (checkbox semantics); `applyQuestionSelection` owns the
  // difference. Advancing is Return's job (`handleOptionActivate`), so a user can
  // freely adjust their choice with Space/click before committing.
  const handleOptionSelect = React.useCallback(
    (questionIndex: number, optionLabel: string) => {
      const question = questions[questionIndex];
      if (question === undefined) return;
      setSelections((prev) => {
        const next = prev.slice();
        next[questionIndex] = applyQuestionSelection(
          question,
          prev[questionIndex] ?? [],
          optionLabel,
        );
        return next;
      });
      clearFreeText(questionIndex);
      markVisited(questionIndex);
    },
    [questions, markVisited, clearFreeText],
  );

  // Return on the cursor option (`commitOnEnter: "act"`). A forward gesture for
  // BOTH arities: it COMMITS the cursor option — single-select replaces, multi-
  // select *ensures-checked* (add if absent, never toggle-off) — marks the
  // question visited, and advances. The flash then blinks every selected row.
  const handleOptionActivate = React.useCallback(
    (questionIndex: number, optionLabel: string) => {
      const question = questions[questionIndex];
      if (question === undefined) return;
      setSelections((prev) => {
        const cur = prev[questionIndex] ?? [];
        const nextSel = question.multiSelect
          ? cur.includes(optionLabel)
            ? cur
            : [...cur, optionLabel]
          : [optionLabel];
        if (nextSel === cur) return prev;
        const next = prev.slice();
        next[questionIndex] = nextSel;
        return next;
      });
      clearFreeText(questionIndex);
      markVisited(questionIndex);
      armAdvance(questionIndex);
    },
    [questions, markVisited, armAdvance, clearFreeText],
  );

  // The free-text answer field ([P01]). Typing into it sets the row's
  // free text and — when non-blank — clears that row's option labels
  // (mutual exclusivity, [Q02]); a non-blank value marks the question
  // visited so it counts toward the headline and Submit gate. Controlled
  // (value from React state), so the value lives in `freeTexts` and the
  // [A9] bag preserves it across reload ([K2] — no `componentStatePreservation
  // Key`, which is uncontrolled-only).
  const handleFreeTextChange = React.useCallback(
    (questionIndex: number, value: string) => {
      setFreeTexts((prev) => {
        if ((prev[questionIndex] ?? "") === value) return prev;
        const next = prev.slice();
        next[questionIndex] = value;
        return next;
      });
      if (value.trim() !== "") {
        setSelections((prev) => {
          if ((prev[questionIndex]?.length ?? 0) === 0) return prev;
          const next = prev.slice();
          next[questionIndex] = [];
          return next;
        });
        markVisited(questionIndex);
      }
    },
    [markVisited],
  );

  // [K3] The free-text field is a multi-line textarea, so plain Return inserts
  // a newline (native). Shift/⌘-Return advances the wizard (mark visited +
  // reuse the shared advance machinery), mirroring the decline reply's send
  // chord. The engine's [P25] guard passes the keystroke through to the
  // focused textarea, so we read it off the field's own `onKeyDown`.
  const handleFreeTextKeyDown = React.useCallback(
    (questionIndex: number, event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || !(event.shiftKey || event.metaKey)) return;
      event.preventDefault();
      markVisited(questionIndex);
      armAdvance(questionIndex);
    },
    [markVisited, armAdvance],
  );

  /** Jump-via-rail-click is exploratory — the user hasn't committed
   *  anything yet by browsing, so we don't mark visited. They have
   *  to actually pick or use `Next` to lock in a row. The keyboard
   *  follows the jump to that question's options. A no-op on the
   *  already-current row: arming a focus intent there would never be
   *  consumed (the consuming effect runs on `currentIndex` changes)
   *  and would misfire on the next genuine step. */
  const handleJump = React.useCallback(
    (target: number) => {
      if (target === currentIndex) return;
      if (target < questions.length) {
        pendingFocusKeyRef.current = `${focusGroup}:${QUESTION_OPTIONS_ORDER}`;
      }
      setCurrentIndex(target);
    },
    [questions.length, focusGroup, currentIndex],
  );

  /** `Back` from the current row: don't mark the row we're leaving
   *  as visited. A user who back-tracked without engaging hasn't
   *  taken a stance. Focus STAYS on Back across the Return (so the user can
   *  Back, Back, Back), unless this reaches the first question (Back becomes
   *  disabled) → shift to Next. */
  const handleBack = React.useCallback(() => {
    if (currentIndex <= 0) return;
    const newIndex = currentIndex - 1;
    pendingFocusKeyRef.current =
      newIndex === 0 ? `${focusGroup}:${QUESTION_NEXT_ORDER}` : null;
    setCurrentIndex(newIndex);
  }, [currentIndex, focusGroup]);

  /** `Next` from the current row IS a commit — even on multi-select,
   *  the click says "I'm done with this question". Mark visited and
   *  advance. Focus STAYS on Next across the Return (so the user can Next,
   *  Next, Next), unless this reaches the review step (no next question; Next
   *  becomes disabled) → shift to Submit if every question is answered, else
   *  Back. */
  const handleAdvance = React.useCallback(() => {
    const total = questions.length;
    const newIndex = nextAdvanceIndex(currentIndex, total);
    markVisited(currentIndex);
    pendingFocusKeyRef.current =
      newIndex < total
        ? null
        : `${focusGroup}:${
            wouldAllBeAnswered(currentIndex)
              ? QUESTION_SUBMIT_ORDER
              : QUESTION_BACK_ORDER
          }`;
    setCurrentIndex(newIndex);
  }, [questions.length, currentIndex, markVisited, focusGroup, wouldAllBeAnswered]);

  const respond = React.useCallback(
    (answers: Record<string, string>) => {
      // Re-check against the live store rather than the rendered
      // `isPending` — robust against a double-click or a stale closure.
      const stillPending =
        session.getSnapshot().pendingQuestion?.request_id === requestId;
      if (!stillPending) return;
      onResolveRef.current?.({ answers });
      session.respondQuestion(requestId, { answers });
    },
    [session, requestId],
  );

  const handleSubmit = React.useCallback(() => {
    respond(buildQuestionAnswers(questions, selections, freeTexts));
  }, [respond, questions, selections, freeTexts]);

  // [P02] `Chat about this` — the decline-and-reply path. Entering decline
  // mode swaps the wizard body for the reply field and lands focus in it
  // ([K1], via `pendingFocusKeyRef` consumed by the focus-restore effect on
  // the `declineMode` change). `Back to questions` exits, restoring the
  // wizard + focus.
  const handleEnterDecline = React.useCallback(() => {
    pendingFocusKeyRef.current = `${focusGroup}:${QUESTION_DECLINE_TEXT_ORDER}`;
    setDeclineMode(true);
  }, [focusGroup]);

  const handleExitDecline = React.useCallback(() => {
    // Back to the wizard — re-seed focus mirroring the open seed: a single
    // single-select question (and the review step / the no-questions form)
    // lands on Submit; every other live question lands on its options.
    const atReview = currentIndex >= questions.length;
    const singleSelectOnly =
      questions.length === 1 && questions[0]?.multiSelect === false;
    pendingFocusKeyRef.current =
      questions.length > 0 && !atReview && !singleSelectOnly
        ? `${focusGroup}:${QUESTION_OPTIONS_ORDER}`
        : `${focusGroup}:${QUESTION_SUBMIT_ORDER}`;
    setDeclineMode(false);
  }, [focusGroup, currentIndex, questions]);

  // Submit the decline reply ([P02]): resolves the tool with the freeform
  // `response` (distinct from Cancel's interrupt). No-op on a blank reply
  // or a stale (no-longer-pending) request.
  const respondDecline = React.useCallback(() => {
    if (declineText.trim() === "") return;
    const stillPending =
      session.getSnapshot().pendingQuestion?.request_id === requestId;
    if (!stillPending) return;
    onResolveRef.current?.({ response: declineText });
    session.respondQuestion(requestId, { response: declineText });
  }, [session, requestId, declineText]);

  // [P06]/[P09] The reply field's submit semantics: plain Return inserts a
  // newline (native textarea), Shift-Return sends the reply (the advertised
  // hint). ⌘-Return is kept as a silent alias for muscle-memory. The engine's
  // [P25] guard yields the keystroke to the focused textarea, so we read it
  // off the field's own `onKeyDown`.
  const handleDeclineKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.shiftKey || event.metaKey)) {
        event.preventDefault();
        respondDecline();
      }
    },
    [respondDecline],
  );

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

  // Escape routing ([P09]). In decline mode Escape returns to the questions
  // (you can't tear the whole question down from the reply sub-mode — `Back`
  // out first); in the wizard it is the unified cancel/interrupt.
  const handleEscape = React.useCallback(() => {
    if (declineMode) {
      handleExitDecline();
      return;
    }
    handleCancel();
  }, [declineMode, handleExitDecline, handleCancel]);

  // The dialog is **card-modal** ([P16]): inline display, trapped focus. The
  // trap owns the keyboard while pending — Tab cycles the wizard's own controls
  // (Cancel / Submit / Back / Next leaf stops + the current question's option
  // group, [P17]) and the opener's key view is restored on dismiss. The prompt
  // entry deactivates off the session's pending state (see `DevCardBody`), and
  // the card content around the dialog is scrimmed ([P19]). Declared above the
  // `!isPending` early return so hook order is stable across renders.
  // Host-less inline dialog: no Radix focus primitive, so no teardown-autofocus
  // slot to own the DOM-focus write. It does NOT defer — the engine moves DOM
  // focus to the restored key view in `popFocusMode` on close, as before.
  // [P01] The engine's Escape ladder owns Escape now: when this dialog's trap is
  // the top mode, the ladder calls `handleCancel` directly (the same action
  // `useInlineDialogScope`'s CANCEL_DIALOG handler runs) instead of relying on
  // Stage-1's CANCEL_DIALOG fallthrough. ⌘. stays chain-routed via the scope.
  const { FocusModeScope, scopeId } = useFocusTrap({
    active: isPending,
    onEscapeDismiss: handleEscape,
  });

  // Spatial arrow order ([P22] / [P23]). The dialog's controls stack in up to
  // three rows — the header actions (Cancel ↔ Submit), the wizard nav (Back ↔
  // Next, multi-question only), and the current question's options — so Left /
  // Right swap within a row while Up / Down move between rows and loop at the
  // edges (`rowGridOrder`). Only the controls actually rendered AND enabled this
  // state join the grid, so an arrow never lands the ring on a disabled or absent
  // button: Submit drops out until every question is answered, Back at the first
  // question, Next at the review step. The current question's options are ONE
  // delegated item-group node (a seam target whose cursor roves the interior) for
  // BOTH arities — single- and multi-select are the same `TugListView` now, so
  // both are arrow-reachable from the buttons. Nodes are stable `group:order`
  // keys; the navigator's liveliness fallback backstops any edge the grid doesn't
  // name, so no arrow dead-ends.
  const spatialOrder = React.useMemo<SpatialOrder>(() => {
    const key = (order: number): string => `${focusGroup}:${order}`;
    // Decline mode ([P02]/[K1]) swaps in its own grid — `Back` + `Reply` on
    // top, then the reply textarea — so arrows stay within the reply surface
    // and never reach the (hidden) wizard. No whole-question Cancel here.
    if (declineMode) {
      return rowGridOrder([
        [key(QUESTION_BACK_ORDER), key(QUESTION_SEND_REPLY_ORDER)],
        [key(QUESTION_DECLINE_TEXT_ORDER)],
      ]);
    }
    const hasQ = questions.length > 0;
    const multi = questions.length > 1;
    const atReview = currentIndex >= questions.length;
    // Single SINGLE-select Submit lights up on the preseed alone (no prior
    // visit needed) so it joins the grid — and is the seeded key view — on
    // mount. A single multi-select question and every multi-question wizard
    // still gate on each row being user-confirmed.
    const everyAnswered =
      hasQ &&
      (questions.length === 1 && questions[0]?.multiSelect === false
        ? questionAnswered(selections[0], freeTexts[0])
        : countConfirmedAnswers(selections, visited, freeTexts) ===
          questions.length);

    // All controls share ONE top row, left→right: Cancel · Back · Next ·
    // Submit (Back / Next multi-question only; Submit once answered). No
    // separate nav row anymore.
    const buttonRow: string[] = [];
    if (hasQ) {
      buttonRow.push(key(QUESTION_CANCEL_ORDER));
      if (multi) {
        if (currentIndex > 0) buttonRow.push(key(QUESTION_BACK_ORDER));
        if (!atReview) buttonRow.push(key(QUESTION_NEXT_ORDER));
      }
      if (everyAnswered) buttonRow.push(key(QUESTION_SUBMIT_ORDER));
    } else {
      // No questions → a lone "Dismiss" (the Submit stop), always enabled.
      buttonRow.push(key(QUESTION_SUBMIT_ORDER));
    }
    // The options group joins the grid whenever a live question is shown (not at
    // the review step). Same treatment regardless of arity.
    const optionsRow: string[] = [];
    if (hasQ && !atReview) optionsRow.push(key(QUESTION_OPTIONS_ORDER));
    // The free-text field ([K1]) is its own grid row directly under the
    // options, reachable by a bare Down arrow, whenever a live question
    // is shown.
    const freeTextRow: string[] = [];
    if (hasQ && !atReview) freeTextRow.push(key(QUESTION_FREETEXT_ORDER));
    // The `Chat about this` entry control ([P02]) — a bottom row in the
    // wizard, present whenever there are questions to decline.
    const chatRow: string[] = [];
    if (hasQ) chatRow.push(key(QUESTION_CHAT_ABOUT_ORDER));

    return rowGridOrder([buttonRow, optionsRow, freeTextRow, chatRow]);
  }, [
    focusGroup,
    questions,
    selections,
    visited,
    currentIndex,
    freeTexts,
    declineMode,
  ]);
  useSpatialOrder(scopeId, isPending ? spatialOrder : null);

  const manager = useFocusManager();

  // The dialog's keyboard scope ([P16]): a CANCEL_DIALOG responder so Escape /
  // Cmd-. cancel (the bare `popInteractive`, no popover), and a seed that lands
  // the key view on the current question's options on open (answering is the
  // task), or on Submit at the review step.
  //
  // Single single-select question: seed the key view on Submit (which is
  // enabled on mount — the first option is preseeded). The common "accept the
  // recommendation" path is then a single Return without ever leaving Submit;
  // changing the pick is Tab/arrow to the options, Space to choose, then back
  // to Submit. A single MULTI-select question still seeds the options (the user
  // is meant to choose which apply), as does every multi-question wizard.
  const isSingleSelectOnly =
    questions.length === 1 && questions[0]?.multiSelect === false;
  const seedAtReview = currentIndex >= questions.length;
  const seedFocusKey = declineMode
    ? `${focusGroup}:${QUESTION_DECLINE_TEXT_ORDER}`
    : isSingleSelectOnly
      ? `${focusGroup}:${QUESTION_SUBMIT_ORDER}`
      : questions.length > 0 && !seedAtReview
        ? `${focusGroup}:${QUESTION_OPTIONS_ORDER}`
        : `${focusGroup}:${QUESTION_SUBMIT_ORDER}`;
  const { attachRoot } = useInlineDialogScope({
    active: isPending,
    defaultFocusKey: seedFocusKey,
    onCancel: handleEscape,
  });

  // Compose the dialog's outer ref: the cancel-responder root + the held element
  // the flash effect animates.
  const setDialogRoot = React.useCallback(
    (el: HTMLDivElement | null) => {
      dialogRootRef.current = el;
      attachRoot(el);
    },
    [attachRoot],
  );

  // Flash-then-advance on a commit-advance ([menu-flash confirmation]). When
  // `armAdvance` records a pending advance (a Return on either arity), the
  // selection has already committed; pulse **every selected row's GLYPH** (the
  // radio dot / checkbox) a couple of times so the eye registers the choice, then
  // advance on the pulse's tail. Single-select → one glyph; multi-select → all
  // checked glyphs pulse together. Runs on `selections` AND `flashTick` so a
  // Return on an already-checked row (selection unchanged) still fires. A no-op
  // for a plain Space toggle (records no pending advance). TugAnimator scales the
  // pulse under reduced motion ([D06]).
  //
  // The confirmation rides the MARK, not the fill: under the list state language a
  // transient row fill is the mouse and the glyph is the committed selection, so
  // the blink pulses the glyph's `opacity` and leaves the row background alone.
  // `fill: "none"` reverts each glyph to its CSS opacity afterward, leaving no
  // residue.
  //
  // The row set is driven off the COMMITTED `selections[currentIndex]` — the
  // authoritative answer Return just changed — NOT the DOM's `aria-checked`. The
  // effect runs as a layout effect AFTER the selection-change render commits, so
  // the just-checked row is in `selections` and its glyph is already shown: the
  // flash always takes Return's change into account, and only then advances.
  // ([L06] the flash is appearance via DOM/TugAnimator; the selection it reads is
  // data; [L03] layout-effect timing; [L13] TugAnimator.)
  React.useLayoutEffect(() => {
    const pending = pendingAdvanceRef.current;
    if (pending === null) return;
    pendingAdvanceRef.current = null;

    const advance = () => {
      if (pending.to === currentIndex) {
        // No index change to drive the focus-restore effect (the
        // single-question commit keeps the user on the only question) —
        // arm the key view directly so the ring still lands on Submit.
        if (manager !== null && pending.focusKey !== null) {
          manager.armKeyboardRestore(pending.focusKey);
        }
        return;
      }
      pendingFocusKeyRef.current = pending.focusKey;
      setCurrentIndex(pending.to);
    };

    const root = dialogRootRef.current;
    // Authoritative post-change selection for the answered question; map each
    // selected label to its (stable) row element. Single-select → one row,
    // multi-select → all checked rows.
    const labels = selections[currentIndex] ?? [];
    const selectedRows =
      root !== null && labels.length > 0
        ? labels
            .map((label) =>
              root.querySelector<HTMLElement>(
                `.dev-question-dialog-options-list [data-option-label="${CSS.escape(label)}"]`,
              ),
            )
            .filter((el): el is HTMLElement => el !== null)
        : [];
    if (selectedRows.length === 0) {
      advance();
      return;
    }

    let cancelled = false;
    const flashes = selectedRows.map((row) => {
      // Pulse the selection glyph (radio dot / checkbox), which every option row
      // carries; fall back to the row itself only if a glyph is somehow absent.
      // Opacity isn't mid-transition (the glyph's own transitions are on
      // background/border, not opacity), so no transition-snap read is needed.
      const target =
        row.querySelector<HTMLElement>(".tug-list-row-check") ?? row;
      return animate(
        target,
        [
          { opacity: "1" },
          { opacity: "0.25" },
          { opacity: "1" },
          { opacity: "0.25" },
          { opacity: "1" },
        ],
        {
          duration: "--tug-motion-duration-slow",
          easing: "ease-in-out",
          key: "question-pick-flash",
          fill: "none",
        },
      );
    });
    Promise.all(flashes.map((f) => f.finished))
      .then(() => {
        if (!cancelled) advance();
      })
      .catch(() => {
        /* flash cancelled (rapid re-pick / unmount) — superseding run advances */
      });
    return () => {
      cancelled = true;
    };
  }, [selections, flashTick, currentIndex, manager]);

  // Apply the nav handlers' focus intent on a step change. `null` (the default
  // for Back/Next in the interior) leaves the key view where it is, so focus
  // STAYS on the pressed nav button across a Return; a `group:order` key
  // re-seeds it (boundary fallback, auto-advance to options, jump). The initial
  // open seed is owned by `useInlineDialogScope`; this only acts when a handler
  // set an intent. [L03] (layout effect), [L06] (key view is appearance/engine).
  React.useLayoutEffect(() => {
    if (!isPending || manager === null) return;
    const target = pendingFocusKeyRef.current;
    if (target === null) return;
    pendingFocusKeyRef.current = null;
    manager.armKeyboardRestore(target);
  }, [isPending, manager, currentIndex, declineMode]);

  // Panel height floor, ratcheted — the hard guarantee under the sizer grid.
  // The stacked sizers already hold the panel at the tallest question's
  // natural height, but any transient under-measure in a hidden sizer (a
  // list settling its layout, wrap math drifting a fraction at odd widths)
  // would let the panel shrink and the dialog's bottom edge wobble. The
  // floor is monotone: the panel's `min-height` only ever grows, so the
  // answer section can never shrink mid-wizard. Width changes re-baseline
  // it (wrap math is width-specific). Direct DOM style writes, not React
  // state ([L06] appearance zone); [L03] layout effect. The ResizeObserver
  // catches growth the render cycle can't see (a sizer settling, a font
  // swap); shrink below the floor never changes the panel's box, so the
  // observer loop is one-directional.
  //
  // DEPENDS on the panel grid's `align-content: start` (see the CSS): with
  // the default `stretch`, a `min-height` on the grid container stretches
  // the row, the row stretches the face, and the next measurement reads the
  // stretched box — a +padding-per-frame runaway. `start` decouples row
  // sizing from the container's min-height, making the ratchet idempotent.
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const panelFloorRef = React.useRef(0);
  const panelFloorWidthRef = React.useRef(-1);
  const syncPanelFloor = React.useCallback(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const rect = panel.getBoundingClientRect();
    if (Math.abs(rect.width - panelFloorWidthRef.current) > 0.5) {
      panelFloorWidthRef.current = rect.width;
      panel.style.minHeight = "";
      const natural = panel.getBoundingClientRect().height;
      panelFloorRef.current = Math.ceil(natural);
      panel.style.minHeight = `${panelFloorRef.current}px`;
      return;
    }
    if (rect.height > panelFloorRef.current) {
      panelFloorRef.current = Math.ceil(rect.height);
      panel.style.minHeight = `${panelFloorRef.current}px`;
    }
  }, []);
  React.useLayoutEffect(() => {
    syncPanelFloor();
  });
  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncPanelFloor());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [syncPanelFloor, questions, isPending]);

  // Cancel guards itself with a confirmation popover: a stray click
  // shouldn't tear the AI's question down without a second beat. The
  // popover is anchored to the Cancel trigger via `TugConfirmPopover`'s
  // imperative API (`ref.confirm() → Promise<boolean>`); a `true`
  // resolution walks the family `Cancel ≡ popInteractive` path.
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
  const confirmedCount = countConfirmedAnswers(selections, visited, freeTexts);
  // `Submit` enablement:
  //  - Single SINGLE-select question — lights up on the preseed alone (the
  //    first option is selected on mount), so the recommended default is
  //    acceptable in one Return on the seeded Submit. Nothing to scan first.
  //  - A single multi-select question / any multi-question — gates on every
  //    row being user-confirmed, so the user scans the whole set first.
  const allAnswered =
    hasQuestions &&
    (single !== null && !single.multiSelect
      ? questionAnswered(selections[0], freeTexts[0])
      : confirmedCount === questions.length);

  // Dialog description — single question repeats its text here
  // verbatim (unchanged from the legacy layout); the multi-question
  // summary moves into the wizard-nav row alongside Back / Next, so
  // this prop is `undefined` for multi-question payloads.
  // Decline mode keeps the wizard's own description (the single question's
  // text, or nothing for multi) so entering/leaving decline doesn't shove a
  // new line in and relayout the rail — the reply field's placeholder carries
  // the "reply in prose" cue instead.
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
  // Cancel ≡ Esc ≡ interrupt — shared across wizard and decline mode (a
  // decline is a *resolution*, Cancel a *rejection*; both keep their
  // confirm popover).
  const cancelControl: React.ReactNode = (
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
        focusGroup={focusGroup}
        focusOrder={QUESTION_CANCEL_ORDER}
        onClick={handleCancelClick}
      >
        Cancel
      </TugPushButton>
    </TugConfirmPopover>
  );

  const dialogActions: React.ReactNode = declineMode ? (
    // Decline mode ([P02]/[P09]) — the action row is `Back` + `Reply`. There
    // is NO whole-question Cancel here: `Back` returns to the questions
    // (where Cancel lives), and `Reply` resolves the tool with the freeform
    // reply. So a decline can't tear the whole question down without a
    // deliberate step back first.
    <>
      <TugPushButton
        emphasis="outlined"
        role="action"
        size="xs"
        focusGroup={focusGroup}
        focusOrder={QUESTION_BACK_ORDER}
        onClick={handleExitDecline}
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back
      </TugPushButton>
      <TugPushButton
        emphasis="primary"
        role="action"
        size="xs"
        focusGroup={focusGroup}
        focusOrder={QUESTION_SEND_REPLY_ORDER}
        persistentDefaultRing
        disabled={declineText.trim() === ""}
        onClick={respondDecline}
      >
        Reply
      </TugPushButton>
    </>
  ) : hasQuestions ? (
    // Wizard controls share one row, left→right: Cancel, Back, Next, Submit.
    // Back / Next only appear for a multi-question payload (single questions
    // have nothing to navigate).
    <>
      {cancelControl}
      {single === null ? (
        <>
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="xs"
            focusGroup={focusGroup}
            focusOrder={QUESTION_BACK_ORDER}
            disabled={isFirstQuestion}
            onClick={handleBack}
          >
            <ArrowLeft size={14} aria-hidden="true" /> Back
          </TugPushButton>
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="xs"
            focusGroup={focusGroup}
            focusOrder={QUESTION_NEXT_ORDER}
            disabled={isAtReview}
            onClick={handleAdvance}
          >
            Next <ArrowRight size={14} aria-hidden="true" />
          </TugPushButton>
        </>
      ) : null}
      <TugPushButton
        emphasis="primary"
        role="action"
        size="xs"
        focusGroup={focusGroup}
        focusOrder={QUESTION_SUBMIT_ORDER}
        persistentDefaultRing
        disabled={!allAnswered}
        onClick={handleSubmit}
      >
        Submit
      </TugPushButton>
    </>
  ) : (
    <TugPushButton
      emphasis="primary"
      role="action"
      size="xs"
      focusGroup={focusGroup}
      focusOrder={QUESTION_SUBMIT_ORDER}
      persistentDefaultRing
      onClick={handleSubmit}
    >
      Dismiss
    </TugPushButton>
  );

  // [P02]/[P09] Decline mode — the freeform reply field. It swaps in for the
  // working surface (the single question's options, or the multi-question
  // panel) while the rail above stays put, so entering decline relayouts only
  // the area below the rail. A controlled `TugTextarea` (value in React state,
  // preserved via the [A9] bag — no `componentStatePreservationKey`, [K2])
  // authored as the mode's focus stop, under a keyboard hint. `Back` / `Reply`
  // live in the top action bar; there is no whole-question Cancel here.
  //
  // The reply surface fills the SAME height the multi-question panel reserved
  // (`panelFloorRef`, measured while the wizard was up), so toggling Chat-about
  // on/off doesn't grow or shrink the block — no vertical hop. (For a single
  // question there's no panel floor, so it sizes to its content.)
  const declineReplyBody: React.ReactNode = (
    <div
      className="dev-question-dialog-decline"
      data-slot="dev-question-dialog-decline"
      style={
        panelFloorRef.current > 0
          ? { minHeight: `${panelFloorRef.current}px` }
          : undefined
      }
    >
      <TugTextarea
        className="dev-question-dialog-decline-field"
        value={declineText}
        onChange={(event) => setDeclineText(event.target.value)}
        onKeyDown={handleDeclineKeyDown}
        placeholder="Type your reply to Claude…"
        autoResize
        rows={3}
        maxRows={10}
        focusGroup={focusGroup}
        focusOrder={QUESTION_DECLINE_TEXT_ORDER}
        aria-label="Reply to Claude"
      />
      <div className="dev-question-dialog-decline-foot">
        <span className="dev-question-dialog-decline-hint">
          Return for a new line • Shift-Return to send reply
        </span>
      </div>
    </div>
  );

  // Frameless layout: a headline (icon + title), an optional description,
  // the body, and a foot action row. Dialog controls (Cancel / Submit, or
  // just Dismiss when there are no questions) live in that foot action
  // row. The wizard nav (Back / Next) sits on its own row inside the body,
  // between the description and the question rail — close enough to the
  // questions for the touch target to feel coupled to the row it
  // mutates, but stable across question advances so the button
  // never moves under the mouse.
  //
  // The dialog is card-modal ([P16]): inline display, trapped focus. Its
  // controls are decomposed into focus-language archetypes ([P17]) authored into
  // the trap — Cancel / Submit / Back / Next leaf buttons + the current
  // question's option group. The outer wrapper carries the `dev-question-dialog`
  // class (the scrim's bright-island marker, [P19]) and the cancel-action
  // responder root (`attachRoot`); it is NOT focusable, so clicking inert chrome
  // establishes no focus state ([P18]). `FocusModeScope` (from `useFocusTrap`)
  // wraps it so the controls join the pushed mode.
  return (
    <FocusModeScope>
      <div
        ref={setDialogRoot}
        className="dev-question-dialog"
        data-slot="dev-question-dialog"
      >
    <div className={cn("dev-question-dialog-frame", className)}>
      {/* No titled-card headline: the host BlockChrome header carries the
          identity ([P02]). The single-question text rides the description so
          it sits directly above its options and morphs cleanly into the
          answered Q→A row. */}
      {dialogDescription !== undefined ? (
        <div className="dev-question-dialog-headline-description">
          {dialogDescription}
        </div>
      ) : null}
      <div className="dev-question-dialog-body">
      {/* One top action bar holds the controls (left→right Cancel · Back ·
          Next · Submit, or Back · Reply in decline mode) on the trailing edge,
          and — for a multi-question payload — the progress summary on the
          leading edge. There is no separate foot action row. */}
      <div
        className="dev-question-dialog-actionbar"
        data-slot="dev-question-dialog-actionbar"
      >
        {wizardSummary !== null ? (
          <span className="dev-question-dialog-nav-summary">{wizardSummary}</span>
        ) : null}
        <div className="dev-question-dialog-actionbar-buttons">
          {dialogActions}
        </div>
      </div>
      {/* Single-question payload — no rail, no panel. The options + free-text
          fill the slot; decline mode swaps them for the reply field in place. */}
      {hasQuestions && single !== null ? (
        <div
          className="dev-question-dialog-questions"
          data-slot="dev-question-dialog-questions"
        >
          {declineMode ? (
            declineReplyBody
          ) : (
            <>
              <QuestionOptions
                question={single}
                selection={selections[0] ?? []}
                onSelect={(optionLabel) => handleOptionSelect(0, optionLabel)}
                onActivate={(optionLabel) => handleOptionActivate(0, optionLabel)}
                focusGroup={focusGroup}
                focusOrder={QUESTION_OPTIONS_ORDER}
              />
              <QuestionFreeText
                value={freeTexts[0] ?? ""}
                onChange={(value) => handleFreeTextChange(0, value)}
                onKeyDown={(event) => handleFreeTextKeyDown(0, event)}
                focusGroup={focusGroup}
                focusOrder={QUESTION_FREETEXT_ORDER}
              />
            </>
          )}
        </div>
      ) : null}
      {hasQuestions && single === null ? (
        <>
          {/* The rail — the shared `QuestionSummaryList`, one summary row per
            * question (status marker · N. · question · → answer). The rows are
            * mouse-jump only (keyboard walks Back / Next), so they carry no
            * `focusGroup` Tab stop; the `current` row is non-interactive. */}
          <QuestionSummaryList
            className="dev-question-dialog-rail"
            ariaLabel="Questions"
            rows={questions.map((q, i) => {
              const selection = selections[i] ?? [];
              const freeText = freeTexts[i] ?? "";
              const status = rowStatus(
                i === currentIndex,
                visited[i] === true,
                questionAnswered(selection, freeText),
              );
              return {
                index: i,
                question: q.question,
                answer: composeRowAnswerLabel(selection, freeText),
                status,
                onActivate: () => handleJump(i),
                ariaLabel: `${railRowLabelPrefix(status)} ${i + 1}: ${q.question}`,
              } satisfies QuestionSummaryRowData;
            })}
          />

          {/* A quiet structural cut between the index (rail) and the
            * working surface (panel) — a full-width hairline, no box. */}
          <TugSeparator className="dev-question-dialog-separator" />

          {/* Below the separator: the working surface. Decline mode swaps the
            * reply field in here (the rail above stays put); otherwise the
            * stationary options panel renders — a CSS grid stacking one hidden,
            * inert sizer per question under the live face, so the panel holds
            * the tallest question's height in every state (no JS measurement,
            * no reflow on advance; review swaps the face, never the box). */}
          {declineMode ? (
            declineReplyBody
          ) : (
          <div
            ref={panelRef}
            className="dev-question-dialog-panel"
            data-slot="dev-question-dialog-panel"
          >
            <div
              className="dev-question-dialog-panel-face"
              data-slot="dev-question-dialog-panel-face"
            >
              {isAtReview ? (
                <div className="dev-question-dialog-panel-review">
                  Review your answers above, then Submit.
                </div>
              ) : (
                <>
                  <PanelHeading
                    index={currentIndex}
                    question={questions[currentIndex]}
                  />
                  <div className="dev-question-dialog-panel-options">
                    <QuestionOptions
                      key={`${currentIndex}:${questions[currentIndex].question}`}
                      question={questions[currentIndex]}
                      selection={selections[currentIndex] ?? []}
                      onSelect={(optionLabel) =>
                        handleOptionSelect(currentIndex, optionLabel)
                      }
                      onActivate={(optionLabel) =>
                        handleOptionActivate(currentIndex, optionLabel)
                      }
                      focusGroup={focusGroup}
                      focusOrder={QUESTION_OPTIONS_ORDER}
                    />
                  </div>
                  <QuestionFreeText
                    value={freeTexts[currentIndex] ?? ""}
                    onChange={(value) =>
                      handleFreeTextChange(currentIndex, value)
                    }
                    onKeyDown={(event) =>
                      handleFreeTextKeyDown(currentIndex, event)
                    }
                    focusGroup={focusGroup}
                    focusOrder={QUESTION_FREETEXT_ORDER}
                  />
                </>
              )}
            </div>
            {/* Sizers render AFTER the live face so a first-match DOM
              * query for an option primitive (a radio group, a list
              * row) always lands on the live one, never an inert
              * sizer clone. Grid stacking is order-independent. */}
            {questions.map((question, index) => (
              <div
                key={`sizer:${index}:${question.question}`}
                className="dev-question-dialog-panel-sizer"
                aria-hidden="true"
              >
                <PanelHeading index={index} question={question} />
                <div className="dev-question-dialog-panel-options">
                  <QuestionOptionsSizer question={question} />
                </div>
                <QuestionFreeTextSizer />
              </div>
            ))}
          </div>
          )}
        </>
      ) : null}
          {hasQuestions ? (
            // [P02] `Chat about this` — abandon the questions and reply in
            // prose. A quiet (ghost) entry at the foot of the wizard;
            // activating it switches the dialog into decline mode. It STAYS at
            // the foot in decline mode, lit (`tinted`) + disabled, so it reads
            // as the active mode toggle rather than vanishing.
            <div
              className="dev-question-dialog-chat-about"
              data-slot="dev-question-dialog-chat-about"
              data-active={declineMode ? "true" : undefined}
            >
              <TugPushButton
                emphasis={declineMode ? "tinted" : "ghost"}
                role="action"
                size="xs"
                focusGroup={focusGroup}
                focusOrder={QUESTION_CHAT_ABOUT_ORDER}
                disabled={declineMode}
                onClick={declineMode ? undefined : handleEnterDecline}
              >
                <MessageCircleQuestion size={14} aria-hidden="true" /> Chat
                about this instead
              </TugPushButton>
            </div>
          ) : null}
      </div>
    </div>
      </div>
    </FocusModeScope>
  );
};

/**
 * `QuestionDialog` — dispatch adapter for {@link QuestionWizard}. Maps
 * the dispatch's `{ input, context }` shape onto the wizard's direct
 * `{ request, session }` props. Kept as a thin shim while the foot-slot
 * call site still routes through the `kind: "question"` RenderInput;
 * the durable surface is moving to `AskUserQuestionToolBlock`.
 */
export const QuestionDialog: React.FC<QuestionDialogProps> = ({
  input,
  context,
  className,
}) => (
  <QuestionWizard
    request={input.request}
    session={context.session}
    className={className}
  />
);
