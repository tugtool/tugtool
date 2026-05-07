/**
 * tide-picker-cells.tsx — cell renderers for the Tide picker's two
 * `TugListView` lists (Recents + Sessions).
 *
 * Each renderer is a `TugListViewCellRenderer<...>` that takes the
 * typed row payload from `dataSource.rowAt(p.index)` and paints the
 * visual treatment. Selection state (sessions), the live path
 * (recents), and per-row callbacks flow through `PickerCellContext`
 * so the cells stay pure and testable in isolation; the picker form
 * wires the provider with live state.
 *
 * Recents cells:
 *  - `path-recent` — `data-selected="true"` when `currentPath ===
 *    path` (master-pane behavior — clicking a recent fills the input
 *    and that recent stays highlighted). Match ranges from the
 *    matcher (the picker form's data source attaches them) drive
 *    `<mark>` highlights inside the path text.
 *
 * Sessions cells:
 *  - `session-new` — single-row "New session". Selected when
 *    the picker's selection is `{ kind: "session-new" }`.
 *  - `session-resume` — rich row layout with snippet + subtitle +
 *    trailing trash icon (non-live) or live/failed badge.
 *  - `loading` — "checking…" placeholder. Inert.
 *
 * Click semantics:
 *  - All non-disabled cells route through the wrapper's onClick to
 *    `delegate.onSelect` (the form's delegate dispatches navigation
 *    for path-recent, selection update for session-* per [D03],
 *    [D04]).
 *  - The trash icon on session-resume attaches its own click that
 *    stops propagation — the user is forgetting, not selecting.
 *    Click opens a cell-local `TugConfirmPopover`; only after the
 *    user confirms does `onConfirmForgetSession` fire.
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — context is
 *    React state owned by the consumer; the data sources supply
 *    rows via `useSyncExternalStore` at the `TugListView` level.
 *  - [L06] visual-state changes via DOM attributes (`data-selected`,
 *    `data-disabled`, `data-state`) and CSS, not React state on the
 *    cell side.
 *  - [L19] component authoring guide.
 *  - [L20] tokens scoped under `.tide-card-picker-list-view*` in
 *    `tide-card.css`.
 *
 * Decisions:
 *  - tugplan-tide-picker-redesign [D02] role-flat-list (cell-only
 *    after the master/detail rework — headers are JSX, footers are
 *    buttons), [D04] path-recent navigation + selected state,
 *    [D13] shared-text-matcher.
 */

import React, { createContext, useContext } from "react";
import { Trash2 } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import {
  TugConfirmPopover,
  type TugConfirmPopoverHandle,
} from "@/components/tugways/tug-confirm-popover";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
} from "@/components/tugways/tug-list-view";

import type {
  RecentsRow,
  SessionsRow,
  TideRecentsDataSource,
  TideSessionsDataSource,
} from "@/lib/tide-picker-data-source";
import {
  formatSessionRowSubtitle,
  truncateForDisplay,
} from "./tide-picker-format";

// ---------------------------------------------------------------------------
// Selection type + context
// ---------------------------------------------------------------------------

/**
 * The picker's session selection. Owned by the picker form as
 * `useState<PickerSelection | null>`. The Recents list does NOT
 * carry a selection state of its own — its "selected" cell is
 * derived from `currentPath === recent.path` in the cell.
 */
export type PickerSelection =
  | { readonly kind: "session-new" }
  | { readonly kind: "session-resume"; readonly sessionId: string };

interface PickerCellContextValue {
  /** Live project-path input value. Drives path-recent selected state. */
  readonly currentPath: string;
  /** Current session selection. `null` when no session row is selected. */
  readonly selection: PickerSelection | null;
  /**
   * Forget a single session. Invoked by the cell only after the
   * cell-local TugConfirmPopover resolves true — the cell owns
   * confirmation, so this callback unconditionally deletes.
   */
  readonly onConfirmForgetSession: (sessionId: string) => void;
}

const NULL_CONTEXT: PickerCellContextValue = {
  currentPath: "",
  selection: null,
  onConfirmForgetSession: () => {},
};

const PickerCellContext = createContext<PickerCellContextValue>(NULL_CONTEXT);

/** Provider component for the picker form to wrap its list views. */
export const PickerCellProvider = PickerCellContext.Provider;

function usePickerCellContext(): PickerCellContextValue {
  return useContext(PickerCellContext);
}

// ---------------------------------------------------------------------------
// Highlight rendering
// ---------------------------------------------------------------------------

/**
 * Render `text` with `<mark>` highlights at `matches` (UTF-16 code
 * unit half-open ranges). Empty `matches` → return text unmarked.
 */
function renderHighlighted(
  text: string,
  matches: ReadonlyArray<readonly [number, number]>,
): React.ReactNode {
  if (matches.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of matches) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={`m-${start}`} className="tide-card-picker-match">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

// ---------------------------------------------------------------------------
// Recents cell — path-recent
// ---------------------------------------------------------------------------

/**
 * Path-recent cell. Renders the path text with `<mark>` highlights
 * at the matcher's match ranges. `data-selected="true"` when the
 * live input value (`currentPath`) equals this recent's path.
 *
 * The cell wrapper takes the click; the form's delegate calls
 * `setPath(recent)`. Backward-compat keys `data-testid` for the
 * existing test suite.
 */
export const PathRecentCell: TugListViewCellRenderer<TideRecentsDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<TideRecentsDataSource>) => {
  const { currentPath } = usePickerCellContext();
  const row = dataSource.rowAt(index);
  const isSelected = currentPath === row.path;
  return (
    <div
      className="tide-card-picker-path-recent"
      data-testid="tide-card-picker-path-recent"
      data-selected={isSelected ? "true" : undefined}
      title={row.path}
      aria-label={row.path}
    >
      {renderHighlighted(row.path, row.matches)}
    </div>
  );
};

export const RECENTS_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<TideRecentsDataSource>
> = {
  "path-recent": PathRecentCell,
};

// ---------------------------------------------------------------------------
// Sessions cells — session-new, session-resume, loading
// ---------------------------------------------------------------------------

export const SessionNewCell: TugListViewCellRenderer<TideSessionsDataSource> =
  () => {
    const { selection } = usePickerCellContext();
    const isSelected = selection?.kind === "session-new";
    return (
      <div
        className="tide-card-picker-session-option"
        data-testid="tide-card-picker-session-new"
        data-selected={isSelected ? "true" : undefined}
      >
        <div className="tide-card-picker-session-option-text">
          <span className="tide-card-picker-session-option-title">
            New session
          </span>
        </div>
      </div>
    );
  };

export const SessionResumeCell: TugListViewCellRenderer<TideSessionsDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<TideSessionsDataSource>) => {
  const { selection, onConfirmForgetSession } = usePickerCellContext();
  const data = dataSource.rowAt(index) as Extract<
    SessionsRow,
    { kind: "session-resume" }
  >;
  const row = data.row;
  const isLive = row.state === "live";
  const isFailed = row.state === "failed";
  const isSelected =
    selection?.kind === "session-resume" &&
    selection.sessionId === row.session_id;

  const fullPrompt =
    row.first_user_prompt !== null && row.first_user_prompt.length > 0
      ? row.first_user_prompt
      : null;
  const snippet =
    fullPrompt !== null ? truncateForDisplay(fullPrompt, 64) : null;

  const subtitleText = isLive
    ? "Live in another card"
    : isFailed
      ? "Couldn't resume — JSONL missing"
      : formatSessionRowSubtitle(row);

  const idShort = row.session_id.slice(0, 8);
  const previewSnippet =
    fullPrompt !== null && fullPrompt.length > 0
      ? truncateForDisplay(fullPrompt, 64)
      : null;
  const confirmMessage =
    previewSnippet !== null
      ? `Forget "${previewSnippet}"?`
      : "Forget this session?";

  const confirmRef = React.useRef<TugConfirmPopoverHandle>(null);
  // Track whether the forget-confirm popover is open so the row can
  // keep its hover-styled background and the trash icon stays visible
  // while the user moves the cursor away from the row toward the
  // popover. Without this, `:hover` is lost the moment the cursor
  // crosses into the portaled popover and the visual cue collapses
  // mid-decision.
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  async function handleTrashClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setConfirmOpen(true);
    try {
      const ok = await confirmRef.current?.confirm();
      if (ok === true) onConfirmForgetSession(row.session_id);
    } finally {
      setConfirmOpen(false);
    }
  }

  return (
    <div
      className="tide-card-picker-session-option"
      data-testid="tide-card-picker-session-resume"
      data-state={row.state}
      data-selected={isSelected ? "true" : undefined}
      data-disabled={isLive ? "true" : undefined}
      data-popover-open={confirmOpen ? "true" : undefined}
    >
      <div className="tide-card-picker-session-option-text">
        <span
          className="tide-card-picker-session-option-title"
          title={fullPrompt ?? undefined}
          aria-label={fullPrompt ?? undefined}
        >
          {snippet ?? <em>No prompts yet</em>}
        </span>
        <span
          className="tide-card-picker-session-option-subtitle"
          data-testid="tide-card-picker-resume-subtitle"
        >
          {subtitleText}
        </span>
      </div>
      {!isLive && (
        <TugConfirmPopover
          ref={confirmRef}
          message={confirmMessage}
          confirmLabel="Forget"
          confirmRole="danger"
          side="left"
        >
          <button
            type="button"
            className="tide-card-picker-session-forget"
            aria-label={`Forget session ${idShort}`}
            title={`Forget session ${idShort}`}
            onClick={handleTrashClick}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </TugConfirmPopover>
      )}
      {isLive && (
        <TugBadge emphasis="tinted" role="action">
          live
        </TugBadge>
      )}
      {isFailed && (
        <TugBadge emphasis="tinted" role="danger">
          failed
        </TugBadge>
      )}
    </div>
  );
};

export const LoadingCell: TugListViewCellRenderer<TideSessionsDataSource> = () => (
  <div
    className="tide-card-picker-pending-placeholder"
    data-testid="tide-card-picker-pending-placeholder"
    role="status"
    aria-live="polite"
  >
    checking…
  </div>
);

export const SESSIONS_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<TideSessionsDataSource>
> = {
  "session-new": SessionNewCell,
  "session-resume": SessionResumeCell,
  "loading": LoadingCell,
};
