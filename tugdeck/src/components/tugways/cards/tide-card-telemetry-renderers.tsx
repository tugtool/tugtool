/**
 * tide-card-telemetry-renderers.tsx — small, focused React components
 * that render one datum each from the tide card's per-turn and
 * session-cumulative telemetry surface.
 *
 * Each renderer is **placement-agnostic**: it takes the data it needs
 * (a store, a `TurnEntry`, etc.) and renders a deterministic display
 * fragment. The same renderer is suitable for the status-bar /
 * prompt-entry-top / prompt-entry-footer (session-scoped renderers)
 * or the per-turn trailing slot (per-turn renderers); the experiment
 * harness decides which datum lands in which zone.
 *
 * Conformance:
 *  - [L02] Session-scoped renderers subscribe to `CodeSessionStore` via
 *    `useSyncExternalStore`. Live-clock-dependent renderers also
 *    subscribe to a shared per-second tick so the displayed clock
 *    moves between store updates (the tick is a tiny external store
 *    backed by `setInterval`; the renderer's `getSnapshot` reads
 *    `Date.now()` derivatively).
 *  - [L06] Renderers produce only text + primitives (TugLinearGauge for
 *    the window-utilization datum). No React state for visible-only
 *    appearance.
 *  - [L19] Each renderer is a self-contained React function component.
 *  - [L20] No new token slots authored — renderers consume the host's
 *    layout box plus existing component-tier primitives.
 *
 * @module components/tugways/cards/tide-card-telemetry-renderers
 */

import "./tide-card-telemetry-renderers.css";

import React, { useCallback, useSyncExternalStore } from "react";

import { TugArcGauge } from "@/components/tugways/tug-arc-gauge";
import {
  TugPopover,
  TugPopoverContent,
  TugPopoverTrigger,
} from "@/components/tugways/tug-popover";
import {
  labelTextFor,
  TugStateIndicator,
} from "@/components/tugways/tug-state-indicator";
import type { TugStateIndicatorState } from "@/components/tugways/tug-state-indicator";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { TurnEntry } from "@/lib/code-session-store/types";
import {
  computeRichContextBreakdown,
  deriveSessionTotals,
  deriveTimeCellMs,
} from "@/lib/code-session-store/telemetry";
import {
  deriveContextWindows,
  perTurnTokens,
  turnWindowTokens,
} from "@/lib/code-session-store/end-state";
import { useLifecycleTick } from "@/lib/code-session-store/hooks/use-lifecycle-tick";
import {
  DEFAULT_CONTEXT_MAX_TOKENS,
  resolveModelContextMax,
} from "@/lib/model-context-max";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { useSessionStateChanges } from "@/lib/session-state-changes-store";

import {
  ContextPopoverContent,
  StateChangeLogPopoverContent,
  TasksPopoverContent,
  TimePopoverContent,
  TokensPopoverContent,
  type ScrollToRowHandler,
} from "./tide-card-telemetry-popovers";
import { TugProgress } from "@/components/tugways/tug-progress";
import { useTaskListState } from "@/lib/code-session-store/hooks/use-task-list-state";
import { countTasks } from "@/components/tugways/body-kinds/todo-list-block";

// ---------------------------------------------------------------------------
// Pure-logic formatters (exported for tests)
// ---------------------------------------------------------------------------

/** Format a token count as `12.3k` or `1.05M`. Tiny counts render exact. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Same magnitudes as `formatTokens` but with **uppercase** suffixes —
 * `K` (kilo), `M` (mega), `G` (giga). Instrument-shorthand convention
 * adopted for the Z2 status row in #step-20-4.
 *
 * Signed: a negative count renders with a leading U+2212 minus sign
 * (`-208.3K`). The per-turn token figure is a signed window delta — a
 * `/compact` turn shrinks the window — and the cell shows that
 * honestly rather than clamping a real shrink to `0`.
 */
export function formatTokensCaps(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 0) return `−${formatTokensCaps(-n)}`;
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}G`;
}

/** Format milliseconds as `1.2s` / `34s` / `2m 03s` / `1h 04m`. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  if (ms < 1_000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1_000);
  if (totalSec < 60) {
    const tenths = Math.floor((ms % 1_000) / 100);
    return totalSec < 10 ? `${totalSec}.${tenths}s` : `${totalSec}s`;
  }
  if (totalSec < 3_600) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  }
  const h = Math.floor(totalSec / 3_600);
  const m = Math.floor((totalSec % 3_600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

/**
 * Always-hours time format — `Hh Mm SSs` shape at every magnitude.
 * `0h 0m 12s` even when below an hour; `4h 30m 00s` for a marathon
 * session. Always includes the seconds component. Used by the time
 * popover's per-turn rows, where the uniform `Hh Mm SSs` shape keeps
 * the stacked figures column-aligned.
 */
export function formatTimeAlwaysHours(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0h 0m 00s";
  const totalSec = Math.max(0, Math.floor(ms / 1_000));
  const h = Math.floor(totalSec / 3_600);
  const m = Math.floor((totalSec % 3_600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * Conditional-hours time format — `Mm SSs` for any span under an
 * hour, `Hh Mm SSs` once a single span crosses the hour mark. The
 * status row's TIME cell uses this so the common case (turns lasting
 * seconds or a few minutes) reads without a vestigial leading `0h`;
 * an hour-plus turn still surfaces its hours component. Always
 * includes a zero-padded seconds component.
 */
export function formatTimeMinutesSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0m 00s";
  const totalSec = Math.max(0, Math.floor(ms / 1_000));
  const s = (totalSec % 60).toString().padStart(2, "0");
  const m = Math.floor((totalSec % 3_600) / 60);
  if (totalSec < 3_600) return `${m}m ${s}s`;
  const h = Math.floor(totalSec / 3_600);
  return `${h}h ${m}m ${s}s`;
}

/** Format a USD cost as `$0.0123` (4 decimals when small, 2 when ≥ $1). */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "$0";
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Live-tick external store — one shared interval, all session-clock
// renderers subscribe via `useSyncExternalStore` per [L02].
// ---------------------------------------------------------------------------

/**
 * Module-scoped 1Hz tick. Lazy-started on first subscribe; stopped
 * when the last subscriber unsubscribes. The "snapshot" is the last
 * tick wall-clock ms; renderers read it (or `Date.now()` directly,
 * which is fine because `useSyncExternalStore` only re-renders when
 * the snapshot reference changes — and the snapshot changes once per
 * tick).
 */
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickValue = 0;

function startTick(): void {
  if (tickTimer !== null) return;
  tickValue = Date.now();
  tickTimer = setInterval(() => {
    tickValue = Date.now();
    for (const fn of tickListeners) fn();
  }, 1_000);
}

function stopTickIfIdle(): void {
  if (tickListeners.size === 0 && tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  startTick();
  return () => {
    tickListeners.delete(listener);
    stopTickIfIdle();
  };
}

function getTick(): number {
  return tickValue;
}

/**
 * Hook returning the current 1Hz tick value. Renderers that need a
 * live clock subscribe; the underlying interval starts on first
 * subscription and stops when nothing subscribes.
 */
function useLiveTick(): number {
  return useSyncExternalStore(subscribeTick, getTick, getTick);
}

// ---------------------------------------------------------------------------
// Session-scoped renderers
// ---------------------------------------------------------------------------

export interface TideTelemetryProps {
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore?: SessionMetadataStore;
}

/**
 * Props for {@link TideTelemetryStatusRow} — the session telemetry
 * props plus the optional transcript-scroll handler the Time / Tokens
 * popovers thread onto their per-turn `#NNNN` entry numbers.
 */
export interface TideTelemetryStatusRowProps extends TideTelemetryProps {
  /**
   * Scrolls the transcript to a transcript row when the user clicks
   * its `#NNNN` entry number in the Time / Tokens popover. The tide
   * card supplies it (it owns the transcript's imperative handle);
   * omitted in the gallery / fixtures, where the numbers render as
   * inert text.
   */
  onScrollToRow?: ScrollToRowHandler;
}

/**
 * Window-utilization gauge — the context-window occupancy after the
 * most-recent committed turn (`window(latest)` from the transcript
 * window-walk: the last turn's last-iteration `input + output +
 * cache-read + cache-creation`) divided by the static context-window
 * max for the active model.
 *
 * Uses TugLinearGauge in `compact` density so the strip fits inside
 * a status-bar or prompt-entry footer without dominating layout.
 */
export const TideTelemetryWindowUtilization: React.FC<TideTelemetryProps> = ({
  codeSessionStore,
  sessionMetadataStore,
}) => {
  const snap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );
  const meta = useSyncExternalStore(
    useCallback(
      (listener) =>
        sessionMetadataStore !== undefined
          ? sessionMetadataStore.subscribe(listener)
          : () => {},
      [sessionMetadataStore],
    ),
    useCallback(
      () => sessionMetadataStore?.getSnapshot().model ?? null,
      [sessionMetadataStore],
    ),
  );
  // Resident context after the latest committed turn — the transcript
  // window-walk (carry-forward over any zero-usage turn). `0` for a
  // fresh session before `sessionInitTokens` is captured.
  const windows = deriveContextWindows(
    snap.transcript.map((t) => t.cost),
    snap.sessionInitTokens ?? 0,
  );
  const contextTokens =
    windows.length > 0
      ? windows[windows.length - 1].window
      : snap.sessionInitTokens ?? 0;
  const max = meta !== null ? resolveModelContextMax(meta) : DEFAULT_CONTEXT_MAX_TOKENS;
  const maxText = formatTokens(max);
  // Render value as `current / max` so the denominator is visible
  // beneath the arc's proportional sweep. The "tokens" label rides
  // the gauge's separate label slot (which TugArcGauge renders in a
  // flex column below the value at compact density). Cascade-scoped
  // CSS (see tide-card.css under `.tide-card-status-bar`) drops the
  // primitive's default ALL-CAPS / mono treatment for this surface.
  const formatRatio = useCallback(
    (v: number) => `${formatTokens(v)} / ${maxText}`,
    [maxText],
  );
  return (
    <TugArcGauge
      className="tide-telemetry-window-utilization"
      data-slot="tide-telemetry-window-utilization"
      value={contextTokens}
      min={0}
      max={max}
      density="compact"
      formatValue={formatRatio}
      thresholds={{ caution: 0.75, danger: 0.9 }}
    />
  );
};

/**
 * Cumulative session input + cache-read + cache-creation + output
 * tokens. Sum across every committed turn — the lifetime tokens cost
 * of the session so far.
 */
export const TideTelemetryCumulativeTokens: React.FC<TideTelemetryProps> = ({
  codeSessionStore,
}) => {
  const snap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );
  const totals = deriveSessionTotals(snap.transcript);
  const total =
    totals.totalInputTokens +
    totals.totalCacheReadTokens +
    totals.totalCacheCreationTokens +
    totals.totalOutputTokens;
  return (
    <span
      className="tide-telemetry-text"
      data-slot="tide-telemetry-cumulative-tokens"
    >
      {formatTokens(total)} tokens
    </span>
  );
};

/**
 * Cumulative session Claude-active time across every committed turn.
 * In-flight turns are NOT added — the precise live-segment computation
 * (subtracting awaiting-approval + transport-downtime windows) requires
 * the internal reducer state and lives outside this placement-agnostic
 * renderer. Subscribes to a 1Hz tick so any side-channel that flips
 * the committed sum mid-second still surfaces promptly.
 */
export const TideTelemetryCumulativeActiveMs: React.FC<TideTelemetryProps> = ({
  codeSessionStore,
}) => {
  const snap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );
  // Subscribe to the live tick so the display refreshes even when no
  // store dispatch has fired. The tick value itself is unused — the
  // store snapshot is the source of truth for the committed total.
  useLiveTick();
  const committed = deriveSessionTotals(snap.transcript).totalActiveMs;
  return (
    <span
      className="tide-telemetry-text"
      data-slot="tide-telemetry-cumulative-active-ms"
    >
      {formatDurationMs(committed)}
    </span>
  );
};

/**
 * Phase / "Claude is thinking" indicator — surfaces the session's
 * coarse-grained `phase` enum. Useful in Z4 (prompt-entry footer)
 * during the HMR study to compare against ambient-light placements.
 */
export const TideTelemetryPhase: React.FC<TideTelemetryProps> = ({
  codeSessionStore,
}) => {
  const phase = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().phase,
      [codeSessionStore],
    ),
  );
  return (
    <span className="tide-telemetry-text" data-slot="tide-telemetry-phase">
      {phase}
    </span>
  );
};

/**
 * IBM-1620-style endcap-rule label apparatus — letterspaced uppercase
 * label inset into a horizontal rule terminated by short perpendicular
 * ticks at each end. The label visually divides one section from the
 * next without explicit row dividers; the ticks point toward the
 * value (down when label is above, up when label is below).
 *
 * Internal component for `TideTelemetryStatusRow`. The apparatus
 * width is fixed by the row (via the `--tugx-tide-status-cell-width`
 * CSS variable, which the STATE cell overrides wider), so this
 * component just fills whatever width its container provides.
 */
const TideTelemetryEndcapRuleLabel: React.FC<{
  label: string;
  /** Direction the endcap ticks extend (toward the value). */
  ticksDirection: "down" | "up";
}> = ({ label, ticksDirection }) => (
  <span
    className="tide-telemetry-endcap-rule"
    data-ticks={ticksDirection}
    aria-hidden="true"
  >
    <span className="tide-telemetry-endcap-tick tide-telemetry-endcap-tick-left" />
    <span className="tide-telemetry-endcap-rule-fill" />
    <span className="tide-telemetry-endcap-label">{label}</span>
    <span className="tide-telemetry-endcap-rule-fill" />
    <span className="tide-telemetry-endcap-tick tide-telemetry-endcap-tick-right" />
  </span>
);

/**
 * Combined session status row — production Z2 surface promoted from
 * the workshop gallery. Layout:
 *
 *     STATE   TIME   TOKENS   CONTEXT
 *
 * Four cell anchors, each opening a popover on click:
 *
 *   - **STATE** → `StateChangeLogPopoverContent` driven by
 *     `useSessionStateChanges(snap.tugSessionId)` against the
 *     persisted SQLite ledger.
 *   - **TIME** → `TimePopoverContent` — per-turn `activeMs` log +
 *     count/total/avg footer + live in-flight footer row when a
 *     turn is in flight.
 *   - **TOKENS** → `TokensPopoverContent` — per-turn token-sum log +
 *     count/total/avg footer + live in-flight footer row.
 *   - **CONTEXT** → `ContextPopoverContent` — rich `/context`-style
 *     breakdown when a `lastContextBreakdown` frame is present, the
 *     5-segment `cost_update`-derived fallback otherwise.
 *
 * TIME cell text is the live in-flight clock when a turn is in
 * flight (`isLivePhase(phase)` true) and the last committed turn's
 * `activeMs` after commit. `deriveTimeCellMs` pauses on yellow axes
 * (awaiting-approval / transport-downtime / interrupt-in-flight)
 * via the snapshot's union-pause bookkeeping, freezes at
 * `turn_complete`, and re-engages on the next submit.
 * `useLifecycleTick` provides the 1Hz heartbeat — it ticks only
 * while in flight and reports `0` otherwise (the helper's fallback
 * path uses the static value in that case).
 *
 * The STATE cell mirrors the other three: an endcap-rule legend
 * above a value. The value is the human-readable phase title
 * (`labelTextFor`): "Idle", "Running tools", "Awaiting first
 * response". Flanking the value, pinned to either end of the value
 * area, are two label-less `TugStateIndicator` glyphs — their
 * concentric dot + pulsing ring read
 * `phase × transportState × interruptInFlight` and give the cell
 * the live motion a static figure cannot.
 *
 * The row renders four cells — STATE / TIME / TOKENS / CONTEXT.
 * Cumulative TOTAL TIME / TOTAL TOKENS are not separate cells; the
 * same sums surface in the TIME and TOKENS popovers' summary footers
 * (one click reveals the per-turn rows + the cumulative totals).
 *
 * **Mount-identity ([L26]):** the four-cell flex row and every cell
 * are unconditionally mounted across phase / transport / interrupt
 * transitions. Only the popovers' open/closed state and the cell
 * values change; the STATE indicators reconcile tone in place.
 */
export const TideTelemetryStatusRow: React.FC<TideTelemetryStatusRowProps> = ({
  codeSessionStore,
  sessionMetadataStore,
  onScrollToRow,
}) => {
  const snap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );
  const meta = useSyncExternalStore(
    useCallback(
      (listener) =>
        sessionMetadataStore !== undefined
          ? sessionMetadataStore.subscribe(listener)
          : () => {},
      [sessionMetadataStore],
    ),
    useCallback(
      () => sessionMetadataStore?.getSnapshot().model ?? null,
      [sessionMetadataStore],
    ),
  );
  // Live 1Hz heartbeat — ticks only while phase is non-terminal, so
  // the TIME cell's in-flight readout advances at the granularity
  // the user perceives. `tickAt` is the helper's input, not a
  // render-affecting value itself; `deriveTimeCellMs` folds it into
  // its union-pause math.
  const tickAt = useLifecycleTick(snap.phase);
  // Subscribe to the persisted state-change log so the indicator's
  // popover surfaces the live row stream. Returns the idle snapshot
  // when no card has bound to a session id, so the subscription is
  // cheap even before the popover opens.
  const stateChangeSnap = useSessionStateChanges(snap.tugSessionId);

  const lastTurn =
    snap.transcript.length > 0
      ? snap.transcript[snap.transcript.length - 1]
      : null;
  // TIME cell: live in-flight clock when a turn is in flight, or
  // the last committed turn's activeMs as the post-commit fallback.
  // `deriveTimeCellMs` short-circuits to the fallback path when
  // `inflightUserMessage === null`.
  const lastCommittedActiveMs = lastTurn !== null ? lastTurn.activeMs : 0;
  const perTurnActiveMs = deriveTimeCellMs(snap, tickAt, lastCommittedActiveMs);
  // TOKENS / CONTEXT cells — both feed-derived. While a turn is in
  // flight the cells read the latest `streaming_usage` frame
  // (`liveTurnUsage`) so they climb mid-turn the way TIME does; once
  // the turn commits — and between turns — they read the transcript
  // window-walk.
  //
  // TOKENS — `perTurn`: the signed per-turn delta `window(N) −
  // window(N−1)` (the number Z1B shows; negative at a `/compact`).
  // CONTEXT — the resident context total, unified with the popover
  // through `computeRichContextBreakdown`: `breakdown.totalUsed` is
  // `window` by construction. Before turn 1 (no `sessionInit`, no
  // window) the breakdown's bootstrap is tugcode's static estimate,
  // so the cell shows a session-init figure the moment the session
  // opens — never blank.
  const sessionInit = snap.sessionInitTokens;
  const windows = deriveContextWindows(
    snap.transcript.map((t) => t.cost),
    sessionInit ?? 0,
  );
  const lastCommittedWindow =
    windows.length > 0 ? windows[windows.length - 1].window : null;
  const isInflight = snap.inflightUserMessage !== null;
  const live = snap.liveTurnUsage;
  // Resident window: the live in-flight frame, else the last committed
  // turn's window, else `null` (no turns yet — fresh session).
  const windowTokens =
    isInflight && live !== null ? turnWindowTokens(live) : lastCommittedWindow;
  // The prior window the in-flight per-turn delta is measured against.
  const priorWindow = lastCommittedWindow ?? sessionInit ?? 0;
  // The instant a turn is submitted the TOKENS cell clears — it must
  // not keep showing the *previous* turn's delta until the new turn's
  // first `streaming_usage` frame lands. So in-flight with no live
  // frame yet reads 0; the last-committed delta is shown only between
  // turns.
  const tokensCellValue = isInflight
    ? live !== null
      ? perTurnTokens(live, priorWindow)
      : 0
    : windows.length > 0
      ? windows[windows.length - 1].perTurn
      : 0;
  const contextMax =
    meta !== null ? resolveModelContextMax(meta) : DEFAULT_CONTEXT_MAX_TOKENS;
  // One breakdown computation feeds BOTH the CONTEXT cell (its
  // `totalUsed`) and the Context popover (its `segments`) — the two
  // surfaces cannot disagree.
  const contextBreakdown = computeRichContextBreakdown({
    staticBreakdown: snap.lastContextBreakdown,
    sessionInitTokens: sessionInit,
    windowTokens,
    contextMax,
  });
  const contextTotal = contextBreakdown?.totalUsed ?? windowTokens ?? 0;

  // Color-coded context numerator. The `/` and denominator stay
  // muted so the live numerator reads first. Threshold class is
  // applied to the wrapping span; the CSS rule paints the
  // numerator's color via descendant selector.
  const ratio = contextMax > 0 ? contextTotal / contextMax : 0;
  const contextThreshold: "normal" | "caution" | "danger" =
    ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "caution" : "normal";

  const indicatorState: TugStateIndicatorState = {
    phase: snap.phase,
    transportState: snap.transportState,
    interruptInFlight: snap.interruptInFlight,
  };
  // STATE cell value — the human-readable phase title. The two
  // flanking indicators take `indicatorState` directly and derive
  // their own tone + pulse.
  const stateLabelText = labelTextFor(indicatorState);

  // TASKS cell — assembled from the Task* event stream ([D100]).
  // The ring animates when at least one task is pending or
  // in_progress (work happening); stops otherwise. The label text
  // reads `N/M` (`completed/total`) when tasks exist, else `None`.
  const taskListState = useTaskListState(codeSessionStore);
  const taskCounts = countTasks(taskListState.tasks);
  const hasTasks = taskCounts.total > 0;
  const tasksActive =
    hasTasks &&
    taskCounts.completed < taskCounts.total;
  const tasksLabelText = hasTasks
    ? `${taskCounts.completed}/${taskCounts.total}`
    : "None";

  // Per-anchor popover content. Each popover receives only the
  // inputs it needs — no shared context object — so future popover
  // changes touch one factory call instead of a coupling layer.
  // `isInflight` (computed above with the cell values) gates both
  // per-area popovers' in-flight footer.
  const timePopover = (
    <TimePopoverContent
      transcript={snap.transcript}
      inflight={
        isInflight ? { currentTurnActiveMs: perTurnActiveMs } : null
      }
      onScrollToRow={onScrollToRow}
    />
  );
  const tokensPopover = (
    <TokensPopoverContent
      transcript={snap.transcript}
      sessionInitTokens={sessionInit}
      inflight={
        // The in-flight footer carries the live per-turn delta —
        // `tokensCellValue` is the signed `window − priorWindow`
        // while a turn is in flight (see the cell-value block above).
        isInflight ? { currentTurnTokens: tokensCellValue } : null
      }
      onScrollToRow={onScrollToRow}
    />
  );
  const contextPopover = (
    <ContextPopoverContent
      breakdown={contextBreakdown}
    />
  );
  const statePopover = (
    <StateChangeLogPopoverContent rows={stateChangeSnap.rows} />
  );
  const tasksPopover = <TasksPopoverContent state={taskListState} />;

  // Flat 4-cell flex row — STATE + TIME + TOKENS + CONTEXT as direct
  // siblings. The row's `justify-content: center` (declared in CSS)
  // packs the four cells as one group with a fixed inter-item `gap`;
  // the leftover width splits into equal flexing margins on the
  // row's far left and right. Every cell is a fixed-width box — all
  // four share one width — so the group's width is constant and the
  // cells never shift.
  return (
    <div
      className="tide-telemetry-status-row"
      data-slot="tide-telemetry-status-row"
    >
      <TugPopover>
        <TugPopoverTrigger>
          <span
            className="tide-telemetry-status-cell tide-telemetry-status-anchor"
            data-priority="state"
          >
            <TideTelemetryEndcapRuleLabel label="STATE" ticksDirection="down" />
            <span className="tide-telemetry-status-value-wrap">
              <TugStateIndicator
                state={indicatorState}
                size={12}
                labelPosition="none"
                aria-hidden
              />
              <span className="tide-telemetry-status-value">
                {stateLabelText}
              </span>
              <TugStateIndicator
                state={indicatorState}
                size={12}
                labelPosition="none"
                aria-hidden
              />
            </span>
          </span>
        </TugPopoverTrigger>
        <TugPopoverContent side="top" align="center" sideOffset={8} arrow>
          {statePopover}
        </TugPopoverContent>
      </TugPopover>
      <TugPopover>
        <TugPopoverTrigger>
          <span
            className="tide-telemetry-status-cell tide-telemetry-status-anchor"
            data-priority="time"
          >
            <TideTelemetryEndcapRuleLabel label="TIME" ticksDirection="down" />
            <span className="tide-telemetry-status-value-wrap">
              <span className="tide-telemetry-status-value">
                {formatTimeMinutesSeconds(perTurnActiveMs)}
              </span>
            </span>
          </span>
        </TugPopoverTrigger>
        <TugPopoverContent side="top" align="center" sideOffset={8} arrow>
          {timePopover}
        </TugPopoverContent>
      </TugPopover>
      <TugPopover>
        <TugPopoverTrigger>
          <span
            className="tide-telemetry-status-cell tide-telemetry-status-anchor"
            data-priority="tokens"
          >
            <TideTelemetryEndcapRuleLabel label="TOKENS" ticksDirection="down" />
            <span className="tide-telemetry-status-value-wrap">
              <span className="tide-telemetry-status-value">
                {formatTokensCaps(tokensCellValue)}
              </span>
            </span>
          </span>
        </TugPopoverTrigger>
        <TugPopoverContent side="top" align="center" sideOffset={8} arrow>
          {tokensPopover}
        </TugPopoverContent>
      </TugPopover>
      <TugPopover>
        <TugPopoverTrigger>
          <span
            className="tide-telemetry-status-cell tide-telemetry-status-anchor"
            data-priority="context"
          >
            <TideTelemetryEndcapRuleLabel label="CONTEXT" ticksDirection="down" />
            <span className="tide-telemetry-status-value-wrap">
              <span
                className="tide-telemetry-status-value tide-telemetry-status-value-context"
                data-context-threshold={contextThreshold}
              >
                <span className="tide-telemetry-status-context-numerator">
                  {formatTokensCaps(contextTotal)}
                </span>
                <span className="tide-telemetry-status-context-denominator">
                  {`/ ${formatTokensCaps(contextMax)}`}
                </span>
              </span>
            </span>
          </span>
        </TugPopoverTrigger>
        <TugPopoverContent side="top" align="center" sideOffset={8} arrow>
          {contextPopover}
        </TugPopoverContent>
      </TugPopover>
      <TugPopover>
        <TugPopoverTrigger>
          <span
            className="tide-telemetry-status-cell tide-telemetry-status-anchor"
            data-priority="tasks"
          >
            <TideTelemetryEndcapRuleLabel label="TASKS" ticksDirection="down" />
            <span className="tide-telemetry-status-value-wrap">
              <TugProgress
                variant="ring"
                size="sm"
                stopped={!tasksActive}
                aria-label={
                  hasTasks
                    ? `${taskCounts.completed} of ${taskCounts.total} tasks complete`
                    : "No tasks"
                }
              />
              <span className="tide-telemetry-status-value">
                {tasksLabelText}
              </span>
            </span>
          </span>
        </TugPopoverTrigger>
        <TugPopoverContent side="top" align="center" sideOffset={8} arrow>
          {tasksPopover}
        </TugPopoverContent>
      </TugPopover>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Per-turn renderers (Z1)
// ---------------------------------------------------------------------------

export interface TideTurnTelemetryProps {
  turn: TurnEntry;
}

/** Per-turn Claude-active duration (committed turns only). */
export const TideTelemetryPerTurnDuration: React.FC<TideTurnTelemetryProps> = ({
  turn,
}) => (
  <span
    className="tide-telemetry-text"
    data-slot="tide-telemetry-per-turn-duration"
  >
    {formatDurationMs(turn.activeMs)}
  </span>
);

/** Per-turn cost in USD (committed turns only). */
export const TideTelemetryPerTurnCost: React.FC<TideTurnTelemetryProps> = ({
  turn,
}) => (
  <span
    className="tide-telemetry-text"
    data-slot="tide-telemetry-per-turn-cost"
  >
    {formatUsd(turn.cost.totalCostUsd)}
  </span>
);

/** Per-turn time-to-first-token (committed turns only). */
export const TideTelemetryPerTurnTtft: React.FC<TideTurnTelemetryProps> = ({
  turn,
}) => (
  <span
    className="tide-telemetry-text"
    data-slot="tide-telemetry-per-turn-ttft"
  >
    {turn.ttftMs !== null ? formatDurationMs(turn.ttftMs) : "—"}
  </span>
);
