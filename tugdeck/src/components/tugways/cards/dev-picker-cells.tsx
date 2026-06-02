/**
 * dev-picker-cells.tsx — cell renderers for the Dev picker's two
 * `TugListView` lists (Recents + Sessions).
 *
 * Each renderer is a `TugListViewCellRenderer<...>` that takes the
 * typed row payload from `dataSource.rowAt(p.index)` and paints the
 * visual treatment. **Cells are pure render functions** per
 * [tugplan-dev-picker-redesign §D17](
 * ../../../roadmap/tugplan-dev-picker-redesign.md#d17-pure-renderer-rule):
 * no `useState`, no `useRef`, no `useEffect` / `useLayoutEffect`, no
 * `useImperativeHandle`. Selection state, the live path, and the
 * confirmation flow all live above the list — in `DevProjectPickerForm`,
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
 *    trash icon when the user requests to trash it.
 *  - `loading` — "checking…" placeholder. Inert.
 *
 * Click semantics:
 *  - All non-disabled cells route through the wrapper's onClick to
 *    `delegate.onSelect` (the form's delegate dispatches navigation
 *    for path-recent, selection update for session-* per [D03],
 *    [D04]).
 *  - The trash control is a focus-refusing `TugIconButton` per
 *    [D16]. Its click dispatches `request-trash-session` with
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
 *  - [L20] tokens scoped under `.dev-card-picker-list-view*` in
 *    `dev-card.css`.
 *
 * Decisions:
 *  - tugplan-dev-picker-redesign [D02] role-flat-list (cell-only
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
  DevRecentsDataSource,
  DevSessionsDataSource,
} from "@/lib/dev-picker-data-source";
import {
  formatSessionRowSubtitle,
  truncateForDisplay,
} from "./dev-picker-format";
import { sessionRowTitle } from "@/lib/session-name";

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
  /**
   * The live project-path text. A recents row highlights exactly when its
   * path equals this; when the typed path matches no recent, none highlight.
   * The path input and the recents list are two views of one value —
   * whichever surface the user touches writes it, the other reflects.
   */
  readonly currentPath: string;
  /** Current session selection. `null` when no session row is selected. */
  readonly selection: PickerSelection | null;
  /**
   * Session id whose trash-confirmation popover is currently open
   * (driven by the form's `pendingTrashSessionId` state). The
   * matching row marks itself with `data-pending-trash="true"` so
   * its trash icon stays visible AND highlighted while the popover
   * is up — Mac-menu-open style. `null` when no trash is pending.
   */
  readonly pendingTrashSessionId: string | null;
  /**
   * Recent path whose trash-confirmation popover is currently open. The
   * matching recents row marks itself `data-pending-trash="true"` so its trash
   * icon stays visible while the popover is up. `null` when none pending.
   */
  readonly pendingTrashRecentPath: string | null;
}

const NULL_CONTEXT: PickerCellContextValue = {
  currentPath: "",
  selection: null,
  pendingTrashSessionId: null,
  pendingTrashRecentPath: null,
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
      <mark key={`m-${start}`} className="dev-card-picker-match">
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
 * Path-recent cell. Composes a `TugListRow` — `flush` variant inherited
 * from the Recents list's `rowLayout` — and renders the path text with
 * `<mark>` highlights at the matcher's match ranges as the row's
 * `children`. This is a sanctioned `children` escape hatch per the
 * list-view house rules ([list-view-usage.md]): the content is not a
 * plain string but monospace, RTL middle-ellipsis path text carrying
 * inline `<mark>` search highlights, which `TugLabel`'s string `title`
 * cannot express. The `.dev-card-picker-path-recent` rule supplies the
 * consistent (mono) typography.
 *
 * Selection mirrors the typed project path: the row highlights exactly when
 * its path equals `currentPath` (from `PickerCellContext`), and none highlight
 * when the typed path matches no recent. Clicking a recent writes that path
 * back through `delegate.onSelect`, so the input and this list stay two views
 * of one value.
 */
export const PathRecentCell: TugListViewCellRenderer<DevRecentsDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<DevRecentsDataSource>) => {
  const { currentPath, pendingTrashRecentPath } = usePickerCellContext();
  const row = dataSource.rowAt(index);
  // Highlight only when this recent IS the typed path (exact match); none
  // highlight when the typed path matches no recent. Derived from the one
  // shared value, so the list always agrees with the input.
  const isSelected = row.path === currentPath;
  // While this row's trash-confirm popover is up, keep its icon visible
  // (Mac-menu-open style) — mirrors the Sessions list's per-row trash.
  const isPendingTrash = pendingTrashRecentPath === row.path;
  const pathShort = row.path.split("/").filter(Boolean).slice(-1)[0] ?? row.path;
  return (
    <TugListRow
      selected={isSelected}
      trailingReveal="hover"
      data-recent-path={row.path}
      data-pending-trash={isPendingTrash ? "true" : undefined}
      trailing={
        <TugIconButton
          icon={<Trash2 size={14} aria-hidden="true" />}
          aria-label={`Remove ${pathShort} from recent paths`}
          title={`Remove ${pathShort} from recent paths`}
          tone="danger"
          className="dev-card-picker-recent-trash"
          dispatch={{
            action: TUG_ACTIONS.REQUEST_TRASH_RECENT,
            value: { path: row.path },
            phase: "discrete",
          }}
        />
      }
    >
      <div
        className="dev-card-picker-path-recent"
        data-testid="dev-card-picker-path-recent"
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
  TugListViewCellRenderer<DevRecentsDataSource>
> = {
  "path-recent": PathRecentCell,
};

// ---------------------------------------------------------------------------
// Sessions cells — session-new, session-resume, loading
// ---------------------------------------------------------------------------

export const SessionNewCell: TugListViewCellRenderer<DevSessionsDataSource> =
  () => {
    const { selection } = usePickerCellContext();
    const isSelected = selection?.kind === "session-new";
    return (
      <TugListRow
        title="New session"
        selected={isSelected}
        data-testid="dev-card-picker-session-new"
      />
    );
  };

export const SessionResumeCell: TugListViewCellRenderer<DevSessionsDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<DevSessionsDataSource>) => {
  const { selection, pendingTrashSessionId } = usePickerCellContext();
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
  // While a trash-confirmation popover is pending FOR THIS ROW, the
  // row marks itself so CSS can keep the trash icon visible AND
  // highlighted (Mac-menu-open style). Pure render derivation from
  // the context value — no per-cell state.
  const isPendingTrash = pendingTrashSessionId === row.session_id;

  const fullPrompt =
    row.last_user_prompt !== null && row.last_user_prompt.length > 0
      ? row.last_user_prompt
      : null;
  // The user-assigned name ([#step-13d]) is the row title when set; otherwise
  // the `last_user_prompt`-derived snippet. `""` when neither exists →
  // "No prompts yet".
  const titleText = sessionRowTitle(row.name, fullPrompt ?? "");
  const snippet =
    titleText.length > 0 ? truncateForDisplay(titleText, 64) : null;

  const subtitleText = isLive
    ? "Live in another card"
    : isFailed
      ? "Couldn't resume — JSONL missing"
      : formatSessionRowSubtitle(row);

  const idShort = row.session_id.slice(0, 8);

  // Trailing accessory: a live/failed status badge, a trash action, or
  // both (a failed row can still be trashed). The trash reveals on row
  // hover/focus-within for the plain case; when a badge is present the
  // trailing stays visible.
  const badge = isLive ? (
    <TugBadge emphasis="tinted" role="action">
      live
    </TugBadge>
  ) : isFailed ? (
    <TugBadge emphasis="tinted" role="danger">
      failed
    </TugBadge>
  ) : null;
  const trash = !isLive ? (
    <TugIconButton
      icon={<Trash2 size={14} aria-hidden="true" />}
      aria-label={`Move session ${idShort} to Trash`}
      title={`Move session ${idShort} to Trash`}
      tone="danger"
      className="dev-card-picker-session-trash"
      dispatch={{
        action: TUG_ACTIONS.REQUEST_TRASH_SESSION,
        value: { sessionId: row.session_id },
        phase: "discrete",
      }}
    />
  ) : null;
  const trailing =
    badge !== null || trash !== null ? (
      <>
        {badge}
        {trash}
      </>
    ) : undefined;

  // The row carries `data-session-id` so the form's anchor-resolution
  // layout effect can locate this row's trash button (a descendant
  // `[data-slot="tug-icon-button"]`) when the user dispatches
  // `request-trash-session` — see `dev-card.tsx` `pendingTrashAnchorEl`.
  return (
    <TugListRow
      title={snippet ?? "No prompts yet"}
      subtitle={subtitleText}
      selected={isSelected}
      disabled={isLive}
      trailing={trailing}
      trailingReveal={badge !== null ? "always" : "hover"}
      data-testid="dev-card-picker-session-resume"
      data-state={row.state}
      data-session-id={row.session_id}
      data-pending-trash={isPendingTrash ? "true" : undefined}
    />
  );
};

export const LoadingCell: TugListViewCellRenderer<DevSessionsDataSource> = () => (
  <div
    className="dev-card-picker-pending-placeholder"
    data-testid="dev-card-picker-pending-placeholder"
    role="status"
    aria-live="polite"
  >
    checking…
  </div>
);

export const SESSIONS_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<DevSessionsDataSource>
> = {
  "session-new": SessionNewCell,
  "session-resume": SessionResumeCell,
  "loading": LoadingCell,
};
