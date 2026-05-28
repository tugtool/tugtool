/**
 * dev-card-telemetry-popovers.tsx — popover content components for
 * the four Z2 status-row anchors (indicator, TIME, TOKENS, CONTEXT).
 *
 * Each component renders inside a `TugPopoverContent` returned by
 * `DevTelemetryStatusRow`. The popovers share a layout vocabulary
 * (`PerAreaPopoverFrame`, `PopoverRow`, `DevPopoverRowGrid`) so the
 * four surfaces read with the same rhythm — title bar above a 1px
 * rule, then either a 3-column row grid (Time / Tokens / state-change
 * log) or a 2-column gauge + legend layout (Context).
 *
 * **Four-column shared grid (Time / Tokens).** The row list AND the
 * summary footer share a single CSS grid via `subgrid`, so the
 * label / preview / annotation / value columns line up vertically
 * across every row in both blocks. Without the shared grid, each row
 * would be its own grid and column edges would drift with content
 * widths.
 *
 * **End-state badge consistency.** Per-turn rows display the badge
 * produced by `endStateBadgeFor(turn.turnEndReason)` — the same
 * dispatch the Z1B end-state display uses. The popover and the Z1B
 * footer therefore always read the same text ("OK" / "interrupted" /
 * "error" / "lost") and tone for a given turn.
 *
 * **Turn-number affordance.** Each per-turn row's label is the PAIR
 * of `#NNNN` transcript entry numbers the turn spans — the user-half
 * row and the assistant-half row. When the host threads an
 * `onScrollToRow` handler down, each number is an independently
 * clickable button that scrolls the transcript to that entry's row —
 * a control-style action, no popover-local state. The row also
 * carries an end-truncated preview of the turn's request string.
 *
 * Conformance:
 *  - [L02] popover content is a function of inputs only — `transcript`,
 *    `inflight`, `contextMax`, `rows`. The status-row owns the
 *    `useSyncExternalStore` subscriptions; this module reads no
 *    external state on its own.
 *  - [L06] all visible state lives on CSS class / data-attribute
 *    selectors; no inline style for appearance.
 *  - [L19] `.tsx` + `.css` pair; popover-frame and row primitives
 *    carry `data-slot` anchors for tests.
 *  - [L20] component-token sovereignty — the popovers consume
 *    `--tug-space-*`, `--tug-font-mono`, and `--tug7-element-*`
 *    tokens but introduce no new slot family.
 *
 * @module components/tugways/cards/dev-card-telemetry-popovers
 */

import "./dev-card-telemetry-popovers.css";

import React, { useLayoutEffect, useRef } from "react";

import { TugArcGauge } from "@/components/tugways/tug-arc-gauge";
import type { TugArcGaugeSegment } from "@/components/tugways/tug-arc-gauge";
import { TugBadge } from "@/components/tugways/tug-badge";
import {
  devSessionPhaseKey,
  devSessionPhaseVisual,
  type DevSessionPhaseInput,
} from "@/lib/code-session-store/session-phase-visual";
import {
  endStateBadgeFor,
  type EndStateBadge,
} from "@/lib/code-session-store/end-state";
import { formatStateChangeRow } from "@/lib/code-session-store/state-change-formatter";
import {
  computeTimeSummary,
  computeTokensSummary,
  type ContextBreakdown,
} from "@/lib/code-session-store/telemetry";
import type { TurnEntry } from "@/lib/code-session-store/types";
import type { SessionStateChangeRow } from "@/lib/session-state-changes-reader";
import {
  assistantRowIndexForTurn,
  userRowIndexForTurn,
} from "@/lib/dev-transcript-data-source";
import { formatSequenceNumber } from "@/components/tugways/tug-transcript-entry";
import { TugLabel } from "@/components/tugways/tug-label";
import {
  TugProgressIndicator,
  type TugProgressIndicatorState,
} from "@/components/tugways/tug-progress-indicator";
import { TugTooltip } from "@/components/tugways/tug-tooltip";
import type { TaskStatus } from "@/lib/code-session-store/select-task-list";
import {
  composeTaskCopyText,
  composeTaskSummary,
  countTasks,
} from "@/components/tugways/body-kinds/todo-list-block";
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances";
import type { TaskListState } from "@/lib/code-session-store/select-task-list";

import { formatTimeAlwaysHours, formatTokensCaps } from "./dev-card-telemetry-renderers";

// ---------------------------------------------------------------------------
// Cross-popover callback contract
// ---------------------------------------------------------------------------

/**
 * Invoked when the user clicks a `#NNNN` entry number in the Time /
 * Tokens popover — scrolls the transcript so that entry's row is in
 * view. `rowIndex` is a transcript list-view row index: a turn shows
 * BOTH of its entries (user row + assistant row), each independently
 * clickable, so the handler is keyed by row rather than by turn. See
 * `userRowIndexForTurn` / `assistantRowIndexForTurn`. Supplied by the
 * dev card, which owns the transcript's imperative handle; omitted in
 * the gallery / fixtures, where the numbers render as inert text.
 */
export type ScrollToRowHandler = (rowIndex: number) => void;

/**
 * Per-turn request-preview cap. The user-half prompt is collapsed to a
 * single line and end-truncated to this many characters so the popover
 * row stays compact.
 */
const REQUEST_PREVIEW_MAX_CHARS = 24;

/**
 * One-line, end-truncated preview of a turn's user prompt. Drops the
 * `>` Code-route prefix (matching the transcript's user row) and
 * collapses internal whitespace so a multi-line prompt reads as one
 * tidy line.
 */
function requestPreviewText(turn: TurnEntry): string {
  // Pull the user submission's text from the `user_message` Message
  // at the head of `turn.messages` (the [D07] substrate replacement
  // for `turn.userMessage`). Wake turns have no `user_message` head;
  // they return an empty preview, which the caller is gated to avoid
  // by `turn.messages[0]?.kind === "user_message"` upstream.
  const head = turn.messages[0];
  const raw = head !== undefined && head.kind === "user_message" ? head.text : "";
  let text = raw.trim();
  if (text.startsWith("> ")) text = text.slice(2);
  else if (text.startsWith(">")) text = text.slice(1);
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= REQUEST_PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, REQUEST_PREVIEW_MAX_CHARS - 1)}…`;
}

// ---------------------------------------------------------------------------
// Shared frame
// ---------------------------------------------------------------------------

/**
 * Popover-content frame shared by every Z2 anchor — centered uppercase
 * title bar above a 1px rule, then the body. The summary footer is
 * NOT rendered here for the row-grid popovers (Time / Tokens / state
 * log): those use {@link DevPopoverRowGrid}, which folds the summary
 * into the same subgrid so columns align across rows and summary.
 * The Context popover renders its own arc + legend body and never
 * carries a summary footer.
 *
 * `data-popover-kind` lets a callsite tune width / padding via the
 * stylesheet without each popover redeclaring its own root rule.
 */
function PerAreaPopoverFrame({
  title,
  children,
  kind,
}: {
  title: string;
  children: React.ReactNode;
  /**
   * `default` → the Time / Tokens narrow width.
   * `context` → wider cap for the segmented arc + legend.
   * `state-log` → wider, taller cap for the state-change row log.
   */
  kind?: "default" | "context" | "state-log";
}): React.ReactElement {
  return (
    <div
      className="dev-popover-frame"
      data-popover-kind={kind ?? "default"}
      data-slot="dev-popover-frame"
    >
      <div className="dev-popover-frame-title">{title}</div>
      <div className="dev-popover-frame-rule" />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row primitives — subgrid-shared 4-column layout
// ---------------------------------------------------------------------------

/**
 * One row in a Time / Tokens popover. Renders four grid cells (label /
 * preview / annotation / value) into the surrounding
 * {@link DevPopoverRowGrid} via CSS subgrid. Columns size to the
 * widest content across EVERY row in the grid (both the scrollable
 * row list and the summary footer), so the column edges line up
 * vertically end-to-end.
 *
 * Four-column contract:
 *   col 1 → label (muted, left-aligned — the turn's `#NNNN` entry
 *           pair for per-turn rows, "turns" / "total" / "avg" for the
 *           summary rows)
 *   col 2 → preview (the turn's request-string preview; empty on the
 *           summary rows)
 *   col 3 → annotation (badge or hint, right-aligned within the
 *           column so it abuts the value)
 *   col 4 → value (normal, right-aligned, e.g. "30.1K" / "0h 0m 02s")
 *
 * `label` and `preview` accept a `ReactNode`; `preview` is omitted on
 * the summary rows, whose cell then renders empty (the column still
 * exists so the summary stays column-aligned with the per-turn rows).
 */
function PopoverRow({
  label,
  preview,
  value,
  hint,
  badge,
}: {
  label: React.ReactNode;
  preview?: React.ReactNode;
  value: string;
  hint?: string;
  badge?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="dev-popover-row" data-slot="dev-popover-row">
      <span className="dev-popover-row-label">{label}</span>
      <span className="dev-popover-row-preview">{preview ?? null}</span>
      <span className="dev-popover-row-annotation">
        {badge !== undefined ? badge : hint !== undefined ? hint : null}
      </span>
      <span className="dev-popover-row-value">{value}</span>
    </div>
  );
}

/**
 * One transcript entry number — `#NNNN` in the format the transcript
 * stamps on its entries (via {@link formatSequenceNumber}, where the
 * sequence is `rowIndex + 1`).
 *
 * When `onScrollToRow` is supplied the number renders as a button
 * that scrolls the transcript to that entry's row; otherwise it is
 * inert text (gallery / fixtures, with no transcript to drive). The
 * click is a control-style action — fire-and-forget to the handler
 * the dev card threaded down; no popover-local state.
 */
function TurnNumberButton({
  rowIndex,
  onScrollToRow,
}: {
  rowIndex: number;
  onScrollToRow?: ScrollToRowHandler;
}): React.ReactElement {
  const sequenceText = formatSequenceNumber(rowIndex + 1);
  if (onScrollToRow === undefined) {
    return (
      <span className="dev-popover-row-turn-static">{sequenceText}</span>
    );
  }
  return (
    <button
      type="button"
      className="dev-popover-row-turn"
      data-slot="dev-popover-row-turn"
      aria-label={`Scroll the transcript to entry ${sequenceText}`}
      onClick={() => onScrollToRow(rowIndex)}
    >
      {sequenceText}
    </button>
  );
}

/**
 * Per-turn row label — the PAIR of transcript entry numbers a turn
 * spans: the user-half row (`#N`) and the assistant-half row
 * (`#N+1`). Each number is independently clickable, so the reader
 * can jump to either side of the turn. Mirrors the transcript's
 * own two-entries-per-turn structure.
 *
 * Wake turns ([D06]) have NO user row — `userRowIndexForTurn` returns
 * `-1` for them, and we render only the assistant-half button (no
 * `·` separator). The single-number rendering is the popover's
 * visual cue that the turn doesn't have a user submission to
 * scroll to.
 */
function TurnEntryPair({
  turnIndex,
  transcript,
  onScrollToRow,
}: {
  turnIndex: number;
  transcript: ReadonlyArray<TurnEntry>;
  onScrollToRow?: ScrollToRowHandler;
}): React.ReactElement {
  const turn = transcript[turnIndex];
  const hasUserMessage = turn?.messages[0]?.kind === "user_message";
  const assistantRow = assistantRowIndexForTurn(turnIndex, transcript);
  if (!hasUserMessage) {
    // Wake turn — render only the assistant-half number, no separator.
    return (
      <span className="dev-popover-turn-pair" data-slot="dev-popover-turn-pair">
        <TurnNumberButton
          rowIndex={assistantRow}
          onScrollToRow={onScrollToRow}
        />
      </span>
    );
  }
  const userRow = userRowIndexForTurn(turnIndex, transcript);
  return (
    <span className="dev-popover-turn-pair" data-slot="dev-popover-turn-pair">
      <TurnNumberButton
        rowIndex={userRow}
        onScrollToRow={onScrollToRow}
      />
      <span className="dev-popover-turn-pair-sep" aria-hidden>
        ·
      </span>
      <TurnNumberButton
        rowIndex={assistantRow}
        onScrollToRow={onScrollToRow}
      />
    </span>
  );
}

/**
 * The turn's request-string preview cell — an end-truncated
 * `TugLabel` (see {@link requestPreviewText}). Muted + mono so it
 * sits quietly between the entry-number pair and the end-state badge.
 */
function RequestPreview({ turn }: { turn: TurnEntry }): React.ReactElement {
  return (
    <TugLabel className="dev-popover-row-request" mono emphasis="calm">
      {requestPreviewText(turn)}
    </TugLabel>
  );
}

/**
 * Shared 3-column grid spanning the popover's row list AND its
 * summary footer. Both blocks render into the same outer grid via
 * `subgrid`, so the label / annotation / value column edges line up
 * vertically across every row — including across the divider that
 * separates the scrolling list from the summary rows.
 *
 * The row list lives inside a scroller `<div>` with `max-height` +
 * `overflow-y: auto` capped at the shared 10-row visible height; the
 * summary rows sit in a sibling `<div>` below the divider and are
 * always visible. Both wrappers carry the SAME right-edge gutter
 * (`--dev-popover-scroll-gutter`) so their subgrid tracks inset
 * equally — the scroller's columns and the summary's columns line up
 * across the divider. (Padding the scroller alone drifts its columns
 * left of the summary's by the gutter width.)
 *
 * If the row list is empty, the grid degenerates to "summary only"
 * (or to the caller's `empty` content when no summary applies).
 */
function DevPopoverRowGrid({
  rows,
  summary,
  empty,
}: {
  rows: ReadonlyArray<React.ReactElement>;
  summary?: ReadonlyArray<React.ReactElement>;
  empty?: React.ReactNode;
}): React.ReactElement {
  const hasRows = rows.length > 0;
  const summaryRows = summary ?? [];
  const hasSummary = summaryRows.length > 0;
  if (!hasRows && !hasSummary) {
    return <>{empty ?? <EmptyTranscriptBody />}</>;
  }
  return (
    <div className="dev-popover-row-grid" data-slot="dev-popover-row-grid">
      {hasRows ? (
        <div className="dev-popover-row-grid-scroller">{rows}</div>
      ) : (
        <div className="dev-popover-row-grid-empty">
          {empty ?? <EmptyTranscriptBody />}
        </div>
      )}
      {hasSummary ? (
        <>
          <div className="dev-popover-row-grid-divider" aria-hidden />
          <div
            className="dev-popover-row-grid-summary"
            data-slot="dev-popover-row-grid-summary"
          >
            {summaryRows}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Per-turn end-state chip — driven by the same `endStateBadgeFor`
 * dispatch the Z1B end-state row uses, so the popover row and the
 * Z1B footer always read the same text + tone for a given turn.
 *
 * Renders as a `ghost`-emphasis TugBadge to keep the row chrome
 * quiet (the popover lists many rows; a `tinted` badge per row
 * would dominate).
 */
function TurnEndStateBadge({ turn }: { turn: TurnEntry }): React.ReactElement {
  const badge: EndStateBadge = endStateBadgeFor(turn.turnEndReason);
  return (
    <TugBadge emphasis="ghost" role={badge.role} size="sm">
      {badge.text}
    </TugBadge>
  );
}

/**
 * Empty-row body shared by Time / Tokens / state-log popovers. Same
 * muted typographic weight as the rest of the popover so the empty
 * state doesn't read as an error.
 */
function EmptyTranscriptBody(): React.ReactElement {
  return (
    <div className="dev-popover-empty" data-slot="dev-popover-empty">
      No committed turns yet.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time popover
// ---------------------------------------------------------------------------

/**
 * `Time` popover — per-turn `activeMs` log + summary footer (count,
 * total, average) + optional in-flight footer surfacing the live
 * current-turn elapsed when a turn is in flight. The summary is
 * derived by `computeTimeSummary` so the gallery + production
 * popovers compute identical numbers.
 *
 * Row + summary share a single subgrid so the column edges line up
 * end-to-end ({@link DevPopoverRowGrid}).
 */
export function TimePopoverContent({
  transcript,
  inflight,
  onScrollToRow,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  inflight: { currentTurnActiveMs: number } | null;
  onScrollToRow?: ScrollToRowHandler;
}): React.ReactElement {
  const summary = computeTimeSummary(transcript);
  const rows = transcript.map((t, i) => (
    <PopoverRow
      key={t.turnKey}
      label={<TurnEntryPair turnIndex={i} transcript={transcript} onScrollToRow={onScrollToRow} />}
      preview={<RequestPreview turn={t} />}
      value={formatTimeAlwaysHours(t.activeMs)}
      badge={<TurnEndStateBadge turn={t} />}
    />
  ));
  const summaryRows: React.ReactElement[] = [
    <PopoverRow key="turns" label="turns" value={String(summary.count)} />,
    <PopoverRow
      key="total"
      label="total"
      value={formatTimeAlwaysHours(summary.totalActiveMs)}
    />,
    <PopoverRow
      key="avg"
      label="avg"
      value={formatTimeAlwaysHours(summary.avgActiveMs)}
      hint="per turn"
    />,
  ];
  if (inflight !== null) {
    summaryRows.push(
      <PopoverRow
        key="current"
        label="current turn"
        value={formatTimeAlwaysHours(inflight.currentTurnActiveMs)}
        hint="in flight"
      />,
    );
  }
  return (
    <PerAreaPopoverFrame title="Per-request log — Time">
      <DevPopoverRowGrid rows={rows} summary={summaryRows} />
    </PerAreaPopoverFrame>
  );
}

// ---------------------------------------------------------------------------
// Tokens popover
// ---------------------------------------------------------------------------

/**
 * `Tokens` popover — per-turn token log + summary footer. Each turn's
 * figure is its SIGNED `perTurn` window delta (`window(N) −
 * window(N−1)`, the transcript window-walk — the same number Z1B
 * shows), never a sum of raw `TurnCost`. A `/compact` turn reads as an
 * honest negative. Same in-flight contract as the Time popover:
 * in-flight turns are excluded from the row log, with the live
 * current-turn delta surfaced as a separate footer row.
 *
 * Row + summary share a single subgrid ({@link DevPopoverRowGrid}).
 */
export function TokensPopoverContent({
  transcript,
  sessionInitTokens,
  inflight,
  onScrollToRow,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  sessionInitTokens: number | null;
  inflight: { currentTurnTokens: number } | null;
  onScrollToRow?: ScrollToRowHandler;
}): React.ReactElement {
  const summary = computeTokensSummary(transcript, sessionInitTokens);
  const rows = transcript.map((t, i) => (
    <PopoverRow
      key={t.turnKey}
      label={<TurnEntryPair turnIndex={i} transcript={transcript} onScrollToRow={onScrollToRow} />}
      preview={<RequestPreview turn={t} />}
      value={formatTokensCaps(summary.perTurn[i] ?? 0)}
      badge={<TurnEndStateBadge turn={t} />}
    />
  ));
  const summaryRows: React.ReactElement[] = [
    <PopoverRow key="turns" label="turns" value={String(summary.count)} />,
    <PopoverRow
      key="total"
      label="total"
      value={formatTokensCaps(summary.totalTokens)}
    />,
    <PopoverRow
      key="avg"
      label="avg"
      value={formatTokensCaps(summary.avgTokensPerTurn)}
      hint="per turn"
    />,
  ];
  if (inflight !== null) {
    summaryRows.push(
      <PopoverRow
        key="current"
        label="current turn"
        value={formatTokensCaps(inflight.currentTurnTokens)}
        hint="in flight"
      />,
    );
  }
  return (
    <PerAreaPopoverFrame title="Per-request log — Tokens">
      <DevPopoverRowGrid rows={rows} summary={summaryRows} />
    </PerAreaPopoverFrame>
  );
}

// ---------------------------------------------------------------------------
// Context popover
// ---------------------------------------------------------------------------

function formatContextPercent(used: number, max: number): string {
  if (max <= 0) return "0.0%";
  return `${((used / max) * 100).toFixed(1)}%`;
}

function contextSegmentSwatchVar(tone: TugArcGaugeSegment["tone"]): string {
  return `var(--tugx-arc-gauge-segment-${tone}-color)`;
}

/**
 * `Context` popover — the `/context`-style session breakdown.
 *
 * Renders the assembled {@link ContextBreakdown} the status row hands
 * down — the SAME object the `CONTEXT` cell reads its total from, so
 * the two surfaces cannot disagree. Its total and `messages` slice
 * are feed-exact (`window` / `sessionInit`); the five static
 * categories are tugcode's local estimate, scaled to the feed-exact
 * bootstrap. `mcp_tools` is intentionally absent — Tug treats MCP as
 * out of scope.
 *
 * `breakdown === null` means no `context_breakdown` frame has landed
 * yet — the popover surfaces an explicit empty state.
 */
export function ContextPopoverContent({
  breakdown,
}: {
  breakdown: ContextBreakdown | null;
}): React.ReactElement {
  if (breakdown === null) {
    return (
      <PerAreaPopoverFrame title="Context window" kind="context">
        <div className="dev-popover-empty">
          Session-init breakdown not yet recorded.
        </div>
      </PerAreaPopoverFrame>
    );
  }
  return (
    <PerAreaPopoverFrame title="Context window" kind="context">
      <ContextBreakdownBody
        segments={breakdown.segments}
        contextMax={breakdown.contextMax}
        totalUsed={breakdown.totalUsed}
      />
    </PerAreaPopoverFrame>
  );
}

/**
 * Body for the Context popover — large segmented gauge on the left,
 * per-category legend + used/max summary in a single 3-column grid
 * on the right so column edges line up across the legend / summary
 * divider. Used by both rich and (when present) fallback paths.
 */
function ContextBreakdownBody({
  segments,
  contextMax,
  totalUsed,
}: {
  segments: ReadonlyArray<TugArcGaugeSegment>;
  contextMax: number;
  totalUsed: number;
}): React.ReactElement {
  return (
    <div className="dev-context-popover-body">
      <div className="dev-context-popover-gauge">
        <TugArcGauge
          min={0}
          max={contextMax}
          value={0}
          density="detailed"
          formatValue={formatTokensCaps}
          segments={segments}
        />
      </div>
      <div className="dev-context-popover-grid">
        {segments.map((s) => (
          <React.Fragment key={s.id}>
            <span className="dev-context-popover-legend-label">
              <span
                className="dev-context-popover-swatch"
                style={{ backgroundColor: contextSegmentSwatchVar(s.tone) }}
              />
              {s.label}
            </span>
            <span className="dev-context-popover-legend-percent">
              {formatContextPercent(s.value, contextMax)}
            </span>
            <span className="dev-context-popover-legend-value">
              {formatTokensCaps(s.value)}
            </span>
          </React.Fragment>
        ))}
        <div className="dev-context-popover-grid-divider" />
        <span className="dev-context-popover-summary-label">used</span>
        <span className="dev-context-popover-summary-percent">
          {formatContextPercent(totalUsed, contextMax)}
        </span>
        <span className="dev-context-popover-summary-value">
          {formatTokensCaps(totalUsed)}
        </span>
        <span className="dev-context-popover-summary-label">max</span>
        <span />
        <span className="dev-context-popover-summary-value">
          {formatTokensCaps(contextMax)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State-change log popover
// ---------------------------------------------------------------------------

type StateChangeTone = "default" | "success" | "caution" | "danger";

/**
 * Map a session-phase input onto a tone key. Resolves the same
 * (phase × transport × interrupt) → tone triple the inline
 * {@link TugProgressIndicator} uses, without instantiating an
 * indicator per row.
 */
function stateChangeToneFor(input: DevSessionPhaseInput): StateChangeTone {
  const visual = devSessionPhaseVisual(devSessionPhaseKey(input));
  if (visual.role === "danger") return "danger";
  if (visual.role === "caution") return "caution";
  if (visual.role === "success") return "success";
  return "default";
}

/** Map a tone key to the color token used in the popover's tone dot. */
function stateChangeToneVar(tone: StateChangeTone): string {
  switch (tone) {
    case "success":
      return "var(--tug7-element-global-text-normal-success-rest)";
    case "caution":
      return "var(--tug7-element-global-text-normal-caution-rest)";
    case "danger":
      return "var(--tug7-element-global-text-normal-danger-rest)";
    case "default":
    default:
      return "var(--tug7-element-global-text-normal-default-rest)";
  }
}

/**
 * Distance from the bottom (px) the auto-scroll considers "still
 * pinned." If the user scrolls up further than this, the effect
 * stops chasing new rows.
 */
const AUTOSCROLL_THRESHOLD_PX = 8;

/**
 * Scrolling log of every persisted state change for a session. One
 * shared 5-column grid (tone dot · timestamp · phase · transport ·
 * interrupt); all rows live in one grid so each column sizes to
 * the widest entry across the log. Auto-scroll keeps the most
 * recent row in view unless the user scrolls away from the bottom.
 *
 * `rows` is the snapshot returned by `useSessionStateChanges`.
 */
export function StateChangeLogPopoverContent({
  rows,
}: {
  rows: ReadonlyArray<SessionStateChangeRow>;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef<boolean>(true);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  });

  const onScroll = (ev: React.UIEvent<HTMLDivElement>): void => {
    const el = ev.currentTarget;
    const distanceFromBottom =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickToBottomRef.current = distanceFromBottom <= AUTOSCROLL_THRESHOLD_PX;
  };

  if (rows.length === 0) {
    return (
      <PerAreaPopoverFrame title="Session state changes" kind="state-log">
        <div
          className="dev-popover-empty"
          data-slot="dev-popover-empty-state-changes"
        >
          No state changes recorded yet.
        </div>
      </PerAreaPopoverFrame>
    );
  }

  const formatted = rows.map((r) => formatStateChangeRow(r));

  return (
    <PerAreaPopoverFrame title="Session state changes" kind="state-log">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="dev-state-log-scroller"
        data-slot="dev-state-log-scroller"
      >
        <div className="dev-state-log-grid">
          {rows.map((row, i) => {
            const f = formatted[i]!;
            const tone = stateChangeToneFor(row);
            return (
              <React.Fragment key={`${f.atText}-${i}`}>
                <span
                  aria-hidden
                  className="dev-state-log-dot"
                  style={{ backgroundColor: stateChangeToneVar(tone) }}
                />
                <span className="dev-state-log-time">{f.atText}</span>
                <span className="dev-state-log-phase">{f.phase}</span>
                <span className="dev-state-log-transport">
                  {f.transportState}
                </span>
                <span className="dev-state-log-interrupt">
                  {`interrupt: ${f.interrupt}`}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </PerAreaPopoverFrame>
  );
}

// ---------------------------------------------------------------------------
// Tasks popover
// ---------------------------------------------------------------------------

/**
 * Resolve a task status × the session's idle gate onto the
 * indicator's `state`. The role falls out of the indicator's
 * state→role default (running → action, completed → success,
 * stopped → inherit).
 *
 *  - `pending`     → stopped   (quiet muted dot)
 *  - `in_progress` → running   (action-colored dot + ring pulse)
 *                     idle session demotes to stopped
 *  - `completed`   → completed (success-colored filled dot)
 */
function taskRowState(
  status: TaskStatus,
  idle: boolean,
): TugProgressIndicatorState {
  if (status === "completed") return "completed";
  if (status === "in_progress") return idle ? "stopped" : "running";
  return "stopped";
}

/**
 * Tasks popover — opened from the `TASKS` cell in the status row.
 * Renders the full assembled task list ([D100]) as a flex column of
 * {@link TugProgressIndicator} rows in the `pulsing-dot` variant
 * with `glyphPosition="left"`. Each row's status drives its
 * `(role, state)` pair through {@link taskRowVisual}; an `idle`
 * session demotes any `in_progress` row to `state="stopped"`
 * (same gate that stops the status-bar TASKS dot). Rows with
 * descriptions wrap in a `TugTooltip` so the longer prose surfaces
 * on hover.
 *
 * An empty `tasks` array renders the standard popover empty message.
 */
export function TasksPopoverContent({
  state,
  idle,
}: {
  state: TaskListState;
  idle: boolean;
}): React.ReactElement {
  if (state.tasks.length === 0) {
    return (
      <PerAreaPopoverFrame title="Tasks">
        <div className="dev-popover-empty">No tasks for this session.</div>
      </PerAreaPopoverFrame>
    );
  }
  // `composeTaskSummary` produces "3 done, 1 in progress, 2 pending"
  // with zero-bucket drop, so the footer reads cleanly whether the
  // list is all-done, mid-flight, or untouched.
  const summary = composeTaskSummary(countTasks(state.tasks));
  return (
    <PerAreaPopoverFrame title="Tasks">
      <div
        className="dev-tasks-popover-body"
        data-slot="dev-tasks-popover-body"
      >
        {state.tasks.map((task) => {
          const text =
            task.status === "in_progress" && task.activeForm !== undefined
              ? task.activeForm
              : task.subject;
          const row = (
            <TugProgressIndicator
              variant="pulsing-dot"
              glyphPosition="left"
              size={14}
              state={taskRowState(task.status, idle)}
              label={text}
              data-status={task.status}
              className="dev-tasks-popover-row"
            />
          );
          if (task.description === undefined) {
            return <React.Fragment key={task.taskId}>{row}</React.Fragment>;
          }
          return (
            <TugTooltip
              key={task.taskId}
              content={task.description}
              side="top"
              align="start"
            >
              {row}
            </TugTooltip>
          );
        })}
      </div>
      <div
        className="dev-tasks-popover-footer"
        data-slot="dev-tasks-popover-footer"
      >
        <span className="dev-tasks-popover-pending">{summary}</span>
        <BlockCopyButton
          aria-label="Copy task list"
          getText={() => composeTaskCopyText(state.tasks)}
        />
      </div>
    </PerAreaPopoverFrame>
  );
}
