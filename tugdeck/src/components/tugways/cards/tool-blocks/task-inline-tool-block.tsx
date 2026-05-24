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
 * Conformance deviation (intentional). This is the first wrapper to
 * opt out of `ToolBlockChrome`. No frame, no status stripe, no
 * error band, no actions cluster. A `ListChecks` icon plus a single
 * `TugLabel` row, sized to read as ambient conversation-flow
 * annotation rather than another tool-call card. Putting the
 * `Background Task ·`-style chrome around these would fight the
 * TASKS cell for the user's attention — the cell is primary, the
 * marker is ambient.
 *
 * Per-event reading (label text + icon carry the meaning; color is
 * uniform — see "Why calm-uniform" below):
 *  - `TaskCreate` → `"Created: <subject>"` (subject is in the
 *    input — narrowed via `narrowTaskCreateInput`).
 *  - `TaskUpdate → in_progress` → `"Started: <subject>"`.
 *  - `TaskUpdate → completed` → `"Completed: <subject>"`.
 *  - `TaskUpdate → pending` → `"Reset: <subject>"` (rare —
 *    explicit revert from a non-pending status; defensive coverage
 *    of a valid wire value the design didn't specify a verb for).
 *  - `TaskUpdate` with unknown `taskId` → falls back to
 *    `"<Verb>: Task #<taskId>"` (the matching `TaskCreate` may
 *    have arrived out of order in replay; the bare id is the
 *    least-misleading thing we can render).
 *  - Streaming (input still arriving) → `"Creating…"` /
 *    `"Updating…"` placeholder, calm treatment.
 *  - Errored event → error text + `role="danger"` +
 *    `emphasis="normal"` (drop calm so the danger color reads
 *    cleanly — `calm`'s `color:` would otherwise override the
 *    role tint).
 *
 * Why calm-uniform, not role-colored. An earlier draft proposed
 * `role="action"` for Created / Started and `role="success"` for
 * Completed — colored accents per event. The audit volume of these
 * events in a real session is high enough (often 8–12 per turn for
 * a multi-task plan) that role-coloring pulls weight away from the
 * TASKS cell. `emphasis="calm"` keeps every row visually
 * subordinate to the cell. Color is reserved for the rare error
 * case, where it earns the visual interrupt.
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
 * @module components/tugways/cards/tool-blocks/task-inline-tool-block
 */

import "./task-inline-tool-block.css";

import React from "react";
import { ListChecks } from "lucide-react";

import { TugLabel } from "@/components/tugways/tug-label";
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

const TaskInlineRow: React.FC<RowProps> = ({ baseProps, tasks }) => {
  const { toolName, input, textOutput, status } = baseProps;
  const kind = deriveTaskInlineKind(toolName);

  // Error branch: surface the error text with a danger tint. Drop
  // calm so the role's text color reads cleanly (calm's `color:`
  // rule would otherwise win in the cascade). When `textOutput` is
  // missing on an errored event (rare — `tool_result.is_error` true
  // without an output body), fall back to a generic "Failed" label
  // so the marker isn't a blank danger row.
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
        <ListChecks
          size={14}
          aria-hidden="true"
          className="task-inline-tool-block-icon"
        />
        <TugLabel size="sm" role="danger" emphasis="normal">
          {errorText}
        </TugLabel>
      </div>
    );
  }

  // Calm-uniform branch — every non-error event reads as ambient
  // annotation. The label text varies; the visual treatment does
  // not.
  const labelText = composeMarkerText({ kind, input, status, tasks });
  return (
    <div
      className="task-inline-tool-block"
      data-slot="task-inline-tool-block"
      data-kind={kind ?? undefined}
    >
      <ListChecks
        size={14}
        aria-hidden="true"
        className="task-inline-tool-block-icon"
      />
      <TugLabel size="sm" emphasis="calm">
        {labelText}
      </TugLabel>
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

/**
 * Compose the marker's visible text for a non-error event.
 * Exported for tests.
 */
export function composeMarkerText({
  kind,
  input,
  status,
  tasks,
}: ComposeArgs): string {
  // Streaming branch — input is still arriving; we may not yet
  // have a subject (TaskCreate) or a taskId (TaskUpdate). Fall back
  // to the streaming placeholder. The calm treatment is the same
  // as the steady-state row.
  if (status === "streaming") {
    if (kind === "create") return "Creating…";
    if (kind === "update") return "Updating…";
    return "…";
  }
  if (kind === "create") {
    const narrowed = narrowTaskCreateInput(input);
    if (narrowed === undefined) return "Creating…";
    return composeCreatedLabel(narrowed.subject);
  }
  if (kind === "update") {
    const narrowed = narrowTaskUpdateInput(input);
    if (narrowed === undefined) return "Updating…";
    const subject = resolveUpdateSubject(narrowed.taskId, tasks);
    return composeUpdatedLabel(narrowed.status, subject);
  }
  // Defensive — an unrecognised kind shouldn't reach here, but the
  // wrapper renders a neutral placeholder rather than crashing.
  return "Task event";
}
