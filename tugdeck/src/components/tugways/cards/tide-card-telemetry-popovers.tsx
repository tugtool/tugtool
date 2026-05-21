/**
 * tide-card-telemetry-popovers.tsx — popover content components for
 * the four Z2 status-row anchors (indicator, TIME, TOKENS, CONTEXT).
 *
 * Each component renders inside a `TugPopoverContent` returned by
 * `TideTelemetryStatusRow`. The popovers share a layout vocabulary
 * (`PerAreaPopoverFrame`, `PopoverRow`, `TidePopoverRowGrid`) so the
 * four surfaces read with the same rhythm — title bar above a 1px
 * rule, then either a 3-column row grid (Time / Tokens / state-change
 * log) or a 2-column gauge + legend layout (Context).
 *
 * **Three-column shared grid (Time / Tokens).** The row list AND the
 * summary footer share a single CSS grid via `subgrid`, so the
 * label / annotation / value columns line up vertically across every
 * row in both blocks. Without the shared grid, each row would be its
 * own grid and column edges would drift with content widths.
 *
 * **End-state badge consistency.** Per-turn rows display the badge
 * produced by `endStateBadgeFor(turn.turnEndReason)` — the same
 * dispatch the Z1B end-state display uses. The popover and the Z1B
 * footer therefore always read the same text ("OK" / "interrupted" /
 * "error" / "lost") and tone for a given turn.
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
 * @module components/tugways/cards/tide-card-telemetry-popovers
 */

import "./tide-card-telemetry-popovers.css";

import React, { useLayoutEffect, useRef } from "react";

import { TugArcGauge } from "@/components/tugways/tug-arc-gauge";
import type { TugArcGaugeSegment } from "@/components/tugways/tug-arc-gauge";
import { TugBadge } from "@/components/tugways/tug-badge";
import {
  indicatorVisualFor,
  type TugStateIndicatorTone,
} from "@/components/tugways/tug-state-indicator";
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

import { formatTimeAlwaysHours, formatTokensCaps } from "./tide-card-telemetry-renderers";

// ---------------------------------------------------------------------------
// Shared frame
// ---------------------------------------------------------------------------

/**
 * Popover-content frame shared by every Z2 anchor — centered uppercase
 * title bar above a 1px rule, then the body. The summary footer is
 * NOT rendered here for the row-grid popovers (Time / Tokens / state
 * log): those use {@link TidePopoverRowGrid}, which folds the summary
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
      className="tide-popover-frame"
      data-popover-kind={kind ?? "default"}
      data-slot="tide-popover-frame"
    >
      <div className="tide-popover-frame-title">{title}</div>
      <div className="tide-popover-frame-rule" />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row primitives — subgrid-shared 3-column layout
// ---------------------------------------------------------------------------

/**
 * One row in a Time / Tokens popover. Renders three grid cells (label
 * / annotation / value) into the surrounding {@link TidePopoverRowGrid}
 * via CSS subgrid. Columns size to the widest content across EVERY
 * row in the grid (both the scrollable row list and the summary
 * footer), so the label / annotation / value edges line up
 * vertically end-to-end.
 *
 * Three-column contract:
 *   col 1 → label (muted, left-aligned, e.g. "turn 1" / "total")
 *   col 2 → annotation (badge or hint, right-aligned within the
 *           column so it abuts the value)
 *   col 3 → value (normal, right-aligned, e.g. "30.1K" / "0h 0m 02s")
 *
 * `label` accepts a `ReactNode` so a future caller can prepend
 * swatches inline (the Context popover used to do this in the
 * gallery; it now uses a separate body).
 */
function PopoverRow({
  label,
  value,
  hint,
  badge,
}: {
  label: React.ReactNode;
  value: string;
  hint?: string;
  badge?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="tide-popover-row" data-slot="tide-popover-row">
      <span className="tide-popover-row-label">{label}</span>
      <span className="tide-popover-row-annotation">
        {badge !== undefined ? badge : hint !== undefined ? hint : null}
      </span>
      <span className="tide-popover-row-value">{value}</span>
    </div>
  );
}

/**
 * Shared 3-column grid spanning the popover's row list AND its
 * summary footer. Both blocks render into the same outer grid via
 * `subgrid`, so the label / annotation / value column edges line up
 * vertically across every row — including across the divider that
 * separates the scrolling list from the summary rows.
 *
 * The row list lives inside a `<div>` with `max-height` + `overflow-y:
 * auto` capped at the shared 10-row visible height; the summary rows
 * sit below the divider and are always visible.
 *
 * If the row list is empty, the grid degenerates to "summary only"
 * (or to the caller's `empty` content when no summary applies).
 */
function TidePopoverRowGrid({
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
    <div className="tide-popover-row-grid" data-slot="tide-popover-row-grid">
      {hasRows ? (
        <div className="tide-popover-row-grid-scroller">{rows}</div>
      ) : (
        <div className="tide-popover-row-grid-empty">
          {empty ?? <EmptyTranscriptBody />}
        </div>
      )}
      {hasSummary ? (
        <>
          <div className="tide-popover-row-grid-divider" aria-hidden />
          {summaryRows}
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
    <div className="tide-popover-empty" data-slot="tide-popover-empty">
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
 * end-to-end ({@link TidePopoverRowGrid}).
 */
export function TimePopoverContent({
  transcript,
  inflight,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  inflight: { currentTurnActiveMs: number } | null;
}): React.ReactElement {
  const summary = computeTimeSummary(transcript);
  const rows = transcript.map((t, i) => (
    <PopoverRow
      key={t.turnKey}
      label={`turn ${i + 1}`}
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
      <TidePopoverRowGrid rows={rows} summary={summaryRows} />
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
 * Row + summary share a single subgrid ({@link TidePopoverRowGrid}).
 */
export function TokensPopoverContent({
  transcript,
  sessionInitTokens,
  inflight,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  sessionInitTokens: number | null;
  inflight: { currentTurnTokens: number } | null;
}): React.ReactElement {
  const summary = computeTokensSummary(transcript, sessionInitTokens);
  const rows = transcript.map((t, i) => (
    <PopoverRow
      key={t.turnKey}
      label={`turn ${i + 1}`}
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
      <TidePopoverRowGrid rows={rows} summary={summaryRows} />
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
        <div className="tide-popover-empty">
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
    <div className="tide-context-popover-body">
      <div className="tide-context-popover-gauge">
        <TugArcGauge
          min={0}
          max={contextMax}
          value={0}
          density="detailed"
          formatValue={formatTokensCaps}
          segments={segments}
        />
      </div>
      <div className="tide-context-popover-grid">
        {segments.map((s) => (
          <React.Fragment key={s.id}>
            <span className="tide-context-popover-legend-label">
              <span
                className="tide-context-popover-swatch"
                style={{ backgroundColor: contextSegmentSwatchVar(s.tone) }}
              />
              {s.label}
            </span>
            <span className="tide-context-popover-legend-percent">
              {formatContextPercent(s.value, contextMax)}
            </span>
            <span className="tide-context-popover-legend-value">
              {formatTokensCaps(s.value)}
            </span>
          </React.Fragment>
        ))}
        <div className="tide-context-popover-grid-divider" />
        <span className="tide-context-popover-summary-label">used</span>
        <span className="tide-context-popover-summary-percent">
          {formatContextPercent(totalUsed, contextMax)}
        </span>
        <span className="tide-context-popover-summary-value">
          {formatTokensCaps(totalUsed)}
        </span>
        <span className="tide-context-popover-summary-label">max</span>
        <span />
        <span className="tide-context-popover-summary-value">
          {formatTokensCaps(contextMax)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State-change log popover
// ---------------------------------------------------------------------------

/**
 * Map a state-indicator tone to the matching color token the
 * indicator's CSS uses for its dot. Lets the popover's tone dot
 * read the same color as the indicator would for that triple
 * without instantiating a `TugStateIndicator` per row.
 */
function stateChangeToneVar(tone: TugStateIndicatorTone): string {
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
          className="tide-popover-empty"
          data-slot="tide-popover-empty-state-changes"
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
        className="tide-state-log-scroller"
        data-slot="tide-state-log-scroller"
      >
        <div className="tide-state-log-grid">
          {rows.map((row, i) => {
            const f = formatted[i]!;
            const tone = indicatorVisualFor(row).tone;
            return (
              <React.Fragment key={`${f.atText}-${i}`}>
                <span
                  aria-hidden
                  className="tide-state-log-dot"
                  style={{ backgroundColor: stateChangeToneVar(tone) }}
                />
                <span className="tide-state-log-time">{f.atText}</span>
                <span className="tide-state-log-phase">{f.phase}</span>
                <span className="tide-state-log-transport">
                  {f.transportState}
                </span>
                <span className="tide-state-log-interrupt">
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
