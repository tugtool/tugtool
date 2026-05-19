/**
 * tide-card-telemetry-popovers.tsx — popover content components for
 * the four Z2 status-row anchors (indicator, TIME, TOKENS, CONTEXT).
 *
 * Each component renders inside a `TugPopoverContent` returned by
 * `TideTelemetryStatusRow`. The popovers share a layout vocabulary
 * (`PerAreaPopoverFrame`, `PopoverRow`, `PopoverRowScroller`) so the
 * four surfaces read with the same rhythm — title bar above a 1px
 * rule, optional row-list body, optional summary footer separated
 * by a second rule.
 *
 * Polished in `gallery-tide-status-row.tsx` (workshop) and promoted
 * here for production use by Step 20.4.15. The promotion translates
 * the gallery's inline-style layout into class-driven CSS per [L19]
 * / [L20]; the data shapes and semantics are unchanged from the
 * workshop pinning.
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
import { formatStateChangeRow } from "@/lib/code-session-store/state-change-formatter";
import {
  computeContextBreakdown,
  computeRichContextBreakdown,
  computeTimeSummary,
  computeTokensSummary,
  type ContextBreakdownSnapshotInput,
} from "@/lib/code-session-store/telemetry";
import type { TurnEntry } from "@/lib/code-session-store/types";
import type { SessionStateChangeRow } from "@/lib/session-state-changes-reader";

import { formatTimeAlwaysHours, formatTokensCaps } from "./tide-card-telemetry-renderers";

// ---------------------------------------------------------------------------
// Shared frame + row primitives
// ---------------------------------------------------------------------------

/**
 * Popover-content frame shared by every Z2 anchor — centered uppercase
 * title bar above a 1px rule, body slot, optional separator-fronted
 * summary footer. The frame owns the chrome so popovers stay
 * structurally consistent — only the body content differs.
 *
 * `data-popover-kind` lets a callsite tune width / padding via the
 * stylesheet without each popover redeclaring its own root rule.
 */
function PerAreaPopoverFrame({
  title,
  children,
  summaryFooter,
  kind,
}: {
  title: string;
  children: React.ReactNode;
  summaryFooter?: React.ReactNode;
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
      {summaryFooter !== undefined && summaryFooter !== null ? (
        <div className="tide-popover-frame-footer">{summaryFooter}</div>
      ) : null}
    </div>
  );
}

/**
 * Single row inside a Time / Tokens popover. Three-column grid —
 * label (muted, left), badge-or-hint (annotation, right-aligned to
 * abut value), value (normal, right). The grid's columns
 * `auto 1fr auto` keep values right-aligned across rows even when
 * widths vary, so a column-scan reads cleanly. `label` accepts a
 * `ReactNode` so callsites can prepend swatches inline.
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
 * Per-row chip rendering the turn's terminal state. `success` reads
 * as low-emphasis (muted ghost); `interrupted` reads as caution so
 * the row jumps slightly out of the column.
 */
function TerminalStateBadge({
  result,
}: {
  result: TurnEntry["result"];
}): React.ReactElement {
  if (result === "interrupted") {
    return (
      <TugBadge emphasis="tinted" role="caution" size="sm">
        interrupted
      </TugBadge>
    );
  }
  return (
    <TugBadge emphasis="ghost" role="success" size="sm">
      success
    </TugBadge>
  );
}

/**
 * Empty-transcript body shared by the Time + Tokens popovers. Same
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

/**
 * Scrolling wrapper for the row-list popovers (Time / Tokens). Caps
 * the body at the shared 10-row visible height and gutters the
 * scrollbar so the value column never sits flush against the thumb.
 */
function PopoverRowScroller({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="tide-popover-row-scroller" data-slot="tide-popover-row-scroller">
      {children}
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
 */
export function TimePopoverContent({
  transcript,
  inflight,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  inflight: { currentTurnActiveMs: number } | null;
}): React.ReactElement {
  const summary = computeTimeSummary(transcript);
  return (
    <PerAreaPopoverFrame
      title="Per-request log — Time"
      summaryFooter={
        <>
          <PopoverRow label="turns" value={String(summary.count)} />
          <PopoverRow
            label="total"
            value={formatTimeAlwaysHours(summary.totalActiveMs)}
          />
          <PopoverRow
            label="avg"
            value={formatTimeAlwaysHours(summary.avgActiveMs)}
            hint="per turn"
          />
          {inflight !== null ? (
            <PopoverRow
              label="current turn"
              value={formatTimeAlwaysHours(inflight.currentTurnActiveMs)}
              hint="in flight"
            />
          ) : null}
        </>
      }
    >
      {transcript.length === 0 ? (
        <EmptyTranscriptBody />
      ) : (
        <PopoverRowScroller>
          {transcript.map((t, i) => (
            <PopoverRow
              key={t.turnKey}
              label={`turn ${i + 1}`}
              value={formatTimeAlwaysHours(t.activeMs)}
              badge={<TerminalStateBadge result={t.result} />}
            />
          ))}
        </PopoverRowScroller>
      )}
    </PerAreaPopoverFrame>
  );
}

// ---------------------------------------------------------------------------
// Tokens popover
// ---------------------------------------------------------------------------

/** Per-turn token sum — mirrors the Z2 TOKENS cell's headline formula. */
function perTurnTotalTokens(turn: TurnEntry): number {
  return (
    turn.cost.inputTokens +
    turn.cost.outputTokens +
    turn.cost.cacheReadInputTokens +
    turn.cost.cacheCreationInputTokens
  );
}

/**
 * `Tokens` popover — per-turn token-sum log + summary footer. Same
 * in-flight contract as the Time popover: in-flight turns are
 * excluded from the row log, with the live current-turn contribution
 * surfaced as a separate footer row when a turn is in flight.
 */
export function TokensPopoverContent({
  transcript,
  inflight,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  inflight: { currentTurnTokens: number } | null;
}): React.ReactElement {
  const summary = computeTokensSummary(transcript);
  return (
    <PerAreaPopoverFrame
      title="Per-request log — Tokens"
      summaryFooter={
        <>
          <PopoverRow label="turns" value={String(summary.count)} />
          <PopoverRow label="total" value={formatTokensCaps(summary.totalTokens)} />
          <PopoverRow
            label="avg"
            value={formatTokensCaps(summary.avgTokensPerTurn)}
            hint="per turn"
          />
          {inflight !== null ? (
            <PopoverRow
              label="current turn"
              value={formatTokensCaps(inflight.currentTurnTokens)}
              hint="in flight"
            />
          ) : null}
        </>
      }
    >
      {transcript.length === 0 ? (
        <EmptyTranscriptBody />
      ) : (
        <PopoverRowScroller>
          {transcript.map((t, i) => (
            <PopoverRow
              key={t.turnKey}
              label={`turn ${i + 1}`}
              value={formatTokensCaps(perTurnTotalTokens(t))}
              badge={<TerminalStateBadge result={t.result} />}
            />
          ))}
        </PopoverRowScroller>
      )}
    </PerAreaPopoverFrame>
  );
}

// ---------------------------------------------------------------------------
// Context popover
// ---------------------------------------------------------------------------

/** Showcase scale used by the large segmented gauge inside the popover. */
const CONTEXT_GAUGE_LARGE_PX = 180;

function formatContextPercent(used: number, max: number): string {
  if (max <= 0) return "0.0%";
  return `${((used / max) * 100).toFixed(1)}%`;
}

function contextSegmentSwatchVar(tone: TugArcGaugeSegment["tone"]): string {
  return `var(--tugx-arc-gauge-segment-${tone}-color)`;
}

/**
 * `Context` popover — two render paths backed by one helper:
 *
 *  - **Rich path:** when the snapshot carries a `lastContextBreakdown`,
 *    paint the `/context`-style per-category breakdown via
 *    `computeRichContextBreakdown` (system_prompt / system_tools /
 *    custom_agents / memory_files / skills / messages + optional
 *    autocompact_buffer + remainder). Numbers are tokenized in
 *    tugcode within the documented 5–10% accuracy bar.
 *  - **Fallback path:** when no breakdown frame has landed, render
 *    the cost_update-derived 5-segment view against the last
 *    committed turn (input / cache-read / cache-creation / output /
 *    remainder), via `computeContextBreakdown`.
 *
 * Empty state: when neither the breakdown frame nor any committed
 * turn is available, the popover renders the empty-transcript
 * placeholder. `mcp_tools` is intentionally absent from the rich
 * path — Tug treats MCP as out of scope.
 */
export function ContextPopoverContent({
  transcript,
  contextMax,
  lastContextBreakdown,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  contextMax: number;
  lastContextBreakdown?: ContextBreakdownSnapshotInput | null;
}): React.ReactElement {
  const breakdown = computeRichContextBreakdown(
    lastContextBreakdown ?? null,
    transcript,
    contextMax,
  );
  if (breakdown === null) {
    // Try the fallback path against the most recent turn before
    // surrendering to the empty state.
    const fallback =
      transcript.length > 0
        ? computeContextBreakdown(transcript[transcript.length - 1]!, contextMax)
        : null;
    if (fallback === null) {
      return (
        <PerAreaPopoverFrame title="Context window" kind="context">
          <EmptyTranscriptBody />
        </PerAreaPopoverFrame>
      );
    }
    return (
      <PerAreaPopoverFrame title="Context window" kind="context">
        <ContextBreakdownBody
          segments={fallback.segments}
          contextMax={fallback.contextMax}
          totalUsed={fallback.totalUsed}
        />
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
 * Shared body for the Context popover — large segmented gauge on
 * the left, per-category legend + used/max summary in a single
 * 3-column grid on the right so column edges line up across the
 * legend / summary divider. Used by both the rich and the
 * cost_update-derived fallback paths.
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
