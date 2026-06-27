/**
 * `TaskInlineToolBlock` — Layer-2 marker for `TaskCreate` and
 * `TaskUpdate` events.
 *
 * The [D100] task list has two complementary surfaces. The TASKS
 * status-bar cell on `Z2` is the canonical surface for *current
 * state* (the assembled list, one fixed glance away). This wrapper
 * is the second surface — a per-call inline marker in the
 * transcript so a reader scrolling back can see *when in the
 * conversation flow* each task action happened. The two surfaces
 * never duplicate work: the cell answers "what's on the list now?";
 * the marker answers "when did this happen?".
 *
 * Conformance posture. The wrapper still opts out of `BlockChrome`
 * — no frame, no status stripe, no error band, no actions cluster
 * — but it borrows the tool-call header's *geometry*: a fixed
 * leading status slot, a one-line box every cross-row item rides,
 * and the header type scale. The result reads in the transcript's
 * row rhythm (so it no longer looks like a different species) while
 * staying lighter than a real tool-call card. The status slot holds
 * a per-state icon rather than the header's animated lifecycle dot:
 * task events are discrete, terminal state changes, not live
 * phases, so a static state glyph reads truer than a pulse — and it
 * keeps task markers visually distinct from the tool calls that
 * keep the dot.
 *
 * Per-event reading. The row is `[icon] Verb subject` — the verb is
 * the bold header "name", the subject the muted detail (the
 * block-header name/detail mapping). The icon carries the state by
 * shape:
 *  - `TaskCreate` → `ListPlus` + `"Created"` + subject (subject is
 *    in the input — narrowed via `narrowTaskCreateInput`).
 *  - `TaskUpdate → in_progress` → `CircleDot` + `"Started"`.
 *  - `TaskUpdate → completed` → `CircleCheck` + `"Completed"`.
 *  - `TaskUpdate → pending` → `RotateCcw` + `"Reset"` (rare —
 *    explicit revert from a non-pending status; defensive coverage
 *    of a valid wire value the design didn't specify a verb for).
 *  - `TaskUpdate` with unknown `taskId` → subject falls back to
 *    `"Task #<taskId>"` (the matching `TaskCreate` may have arrived
 *    out of order in replay; the bare id is the least-misleading
 *    thing we can render).
 *  - Streaming (input still arriving) → `ListChecks` + `"Creating…"`
 *    / `"Updating…"` placeholder, no subject.
 *  - Errored event → `CircleAlert` + error text, both danger-tinted
 *    (`data-tone="danger"`).
 *
 * Why muted-icon, not role-colored. An earlier draft proposed
 * `role="action"` for Created / Started and `role="success"` for
 * Completed — colored accents per event. The audit volume of these
 * events in a real session is high enough (often 8–12 per turn for
 * a multi-task plan) that role-coloring pulls weight away from the
 * TASKS cell. So the state is carried by icon *shape*, not hue: the
 * icon stays muted and the verb reads in the header's normal text
 * tone. Color is reserved for the rare error case, where it earns
 * the visual interrupt.
 *
 * `subject` lookup for `TaskUpdate`. The wire only carries
 * `taskId`. The wrapper resolves `subject` by reading the
 * `useTaskListState(session)` reducer state and indexing by
 * `taskId`. When `session` is unavailable (the gallery card
 * supplies none), the wrapper falls back to the `Task #<id>` form
 * — no React-hook violation because the conditional split happens
 * at the component level (outer routes to an inner component that
 * unconditionally calls the hook), not inside a single component
 * with a conditional hook call.
 *
 * Laws:
 *  - [L02] external state enters React through `useSyncExternalStore`
 *    — via `useTaskListState` (which already conforms).
 *  - [L06] no React state for appearance — every visible variant
 *    is a JSX choice driven by props + the reducer-resolved
 *    subject.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="task-inline-tool-block"`, this module docstring.
 *  - [L20] component-token sovereignty — owns the
 *    `--tugx-task-inline-*` slot family for layout / spacing;
 *    color comes from `TugLabel`'s own role/emphasis tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — but the chrome layer is intentionally
 *    absent here; the wrapper IS the body.
 *  - [D100] two-surface task list — this wrapper is the second
 *    surface (TASKS cell is the first); D100's prose was amended to
 *    acknowledge both.
 *  - [D101] visibility policy — `taskcreate` / `taskupdate` move
 *    from `hidden` to bespoke when this wrapper ships; the policy
 *    entries are removed in the same change.
 *
 * @module components/tugways/cards/blocks/task-inline-tool-block
 */

import "./task-inline-tool-block.css";

import React from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  ListChecks,
  ListPlus,
  RotateCcw,
} from "lucide-react";

import {
  narrowTaskCreateInput,
  narrowTaskUpdateInput,
  type TaskItem,
  type TaskStatus,
} from "@/lib/code-session-store/select-task-list";
import { useTaskListState } from "@/lib/code-session-store/hooks/use-task-list-state";
import type { CodeSessionStore } from "@/lib/code-session-store";

import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Verb derivation
// ---------------------------------------------------------------------------

/** Marker event kind — which Task* tool produced this row. */
export type TaskInlineKind = "create" | "update";

/**
 * Pick the kind from the original tool name. Returns `null` for an
 * unrecognised name (defensive — keeps the wrapper from crashing on
 * a future Task* variant). Case-insensitive.
 *
 * Exported for the gallery card and the tests.
 */
export function deriveTaskInlineKind(toolName: string): TaskInlineKind | null {
  const normalised = toolName.toLowerCase();
  if (normalised === "taskcreate") return "create";
  if (normalised === "taskupdate") return "update";
  return null;
}

// ---------------------------------------------------------------------------
// Label composition — the user-visible string for each event variant.
// Exported as a pure helper so the test suite can pin every branch
// without rendering.
// ---------------------------------------------------------------------------

/**
 * What the marker says for a `TaskCreate` event with subject and
 * status. The status is always the wire's default of `pending` at
 * create time, so the helper takes only the subject.
 */
export function composeCreatedLabel(subject: string): string {
  return `Created: ${subject}`;
}

/**
 * What the marker says for a `TaskUpdate` event. The verb tracks
 * the new status (`Started` for `in_progress`, `Completed` for
 * `completed`, `Reset` for `pending`, `Updated` for any future
 * status), the subject comes from the reducer's lookup, and the
 * helper formats them together.
 */
export function composeUpdatedLabel(
  status: TaskStatus,
  subjectOrId: string,
): string {
  return `${updateVerb(status)}: ${subjectOrId}`;
}

function updateVerb(status: TaskStatus): string {
  switch (status) {
    case "in_progress":
      return "Started";
    case "completed":
      return "Completed";
    case "pending":
      return "Reset";
  }
}

/**
 * The resolved marker state — drives both the per-state icon and
 * (with `verb`) the row's text. A single enum keeps the icon and
 * the verb from drifting: every render reads both off the one
 * `composeMarker` result.
 */
export type TaskMarkerState =
  | "created"
  | "started"
  | "completed"
  | "reset"
  | "creating"
  | "updating"
  | "unknown";

function updateState(status: TaskStatus): TaskMarkerState {
  switch (status) {
    case "in_progress":
      return "started";
    case "completed":
      return "completed";
    case "pending":
      return "reset";
  }
}

/**
 * Resolve a `subject` for a `TaskUpdate`'s `taskId` against the
 * reducer's task list. Falls back to `Task #<taskId>` when the
 * matching `TaskCreate` hasn't been folded yet (the rare replay-
 * out-of-order case).
 *
 * Exported for tests.
 */
export function resolveUpdateSubject(
  taskId: string,
  tasks: readonly TaskItem[],
): string {
  const item = tasks.find((t) => t.taskId === taskId);
  return item !== undefined ? item.subject : `Task #${taskId}`;
}

// ---------------------------------------------------------------------------
// Component — outer / inner split so the optional `session` doesn't
// drive a conditional hook call.
// ---------------------------------------------------------------------------

export const TaskInlineToolBlock: React.FC<ToolBlockProps> = (props) => {
  // Rules-of-hooks discipline: the inner component always calls
  // `useTaskListState` unconditionally. We pick the inner component
  // based on whether `session` is defined, so the chosen subtree's
  // hook chain stays uniform across renders within the same subtree.
  if (props.session !== undefined) {
    return (
      <TaskInlineWithSession
        baseProps={props}
        session={props.session}
      />
    );
  }
  return <TaskInlineRow baseProps={props} tasks={EMPTY_TASKS} />;
};

const EMPTY_TASKS: readonly TaskItem[] = Object.freeze([]);

interface WithSessionProps {
  baseProps: ToolBlockProps;
  session: CodeSessionStore;
}

const TaskInlineWithSession: React.FC<WithSessionProps> = ({
  baseProps,
  session,
}) => {
  const { tasks } = useTaskListState(session);
  return <TaskInlineRow baseProps={baseProps} tasks={tasks} />;
};

interface RowProps {
  baseProps: ToolBlockProps;
  tasks: readonly TaskItem[];
}

/** Source size for every marker glyph — see {@link markerIcon}. */
const MARKER_ICON_SIZE = 16;

/**
 * The per-state glyph. State is carried by *shape*, not color (the
 * icon stays muted via CSS — see "Why muted-icon" in the module
 * docstring); the error glyph is the one exception, danger-tinted
 * via the row's `data-tone`. The streaming / unknown placeholders
 * keep the original `ListChecks` so an in-flight row reads as
 * "a task event, kind not yet known".
 */
function markerIcon(state: TaskMarkerState): React.ReactNode {
  switch (state) {
    case "created":
      return <ListPlus size={MARKER_ICON_SIZE} aria-hidden="true" />;
    case "started":
      return <CircleDot size={MARKER_ICON_SIZE} aria-hidden="true" />;
    case "completed":
      return <CircleCheck size={MARKER_ICON_SIZE} aria-hidden="true" />;
    case "reset":
      return <RotateCcw size={MARKER_ICON_SIZE} aria-hidden="true" />;
    case "creating":
    case "updating":
    case "unknown":
      return <ListChecks size={MARKER_ICON_SIZE} aria-hidden="true" />;
  }
}

const TaskInlineRow: React.FC<RowProps> = ({ baseProps, tasks }) => {
  const { toolName, input, textOutput, status } = baseProps;
  const kind = deriveTaskInlineKind(toolName);

  // Error branch: surface the error text with a danger tint carried
  // by the row's `data-tone` (icon + text both tint via CSS). When
  // `textOutput` is missing on an errored event (rare —
  // `tool_result.is_error` true without an output body), fall back
  // to a generic "Failed" label so the marker isn't a blank danger
  // row. The error text rides the subject slot (it IS the content);
  // there's no verb.
  if (status === "error") {
    const errorText =
      textOutput !== undefined && textOutput.length > 0
        ? textOutput
        : "Failed";
    return (
      <div
        className="task-inline-tool-block"
        data-slot="task-inline-tool-block"
        data-kind={kind ?? undefined}
        data-tone="danger"
      >
        <span className="task-inline-tool-block-icon">
          <CircleAlert size={MARKER_ICON_SIZE} aria-hidden="true" />
        </span>
        <span className="task-inline-tool-block-subject">{errorText}</span>
      </div>
    );
  }

  // Steady / streaming branch — block-header geometry: a leading
  // per-state icon slot, the verb as the bold header "name", and
  // the subject as the muted detail. Placeholder rows (streaming /
  // unknown) carry a verb but no subject.
  const { state, verb, subject } = composeMarker({ kind, input, status, tasks });
  return (
    <div
      className="task-inline-tool-block"
      data-slot="task-inline-tool-block"
      data-kind={kind ?? undefined}
      data-state={state}
    >
      <span className="task-inline-tool-block-icon">{markerIcon(state)}</span>
      <span className="task-inline-tool-block-verb">{verb}</span>
      {subject.length > 0 ? (
        <span className="task-inline-tool-block-subject">{subject}</span>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Marker-text composition — the per-event branching, kept as a pure
// helper so the test suite can pin every label without mounting.
// ---------------------------------------------------------------------------

interface ComposeArgs {
  kind: TaskInlineKind | null;
  input: unknown;
  status: ToolBlockProps["status"];
  tasks: readonly TaskItem[];
}

/** The marker's resolved state + its two text parts. */
export interface TaskMarker {
  state: TaskMarkerState;
  /** The bold header "name" — `Created` / `Started` / a placeholder. */
  verb: string;
  /** The muted detail — the task subject; empty for placeholder rows. */
  subject: string;
}

/**
 * Resolve a non-error event to its state + verb + subject. The one
 * pure surface every non-error row reads: the component maps
 * `state` → icon and renders `verb` + `subject` as the header
 * name + detail. Exported for tests.
 */
export function composeMarker({
  kind,
  input,
  status,
  tasks,
}: ComposeArgs): TaskMarker {
  // Streaming branch — input is still arriving; we may not yet have
  // a subject (TaskCreate) or a taskId (TaskUpdate). Fall back to
  // the streaming placeholder (verb only, no subject).
  if (status === "streaming") {
    if (kind === "create") return { state: "creating", verb: "Creating…", subject: "" };
    if (kind === "update") return { state: "updating", verb: "Updating…", subject: "" };
    return { state: "unknown", verb: "…", subject: "" };
  }
  if (kind === "create") {
    const narrowed = narrowTaskCreateInput(input);
    if (narrowed === undefined) return { state: "creating", verb: "Creating…", subject: "" };
    return { state: "created", verb: "Created", subject: narrowed.subject };
  }
  if (kind === "update") {
    const narrowed = narrowTaskUpdateInput(input);
    if (narrowed === undefined) return { state: "updating", verb: "Updating…", subject: "" };
    const subject = resolveUpdateSubject(narrowed.taskId, tasks);
    return { state: updateState(narrowed.status), verb: updateVerb(narrowed.status), subject };
  }
  // Defensive — an unrecognised kind shouldn't reach here, but the
  // wrapper renders a neutral placeholder rather than crashing.
  return { state: "unknown", verb: "Task event", subject: "" };
}

/**
 * The marker's visible text as one string (`"Verb: subject"`, or
 * just the verb for a placeholder row). Derived from
 * {@link composeMarker} so the verb words have one source. Exported
 * for tests.
 */
export function composeMarkerText(args: ComposeArgs): string {
  const { verb, subject } = composeMarker(args);
  return subject.length > 0 ? `${verb}: ${subject}` : verb;
}
