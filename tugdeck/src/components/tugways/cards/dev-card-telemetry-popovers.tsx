/**
 * dev-card-telemetry-popovers.tsx — popup content for the six Z2
 * status-row anchors (STATE, TIME, TOKENS, CONTEXT, TASKS, JOBS).
 *
 * Every popup composes the shared `TugPopupList` vocabulary — frame,
 * log grid, item rows, footer — so the six surfaces read with one
 * rhythm. This module contributes only what is dev-card-specific:
 * turn-address links into the transcript, per-turn previews and
 * end-state badges, task/job row assembly, and the copy-text
 * composers behind each footer's COPY affordance.
 *
 * Titles match the Z2 cell legends (STATE / TIME / TOKENS / CONTEXT /
 * TASKS / JOBS) so a popup and its trigger read as one instrument.
 *
 * **Footer affordances.** Log-shaped popups (all but CONTEXT) carry a
 * COPY action that writes the visible list as plain text; JOBS adds
 * CLEAR (a deck-local wipe of terminal rows). Every action is the
 * standard popup-list footer shape (2xs outlined push-button chrome).
 *
 * **End-state badge consistency.** Per-turn rows display the badge
 * produced by `endStateBadgeFor(turn.turnEndReason)` — the same
 * dispatch the Z1B end-state display uses, so the two surfaces always
 * read the same text and tone for a given turn.
 *
 * **Turn-number affordance.** Each per-turn row's label is the PAIR of
 * speaker-prefixed addresses the turn spans (`#u{turn}` / `#a{turn}`),
 * matching the transcript's attribution rows. With an `onScrollToRow`
 * handler threaded down, each is an independently clickable button
 * that scrolls the transcript to that entry's row.
 *
 * Conformance:
 *  - [L02] popup content is a function of inputs only; the status row
 *    owns the `useSyncExternalStore` subscriptions.
 *  - [L06] visible state lives on CSS class / data-attribute selectors.
 *  - [L19] `.tsx` + `.css` pair; dev-specific primitives carry
 *    `data-slot` anchors for tests.
 *  - [L20] component-token sovereignty — the composed `TugPopupList` /
 *    `TugBadge` / `TugProgressIndicator` primitives keep their own
 *    tokens; this module introduces no new slot family.
 *
 * @module components/tugways/cards/dev-card-telemetry-popovers
 */

import "./dev-card-telemetry-popovers.css";

import React from "react";

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
import {
  formatTurnAddress,
  type TurnAddress,
} from "@/components/tugways/tug-transcript-entry";
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
import {
  TugPopupListEmpty,
  TugPopupListFooter,
  TugPopupListFrame,
  TugPopupListGrid,
  TugPopupListGroup,
  TugPopupListItem,
  TugPopupListItemText,
  TugPopupListRow,
  TugPopupListScroller,
  TugPopupListToneDot,
  type TugPopupListTone,
} from "@/components/tugways/tug-popup-list";

import {
  formatDurationMs,
  formatTimeAlwaysHours,
  formatTokensCaps,
  useLiveTick,
} from "./dev-card-telemetry-renderers";
import { turnHasTiming } from "@/lib/code-session-store/telemetry";
import { Square, X } from "lucide-react";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  composeJobsSummary,
  countJobs,
  isTerminalJobStatus,
  type JobItem,
  type JobStatus,
} from "@/lib/code-session-store/select-jobs";
import { isWakeLate } from "@/lib/code-session-store/select-scheduled-work";
import {
  goalIsActive,
  type GoalState,
} from "@/lib/code-session-store/select-goal";
import { composeWorkSummary } from "@/lib/code-session-store/select-work";

// ---------------------------------------------------------------------------
// Cross-popover callback contract
// ---------------------------------------------------------------------------

/**
 * Invoked when the user clicks a `#u{turn}` / `#a{turn}` address in a
 * popup — scrolls the transcript so that entry's row is in view.
 * `rowIndex` is a transcript list-view row index: a turn shows BOTH of
 * its entries (user row + assistant row), each independently
 * clickable, so the handler is keyed by row rather than by turn. See
 * `userRowIndexForTurn` / `assistantRowIndexForTurn`. Supplied by the
 * dev card, which owns the transcript's imperative handle; omitted in
 * the gallery / fixtures, where the numbers render as inert text.
 */
export type ScrollToRowHandler = (rowIndex: number) => void;

/**
 * Per-turn request-preview cap. The user-half prompt is collapsed to a
 * single line and end-truncated to this many characters so the popup
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
  // they return an empty preview.
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
// Footer actions — the standardized COPY affordance
// ---------------------------------------------------------------------------

/**
 * The one COPY shape every popup-list footer uses — text-only,
 * outlined, 2xs — so COPY reads identically beside CLEAR and across
 * every popup. `getText` composes the popup's visible list as plain
 * text at click time.
 */
function PopupCopyButton({
  getText,
  "aria-label": ariaLabel,
}: {
  getText: () => string;
  "aria-label": string;
}): React.ReactElement {
  return (
    <BlockCopyButton
      subtype="text"
      emphasis="outlined"
      size="2xs"
      aria-label={ariaLabel}
      getText={getText}
    />
  );
}

/**
 * Plain-text lines for a Time / Tokens per-turn log — one line per
 * committed turn (addresses, preview, end state, value) plus the
 * summary block, tab-separated for pasteability.
 */
function composeTurnLogCopyText(
  transcript: ReadonlyArray<TurnEntry>,
  turnNumberBase: number,
  valueFor: (turn: TurnEntry, index: number) => string,
  summaryLines: ReadonlyArray<string>,
): string {
  const lines = transcript.map((turn, i) => {
    const n = turnNumberBase + i + 1;
    const badge = endStateBadgeFor(turn.turnEndReason, turn.interruptReason);
    const preview = requestPreviewText(turn);
    return [`#u${n} · #a${n}`, preview, badge.text, valueFor(turn, i)]
      .filter((part) => part.length > 0)
      .join("\t");
  });
  return [...lines, ...summaryLines].join("\n");
}

/** Plain-text lines for the state-change log. */
function composeStateLogCopyText(
  rows: ReadonlyArray<SessionStateChangeRow>,
): string {
  return rows
    .map((row) => {
      const f = formatStateChangeRow(row);
      return `${f.atText}\t${f.phase}\t${f.transportState}\tinterrupt: ${f.interrupt}`;
    })
    .join("\n");
}

/** Plain-text lines for the jobs ledger. */
function composeJobsCopyText(jobs: readonly JobItem[]): string {
  return jobs
    .map((job) => {
      const elapsedMs =
        job.status === "running"
          ? Date.now() - job.startedAtMs
          : Math.max(0, (job.endedAtMs ?? job.startedAtMs) - job.startedAtMs);
      return `[${job.status}]\t${jobDescriptionText(job.description)}\t${job.kind} · ${formatDurationMs(elapsedMs)}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Turn-address links
// ---------------------------------------------------------------------------

/**
 * One transcript entry address — `#u{turn}` / `#a{turn}` in the same
 * speaker-prefixed format the transcript stamps on its attribution rows
 * (via {@link formatTurnAddress}). The `address` drives the visible label;
 * `rowIndex` is the list-view row the click scrolls to (the two are
 * distinct: the user and assistant halves of a turn share the turn number
 * but live at different rows).
 *
 * When `onScrollToRow` is supplied the address renders as a button that
 * scrolls the transcript to that entry's row; otherwise it is inert text
 * (gallery / fixtures, with no transcript to drive). The click is a
 * control-style action — fire-and-forget to the handler the dev card
 * threaded down; no popup-local state.
 */
function TurnNumberButton({
  address,
  rowIndex,
  onScrollToRow,
}: {
  address: TurnAddress;
  rowIndex: number;
  onScrollToRow?: ScrollToRowHandler;
}): React.ReactElement {
  const addressText = formatTurnAddress(address);
  if (onScrollToRow === undefined) {
    return (
      <span className="dev-popover-row-turn-static">{addressText}</span>
    );
  }
  return (
    <button
      type="button"
      className="dev-popover-row-turn"
      data-slot="dev-popover-row-turn"
      aria-label={`Scroll the transcript to entry ${addressText}`}
      onClick={() => onScrollToRow(rowIndex)}
    >
      {addressText}
    </button>
  );
}

/**
 * Per-turn row label — the PAIR of transcript addresses a turn spans:
 * the user-half (`#u{turn}`) and the assistant-half (`#a{turn}`). Both
 * carry the SAME canonical turn number — the speaker prefix is what tells
 * the two halves apart, exactly as the transcript's own attribution rows
 * read. Each is independently clickable, so the reader can jump to either
 * side of the turn.
 *
 * The turn number is `turnNumberBase + turnIndex + 1` — the loaded
 * window's `firstLoadedTurnIndex` plus the row's window-relative turn,
 * matching the transcript's `#u{turn}` / `#a{turn}` stamps for a paged
 * window.
 *
 * Wake turns ([D06]) have NO user row — `userRowIndexForTurn` returns
 * `-1` for them, and we render only the assistant-half `#a{turn}` (no
 * `·` separator). The single-address rendering is the popup's visual
 * cue that the turn doesn't have a user submission to scroll to.
 */
function TurnEntryPair({
  turnIndex,
  transcript,
  turnNumberBase,
  onScrollToRow,
}: {
  turnIndex: number;
  transcript: ReadonlyArray<TurnEntry>;
  turnNumberBase: number;
  onScrollToRow?: ScrollToRowHandler;
}): React.ReactElement {
  const turnNumber = turnNumberBase + turnIndex + 1;
  const assistantRow = assistantRowIndexForTurn(turnIndex, transcript);
  const userRow = userRowIndexForTurn(turnIndex, transcript);
  // Kind-open: a turn with no `user` row (a wake / continuation / orphan)
  // returns `-1`, and we render only the assistant-half address. No
  // `origin`/`messages[0]` boolean — the row walk is the authority ([P04]).
  if (userRow === -1) {
    return (
      <span className="dev-popover-turn-pair" data-slot="dev-popover-turn-pair">
        <TurnNumberButton
          address={{ speaker: "assistant", turn: turnNumber }}
          rowIndex={assistantRow}
          onScrollToRow={onScrollToRow}
        />
      </span>
    );
  }
  return (
    <span className="dev-popover-turn-pair" data-slot="dev-popover-turn-pair">
      <TurnNumberButton
        address={{ speaker: "user", turn: turnNumber }}
        rowIndex={userRow}
        onScrollToRow={onScrollToRow}
      />
      <span className="dev-popover-turn-pair-sep" aria-hidden>
        ·
      </span>
      <TurnNumberButton
        address={{ speaker: "assistant", turn: turnNumber }}
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
 * Per-turn end-state chip — driven by the same `endStateBadgeFor`
 * dispatch the Z1B end-state row uses, so the popup row and the
 * Z1B footer always read the same text + tone for a given turn.
 *
 * Renders as a `ghost`-emphasis TugBadge to keep the row chrome
 * quiet (the popup lists many rows; a `tinted` badge per row
 * would dominate).
 */
function TurnEndStateBadge({ turn }: { turn: TurnEntry }): React.ReactElement {
  const badge: EndStateBadge = endStateBadgeFor(
    turn.turnEndReason,
    turn.interruptReason,
  );
  return (
    <TugBadge emphasis="ghost" role={badge.role} size="sm">
      {badge.text}
    </TugBadge>
  );
}

/** Shared empty body for the per-turn log popups. */
function EmptyTranscriptBody(): React.ReactElement {
  return <TugPopupListEmpty>No committed turns yet.</TugPopupListEmpty>;
}

// ---------------------------------------------------------------------------
// Time popover
// ---------------------------------------------------------------------------

/**
 * `TIME` popup — per-turn `activeMs` log + summary rows (count, total,
 * average) + optional in-flight row surfacing the live current-turn
 * elapsed. The summary is derived by `computeTimeSummary` so the
 * gallery + production popups compute identical numbers. Footer: COPY.
 */
export function TimePopoverContent({
  transcript,
  turnNumberBase = 0,
  inflight,
  onScrollToRow,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  /** `firstLoadedTurnIndex` of the loaded window, so the per-turn
   *  addresses match the transcript's paged numbering. Defaults to `0`
   *  (a full / non-windowed load, and the gallery / fixtures). */
  turnNumberBase?: number;
  inflight: { currentTurnActiveMs: number } | null;
  onScrollToRow?: ScrollToRowHandler;
}): React.ReactElement {
  const summary = computeTimeSummary(transcript);
  const rows = transcript.map((t, i) => (
    <TugPopupListRow
      key={t.turnKey}
      label={<TurnEntryPair turnIndex={i} transcript={transcript} turnNumberBase={turnNumberBase} onScrollToRow={onScrollToRow} />}
      preview={<RequestPreview turn={t} />}
      value={turnHasTiming(t) ? formatTimeAlwaysHours(t.activeMs) : "—"}
      badge={<TurnEndStateBadge turn={t} />}
    />
  ));
  const summaryRows: React.ReactElement[] = [
    <TugPopupListRow key="turns" label="turns" value={String(summary.count)} />,
    <TugPopupListRow
      key="total"
      label="total"
      value={formatTimeAlwaysHours(summary.totalActiveMs)}
    />,
    <TugPopupListRow
      key="avg"
      label="avg"
      value={formatTimeAlwaysHours(summary.avgActiveMs)}
      hint="per turn"
    />,
  ];
  if (inflight !== null) {
    summaryRows.push(
      <TugPopupListRow
        key="current"
        label="current turn"
        value={formatTimeAlwaysHours(inflight.currentTurnActiveMs)}
        hint="in flight"
      />,
    );
  }
  const footer =
    transcript.length > 0 ? (
      <TugPopupListFooter>
        <PopupCopyButton
          aria-label="Copy the per-turn time log"
          getText={() =>
            composeTurnLogCopyText(
              transcript,
              turnNumberBase,
              (t) => (turnHasTiming(t) ? formatTimeAlwaysHours(t.activeMs) : "—"),
              [
                `turns\t${summary.count}`,
                `total\t${formatTimeAlwaysHours(summary.totalActiveMs)}`,
                `avg\t${formatTimeAlwaysHours(summary.avgActiveMs)}`,
              ],
            )
          }
        />
      </TugPopupListFooter>
    ) : undefined;
  return (
    <TugPopupListFrame kind="log" footer={footer}>
      <TugPopupListGrid
        rows={rows}
        summary={summaryRows}
        empty={<EmptyTranscriptBody />}
      />
    </TugPopupListFrame>
  );
}

// ---------------------------------------------------------------------------
// Tokens popover
// ---------------------------------------------------------------------------

/**
 * `TOKENS` popup — per-turn token log + summary rows. Each turn's
 * figure is its SIGNED `perTurn` window delta (`window(N) −
 * window(N−1)`, the transcript window-walk — the same number Z1B
 * shows), never a sum of raw `TurnCost`. A `/compact` turn reads as an
 * honest negative. Same in-flight contract as the Time popup. Footer:
 * COPY.
 */
export function TokensPopoverContent({
  transcript,
  turnNumberBase = 0,
  sessionInitTokens,
  inflight,
  onScrollToRow,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  /** `firstLoadedTurnIndex` of the loaded window, so the per-turn
   *  addresses match the transcript's paged numbering. Defaults to `0`
   *  (a full / non-windowed load, and the gallery / fixtures). */
  turnNumberBase?: number;
  sessionInitTokens: number | null;
  inflight: { currentTurnTokens: number } | null;
  onScrollToRow?: ScrollToRowHandler;
}): React.ReactElement {
  const summary = computeTokensSummary(transcript, sessionInitTokens);
  const rows = transcript.map((t, i) => (
    <TugPopupListRow
      key={t.turnKey}
      label={<TurnEntryPair turnIndex={i} transcript={transcript} turnNumberBase={turnNumberBase} onScrollToRow={onScrollToRow} />}
      preview={<RequestPreview turn={t} />}
      value={formatTokensCaps(summary.perTurn[i] ?? 0)}
      badge={<TurnEndStateBadge turn={t} />}
    />
  ));
  const summaryRows: React.ReactElement[] = [
    <TugPopupListRow key="turns" label="turns" value={String(summary.count)} />,
    <TugPopupListRow
      key="total"
      label="total"
      value={formatTokensCaps(summary.totalTokens)}
    />,
    <TugPopupListRow
      key="avg"
      label="avg"
      value={formatTokensCaps(summary.avgTokensPerTurn)}
      hint="per turn"
    />,
  ];
  if (inflight !== null) {
    summaryRows.push(
      <TugPopupListRow
        key="current"
        label="current turn"
        value={formatTokensCaps(inflight.currentTurnTokens)}
        hint="in flight"
      />,
    );
  }
  const footer =
    transcript.length > 0 ? (
      <TugPopupListFooter>
        <PopupCopyButton
          aria-label="Copy the per-turn token log"
          getText={() =>
            composeTurnLogCopyText(
              transcript,
              turnNumberBase,
              (_t, i) => formatTokensCaps(summary.perTurn[i] ?? 0),
              [
                `turns\t${summary.count}`,
                `total\t${formatTokensCaps(summary.totalTokens)}`,
                `avg\t${formatTokensCaps(summary.avgTokensPerTurn)}`,
              ],
            )
          }
        />
      </TugPopupListFooter>
    ) : undefined;
  return (
    <TugPopupListFrame kind="log" footer={footer}>
      <TugPopupListGrid
        rows={rows}
        summary={summaryRows}
        empty={<EmptyTranscriptBody />}
      />
    </TugPopupListFrame>
  );
}

// ---------------------------------------------------------------------------
// Context popover
// ---------------------------------------------------------------------------

function formatContextPercent(used: number, max: number): string {
  if (max <= 0) return "0.0%";
  return `${((used / max) * 100).toFixed(1)}%`;
}

/**
 * `CONTEXT` popup — the `/context`-style session breakdown.
 *
 * Renders the assembled {@link ContextBreakdown} the status row hands
 * down — the SAME object the `CONTEXT` cell reads its total from, so
 * the two surfaces cannot disagree. Its total and `messages` slice
 * are feed-exact (`window` / `sessionInit`); the five static
 * categories are tugcode's local estimate, scaled to the feed-exact
 * bootstrap. `mcp_tools` is intentionally absent — Tug treats MCP as
 * out of scope.
 *
 * `breakdown === null` means there is no usage yet AND no durable
 * `context_breakdown` frame — nothing to show, so the popup surfaces an
 * explicit empty state. Once usage exists the breakdown is always non-null:
 * with a durable frame it shows the fine category split, and on a fresh
 * target / offline replay it reconstructs a coarse baseline + messages +
 * remainder from the replayed cost (the reserved `autocompact_buffer` and the
 * per-category split need the durable frame and are simply omitted).
 */
export function ContextPopoverContent({
  breakdown,
  threshold = "normal",
}: {
  breakdown: ContextBreakdown | null;
  /**
   * Usage-ratio tone the CONTEXT status cell paints its numerator with
   * (`caution` ≥ 0.75, `danger` ≥ 0.9). Threaded through so the popup's
   * total — the same value the cell flags — carries the same signal on
   * the dial readout and the `used` row rather than reverting to white.
   */
  threshold?: "normal" | "caution" | "danger";
}): React.ReactElement {
  if (breakdown === null) {
    return (
      <TugPopupListFrame kind="wide">
        <TugPopupListEmpty>
          Session-init breakdown not yet recorded.
        </TugPopupListEmpty>
      </TugPopupListFrame>
    );
  }
  return (
    <TugPopupListFrame kind="wide">
      <ContextBreakdownBody
        segments={breakdown.segments}
        contextMax={breakdown.contextMax}
        totalUsed={breakdown.totalUsed}
        threshold={threshold}
      />
    </TugPopupListFrame>
  );
}

/**
 * Body for the Context popup — large segmented gauge on the left,
 * per-category legend + used/max summary in a single 3-column grid
 * on the right so column edges line up across the legend / summary
 * divider.
 */
function ContextBreakdownBody({
  segments,
  contextMax,
  totalUsed,
  threshold,
}: {
  segments: ReadonlyArray<TugArcGaugeSegment>;
  contextMax: number;
  totalUsed: number;
  threshold: "normal" | "caution" | "danger";
}): React.ReactElement {
  return (
    <div className="dev-context-popover-body" data-context-threshold={threshold}>
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
                data-arc-tone={s.tone}
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
        <span className="dev-context-popover-summary-value dev-context-popover-summary-value-used">
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

/**
 * Map a session-phase input onto a popup-list tone key. Resolves the
 * same (phase × transport × interrupt) → tone triple the inline
 * {@link TugProgressIndicator} uses, without instantiating an
 * indicator per row.
 */
function stateChangeToneFor(input: DevSessionPhaseInput): TugPopupListTone {
  const visual = devSessionPhaseVisual(devSessionPhaseKey(input));
  if (visual.role === "danger") return "danger";
  if (visual.role === "caution") return "caution";
  if (visual.role === "success") return "success";
  return "default";
}

/**
 * `STATE` popup — scrolling log of every persisted state change for a
 * session. One shared 5-column grid (tone dot · timestamp · phase ·
 * transport · interrupt); all rows live in one grid so each column
 * sizes to the widest entry across the log. The shared scroller's
 * stick-to-bottom keeps the most recent row in view unless the user
 * scrolls away. Footer: COPY.
 *
 * `rows` is the snapshot returned by `useSessionStateChanges`.
 */
export function StateChangeLogPopoverContent({
  rows,
}: {
  rows: ReadonlyArray<SessionStateChangeRow>;
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <TugPopupListFrame kind="state">
        <TugPopupListEmpty data-slot="dev-popover-empty-state-changes">
          No state changes recorded yet.
        </TugPopupListEmpty>
      </TugPopupListFrame>
    );
  }

  const formatted = rows.map((r) => formatStateChangeRow(r));

  return (
    <TugPopupListFrame
      kind="state"
      footer={
        <TugPopupListFooter>
          <PopupCopyButton
            aria-label="Copy the state-change log"
            getText={() => composeStateLogCopyText(rows)}
          />
        </TugPopupListFooter>
      }
    >
      <TugPopupListScroller stickToBottom data-slot="dev-state-log-scroller">
        <div className="dev-state-log-grid">
          {rows.map((row, i) => {
            const f = formatted[i]!;
            return (
              <React.Fragment key={`${f.atText}-${i}`}>
                <TugPopupListToneDot tone={stateChangeToneFor(row)} />
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
      </TugPopupListScroller>
    </TugPopupListFrame>
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
 * `TASKS` popup — opened from the `TASKS` cell in the status row.
 * Renders the full assembled task list ([D100]) as popup-list item
 * rows, each led by a {@link TugProgressIndicator} pulsing dot. Each
 * row's status drives its `(role, state)` pair through
 * {@link taskRowState}; an `idle` session demotes any `in_progress`
 * row to `state="stopped"` (same gate that stops the status-bar TASKS
 * dot). Rows with descriptions wrap in a `TugTooltip` so the longer
 * prose surfaces on hover. Footer: count summary + COPY.
 *
 * An empty `tasks` array renders the standard popup empty message.
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
      <TugPopupListFrame title="Tasks" kind="item">
        <TugPopupListEmpty>No tasks for this session.</TugPopupListEmpty>
      </TugPopupListFrame>
    );
  }
  // `composeTaskSummary` produces "3 done, 1 in progress, 2 pending"
  // with zero-bucket drop, so the footer reads cleanly whether the
  // list is all-done, mid-flight, or untouched.
  const summary = composeTaskSummary(countTasks(state.tasks));
  return (
    <TugPopupListFrame
      title="Tasks"
      kind="item"
      footer={
        <TugPopupListFooter summary={summary}>
          <PopupCopyButton
            aria-label="Copy task list"
            getText={() => composeTaskCopyText(state.tasks, false)}
          />
        </TugPopupListFooter>
      }
    >
      <TugPopupListScroller data-slot="dev-tasks-popover-body">
        {state.tasks.map((task) => {
          // Always the `subject` — it carries the task's stable identity
          // (e.g. the "Step N:" prefix). The present-continuous
          // `activeForm` reads nicely inline but drops that identity, so
          // the popup keeps every row reading the same way regardless
          // of status.
          const text = (
            <TugPopupListItemText primary={task.subject} />
          );
          return (
            <TugPopupListItem
              key={task.taskId}
              className="dev-tasks-popover-item"
              data-status={task.status}
              indicator={
                <TugProgressIndicator
                  variant="pulsing-dot"
                  size={14}
                  state={taskRowState(task.status, idle)}
                  aria-label={`task ${task.status}`}
                />
              }
            >
              {task.description === undefined ? (
                text
              ) : (
                <TugTooltip content={task.description} side="top" align="start">
                  {text}
                </TugTooltip>
              )}
            </TugPopupListItem>
          );
        })}
      </TugPopupListScroller>
    </TugPopupListFrame>
  );
}

// ---------------------------------------------------------------------------
// Jobs popover
// ---------------------------------------------------------------------------

/**
 * One-line job description — whitespace-collapsed; the CSS clips with
 * an ellipsis at whatever width the popup affords (no character
 * cap), and the full text surfaces in a tooltip (the task-description
 * precedent).
 */
function jobDescriptionText(description: string): string {
  const text = description.replace(/\s+/g, " ").trim();
  return text.length === 0 ? "(unnamed job)" : text;
}

/**
 * The committed-turn index that launched `job` — found via the turn
 * carrying the job's launching `tool_use`. `-1` while the launch turn is
 * still in flight (the `#a{turn}` affordance appears once the turn commits,
 * matching the popups' committed-rows-only numbering). The caller derives
 * both the `#a{turn}` address and the assistant launch-row from it.
 */
function jobTurnIndex(
  job: JobItem,
  transcript: ReadonlyArray<TurnEntry>,
): number {
  return transcript.findIndex((t) =>
    t.messages.some(
      (m) => m.kind === "tool_use" && m.toolUseId === job.toolUseId,
    ),
  );
}

/**
 * Map a job's status onto the row indicator's pose. Failed rows take
 * the `aborted` pose (danger tone); stopped rows read quiet. NO idle
 * demotion — a background job genuinely runs between turns, so a
 * running row keeps its motion regardless of session phase (the one
 * deliberate divergence from {@link taskRowState}).
 */
function jobRowState(status: JobStatus): TugProgressIndicatorState {
  switch (status) {
    case "running":
    case "scheduled":
      // A scheduled wakeup is pending work — it keeps the pulsing pose
      // even though nothing executes yet (the countdown carries the
      // "later, not now" distinction in the row label).
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "aborted";
    case "stopped":
      return "stopped";
  }
}

/**
 * Live elapsed readout for a running job. A leaf component so the
 * shared 1Hz tick subscription mounts only while the popup is open
 * — the cell itself shows `N/M` (no clock) and its pulse is CSS
 * animation, so a closed popup pays no tick. This is the popovers
 * module's one external-state read; the tick is presentation
 * clockwork, not session state, so the module stays a function of its
 * session inputs.
 */
function JobElapsedValue({ startedAtMs }: { startedAtMs: number }): React.ReactElement {
  const now = useLiveTick();
  return <>{formatDurationMs(Math.max(0, now - startedAtMs))}</>;
}

/**
 * Format a wakeup's *requested* delay as a coarse, approximate label —
 * `"fires in ~1m"`. Read from the row's own scheduled interval
 * (`firesAtMs − startedAtMs`), NOT a live clock: the harness fires on
 * its own jittered, minute-boundary schedule we don't observe (a "1
 * minute" wakeup empirically landed at 1m 41s), so a ticking
 * per-second countdown would be false precision. No tick, no drift —
 * just the scheduled interval, rounded to a minute (or hour) with a
 * `~`. Pure and unit-testable.
 */
export function formatWakeSchedule(delayMs: number): string {
  const minutes = Math.max(1, Math.round(delayMs / 60_000));
  if (minutes < 60) return `fires in ~${minutes}m`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return `fires in ~${hours}h`;
}

/**
 * Staleness badge for a wakeup row — derived, never stored. A wakeup
 * that completed more than the threshold past its target reads "fired
 * late" (the exact staleness session 7772e2d5 hit); one stopped while
 * still pending (reaper or respawn) reads "never fired". Crons and rows
 * with no `firesAtMs` get no badge. Returns `null` when no badge
 * applies.
 */
export function wakeBadgeText(job: JobItem): string | null {
  if (job.kind !== "wakeup") return null;
  if (job.status === "completed" && isWakeLate(job.firesAtMs, job.endedAtMs)) {
    return "fired late";
  }
  if (job.status === "stopped" && typeof job.firesAtMs === "number") {
    return "never fired";
  }
  return null;
}

/**
 * Whether a scheduled row's Cancel button does anything. Only a cron is
 * genuinely cancellable — the assistant `CronDelete`s it. A one-shot
 * `ScheduleWakeup` is harness-owned and fire-once, so its fire is
 * unavoidable regardless of whether it is a lone wakeup or part of a
 * `/loop` (the two are indistinguishable at the row level); its Cancel
 * is disabled. Pure, so the rule is unit-testable.
 */
export function scheduledCancelEnabled(job: JobItem): boolean {
  return job.status === "scheduled" && job.kind === "cron";
}

/** Muted meta-line separator dot. */
function JobMetaSep(): React.ReactElement {
  return (
    <span className="dev-jobs-popover-meta-sep" aria-hidden>
      ·
    </span>
  );
}

/**
 * One row of the Jobs popup — a status dot beside a two-line text
 * block (description above a muted meta line: the launching turn's
 * clickable `#a{turn}` address, the job kind, and the elapsed time),
 * with a stop button on running rows in the item row's structural
 * action column (top-aligned to the first line by the popup-list
 * grid). The stop button wears the Z5 submit/stop treatment — the
 * bold `Square` glyph on a filled danger button — and is a
 * fire-and-forget control-style action: no popup-local state, no
 * optimistic flip; the row flips when the wire confirms. Finished
 * rows simply omit the button (the dot already tells the status; no
 * reserved gap).
 */
function JobRow({
  job,
  transcript,
  turnNumberBase,
  onScrollToRow,
  onStopJob,
  onCancelScheduledWork,
  onStopLoop,
}: {
  job: JobItem;
  transcript: ReadonlyArray<TurnEntry>;
  turnNumberBase: number;
  onScrollToRow?: ScrollToRowHandler;
  onStopJob?: (jobId: string) => void;
  onCancelScheduledWork?: (jobId: string) => void;
  /**
   * Stop a wakeup-paced `/loop` — the scheduled `wakeup` row's action
   * (a real user message asking the assistant to end the loop with
   * `ScheduleWakeup {stop:true}`; `CodeSessionStore.stopLoop`). When
   * omitted, wakeup rows render no action (the historical shape).
   */
  onStopLoop?: (jobId: string) => void;
}): React.ReactElement {
  const description = jobDescriptionText(job.description);
  // The job launched from an assistant turn's `tool_use`; link its
  // `#a{turn}` address (the assistant launch-row is the scroll target).
  const turnIndex = jobTurnIndex(job, transcript);
  const rowIndex =
    turnIndex === -1 ? -1 : assistantRowIndexForTurn(turnIndex, transcript);
  // Meta-line trailing value: live elapsed for running rows, a
  // schedule / recurring label for scheduled rows, frozen elapsed for
  // terminal ones.
  const elapsed =
    job.status === "running" ? (
      <JobElapsedValue startedAtMs={job.startedAtMs} />
    ) : job.status === "scheduled" ? (
      typeof job.firesAtMs === "number" ? (
        formatWakeSchedule(job.firesAtMs - job.startedAtMs)
      ) : (
        `recurring (${job.scheduleLabel ?? "cron"})`
      )
    ) : (
      formatDurationMs(
        Math.max(0, (job.endedAtMs ?? job.startedAtMs) - job.startedAtMs),
      )
    );
  const wakeBadge = wakeBadgeText(job);
  const meta = (
    <>
      {turnIndex >= 0 ? (
        <>
          <TurnNumberButton
            address={{
              speaker: "assistant",
              turn: turnNumberBase + turnIndex + 1,
            }}
            rowIndex={rowIndex}
            onScrollToRow={onScrollToRow}
          />
          <JobMetaSep />
        </>
      ) : null}
      <span className="dev-jobs-popover-kind">{job.kind}</span>
      <JobMetaSep />
      <span className="dev-jobs-popover-elapsed">{elapsed}</span>
      {job.progress?.lastToolName !== undefined ? (
        // A backgrounded agent's most recent tool, from its latest
        // `task_progress` tick — the running row's window into what
        // the agent is doing, not just that it is alive.
        <>
          <JobMetaSep />
          <span className="dev-jobs-popover-progress">
            {job.progress.lastToolName}
          </span>
        </>
      ) : null}
      {wakeBadge !== null ? (
        <TugBadge emphasis="tinted" role="danger" size="2xs">
          {wakeBadge}
        </TugBadge>
      ) : null}
    </>
  );
  const textBlock = <TugPopupListItemText primary={description} meta={meta} />;
  const action =
    job.status === "running" && onStopJob !== undefined ? (
      <TugPushButton
        subtype="icon"
        icon={<Square size={12} strokeWidth={3} />}
        aria-label={`Stop background job: ${description}`}
        title="Stop this job"
        emphasis="filled"
        role="danger"
        size="2xs"
        onClick={() => onStopJob(job.jobId)}
      />
    ) : scheduledCancelEnabled(job) && onCancelScheduledWork !== undefined ? (
      // Only a cron gets a Cancel button — the assistant `CronDelete`s
      // it. A one-shot wakeup is harness-owned and fire-once, so there
      // is nothing to cancel; we show no button rather than a dead one.
      <TugPushButton
        subtype="icon"
        icon={<X size={12} strokeWidth={3} />}
        aria-label={`Cancel scheduled cron: ${description}`}
        title="Ask the assistant to cancel this cron"
        emphasis="outlined"
        role="action"
        size="2xs"
        onClick={() => onCancelScheduledWork(job.jobId)}
      />
    ) : job.status === "scheduled" &&
        job.kind === "wakeup" &&
        onStopLoop !== undefined ? (
      // A pending wakeup can't be cancelled (harness-owned, fire-once),
      // but a wakeup-paced LOOP can be stopped: the assistant is asked
      // to end the protocol (`ScheduleWakeup {stop:true}`) so no
      // further wakeups are scheduled.
      <TugPushButton
        subtype="icon"
        icon={<Square size={12} strokeWidth={3} />}
        aria-label={`Stop loop: ${description}`}
        title="Ask the assistant to stop this loop"
        emphasis="outlined"
        role="danger"
        size="2xs"
        onClick={() => onStopLoop(job.jobId)}
      />
    ) : undefined;
  return (
    <TugPopupListItem
      data-status={job.status}
      data-slot="dev-jobs-popover-row"
      indicator={
        <TugProgressIndicator
          variant="pulsing-dot"
          size={12}
          state={jobRowState(job.status)}
          aria-label={`${job.kind} job ${job.status}`}
        />
      }
      action={action}
    >
      {job.description.trim().length > 0 ? (
        <TugTooltip content={job.description} side="top" align="start">
          {textBlock}
        </TugTooltip>
      ) : (
        textBlock
      )}
    </TugPopupListItem>
  );
}

/**
 * `JOBS` popup — opened from the `JOBS` cell in the status row.
 * Renders the session-lifetime background-jobs ledger as popup-list
 * item rows above a footer carrying the composed summary ("1 running,
 * 2 done, 1 failed"), COPY, and a CLEAR button. Clear is a deck-local
 * wipe of terminal rows only — running and scheduled rows always
 * survive — and is disabled while nothing is clearable. Once a
 * wakeup/cron is pending, the rows split into labeled Running /
 * Scheduled / Finished groups.
 *
 * An empty ledger renders the standard popup empty message.
 */
export function JobsPopoverContent({
  jobs,
  transcript,
  turnNumberBase = 0,
  onScrollToRow,
  onStopJob,
  onCancelScheduledWork,
  onClearJobs,
}: {
  jobs: readonly JobItem[];
  /** Committed turns — resolves each job's `#a{turn}` launch-row link. */
  transcript: ReadonlyArray<TurnEntry>;
  /** `firstLoadedTurnIndex` of the loaded window, so each job's address
   *  matches the transcript's paged numbering. Defaults to `0`. */
  turnNumberBase?: number;
  onScrollToRow?: ScrollToRowHandler;
  onStopJob?: (jobId: string) => void;
  onCancelScheduledWork?: (jobId: string) => void;
  onClearJobs?: () => void;
}): React.ReactElement {
  if (jobs.length === 0) {
    return (
      <TugPopupListFrame title="Jobs" kind="item">
        <TugPopupListEmpty>No background jobs this session.</TugPopupListEmpty>
      </TugPopupListFrame>
    );
  }
  const counts = countJobs(jobs);
  const renderRow = (job: JobItem): React.ReactElement => (
    <JobRow
      key={job.jobId}
      job={job}
      transcript={transcript}
      turnNumberBase={turnNumberBase}
      onScrollToRow={onScrollToRow}
      onStopJob={onStopJob}
      onCancelScheduledWork={onCancelScheduledWork}
    />
  );
  // Flat (launch-order) list when there is no scheduled work — the
  // long-standing shape. Once a wakeup/cron is pending, split into
  // Running / Scheduled / Finished so the time-deferred promises read
  // distinctly from work that is executing or done.
  const group = (
    label: string,
    rows: readonly JobItem[],
  ): React.ReactElement | null =>
    rows.length === 0 ? null : (
      <TugPopupListGroup label={label}>
        {rows.map(renderRow)}
      </TugPopupListGroup>
    );
  const body =
    counts.scheduled === 0 ? (
      jobs.map(renderRow)
    ) : (
      <>
        {group("Running", jobs.filter((j) => j.status === "running"))}
        {group("Scheduled", jobs.filter((j) => j.status === "scheduled"))}
        {group("Finished", jobs.filter((j) => isTerminalJobStatus(j.status)))}
      </>
    );
  return (
    <TugPopupListFrame
      title="Jobs"
      kind="item"
      footer={
        <TugPopupListFooter summary={composeJobsSummary(counts)}>
          <PopupCopyButton
            aria-label="Copy the jobs list"
            getText={() => composeJobsCopyText(jobs)}
          />
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="2xs"
            aria-label="Clear finished jobs"
            title="Clear finished jobs (running jobs are kept)"
            disabled={counts.finished === 0 || onClearJobs === undefined}
            onClick={onClearJobs}
          >
            Clear
          </TugPushButton>
        </TugPopupListFooter>
      }
    >
      <TugPopupListScroller data-slot="dev-jobs-popover-body">
        {body}
      </TugPopupListScroller>
    </TugPopupListFrame>
  );
}

// ---------------------------------------------------------------------------
// Work popover — the unified surface
// ---------------------------------------------------------------------------

/** The goal row's dot pose. */
function goalRowState(goal: GoalState): TugProgressIndicatorState {
  if (goal.status === "active") return "running";
  if (goal.status === "achieved") return "completed";
  return "stopped";
}

/**
 * `WORK` popup — opened from the `WORK` cell, the single surface over
 * every trackable unit of session work ([P02]/[P03] of
 * `roadmap/slash-command-plan.md`): the `/goal`, running background
 * jobs, scheduled wakeups/crons, the task checklist, and finished
 * rows. Sections render only when non-empty; every management action
 * carries over from the surfaces it merges — stop job, cancel cron,
 * stop loop, clear finished, clear goal.
 *
 * The storage stays split ([P02]): tasks are the derived turn-scoped
 * fold, jobs the session-lifetime ledger, the goal its own snapshot
 * field. This component only composes them.
 */
export function WorkPopoverContent({
  goal,
  canClearGoal,
  onClearGoal,
  taskState,
  idle,
  jobs,
  transcript,
  turnNumberBase = 0,
  onScrollToRow,
  onStopJob,
  onCancelScheduledWork,
  onStopLoop,
  onClearJobs,
}: {
  goal: GoalState | null;
  /** Clear is gated to idle (a live goal run is stopped via interrupt). */
  canClearGoal?: boolean;
  onClearGoal?: () => void;
  taskState: TaskListState;
  idle: boolean;
  jobs: readonly JobItem[];
  transcript: ReadonlyArray<TurnEntry>;
  turnNumberBase?: number;
  onScrollToRow?: ScrollToRowHandler;
  onStopJob?: (jobId: string) => void;
  onCancelScheduledWork?: (jobId: string) => void;
  onStopLoop?: (jobId: string) => void;
  onClearJobs?: () => void;
}): React.ReactElement {
  const hasGoal = goal !== null;
  const hasTasks = taskState.tasks.length > 0;
  const hasJobs = jobs.length > 0;
  if (!hasGoal && !hasTasks && !hasJobs) {
    return (
      <TugPopupListFrame kind="item">
        <TugPopupListEmpty>No work for this session.</TugPopupListEmpty>
      </TugPopupListFrame>
    );
  }
  const jobCounts = countJobs(jobs);
  const renderJobRow = (job: JobItem): React.ReactElement => (
    <JobRow
      key={job.jobId}
      job={job}
      transcript={transcript}
      turnNumberBase={turnNumberBase}
      onScrollToRow={onScrollToRow}
      onStopJob={onStopJob}
      onCancelScheduledWork={onCancelScheduledWork}
      onStopLoop={onStopLoop}
    />
  );
  const group = (
    label: string,
    rows: React.ReactNode,
    empty: boolean,
  ): React.ReactElement | null =>
    empty ? null : <TugPopupListGroup label={label}>{rows}</TugPopupListGroup>;

  const goalRow =
    goal === null ? null : (
      <TugPopupListItem
        data-status={goal.status}
        data-slot="dev-work-popover-goal-row"
        indicator={
          <TugProgressIndicator
            variant="pulsing-dot"
            size={12}
            state={goalRowState(goal)}
            aria-label={`goal ${goal.status}`}
          />
        }
        action={
          goalIsActive(goal) && onClearGoal !== undefined ? (
            <TugPushButton
              subtype="icon"
              icon={<X size={12} strokeWidth={3} />}
              aria-label="Clear the active goal"
              title={
                canClearGoal === false
                  ? "Stop the running turn first, then clear the goal"
                  : "Clear the goal (/goal clear)"
              }
              emphasis="outlined"
              role="danger"
              size="2xs"
              disabled={canClearGoal === false}
              onClick={onClearGoal}
            />
          ) : undefined
        }
      >
        <TugPopupListItemText
          primary={goal.condition}
          meta={
            goal.latestReason !== null ? (
              <span className="dev-work-popover-goal-reason">
                {`${goal.turnsEvaluated} evaluated · ${goal.latestReason}`}
              </span>
            ) : (
              <span className="dev-work-popover-goal-reason">{goal.status}</span>
            )
          }
        />
      </TugPopupListItem>
    );

  const taskRows = taskState.tasks.map((task) => {
    const text = <TugPopupListItemText primary={task.subject} />;
    return (
      <TugPopupListItem
        key={task.taskId}
        className="dev-tasks-popover-item"
        data-status={task.status}
        indicator={
          <TugProgressIndicator
            variant="pulsing-dot"
            size={14}
            state={taskRowState(task.status, idle)}
            aria-label={`task ${task.status}`}
          />
        }
      >
        {task.description === undefined ? (
          text
        ) : (
          <TugTooltip content={task.description} side="top" align="start">
            {text}
          </TugTooltip>
        )}
      </TugPopupListItem>
    );
  });

  const summary = composeWorkSummary(
    countTasks(taskState.tasks),
    jobCounts,
    goal,
  );
  return (
    <TugPopupListFrame
      kind="item"
      footer={
        <TugPopupListFooter summary={summary}>
          <PopupCopyButton
            aria-label="Copy the work list"
            getText={() =>
              [
                hasJobs ? composeJobsCopyText(jobs) : null,
                hasTasks ? composeTaskCopyText(taskState.tasks, false) : null,
              ]
                .filter((s): s is string => s !== null)
                .join("\n\n")
            }
          />
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="2xs"
            aria-label="Clear finished jobs"
            title="Clear finished jobs (running and scheduled rows are kept)"
            disabled={jobCounts.finished === 0 || onClearJobs === undefined}
            onClick={onClearJobs}
          >
            Clear
          </TugPushButton>
        </TugPopupListFooter>
      }
    >
      <TugPopupListScroller data-slot="dev-work-popover-body">
        {group("Goal", goalRow, goalRow === null)}
        {group(
          "Running",
          jobs.filter((j) => j.status === "running").map(renderJobRow),
          jobCounts.running === 0,
        )}
        {group(
          "Scheduled",
          jobs.filter((j) => j.status === "scheduled").map(renderJobRow),
          jobCounts.scheduled === 0,
        )}
        {group("Tasks", taskRows, !hasTasks)}
        {group(
          "Finished",
          jobs.filter((j) => isTerminalJobStatus(j.status)).map(renderJobRow),
          jobCounts.finished === 0,
        )}
      </TugPopupListScroller>
    </TugPopupListFrame>
  );
}
