/**
 * tide-picker-cells.tsx — cell renderers for the Tide project
 * picker's seven row kinds.
 *
 * Each renderer is a `TugListViewCellRenderer<TidePickerDataSource>`
 * that takes the typed row payload from `dataSource.rowAt(p.index)`
 * and paints the visual treatment per [Spec S01]. Selection state
 * and per-row callbacks (`onRequestForgetSession`,
 * `onRequestForgetAll`) flow through `PickerCellContext` so the
 * cells stay pure and testable in isolation; the picker form wires
 * the provider with live state.
 *
 * Design notes:
 *  - Header rows (`header-recents`, `header-sessions`) are inert per
 *    [D02]: `TugListView` sets `data-list-cell-role="header"` on the
 *    wrapper and gates `onSelect` / `tabIndex`. The cell renders the
 *    visible label only; click handlers live nowhere here.
 *  - `path-recent` is `role: "cell"`, so the wrapper takes the
 *    click and routes to `delegate.onSelect` per [D04]. The cell
 *    itself has no inline click handler — the form's `onSelect`
 *    delegate dispatches navigation. Highlight ranges from the
 *    matcher ([D13]) are pre-attached to the row and rendered via
 *    `<mark>` per [Spec S01]'s visual-treatment line.
 *  - `session-new` and `session-resume` are `role: "cell"` but the
 *    wrapper's `onSelect` is consumed by the form's selection state
 *    update, not by direct cell handlers. The cells expose
 *    `data-selected="true"` when `selection` from context matches
 *    the row's identity ([Spec S03] selection invalidation is the
 *    form's responsibility, not the cell's).
 *  - `session-resume`'s trailing trash icon is the one place a
 *    cell attaches its OWN click handler — it must NOT propagate to
 *    the wrapper's `onSelect` (the user is forgetting, not
 *    selecting). `e.stopPropagation()` + `e.preventDefault()` keep
 *    the wrapper unaware. `pointerdown` is also stopped because
 *    `TugListView`'s focusin promotion runs before `onClick`.
 *  - `forget-all` is `role: "footer"` per [D05] / [D02], so the
 *    wrapper's `onSelect` is gated. The cell attaches its own
 *    `onClick` that calls `onRequestForgetAll`.
 *  - `loading` is `role: "cell"` (it's a placeholder, not a
 *    structural divider); the form's `onSelect` delegate ignores
 *    `loading` clicks. `aria-live="polite"` + `role="status"` so
 *    assistive tech announces the in-flight state.
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — context is
 *    React state owned by the consumer; the data source supplies
 *    row payloads via `useSyncExternalStore` at the `TugListView`
 *    level.
 *  - [L06] visual-state changes via DOM attributes (`data-selected`,
 *    `data-disabled`, `data-state`) and CSS, never React state on
 *    the cell side.
 *  - [L19] component authoring guide — file pair (this file +
 *    `__tests__/tide-picker-cells.test.tsx`), exported components,
 *    typed `TugListViewCellRenderer<TidePickerDataSource>` shape.
 *  - [L20] tokens scoped under `.tide-card-picker-list-view` in
 *    `tide-card.css`; no reach into `--tugx-list-view-*`.
 *
 * Decisions:
 *  - tugplan-tide-picker-redesign [D02] role-flat-list, [D04]
 *    path-recent-navigation, [D05] forget-all-direct, [D07]
 *    finder-style-truncation, [D08] structural-allcaps-fix, [D11]
 *    notice-outside-list, [D13] shared-text-matcher.
 *  - [Spec S01] row vocabulary; [Spec S03] selection invalidation.
 */

import React, { createContext, useContext } from "react";
import { Trash2 } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
} from "@/components/tugways/tug-list-view";

import type {
  PickerRow,
  TidePickerDataSource,
} from "@/lib/tide-picker-data-source";
import {
  formatSessionRowSubtitle,
  truncateForDisplay,
} from "./tide-picker-format";

// ---------------------------------------------------------------------------
// Selection type + context
// ---------------------------------------------------------------------------

/**
 * The picker's selection state. Owned by `TideProjectPickerForm` as
 * `useState<PickerSelection | null>`. Cells read it from context to
 * compute `data-selected`.
 */
export type PickerSelection =
  | { readonly kind: "session-new" }
  | { readonly kind: "session-resume"; readonly sessionId: string };

interface PickerCellContextValue {
  /** Current picker selection. `null` when no row is selected. */
  readonly selection: PickerSelection | null;
  /** Open the inline forget-confirm panel for a single session. */
  readonly onRequestForgetSession: (sessionId: string) => void;
  /** Open the inline forget-confirm panel for the all-sessions case. */
  readonly onRequestForgetAll: () => void;
}

/**
 * No-op context default. Used when a cell renders outside a
 * provider (only happens in tests that exercise pure markup
 * without selection/forget behavior). Production cells always
 * see the form's provider value.
 */
const NULL_CONTEXT: PickerCellContextValue = {
  selection: null,
  onRequestForgetSession: () => {},
  onRequestForgetAll: () => {},
};

const PickerCellContext = createContext<PickerCellContextValue>(NULL_CONTEXT);

/** Provider component for `TideProjectPickerForm`. */
export const PickerCellProvider = PickerCellContext.Provider;

function usePickerCellContext(): PickerCellContextValue {
  return useContext(PickerCellContext);
}

// ---------------------------------------------------------------------------
// Highlight rendering for path-recent cells
// ---------------------------------------------------------------------------

/**
 * Render `text` with `<mark>` highlights at `matches` (UTF-16 code
 * unit half-open ranges). Empty `matches` → return text unmarked.
 *
 * Mirrors `gallery-list-view-filter`'s `renderHighlighted` so both
 * surfaces produce identical highlight markup.
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
// Cell renderers
// ---------------------------------------------------------------------------

/**
 * Header for the RECENTS section. Sentence case ("Recents"), no
 * `text-transform: uppercase` per [D08]. The wrapper carries
 * `data-list-cell-role="header"`, `tabIndex={-1}`; this cell paints
 * the visible label only.
 */
export const HeaderRecentsCell: TugListViewCellRenderer<TidePickerDataSource> =
  () => (
    <div
      className="tide-card-picker-section-header"
      data-testid="tide-card-picker-header-recents"
    >
      Recents
    </div>
  );

/**
 * Header for the SESSIONS section. Same shape as `HeaderRecentsCell`
 * with a different label.
 */
export const HeaderSessionsCell: TugListViewCellRenderer<TidePickerDataSource> =
  () => (
    <div
      className="tide-card-picker-section-header"
      data-testid="tide-card-picker-header-sessions"
    >
      Sessions
    </div>
  );

/**
 * Path-recent cell. The data source pre-attaches highlight ranges
 * from `caseInsensitiveSubstring(query, path)`; this cell renders
 * the path with `<mark>` spans over those ranges.
 *
 * macOS Finder-style ellipsis-at-start truncation per [D07] is
 * supplied by the scoped CSS rule on `.tide-card-picker-path-recent`
 * (`direction: rtl; unicode-bidi: plaintext`).
 *
 * `title` and `aria-label` carry the full path so hover tooltip
 * and screen readers see the unabbreviated form.
 */
export const PathRecentCell: TugListViewCellRenderer<TidePickerDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<TidePickerDataSource>) => {
  const row = dataSource.rowAt(index) as Extract<
    PickerRow,
    { kind: "path-recent" }
  >;
  return (
    <div
      className="tide-card-picker-path-recent"
      data-testid="tide-card-picker-path-recent"
      title={row.path}
      aria-label={row.path}
    >
      {renderHighlighted(row.path, row.matches)}
    </div>
  );
};

/**
 * Start-fresh cell. Always present in SESSIONS; selected by default
 * on first SESSIONS render per [D06]. The wrapper takes the click
 * and the form's `onSelect` delegate sets selection state.
 */
export const SessionNewCell: TugListViewCellRenderer<TidePickerDataSource> =
  () => {
    const { selection } = usePickerCellContext();
    const isSelected = selection?.kind === "session-new";
    return (
      <div
        className="tide-card-picker-session-option"
        data-testid="tide-card-picker-session-new"
        data-selected={isSelected ? "true" : undefined}
      >
        <span className="tide-card-picker-session-option-title">
          Start fresh
        </span>
        <span className="tide-card-picker-session-option-subtitle">
          New session
        </span>
      </div>
    );
  };

/**
 * Existing-session resume cell. Rich row: snippet title + subtitle +
 * trailing affordance.
 *
 * Live rows render with a `live` badge and `data-disabled="true"` —
 * the form's `onSelect` delegate ignores selection on live rows.
 * Failed rows render selectable (the user can choose to retry the
 * resume) with a `failed` badge.
 *
 * The trailing trash icon is rendered only for non-live rows; its
 * `onClick` calls `onRequestForgetSession` from context and stops
 * propagation so the wrapper's `onSelect` doesn't ALSO fire (which
 * would race the forget-confirm panel open with a selection
 * update).
 */
export const SessionResumeCell: TugListViewCellRenderer<TidePickerDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<TidePickerDataSource>) => {
  const { selection, onRequestForgetSession } = usePickerCellContext();
  const data = dataSource.rowAt(index) as Extract<
    PickerRow,
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

  // Subtitle copy is state-driven so the user always sees a reason
  // for any unavailable row. Closed rows show the contextual
  // metadata (timestamp · turns · short id); live and failed rows
  // surface the diagnostic.
  const subtitleText = isLive
    ? "Live in another card"
    : isFailed
      ? "Couldn't resume — JSONL missing"
      : formatSessionRowSubtitle(row);

  const idShort = row.session_id.slice(0, 8);

  return (
    <div
      className="tide-card-picker-session-option"
      data-testid="tide-card-picker-session-resume"
      data-state={row.state}
      data-selected={isSelected ? "true" : undefined}
      data-disabled={isLive ? "true" : undefined}
    >
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
      {!isLive && (
        <button
          type="button"
          className="tide-card-picker-session-forget"
          aria-label={`Forget session ${idShort}`}
          title={`Forget session ${idShort}`}
          onClick={(e) => {
            // Don't propagate to the wrapper's onClick — the user is
            // forgetting, not selecting this row.
            e.stopPropagation();
            e.preventDefault();
            onRequestForgetSession(row.session_id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
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

/**
 * Forget-all footer. Role is `"footer"` per the data source so the
 * wrapper's `onSelect` is gated; the cell attaches its own onClick
 * that calls `onRequestForgetAll` from context. Per [D02] / [D05].
 *
 * The label includes the non-live count when there's more than
 * one to forget, so the user knows the size of the action before
 * confirming.
 */
export const ForgetAllCell: TugListViewCellRenderer<TidePickerDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<TidePickerDataSource>) => {
  const { onRequestForgetAll } = usePickerCellContext();
  const row = dataSource.rowAt(index) as Extract<
    PickerRow,
    { kind: "forget-all" }
  >;
  const label =
    row.nonLiveCount > 1
      ? `Forget all sessions for this path (${row.nonLiveCount})`
      : "Forget all sessions for this path";
  return (
    <button
      type="button"
      className="tide-card-picker-forget-all-link"
      data-testid="tide-card-picker-forget-all"
      onClick={(e) => {
        e.stopPropagation();
        onRequestForgetAll();
      }}
    >
      {label}
    </button>
  );
};

/**
 * Loading placeholder shown while the session ledger request is in
 * flight for a non-empty query. `aria-live="polite"` + `role="status"`
 * so assistive tech announces the in-flight state.
 */
export const LoadingCell: TugListViewCellRenderer<TidePickerDataSource> = () => (
  <div
    className="tide-card-picker-pending-placeholder"
    data-testid="tide-card-picker-pending-placeholder"
    role="status"
    aria-live="polite"
  >
    checking…
  </div>
);

// ---------------------------------------------------------------------------
// Renderer map
// ---------------------------------------------------------------------------

/**
 * `kind → renderer` map for `<TugListView cellRenderers={...} />`.
 * Module-scope and stable; consumers can pass it directly without a
 * `useMemo`. Each renderer reads its row payload via
 * `dataSource.rowAt(p.index)` per the data source's typed access
 * contract.
 */
export const PICKER_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<TidePickerDataSource>
> = {
  "header-recents": HeaderRecentsCell,
  "path-recent": PathRecentCell,
  "header-sessions": HeaderSessionsCell,
  "session-new": SessionNewCell,
  "session-resume": SessionResumeCell,
  "forget-all": ForgetAllCell,
  "loading": LoadingCell,
};
