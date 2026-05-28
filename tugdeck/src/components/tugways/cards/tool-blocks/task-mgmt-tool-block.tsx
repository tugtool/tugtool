/**
 * `TaskMgmtToolBlock` — Layer-2 wrapper for the four background-task
 * management tools: `TaskList`, `TaskGet`, `TaskOutput`, `TaskStop`.
 *
 * These tools control Anthropic's *background-task* family — long-
 * running shell tasks, async agents, and remote sessions that the
 * assistant launched and now wants to inspect, drain, or terminate.
 * This is a **distinct surface** from the user-task list ([D100],
 * `TaskCreate` / `TaskUpdate`), and the wrapper's header reinforces
 * the distinction by prefixing every verb with `Background Task ·`
 * (so a reader scanning the transcript never confuses a background-
 * task `list` with the [D100] user-task list, which never paints
 * inline anyway).
 *
 * Volume is low across the family (TaskList 0.05%, TaskOutput 0.06%,
 * TaskStop 0.01% per the audit), so one wrapper handling all four
 * verbs at the right granularity. The four resolve through the
 * dispatch's `TOOL_ALIASES` map (`tasklist → taskmgmt`, etc.) to
 * the canonical `taskmgmt` registry name; the wrapper branches on
 * the original `toolName` to pick the verb and the body shape.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `ToolBlockChrome` owns the frame: a `ListTodo` icon + a
 *    composed tool-name string (`Background Task · list` /
 *    `Background Task · get` / `Background Task · output` /
 *    `Background Task · stop`), the status stripe, the inline
 *    `DevCautionBadge` (when the dispatch flagged drift), and
 *    the error band.
 *  - **Header** — the verb-qualified name above; the chrome's args
 *    slot carries `#<taskId>` when an id is in the input (every
 *    verb except `list` takes one). The id-prefixed args slot keeps
 *    the row scannable as a single unit (`Background Task · get
 *    #abc123`).
 *  - **Body — per-verb branch** (each body branch composes shared
 *    `body-bits/` primitives — see conformance item 10):
 *      - `list`   → result tail via `ToolBlockPre` (3-line preview
 *        + `ToolBlockDisclosure` for earlier lines when the result
 *        is longer). No input fields — `TaskList` takes none.
 *      - `get`    → `id: #<taskId>` `ToolBlockFieldRow` + result
 *        via `ToolBlockPre` (status + 1-line summary fall out of
 *        the raw text).
 *      - `output` → `id: #<taskId>` row + optional `block:` /
 *        `timeout:` rows + tailed output via `ToolBlockPre` +
 *        `ToolBlockDisclosure` (same shape as `Monitor` — the
 *        stdout-tail problem is the same).
 *      - `stop`   → `id: #<taskId>` row + result via
 *        `ToolBlockFieldRow` (status is typically a short string —
 *        `"stopped"` / `"already exited"`).
 *
 * Streaming / error (Spec S03):
 *  - `status === "streaming"` → header shows the verb (always
 *    known from `toolName`) and the id when arrived; body is the
 *    shared `StreamingPlaceholder`.
 *  - `status === "error"` → chrome paints the error band from
 *    `textOutput`; body still renders the input rows (diagnostic
 *    context — "this stop failed against id X").
 *  - `status === "ready"` → header + per-verb body.
 *
 * Laws:
 *  - [L06] no React state for appearance — every render branch is
 *    a pure derivation from props.
 *  - [L19] `data-slot="task-mgmt-tool-block"` (delegated via the
 *    chrome's `rootSlot`). No paired `.css` file: like Worktree,
 *    after the body-bits refactor this wrapper has zero wrapper-
 *    local styles — every visible rule lives in `tool-block-chrome.css`
 *    (the frame) or `body-bits/*.css` (the body shape). The
 *    `.tsx` + `.css` pair convention is "pair when you own
 *    styles"; this wrapper owns none.
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the
 *    body-bits' shared layout values; introduces no new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — the wrapper owns chrome; the body
 *    composes `body-bits/` primitives over `TugLabel` / `<code>`.
 *  - [D16] tool-name aliasing — all four wire names resolve
 *    through `TOOL_ALIASES` to the canonical `taskmgmt`; the
 *    wrapper branches on `toolName` to pick the verb and body
 *    shape.
 *  - [D100] cross-link — this family is *separate* from the user-
 *    task list whose canonical surface is the TASKS status-bar
 *    cell. The `Background Task ·` header prefix is the visible
 *    disambiguation.
 *  - [D101] visibility policy — `tasklist` / `taskget` /
 *    `taskoutput` / `taskstop` move from `default-intent` to
 *    bespoke once this wrapper ships; all four policy entries
 *    are removed in the same change.
 *
 * @module components/tugways/cards/tool-blocks/task-mgmt-tool-block
 */

import React from "react";
import { ListTodo } from "lucide-react";

import { TugTooltip } from "@/components/tugways/tug-tooltip";

import {
  ToolBlockBody,
  ToolBlockDisclosure,
  ToolBlockFieldRow,
  ToolBlockPre,
} from "./body-bits";
import { StreamingPlaceholder, ToolBlockChrome } from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowing — the four tools have different input shapes; the
// wrapper supports the union of recognised fields and degrades
// gracefully when something else arrives.
// ---------------------------------------------------------------------------

/**
 * Background-task management tool input (from `tool_use.input`),
 * narrowed across all four wire variants:
 *
 *  - `TaskList`   carries no recognised fields.
 *  - `TaskGet`    carries `{ taskId }` (camelCase).
 *  - `TaskOutput` carries `{ task_id, block, timeout }` (snake_case
 *    `task_id`).
 *  - `TaskStop`   carries `{ task_id }` (preferred) or `{ shell_id }`
 *    (legacy, accepted defensively).
 *
 * The narrowed shape normalises every id field into `taskId` so the
 * body and header helpers only have one field to read.
 */
export interface TaskMgmtToolInput {
  /** Normalised task identifier — drawn from `taskId` / `task_id` / `shell_id`. */
  taskId?: string;
  /** TaskOutput only — whether the call blocks for completion. */
  block?: boolean;
  /** TaskOutput only — max wait time in milliseconds. */
  timeout?: number;
}

/**
 * Narrow the wrapper-side `unknown` input to `TaskMgmtToolInput`.
 * Defensive: returns `{}` for non-object inputs, drops mistyped
 * fields silently. The id-field coalescing reads `taskId` first
 * (the camelCase preferred form), then `task_id` (TaskOutput /
 * TaskStop wire), then `shell_id` (TaskStop legacy) — first hit
 * wins.
 */
export function narrowTaskMgmtInput(value: unknown): TaskMgmtToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const taskId =
    typeof v.taskId === "string" && v.taskId.length > 0
      ? v.taskId
      : typeof v.task_id === "string" && v.task_id.length > 0
        ? v.task_id
        : typeof v.shell_id === "string" && v.shell_id.length > 0
          ? v.shell_id
          : undefined;
  return {
    taskId,
    block: typeof v.block === "boolean" ? v.block : undefined,
    timeout: typeof v.timeout === "number" ? v.timeout : undefined,
  };
}

// ---------------------------------------------------------------------------
// Verb derivation
// ---------------------------------------------------------------------------

/**
 * Background-task action verb — `list`, `get`, `output`, or `stop`.
 * Returned by `deriveTaskMgmtVerb` from the original `toolName`
 * and used to compose both the header label and the body shape.
 */
export type TaskMgmtVerb = "list" | "get" | "output" | "stop";

/**
 * Pick the verb from the original tool name. Returns `null` when
 * the name is none of the four (defensive — keeps the wrapper from
 * crashing on an unexpected alias). Case-insensitive and tolerant
 * of underscore / hyphen separators, because the wire name's casing
 * has historically varied (`TaskList` / `task_list` / `tasklist`).
 *
 * Exported for the gallery card and the tests.
 */
export function deriveTaskMgmtVerb(toolName: string): TaskMgmtVerb | null {
  const normalised = toolName.toLowerCase().replace(/[_-]/g, "");
  if (normalised === "tasklist") return "list";
  if (normalised === "taskget") return "get";
  if (normalised === "taskoutput") return "output";
  if (normalised === "taskstop") return "stop";
  return null;
}

// ---------------------------------------------------------------------------
// Header composition
// ---------------------------------------------------------------------------

/**
 * Compose the chrome's `toolName` string — the header reads as
 * `Background Task · list` / `Background Task · get` /
 * `Background Task · output` / `Background Task · stop`. Done
 * here, not in the chrome, because both the prefix and the verb
 * are wrapper-specific knowledge.
 *
 * The `Background Task` prefix is the visible disambiguation
 * from the [D100] user-task list — the TASKS status-bar cell is
 * the canonical surface for that family.
 */
export function composeTaskMgmtToolName(verb: TaskMgmtVerb | null): string {
  if (verb === null) return "Background Task";
  return `Background Task · ${verb}`;
}

/**
 * Compose the chrome's args-summary label — the `#<id>` fragment
 * that rides next to the header verb when a task id is present.
 * Returns `undefined` for `list` (no id) and for any verb whose
 * input arrived without a recognisable id field yet (early in
 * streaming).
 *
 * Exported for the gallery card and the tests.
 */
export function composeTaskMgmtArgsLabel(
  verb: TaskMgmtVerb | null,
  input: TaskMgmtToolInput,
): { label: string } | undefined {
  if (verb === "list" || verb === null) return undefined;
  if (input.taskId === undefined) return undefined;
  return { label: `#${input.taskId}` };
}

// ---------------------------------------------------------------------------
// Output tail composition — the same head/tail split `MonitorToolBlock`
// uses, re-derived locally so neither wrapper depends on the other.
// The pattern is small enough that Rule-of-Three deferral makes more
// sense than an early shared extraction — if a third wrapper grows the
// same need, this helper plus Monitor's lift cleanly into `body-bits/`.
// ---------------------------------------------------------------------------

/**
 * How many trailing output lines the body shows by default. Matched
 * to `MonitorToolBlock`'s `TAIL_LINE_COUNT` (3) so the two stdout-
 * tail surfaces feel consistent in the transcript — a user scanning
 * across both shouldn't have to retune their expectation of "how
 * much tail do I see by default."
 */
export const TASK_OUTPUT_TAIL_LINE_COUNT = 3;

/** Result of splitting an output string into earlier-head + visible-tail. */
export interface TaskOutputTailComposition {
  head: string;
  tail: string;
  droppedLineCount: number;
}

/**
 * Split `output` into the dropped-head prefix and the visible tail.
 * `droppedLineCount` is `0` when the whole output fits in the tail
 * (no `<details>` collapse needed). Trailing empty lines from a
 * newline-terminated buffer are preserved — they're load-bearing
 * for whitespace-significant output. Returns `null` for absent /
 * empty output.
 *
 * Exported for tests.
 */
export function composeTaskOutputTail(
  output: string | undefined,
  tailCount: number = TASK_OUTPUT_TAIL_LINE_COUNT,
): TaskOutputTailComposition | null {
  if (output === undefined || output.length === 0) return null;
  const lines = output.split("\n");
  const effectiveLines =
    lines.length > 0 && lines[lines.length - 1] === ""
      ? lines.slice(0, -1)
      : lines;
  if (effectiveLines.length <= tailCount) {
    return { head: "", tail: output, droppedLineCount: 0 };
  }
  const dropCount = effectiveLines.length - tailCount;
  const head = effectiveLines.slice(0, dropCount).join("\n");
  const tail = effectiveLines.slice(dropCount).join("\n");
  return { head, tail, droppedLineCount: dropCount };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TaskMgmtToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  textOutput,
  status,
  caution,
}) => {
  const mgmtInput = React.useMemo(
    () => narrowTaskMgmtInput(input),
    [input],
  );
  const verb = deriveTaskMgmtVerb(toolName);
  const composedToolName = composeTaskMgmtToolName(verb);
  const argsLabel = composeTaskMgmtArgsLabel(verb, mgmtInput);

  const argsSummary = argsLabel !== undefined ? (
    <TugTooltip content={argsLabel.label} side="bottom" truncated>
      <code data-slot="task-mgmt-tool-block-target">{argsLabel.label}</code>
    </TugTooltip>
  ) : undefined;

  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <ToolBlockPre>{textOutput}</ToolBlockPre>
    ) : undefined;

  const tail = React.useMemo(
    () => composeTaskOutputTail(textOutput),
    [textOutput],
  );

  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else {
    body = renderTaskMgmtBody({ verb, input: mgmtInput, textOutput, tail });
  }

  // Default-folded body: the assistant's prose summary that follows
  // typically restates the tool result, so the chrome-level fold lets
  // the prose read as primary with the raw block one click away. Skip
  // the affordance for streaming (the placeholder is the body) and
  // when there's no body to fold in the first place.
  const hasBody = body !== null;
  const fold = hasBody && status !== "streaming"
    ? {
        defaultFolded: true,
        preservationKey: `task-mgmt-tool-block/${toolUseId}/fold`,
        collapsedLabel: composeTaskMgmtCollapsedLabel(verb),
      }
    : undefined;
  // Copy collects the result text the user sees in the body. Empty
  // when the tool didn't return anything readable.
  const copyText =
    textOutput !== undefined && textOutput.length > 0
      ? textOutput
      : undefined;

  return (
    <ToolBlockChrome
      rootSlot="task-mgmt-tool-block"
      toolName={composedToolName}
      toolIcon={<ListTodo size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
      fold={fold}
      copyText={copyText}
    >
      {body}
    </ToolBlockChrome>
  );
};

/**
 * Compose the chrome's fold-cue collapsed-state label. Per-verb so a
 * scanner sees what they're expanding before they click; the verb-
 * specific noun (`result` for list, `details` for get, `output` for
 * output, `status` for stop) reads as the body's content, not just
 * a generic "expand."
 */
export function composeTaskMgmtCollapsedLabel(
  verb: TaskMgmtVerb | null,
): string {
  if (verb === null) return "details";
  switch (verb) {
    case "list":
      return "result";
    case "get":
      return "details";
    case "output":
      return "output";
    case "stop":
      return "status";
  }
}

// ---------------------------------------------------------------------------
// Per-verb body rendering — kept inline (a single switch) so a reader
// scanning this file sees all four body shapes side by side. Each
// branch is intentionally tiny (≤ 30 lines per the plan).
// ---------------------------------------------------------------------------

interface RenderBodyArgs {
  verb: TaskMgmtVerb | null;
  input: TaskMgmtToolInput;
  textOutput: string | undefined;
  tail: TaskOutputTailComposition | null;
}

function renderTaskMgmtBody({
  verb,
  input,
  textOutput,
  tail,
}: RenderBodyArgs): React.ReactNode {
  if (verb === null) return null;
  switch (verb) {
    case "list":
      return renderListBody(tail);
    case "get":
      return renderGetBody(input, textOutput);
    case "output":
      return renderOutputBody(input, tail);
    case "stop":
      return renderStopBody(input, textOutput);
  }
}

function renderListBody(
  tail: TaskOutputTailComposition | null,
): React.ReactNode {
  if (tail === null) return null;
  return (
    <ToolBlockBody>
      <TailedOutput tail={tail} slot="task-mgmt-tool-block-list-output" />
    </ToolBlockBody>
  );
}

function renderGetBody(
  input: TaskMgmtToolInput,
  textOutput: string | undefined,
): React.ReactNode {
  const hasId = input.taskId !== undefined;
  const hasResult = textOutput !== undefined && textOutput.length > 0;
  if (!hasId && !hasResult) return null;
  return (
    <ToolBlockBody>
      {hasId ? (
        <ToolBlockFieldRow label="id">
          <code>{`#${input.taskId}`}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasResult ? (
        <ToolBlockFieldRow label="result" layout="stacked">
          <ToolBlockPre>{textOutput}</ToolBlockPre>
        </ToolBlockFieldRow>
      ) : null}
    </ToolBlockBody>
  );
}

function renderOutputBody(
  input: TaskMgmtToolInput,
  tail: TaskOutputTailComposition | null,
): React.ReactNode {
  const hasId = input.taskId !== undefined;
  const hasBlock = input.block !== undefined;
  const hasTimeout = input.timeout !== undefined;
  const hasTail = tail !== null;
  if (!hasId && !hasBlock && !hasTimeout && !hasTail) return null;
  return (
    <ToolBlockBody>
      {hasId ? (
        <ToolBlockFieldRow label="id">
          <code>{`#${input.taskId}`}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasBlock ? (
        <ToolBlockFieldRow label="block">
          <code>{String(input.block)}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasTimeout ? (
        <ToolBlockFieldRow label="timeout">
          <code>{`${input.timeout}ms`}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasTail ? (
        <TailedOutput
          tail={tail as TaskOutputTailComposition}
          slot="task-mgmt-tool-block-output-output"
        />
      ) : null}
    </ToolBlockBody>
  );
}

function renderStopBody(
  input: TaskMgmtToolInput,
  textOutput: string | undefined,
): React.ReactNode {
  const hasId = input.taskId !== undefined;
  const trimmedResult =
    textOutput !== undefined ? textOutput.trim() : undefined;
  const hasShortStatus =
    trimmedResult !== undefined &&
    trimmedResult.length > 0 &&
    !trimmedResult.includes("\n");
  const hasMultilineResult =
    trimmedResult !== undefined &&
    trimmedResult.length > 0 &&
    trimmedResult.includes("\n");
  if (!hasId && !hasShortStatus && !hasMultilineResult) return null;
  return (
    <ToolBlockBody>
      {hasId ? (
        <ToolBlockFieldRow label="id">
          <code>{`#${input.taskId}`}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasShortStatus ? (
        <ToolBlockFieldRow label="status">
          <code>{trimmedResult}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasMultilineResult ? (
        <ToolBlockFieldRow label="status" layout="stacked">
          <ToolBlockPre>{textOutput}</ToolBlockPre>
        </ToolBlockFieldRow>
      ) : null}
    </ToolBlockBody>
  );
}

// ---------------------------------------------------------------------------
// TailedOutput — shared stdout tail with optional earlier-history
// disclosure. The same shape `MonitorToolBlock` uses, kept private to
// this module to avoid cross-wrapper coupling (Rule of Three deferral).
// ---------------------------------------------------------------------------

interface TailedOutputProps {
  tail: TaskOutputTailComposition;
  slot: string;
}

const TailedOutput: React.FC<TailedOutputProps> = ({ tail, slot }) => (
  <div data-slot={slot}>
    {tail.droppedLineCount > 0 ? (
      <ToolBlockDisclosure
        summary={`show ${tail.droppedLineCount} earlier ${
          tail.droppedLineCount === 1 ? "line" : "lines"
        }`}
      >
        <ToolBlockPre>{tail.head}</ToolBlockPre>
      </ToolBlockDisclosure>
    ) : null}
    <ToolBlockPre>{tail.tail}</ToolBlockPre>
  </div>
);
