/**
 * `TodoListBlock` — Layer-1 body kind for a Claude Code TodoWrite list.
 *
 * A list-shaped body kind ([#bk-conformance] item 9): rows are
 * rendered via `TugListView` (in `inline` mode for now — Claude Code
 * Todo lists are typically a handful of items, occasionally a few
 * dozen; the row count never warrants windowing in practice). Building
 * on `TugListView` anyway keeps the data-source contract and cell
 * vocabulary in step with the other list-shaped body kinds
 * (`PathListBlock`, `SearchResultBlock`), so a future windowing
 * opt-in is a flip of one prop.
 *
 * Composition (mirrors `PathListBlock`):
 *  - Header (standalone only) — an optional identity `label`, the
 *    item-count summary, and a trailing actions cluster (Copy). In
 *    `embedded` mode the header is suppressed and the cluster portals
 *    into the host `ToolBlockChrome`'s actions slot.
 *  - Body — a `TugListView` in `inline` mode. The block grows to its
 *    natural height and the outer transcript scrolls; no inner
 *    scroller. Each row is `[status-icon] [text]` with the status
 *    driving the icon, text decoration, and (for `in_progress`) the
 *    activeForm rendering.
 *
 * Status states:
 *  - `pending` — circle icon; default colour.
 *  - `in_progress` — spinner-style icon; **highlighted** background
 *    band so the active task is immediately distinguishable. The row
 *    renders `activeForm` (present-continuous, e.g. "Running tests")
 *    when present; otherwise falls back to `content`.
 *  - `completed` — check icon; strikethrough text + muted colour so
 *    finished work fades into the row history.
 *
 * What this body kind does NOT do:
 *  - Render a text-entry / edit surface. A card has at most one
 *    text-entry surface ([#bk-conformance] item 2); editing a Todo is
 *    the assistant's job, not the renderer's. TodoListBlock renders
 *    zero `<input>` / `<textarea>` elements.
 *  - Persist the list itself — the wire shape is the source of truth.
 *    Layout state (none today) would persist through `[A9]` if added.
 *  - Animate transitions between status changes — the next reducer
 *    snapshot remounts the row with its new status; that's enough.
 *
 * Laws:
 *  - [L06] no React state for visual state — status colours / text
 *    decoration are pure CSS keyed off the row's `data-status`.
 *  - [L11] no responder; Copy is a `BlockCopyButton` (self-contained
 *    control).
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="todo-list-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns `--tugx-todo-*`;
 *    consumes `--tugx-block-*` for the shared block scaffold.
 *
 * Decisions:
 *  - [D05] two-layer split: this body kind owns the list rendering;
 *    `TodoWriteToolBlock` owns chrome (counts + progress bar).
 *
 * @module components/tugways/body-kinds/todo-list-block
 */

import "./todo-list-block.css";

import React from "react";
import { createPortal } from "react-dom";
import { Check, Circle, Loader2 } from "lucide-react";

import { useChromeActionsTarget } from "@/components/tugways/cards/tool-blocks/tool-block-chrome";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
} from "@/components/tugways/tug-list-view";

import { BlockActionsCluster, BlockCopyButton } from "./affordances";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One Todo item — the wire shape Claude Code emits inside
 * `tool_use.input.todos[]`. `content` is the imperative form
 * ("Run tests"); `activeForm` is the present-continuous variant
 * ("Running tests") surfaced while the item is `in_progress`.
 */
export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

/** Lifecycle of one Todo per Claude Code's vocabulary. */
export type TodoStatus = "pending" | "in_progress" | "completed";

/** Structured Todo list — the body's render input. */
export interface TodoListData {
  todos: readonly TodoItem[];
}

export interface TodoListBlockProps {
  /**
   * The Todo list data. When undefined (or `todos` is empty) the block
   * renders an empty `data-slot="todo-list-body"` marker for layout
   * consistency.
   */
  data?: TodoListData;

  /**
   * Optional identity label shown at the leading edge of the
   * standalone header. Ignored in `embedded` mode — the host owns
   * identity there.
   */
  label?: string;

  /**
   * "Embedded" mode — composed inside a host that already paints a
   * container and a header (e.g. `ToolBlockChrome` in
   * `TodoWriteToolBlock`). When `true` the standalone frame +
   * header are dropped and the actions cluster portals into the
   * host chrome's actions slot. MUST be used under a
   * `ToolBlockChrome`.
   *
   * @default false
   */
  embedded?: boolean;

  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported because tests pin them
// ---------------------------------------------------------------------------

/** Per-status counts derived from a Todo array. */
export interface TodoCounts {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
}

/**
 * Tally Todos by status. Items whose `status` falls outside the
 * known vocabulary count toward `total` but not toward any bucket,
 * so the counts always sum to ≤ `total` — drift surfaces visibly
 * (the progress bar doesn't lie about progress).
 */
export function countTodos(todos: readonly TodoItem[]): TodoCounts {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  for (const t of todos) {
    if (t.status === "pending") pending += 1;
    else if (t.status === "in_progress") inProgress += 1;
    else if (t.status === "completed") completed += 1;
  }
  return { total: todos.length, pending, inProgress, completed };
}

/**
 * Compose a one-liner summary of the counts for the wrapper header.
 * Format: `"3 done, 1 in progress, 2 pending"` — drops zero buckets so
 * the summary stays short. Returns the empty string when the list is
 * empty (caller decides whether to render a placeholder).
 */
export function composeTodoSummary(counts: TodoCounts): string {
  if (counts.total === 0) return "";
  const parts: string[] = [];
  if (counts.completed > 0) parts.push(`${counts.completed} done`);
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`);
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  return parts.join(", ");
}

/**
 * Progress fraction in `[0, 1]` — `completed / total`. Returns `0` for
 * an empty list. In-progress items intentionally do NOT count as
 * partial credit; the bar reads as the share of *finished* work, which
 * matches the assistant's mental model and the spoken summary.
 */
export function todoProgressFraction(counts: TodoCounts): number {
  if (counts.total === 0) return 0;
  return counts.completed / counts.total;
}

/**
 * Narrow an arbitrary wire `todos` value into a {@link TodoListData}
 * payload. Defensive: drops malformed entries and unknown statuses
 * silently so a partial / drifted result still renders the items the
 * wire shape did agree on.
 */
export function narrowTodoListData(value: unknown): TodoListData | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as { todos?: unknown };
  if (!Array.isArray(v.todos)) return undefined;
  const todos: TodoItem[] = [];
  for (const raw of v.todos) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const content = typeof r.content === "string" ? r.content : undefined;
    const status = narrowTodoStatus(r.status);
    if (content === undefined || status === undefined) continue;
    const activeForm = typeof r.activeForm === "string" ? r.activeForm : undefined;
    todos.push({ content, status, activeForm });
  }
  return { todos };
}

function narrowTodoStatus(value: unknown): TodoStatus | undefined {
  if (value === "pending" || value === "in_progress" || value === "completed") {
    return value;
  }
  return undefined;
}

/**
 * Build the plain-text representation of a Todo list — used by the
 * Copy affordance. Each line: `[ ] content` / `[~] activeForm` /
 * `[x] content`. The pending / in-progress / completed glyphs mirror
 * GitHub-flavored markdown task list conventions with a `~` for
 * in-progress (no markdown equivalent, but readable).
 */
export function composeTodoCopyText(todos: readonly TodoItem[]): string {
  return todos
    .map((t) => {
      const glyph =
        t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
      const text =
        t.status === "in_progress" && t.activeForm !== undefined
          ? t.activeForm
          : t.content;
      return `${glyph} ${text}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TODO_CELL_KIND = "todo";
const DATA_SLOT_ROOT = "todo-list-body";
const DATA_SLOT_HEADER = "todo-list-header";
const DATA_SLOT_ACTIONS = "todo-list-actions";

// ---------------------------------------------------------------------------
// Data source — immutable per instance
// ---------------------------------------------------------------------------

const NOOP_UNSUBSCRIBE = (): void => {};

/**
 * A `TugListView` data source over an immutable Todo array. A fresh
 * instance is built every time `data.todos` identity changes — the
 * source never mutates in place, so `subscribe` is a no-op and
 * `getVersion` returns the array reference (stable per instance,
 * distinct across instances).
 */
class TodoListDataSource implements TugListViewDataSource {
  constructor(private readonly todos: readonly TodoItem[]) {}

  numberOfItems(): number {
    return this.todos.length;
  }

  idForIndex(index: number): string {
    // Todos have no wire id today; the content + index pair is the
    // stable handle. If two items happen to share content, the index
    // tail disambiguates without altering row order on a reorder.
    return `${index}:${this.todos[index].content}`;
  }

  kindForIndex(): string {
    return TODO_CELL_KIND;
  }

  subscribe(): () => void {
    return NOOP_UNSUBSCRIBE;
  }

  getVersion(): unknown {
    return this.todos;
  }

  todoAt(index: number): TodoItem {
    return this.todos[index];
  }
}

// ---------------------------------------------------------------------------
// Cell renderer
// ---------------------------------------------------------------------------

/** Map a status to the lucide icon component. */
const ICON_BY_STATUS: Readonly<Record<TodoStatus, React.ComponentType<{ size?: number }>>> = {
  pending: Circle,
  in_progress: Loader2,
  completed: Check,
};

/**
 * One Todo row — `[status-icon] [text]`. The status drives the icon,
 * the text variant (content vs. activeForm), and the visual treatment
 * via the row's `data-status` attribute (CSS owns colour, weight, and
 * strikethrough — pure [L06]).
 */
const TodoCell: TugListViewCellRenderer<TodoListDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<TodoListDataSource>) => {
  const todo = dataSource.todoAt(index);
  const Icon = ICON_BY_STATUS[todo.status];
  const text =
    todo.status === "in_progress" && todo.activeForm !== undefined
      ? todo.activeForm
      : todo.content;

  return (
    <div
      className="tugx-todo-row"
      data-slot="todo-list-row"
      data-status={todo.status}
    >
      <span className="tugx-todo-row-icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <span className="tugx-todo-row-text">{text}</span>
    </div>
  );
};

/** Cell-renderer dispatch map — module-scope, one entry. */
const CELL_RENDERERS: Record<string, TugListViewCellRenderer<TodoListDataSource>> = {
  [TODO_CELL_KIND]: TodoCell,
};

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export const TodoListBlock: React.FC<TodoListBlockProps> = ({
  data,
  label,
  embedded = false,
  className,
}) => {
  const todos = data?.todos ?? EMPTY_TODOS;
  const dataSource = React.useMemo(() => new TodoListDataSource(todos), [todos]);

  // ---- Copy source ---------------------------------------------------
  //
  // `todosRef` carries the live list so the `BlockCopyButton` `getText`
  // closure reads the freshest items at fire time ([L07]).
  const todosRef = React.useRef<readonly TodoItem[]>(todos);
  React.useLayoutEffect(() => {
    todosRef.current = todos;
  }, [todos]);
  const getCopyText = React.useCallback(
    () => composeTodoCopyText(todosRef.current),
    [],
  );

  // ---- Chrome actions target (embedded composition) ------------------
  const chromeActionsTarget = useChromeActionsTarget();

  // Dev-mode misconfiguration check — `embedded={true}` requires a
  // parent `ToolBlockChrome` or the actions cluster has nowhere to
  // portal. Mirrors `PathListBlock`'s deferred-warn pattern.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!embedded) return;
    if (chromeActionsTarget !== null) return;
    const handle = window.setTimeout(() => {
      console.warn(
        "TodoListBlock: `embedded={true}` requires a parent " +
          "`ToolBlockChrome`. Without one the actions cluster (Copy) " +
          "has nowhere to portal and the user loses access to it " +
          "silently. Either compose under a chrome or set " +
          "`embedded={false}`.",
      );
    }, 0);
    return () => {
      window.clearTimeout(handle);
    };
  }, [embedded, chromeActionsTarget]);

  // ---- Empty data: layout-consistent marker --------------------------
  if (todos.length === 0) {
    return (
      <div
        data-slot={DATA_SLOT_ROOT}
        data-empty="true"
        data-embedded={embedded ? "true" : undefined}
        className={
          className === undefined ? "tugx-todo" : `tugx-todo ${className}`
        }
      />
    );
  }

  const rootClass =
    "tugx-todo" + (className === undefined ? "" : ` ${className}`);

  // The actions cluster — Copy only (no sort: Todo order is producer-
  // assigned and meaningful, not user-tunable like PathList's "found"
  // vs. "name").
  const actions = (
    <BlockCopyButton
      data-slot="todo-list-copy"
      aria-label="Copy todo list"
      getText={getCopyText}
    />
  );

  const portaledActions =
    embedded && chromeActionsTarget !== null
      ? createPortal(
          <BlockActionsCluster data-slot={DATA_SLOT_ACTIONS}>
            {actions}
          </BlockActionsCluster>,
          chromeActionsTarget,
        )
      : null;

  const counts = countTodos(todos);
  const summary = composeTodoSummary(counts);

  return (
    <div
      data-slot={DATA_SLOT_ROOT}
      data-empty="false"
      data-embedded={embedded ? "true" : undefined}
      className={rootClass}
    >
      {embedded ? null : (
        <div className="tugx-todo-header" data-slot={DATA_SLOT_HEADER}>
          {label !== undefined ? (
            <span className="tugx-todo-label" data-slot="todo-list-label">
              {label}
            </span>
          ) : null}
          <span className="tugx-todo-summary" data-slot="todo-list-summary">
            {summary}
          </span>
          <span className="tugx-todo-header-spacer" />
          <BlockActionsCluster data-slot={DATA_SLOT_ACTIONS}>
            {actions}
          </BlockActionsCluster>
        </div>
      )}
      {portaledActions}

      {/* `inline` — every row in document order, no windowing. The
       * block grows to its natural height; the outer transcript owns
       * the scroll. */}
      <TugListView<TodoListDataSource>
        dataSource={dataSource}
        cellRenderers={CELL_RENDERERS}
        className="tugx-todo-list"
        inline
      />
    </div>
  );
};

/** Stable empty-array sentinel so the empty-data path doesn't create
 *  a fresh `[]` per render. */
const EMPTY_TODOS: readonly TodoItem[] = Object.freeze([]);
