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
 * [D01] / [D08]). Paged wizard, master–detail. A single-question
 * payload renders inline (the question text goes in the dialog
 * `description` and the options fill the children slot). A
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
 * **Two control rows.** Dialog controls (`Cancel` / `Submit`) flow
 * into the primitive's trailing `actions` slot on the header row.
 * Wizard nav (`Back` / `Next`) shares a single row with the
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
 *  - [L20] component-token sovereignty — the dialog frame is
 *    delegated to `TugInlineDialog` (`--tugx-idialog-*`); the option
 *    list is a `TugListView` of `TugListRow`s (`--tugx-list-view-*` /
 *    `--tugx-list-row-*`). This component owns only the small
 *    `--tugx-question-*` wizard-rail family.
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
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  MessageCircleQuestion,
} from "lucide-react";

import { TugInlineDialog } from "@/components/tugways/tug-inline-dialog";
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

/**
 * The wizard state the rail cells read — published via
 * {@link QuestionRailContext} (the {@link QuestionOptionsSelectionContext}
 * pattern) so the rail's cell renderer can derive each row's status,
 * marker, and answer summary without the data source carrying
 * per-render state.
 */
interface QuestionRailState {
  questions: ReadonlyArray<ParsedQuestion>;
  selections: ReadonlyArray<ReadonlyArray<string>>;
  visited: ReadonlyArray<boolean>;
  currentIndex: number;
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

const QuestionRailContext = React.createContext<QuestionRailState>({
  questions: [],
  selections: [],
  visited: [],
  currentIndex: 0,
});

/**
 * Static, single-section data source over the wizard's questions —
 * the rail's row *identity*. The question set is fixed for a
 * request's lifetime, so `subscribe` is a no-op and `getVersion`
 * returns the array identity. Row *state* (status / answer) is
 * per-render and flows to the cells via {@link QuestionRailContext}.
 */
class QuestionRailDataSource implements TugListViewDataSource {
  constructor(private readonly questions: readonly ParsedQuestion[]) {}
  numberOfItems(): number {
    return this.questions.length;
  }
  idForIndex(index: number): string {
    return `${index}:${this.questions[index]?.question ?? ""}`;
  }
  kindForIndex(): string {
    return "question";
  }
  subscribe(): () => void {
    return () => {};
  }
  getVersion(): unknown {
    return this.questions;
  }
}

/**
 * One rail row — the uniform per-question summary, a {@link TugListRow}
 * whose `leading` slot carries the status marker and whose content
 * column stacks the heading over a reserved one-line `→ answer` slot.
 * Geometry is identical across all four statuses so a status change
 * never changes the rail's height: the answer slot always renders,
 * hidden via `data-empty` while there is no selection, and clamps to
 * one ellipsized line so a long multi-select answer can't rewrap it.
 * The heading wraps freely — its text is constant per row, so its
 * height is too.
 *
 * The current row carries a soft `--tugx-question-current-bg` tint —
 * the SAME tone the panel below paints, so pointer and stage read as
 * one linked pair (deliberately not TugListRow's loud `selected`
 * fill, which competed with the panel for "this is active") — and its
 * answer summary tracks the in-flight selection live; activation is
 * the enclosing list view cell wrapper's job (→ delegate `onSelect` →
 * the wizard's jump).
 */
const QuestionRailCell: TugListViewCellRenderer<QuestionRailDataSource> =
  function QuestionRailCell({
    index,
  }: TugListViewCellProps<QuestionRailDataSource>): React.ReactElement {
    const rail = React.useContext(QuestionRailContext);
    const question = rail.questions[index];
    const selection = rail.selections[index] ?? [];
    const status = rowStatus(
      index === rail.currentIndex,
      rail.visited[index] === true,
      selection.length > 0,
    );
    const answer = composeRowAnswerLabel(selection);
    const labelPrefix =
      status === "current"
        ? "Current question"
        : status === "done"
          ? "Edit answer to question"
          : status === "recommended"
            ? "Open recommendation for question"
            : "Skip to question";
    return (
      <TugListRow
        className="dev-question-dialog-row"
        data-status={status}
        aria-current={status === "current" ? "step" : undefined}
        aria-label={`${labelPrefix} ${index + 1}: ${question?.question ?? ""}`}
        leading={
          <span className="dev-question-dialog-row-marker" aria-hidden="true">
            <RowMarker status={status} />
          </span>
        }
      >
        <span className="dev-question-dialog-row-body">
          <span className="dev-question-dialog-row-heading">
            <span className="dev-question-dialog-row-heading-number">
              {index + 1}.
            </span>
            {question?.question ?? ""}
          </span>
          <span
            className="dev-question-dialog-row-answer"
            data-slot="dev-question-dialog-row-answer"
            data-empty={answer === "" ? "true" : undefined}
          >
            → {answer}
          </span>
        </span>
      </TugListRow>
    );
  };

const QUESTION_RAIL_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<QuestionRailDataSource>
> = {
  question: QuestionRailCell,
};

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
      <span className="dev-question-dialog-row-heading-number">
        {index + 1}.
      </span>
      {question.question}
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
    captureState: () => ({ selections, visited, currentIndex }),
  });

  // The rail's list-view plumbing. The data source is row identity
  // only (stable per request); per-render row state reaches the cells
  // through `QuestionRailContext` below. The delegate routes a row
  // activation to the wizard's jump — `handleJump` no-ops on the
  // current row, so clicking it can't strand a pending focus intent.
  const railDataSource = React.useMemo(
    () => new QuestionRailDataSource(questions),
    [questions],
  );

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
          (selections[i]?.length ?? 0) > 0,
      );
    },
    [questions, visited, selections],
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
      markVisited(questionIndex);
    },
    [questions, markVisited],
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
      markVisited(questionIndex);
      armAdvance(questionIndex);
    },
    [questions, markVisited, armAdvance],
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

  // The rail delegate routes through a ref so its identity stays
  // stable while `handleJump` re-binds to the moving `currentIndex`.
  const handleJumpRef = React.useRef(handleJump);
  handleJumpRef.current = handleJump;
  const railDelegate = React.useMemo<TugListViewDelegate>(
    () => ({
      onSelect: (index) => handleJumpRef.current(index),
    }),
    [],
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
    onEscapeDismiss: handleCancel,
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
    const hasQ = questions.length > 0;
    const multi = questions.length > 1;
    const atReview = currentIndex >= questions.length;
    const everyAnswered =
      hasQ && countConfirmedAnswers(selections, visited) === questions.length;

    const buttonRow: string[] = [];
    if (hasQ) {
      buttonRow.push(key(QUESTION_CANCEL_ORDER));
      if (everyAnswered) buttonRow.push(key(QUESTION_SUBMIT_ORDER));
    } else {
      // No questions → a lone "Dismiss" (the Submit stop), always enabled.
      buttonRow.push(key(QUESTION_SUBMIT_ORDER));
    }
    const navRow: string[] = [];
    if (multi) {
      if (currentIndex > 0) navRow.push(key(QUESTION_BACK_ORDER));
      if (!atReview) navRow.push(key(QUESTION_NEXT_ORDER));
    }
    // The options group joins the grid whenever a live question is shown (not at
    // the review step). Same treatment regardless of arity.
    const optionsRow: string[] = [];
    if (hasQ && !atReview) optionsRow.push(key(QUESTION_OPTIONS_ORDER));

    return rowGridOrder([buttonRow, navRow, optionsRow]);
  }, [focusGroup, questions, selections, visited, currentIndex]);
  useSpatialOrder(scopeId, isPending ? spatialOrder : null);

  const manager = useFocusManager();

  // The dialog's keyboard scope ([P16]): a CANCEL_DIALOG responder so Escape /
  // Cmd-. cancel (the bare `popInteractive`, no popover), and a seed that lands
  // the key view on the current question's options on open (answering is the
  // task), or on Submit at the review step.
  const seedAtReview = currentIndex >= questions.length;
  const seedFocusKey =
    questions.length > 0 && !seedAtReview
      ? `${focusGroup}:${QUESTION_OPTIONS_ORDER}`
      : `${focusGroup}:${QUESTION_SUBMIT_ORDER}`;
  const { attachRoot } = useInlineDialogScope({
    active: isPending,
    defaultFocusKey: seedFocusKey,
    onCancel: handleCancel,
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
  // selection has already committed; blink **every selected row's** TINT a couple
  // of times so the eye registers the choice, then advance on the blink's tail.
  // Single-select → one row; multi-select → all checked rows blink together. Runs
  // on `selections` AND `flashTick` so a Return on an already-checked row
  // (selection unchanged) still fires. A no-op for a plain Space toggle (records
  // no pending advance). TugAnimator scales the blink under reduced motion ([D06]).
  //
  // There are no row outlines — the selection tint does the work. The flash
  // pulses each selected row's `background-color` between its resting fill and
  // transparent, so the tint itself blinks. `fill: "none"` reverts each row to its
  // CSS fill afterward, leaving no residue.
  //
  // The row set is driven off the COMMITTED `selections[currentIndex]` — the
  // authoritative answer Return just changed — NOT the DOM's `aria-checked`. The
  // effect runs as a layout effect AFTER the selection-change render commits, so
  // the just-checked row is in `selections` and its DOM fill is already the
  // selected tint: the flash always takes Return's change into account, and only
  // then advances. ([L06] the flash is appearance via DOM/TugAnimator; the
  // selection it reads is data; [L03] layout-effect timing; [L13] TugAnimator.)
  React.useLayoutEffect(() => {
    const pending = pendingAdvanceRef.current;
    if (pending === null) return;
    pendingAdvanceRef.current = null;

    const advance = () => {
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
      // The tint to blink is the row's TARGET selection fill. A row whose
      // selection just changed is mid CSS `background-color` transition (from
      // transparent), so a naive read would catch the in-flight value — the bug
      // where a *changed* row didn't flash but a stays-put one did. Snap past the
      // transition by disabling it for the read, then restore it; the WAAPI flash
      // below overrides the property for its run regardless.
      const prevTransition = row.style.transition;
      row.style.transition = "none";
      const restingFill = getComputedStyle(row).backgroundColor;
      row.style.transition = prevTransition;
      return animate(
        row,
        [
          { backgroundColor: restingFill },
          { backgroundColor: "transparent" },
          { backgroundColor: restingFill },
          { backgroundColor: "transparent" },
          { backgroundColor: restingFill },
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
  }, [selections, flashTick, currentIndex]);

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
  }, [isPending, manager, currentIndex]);

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
          focusGroup={focusGroup}
          focusOrder={QUESTION_CANCEL_ORDER}
          onClick={handleCancelClick}
        >
          Cancel
        </TugPushButton>
      </TugConfirmPopover>
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

  // Composes `TugInlineDialog`'s header-bar primitive. Dialog controls
  // (Cancel / Submit, or just Dismiss when there are no questions)
  // flow into `actions` on the header row. The wizard nav (Back / Next)
  // sits on its own row inside the body slot, between the dialog
  // description and the question rail — close enough to the
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
    <TugInlineDialog
      icon={<MessageCircleQuestion />}
      iconRole="info"
      title={questions.length > 1 ? "Claude has questions" : "Claude has a question"}
      description={dialogDescription}
      actions={dialogActions}
      className={className}
    >
      {wizardSummary !== null ? (
        <div
          className="dev-question-dialog-nav"
          data-slot="dev-question-dialog-nav"
        >
          <span className="dev-question-dialog-nav-summary">
            {wizardSummary}
          </span>
          <div className="dev-question-dialog-nav-buttons">
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
          </div>
        </div>
      ) : null}
      {hasQuestions && single !== null ? (
        // Single-question payload — no rail, no panel, no wizard
        // chrome. The question text is the dialog `description`
        // (above) and the options fill the children slot at full
        // width. No sizers: a single question's options always
        // reflect themselves; there is no second state to absorb.
        <div
          className="dev-question-dialog-questions"
          data-slot="dev-question-dialog-questions"
        >
          <QuestionOptions
            question={single}
            selection={selections[0] ?? []}
            onSelect={(optionLabel) => handleOptionSelect(0, optionLabel)}
            onActivate={(optionLabel) => handleOptionActivate(0, optionLabel)}
            focusGroup={focusGroup}
            focusOrder={QUESTION_OPTIONS_ORDER}
          />
        </div>
      ) : null}
      {hasQuestions && single === null ? (
        <>
          {/* The rail — one TugListRow summary per question, uniform
            * geometry in every status. Row identity lives in the data
            * source; row state reaches the cells via context. No
            * `focusGroup`: the rail is mouse-jump only (keyboard
            * walks Back / Next), so it contributes no Tab stop. */}
          <QuestionRailContext.Provider
            value={{ questions, selections, visited, currentIndex }}
          >
            <TugListView<QuestionRailDataSource>
              dataSource={railDataSource}
              delegate={railDelegate}
              cellRenderers={QUESTION_RAIL_CELL_RENDERERS}
              inline
              className="dev-question-dialog-rail"
              aria-label="Questions"
            />
          </QuestionRailContext.Provider>

          {/* A quiet structural cut between the index (rail) and the
            * working surface (panel) — a full-width hairline, no box. */}
          <TugSeparator className="dev-question-dialog-separator" />

          {/* The stationary panel — the one place options ever
            * render. A CSS grid stacks one hidden, inert sizer per
            * question (heading + options at the panel's own width)
            * under the live face, so the panel holds the tallest
            * question's natural height in every wizard state — no
            * JS measurement, no reflow on advance. The review state
            * swaps the face's content, never the panel's box. */}
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
              </div>
            ))}
          </div>
        </>
      ) : null}
    </TugInlineDialog>
      </div>
    </FocusModeScope>
  );
};
