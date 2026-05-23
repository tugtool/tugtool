/**
 * `TodoWriteToolBlock` — Layer-2 wrapper for Claude Code's TodoWrite
 * tool.
 *
 * Composes `ToolWrapperChrome` (header / status / error band) around
 * an `embedded` `TodoListBlock` body kind. Per [Spec S03] /
 * [#bk-conformance]:
 *
 *   - **Header:** checklist icon + tool name + an args summary that
 *     carries the per-status counts and a thin progress bar. The
 *     progress bar tracks `completed / total`; in-progress items
 *     intentionally do not count as partial credit (the summary
 *     beside the bar already names them, and "share of finished
 *     work" matches the assistant's mental model and the spoken
 *     summary).
 *   - **Body:** `TodoListBlock` composed `embedded={true}` — the
 *     wrapper chrome owns identity, so the body kind's standalone
 *     header is suppressed and its Copy affordance portals into the
 *     chrome's actions slot.
 *
 * Wire shape (`tool_use.input`): `{ todos: [{ content, status,
 * activeForm? }] }`. TodoWrite has no `structured_result` — the
 * input itself is the canonical list — so the wrapper narrows
 * `input` directly via {@link narrowTodoListData} (re-exported from
 * the body kind). A successful TodoWrite call's `tool_result.output`
 * is "Todos have been modified successfully" boilerplate and carries
 * no rendered information; we don't surface it.
 *
 * Streaming / error:
 *   - `status === "streaming"` → header shows the tool name and
 *     whatever input fragment has arrived (typically an empty
 *     `todos[]` until the close-bracket arrives); body is
 *     `<StreamingPlaceholder />`.
 *   - `status === "error"` → chrome paints the error band from the
 *     plain-text `tool_result.output`; the body is dropped.
 *   - `status === "ready"` → steady-state render with the full list.
 *
 * Registration: `tide-assistant-renderer-dispatch.ts` imports this
 * module and calls `registerToolWrapper("todowrite", TodoWriteToolBlock)`
 * from its own bottom-of-file initialization. The wire-shape tool name
 * is `TodoWrite`; the registry lowercases on insertion + resolution
 * so casing is handled uniformly.
 *
 * Laws:
 *  - [L06] no React state for appearance; chrome owns DOM attributes;
 *    body composition is pure props derived via `useMemo`.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="todo-write-tool-block"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the body's
 *    `--tugx-todo-*`; wrapper-local progress-bar slots live under
 *    `--tugx-todo-progress-*` in this file's CSS body{}. No new
 *    cross-file token surface.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — body kind owns list rendering, wrapper
 *    owns chrome (counts + progress).
 *
 * @module components/tugways/cards/tool-wrappers/todo-write-tool-block
 */

import "./todo-write-tool-block.css";

import React from "react";
import { ListChecks } from "lucide-react";

import {
  TodoListBlock,
  composeTodoSummary,
  countTodos,
  narrowTodoListData,
  todoProgressFraction,
  type TodoItem,
  type TodoListData,
} from "@/components/tugways/body-kinds/todo-list-block";

import {
  StreamingPlaceholder,
  ToolWrapperChrome,
} from "./tool-wrapper-chrome";
import type { ToolWrapperProps } from "./types";

/**
 * TodoWrite tool input — the wire fields under `tool_use.input`.
 * Re-exported here as a convenience for tests; production wrappers
 * narrow via {@link narrowTodoListData} from the body kind.
 */
export type TodoWriteInput = TodoListData;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TodoWriteToolBlock: React.FC<ToolWrapperProps> = ({
  toolName,
  input,
  textOutput,
  status,
  caution,
}) => {
  const todoData = React.useMemo(() => narrowTodoListData(input), [input]);
  const todos = todoData?.todos ?? EMPTY_TODOS;
  const counts = React.useMemo(() => countTodos(todos), [todos]);
  const summary = composeTodoSummary(counts);
  const progress = todoProgressFraction(counts);
  const progressPercent = Math.round(progress * 100);

  // ---- Header args — counts beside a thin progress bar ----------------
  //
  // The bar is purely a visual; the textual summary is the source of
  // truth for screen readers (the bar carries `aria-hidden`). When the
  // list is empty (streaming-pre-input or genuinely empty) the bar is
  // omitted so the header doesn't read as "0% done" before the user
  // ever saw a list.
  const argsSummary =
    counts.total === 0 ? undefined : (
      <span className="todo-write-tool-block-args">
        <span
          className="todo-write-tool-block-summary"
          data-slot="todo-write-tool-block-summary"
        >
          {summary}
        </span>
        <span
          className="todo-write-tool-block-progress"
          data-slot="todo-write-tool-block-progress"
          data-complete={counts.total > 0 && counts.completed === counts.total ? "true" : undefined}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={counts.total}
          aria-valuenow={counts.completed}
          aria-label={`${progressPercent}% of todos complete`}
        >
          <span
            className="todo-write-tool-block-progress-fill"
            style={{ width: `${progressPercent}%` }}
            aria-hidden="true"
          />
        </span>
      </span>
    );

  // ---- Body — streaming placeholder / error path / embedded list ------
  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else if (status === "error") {
    body = null;
  } else if (todoData !== undefined && todoData.todos.length > 0) {
    body = (
      <TodoListBlock
        data={todoData}
        embedded
        className="todo-write-tool-block-list"
      />
    );
  } else {
    body = null;
  }

  // Errored calls carry the failure message in `textOutput` — route it
  // to the chrome's error band rather than the body.
  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="todo-write-tool-block-error-output">{textOutput}</span>
    ) : undefined;

  return (
    <ToolWrapperChrome
      rootSlot="todo-write-tool-block"
      toolName={toolName}
      toolIcon={<ListChecks size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolWrapperChrome>
  );
};

/** Stable empty-array sentinel so the empty-data path doesn't create a
 *  fresh `[]` per render. */
const EMPTY_TODOS: readonly TodoItem[] = Object.freeze([]);
