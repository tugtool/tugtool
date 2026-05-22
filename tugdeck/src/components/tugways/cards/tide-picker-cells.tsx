/**
 * tide-picker-cells.tsx — cell renderers for the Tide picker's two
 * `TugListView` lists (Recents + Sessions).
 *
 * Each renderer is a `TugListViewCellRenderer<...>` that takes the
 * typed row payload from `dataSource.rowAt(p.index)` and paints the
 * visual treatment. **Cells are pure render functions** per
 * [tugplan-tide-picker-redesign §D17](
 * ../../../roadmap/tugplan-tide-picker-redesign.md#d17-pure-renderer-rule):
 * no `useState`, no `useRef`, no `useEffect` / `useLayoutEffect`, no
 * `useImperativeHandle`. Selection state, the live path, and the
 * confirmation flow all live above the list — in `TideProjectPickerForm`,
 * the chain responder. The cells read what they need through
 * `PickerCellContext`.
 *
 * Recents cells:
 *  - `path-recent` — composes a `pill`-variant `TugListRow` (the
 *    variant is inherited from the Recents list's `rowLayout` via
 *    `TugListRowLayoutContext`, not repeated per cell). Selection is
 *    owned by `TugListView`'s `selectionRequired` mode; the list view
 *    passes the owned selected state in through the cell's `selected`
 *    prop, which the cell forwards to `TugListRow` so the pill paints
 *    its selected treatment. The form's `onSelectionChange` /
 *    `delegate.onSelect` fill the project-path input from the
 *    selected (or re-activated) recent. Match ranges from the matcher
 *    (attached by the picker form's data source) drive `<mark>`
 *    highlights inside the path text.
 *
 * Sessions cells:
 *  - `session-new` — single-row "New session". Selected when
 *    the picker's selection is `{ kind: "session-new" }`.
 *  - `session-resume` — rich row layout with snippet + subtitle +
 *    trailing trash `TugIconButton` (non-live) or live/failed
 *    badge. The row carries `data-session-id={session_id}` so the
 *    form's anchor-resolution layout effect can find this row's
 *    trash icon when the user requests a forget on it.
 *  - `loading` — "checking…" placeholder. Inert.
 *
 * Click semantics:
 *  - All non-disabled cells route through the wrapper's onClick to
 *    `delegate.onSelect` (the form's delegate dispatches navigation
 *    for path-recent, selection update for session-* per [D03],
 *    [D04]).
 *  - The trash control is a focus-refusing `TugIconButton` per
 *    [D16]. Its click dispatches `request-forget-session` with
 *    `{ sessionId }` payload via `useControlDispatch()` to the form
 *    responder. The form sets pending-id state which drives a single
 *    anchored `TugConfirmPopover`. The cell knows nothing about the
 *    confirmation UI.
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — the data
 *    sources supply rows via `useSyncExternalStore` at the
 *    `TugListView` level; cells just render.
 *  - [L06] visual-state changes via DOM attributes (`data-selected`,
 *    `data-disabled`, `data-state`) and CSS, not React state on the
 *    cell side.
 *  - [L11] controls emit actions; the trash button dispatches a chain
 *    action (no callback into context).
 *  - [L19] component authoring guide.
 *  - [L20] tokens scoped under `.tide-card-picker-list-view*` in
 *    `tide-card.css`.
 *
 * Decisions:
 *  - tugplan-tide-picker-redesign [D02] role-flat-list (cell-only
 *    after the master/detail rework — headers are JSX, footers are
 *    buttons), [D04] path-recent navigation + selected state,
 *    [D13] shared-text-matcher,
 *    [D14] no per-cell floating surfaces,
 *    [D16] trailing in-list actions use TugIconButton,
 *    [D17] pure-renderer rule for cells.
 */

import React, { createContext, useContext } from "react";
import { Trash2 } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
} from "@/components/tugways/tug-list-view";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

import type {
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
 * `useState<PickerSelection | null>`. The Recents list does NOT carry
 * a selection state here — it runs in `TugListView`'s
 * `selectionRequired` mode, so the list view owns the selected recent
 * and marks the row wrapper with `data-selected="true"`.
 */
export type PickerSelection =
  | { readonly kind: "session-new" }
  | { readonly kind: "session-resume"; readonly sessionId: string };

interface PickerCellContextValue {
  /** Current session selection. `null` when no session row is selected. */
  readonly selection: PickerSelection | null;
  /**
   * Session id whose forget-confirmation popover is currently open
   * (driven by the form's `pendingForgetSessionId` state). The
   * matching row marks itself with `data-pending-forget="true"` so
   * its trash icon stays visible AND highlighted while the popover
   * is up — Mac-menu-open style. `null` when no forget is pending.
   */
  readonly pendingForgetSessionId: string | null;
}

const NULL_CONTEXT: PickerCellContextValue = {
  selection: null,
  pendingForgetSessionId: null,
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
 * Path-recent cell. Composes a `TugListRow` — `variant` inherited as
 * `pill` from the Recents list's `rowLayout` — and renders the path
 * text with `<mark>` highlights at the matcher's match ranges as the
 * row's `children`. RTL middle-ellipsis path text is not a plain
 * title, so it rides the `children` escape hatch, not the `title`
 * prop.
 *
 * Selection is owned by `TugListView`'s `selectionRequired` mode. The
 * list view passes the owned selected state in through the cell's
 * `selected` prop; the cell forwards it to `TugListRow`, whose pill
 * `[data-selected]` treatment paints the highlight. The cell derives
 * no selection itself. The form's `onSelectionChange` mirrors the
 * selected recent into the project-path input.
 */
export const PathRecentCell: TugListViewCellRenderer<TideRecentsDataSource> = ({
  index,
  dataSource,
  selected,
}: TugListViewCellProps<TideRecentsDataSource>) => {
  const row = dataSource.rowAt(index);
  return (
    <TugListRow selected={selected}>
      <div
        className="tide-card-picker-path-recent"
        data-testid="tide-card-picker-path-recent"
        title={row.path}
        aria-label={row.path}
      >
        {renderHighlighted(row.path, row.matches)}
      </div>
    </TugListRow>
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
  const { selection, pendingForgetSessionId } = usePickerCellContext();
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
  // While a forget-confirmation popover is pending FOR THIS ROW, the
  // row marks itself so CSS can keep the trash icon visible AND
  // highlighted (Mac-menu-open style). Pure render derivation from
  // the context value — no per-cell state.
  const isPendingForget = pendingForgetSessionId === row.session_id;

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

  // The row carries `data-session-id` so the form's anchor-resolution
  // layout effect can locate this row's trash button when the user
  // dispatches `request-forget-session` for this session — see
  // `tide-card.tsx` `pendingForgetAnchorEl` resolution.
  return (
    <div
      className="tide-card-picker-session-option"
      data-testid="tide-card-picker-session-resume"
      data-state={row.state}
      data-selected={isSelected ? "true" : undefined}
      data-disabled={isLive ? "true" : undefined}
      data-session-id={row.session_id}
      data-pending-forget={isPendingForget ? "true" : undefined}
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
        <TugIconButton
          icon={<Trash2 size={14} aria-hidden="true" />}
          aria-label={`Forget session ${idShort}`}
          title={`Forget session ${idShort}`}
          tone="danger"
          className="tide-card-picker-session-forget"
          dispatch={{
            action: TUG_ACTIONS.REQUEST_FORGET_SESSION,
            value: { sessionId: row.session_id },
            phase: "discrete",
          }}
        />
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
