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
import { TugStateIndicator } from "@/components/tugways/tug-state-indicator";
import type { TugStateIndicatorState } from "@/components/tugways/tug-state-indicator";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { TurnEntry } from "@/lib/code-session-store/types";
import {
  deriveSessionTotals,
  deriveTimeCellMs,
  perTurnContextSize,
} from "@/lib/code-session-store/telemetry";
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
  TimePopoverContent,
  TokensPopoverContent,
} from "./tide-card-telemetry-popovers";

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
 */
export function formatTokensCaps(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
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
 * session. Always includes the seconds component. This is the
 * canonical time format for the Z2 status row (#step-20-4 outcome).
 */
export function formatTimeAlwaysHours(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0h 0m 00s";
  const totalSec = Math.max(0, Math.floor(ms / 1_000));
  const h = Math.floor(totalSec / 3_600);
  const m = Math.floor((totalSec % 3_600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s.toString().padStart(2, "0")}s`;
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
 * Window-utilization gauge — the model's view of "tokens consumed at
 * the boundary of the most-recent committed turn" divided by the
 * static context-window max for the active model.
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
  const lastTurn =
    snap.transcript.length > 0
      ? snap.transcript[snap.transcript.length - 1]
      : null;
  const contextTokens = lastTurn !== null ? perTurnContextSize(lastTurn) : 0;
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
 * width is fixed by the row (uniform across all cells via the
 * `--tugx-tide-status-cell-width` CSS variable on the row), so this
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
 * Per-turn token-sum helper, mirroring the Z2 TOKENS cell's
 * headline formula. Pulled to module scope so the live in-flight
 * tokens path can reuse it without recomputation.
 */
function perTurnTotalTokens(turn: TurnEntry): number {
  return (
    turn.cost.inputTokens +
    turn.cost.outputTokens +
    turn.cost.cacheReadInputTokens +
    turn.cost.cacheCreationInputTokens
  );
}

/**
 * Combined session status row — production Z2 surface promoted from
 * the workshop gallery in [Step 20.4.15]. Layout:
 *
 *     [TugStateIndicator (label-right)]   TIME   TOKENS   CONTEXT
 *
 * Four anchors, each opening a popover on click:
 *
 *   - **Indicator** → `StateChangeLogPopoverContent` driven by
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
 * `TugStateIndicator` (Step 20.4.3) replaces the old internal
 * concentric dot + tooltip combo. The indicator's `state` reads
 * `phase × transportState × interruptInFlight`; `labelPosition="right"`
 * surfaces the inline `PHASE_HUMAN_LABEL` text alongside the dot.
 *
 * Cells render TIME / TOKENS / CONTEXT only — the pre-20.4.15
 * TOTAL TIME / TOTAL TOKENS cells were removed because the same
 * sums surface in the TIME and TOKENS popovers' summary footers
 * (one click reveals the per-turn rows + the cumulative totals).
 *
 * **Mount-identity ([L26]):** the four-cell flex row, the indicator
 * host, and every cell are unconditionally mounted across phase /
 * transport / interrupt transitions. Only the popovers' open/closed
 * state and the cell values change.
 */
export const TideTelemetryStatusRow: React.FC<TideTelemetryProps> = ({
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
  // TOKENS cell: when a turn is in flight there is no live token
  // count yet (cost_update lands at turn-complete), so the cell
  // continues to show the last committed turn's total — matching
  // the pre-20.4.15 behaviour for the headline cell. The popover's
  // own in-flight footer is what surfaces a live-turn signal when
  // one exists.
  const perTurnTokens = lastTurn !== null ? perTurnTotalTokens(lastTurn) : 0;
  const perTurnContextTokens =
    lastTurn !== null ? perTurnContextSize(lastTurn) : 0;
  const contextMax =
    meta !== null ? resolveModelContextMax(meta) : DEFAULT_CONTEXT_MAX_TOKENS;

  // Color-coded context numerator. The `/` and denominator stay
  // muted so the live numerator reads first. Threshold class is
  // applied to the wrapping span; the CSS rule paints the
  // numerator's color via descendant selector.
  const ratio = contextMax > 0 ? perTurnContextTokens / contextMax : 0;
  const contextThreshold: "normal" | "caution" | "danger" =
    ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "caution" : "normal";

  const indicatorState: TugStateIndicatorState = {
    phase: snap.phase,
    transportState: snap.transportState,
    interruptInFlight: snap.interruptInFlight,
  };

  // Per-anchor popover content. Each popover receives only the
  // inputs it needs — no shared context object — so future popover
  // changes touch one factory call instead of a coupling layer.
  // `isInflight` is computed once; both per-area popovers gate
  // their in-flight footer on it.
  const isInflight = snap.inflightUserMessage !== null;
  const timePopover = (
    <TimePopoverContent
      transcript={snap.transcript}
      inflight={
        isInflight ? { currentTurnActiveMs: perTurnActiveMs } : null
      }
    />
  );
  const tokensPopover = (
    <TokensPopoverContent
      transcript={snap.transcript}
      inflight={
        // No live token count mid-turn (cost_update lands at
        // turn-complete); the in-flight footer reads the most
        // recent committed contribution rather than fabricating a
        // mid-turn value the wire hasn't reported yet.
        isInflight ? { currentTurnTokens: perTurnTokens } : null
      }
    />
  );
  const contextPopover = (
    <ContextPopoverContent
      contextMax={contextMax}
      lastContextBreakdown={snap.lastContextBreakdown}
    />
  );
  const indicatorPopover = (
    <StateChangeLogPopoverContent rows={stateChangeSnap.rows} />
  );

  // Flat 4-item flex row — indicator slot + three cells as direct
  // siblings. The row's `justify-content: space-between` (declared
  // in CSS) distributes them edge-to-edge with the row's `gap`
  // serving as the *minimum* inter-item spacing; all four
  // inter-item gaps flex uniformly with the host width. The
  // indicator slot is pinned to a fixed width
  // (`--tugx-tide-status-indicator-slot-width`, 220px) sized for
  // the longest `PHASE_HUMAN_LABEL` ("Awaiting first response")
  // so the cells' horizontal positions stay rock-stable across
  // label-text changes.
  return (
    <div
      className="tide-telemetry-status-row"
      data-slot="tide-telemetry-status-row"
    >
      <span
        className="tide-telemetry-status-indicator-slot"
        data-slot="tide-telemetry-status-indicator-slot"
      >
        <TugPopover>
          <TugPopoverTrigger>
            <span
              className="tide-telemetry-status-anchor"
              data-slot="tide-telemetry-status-indicator-anchor"
              data-priority="indicator"
            >
              <TugStateIndicator state={indicatorState} size={16} />
            </span>
          </TugPopoverTrigger>
          <TugPopoverContent side="top" align="start" sideOffset={8} arrow>
            {indicatorPopover}
          </TugPopoverContent>
        </TugPopover>
      </span>
      <TugPopover>
        <TugPopoverTrigger>
          <span
            className="tide-telemetry-status-cell tide-telemetry-status-anchor"
            data-priority="time"
          >
            <TideTelemetryEndcapRuleLabel label="TIME" ticksDirection="down" />
            <span className="tide-telemetry-status-value-wrap">
              <span className="tide-telemetry-status-value">
                {formatTimeAlwaysHours(perTurnActiveMs)}
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
                {formatTokensCaps(perTurnTokens)}
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
                  {formatTokensCaps(perTurnContextTokens)}
                </span>
                <span className="tide-telemetry-status-context-denominator">
                  {` / ${formatTokensCaps(contextMax)}`}
                </span>
              </span>
            </span>
          </span>
        </TugPopoverTrigger>
        <TugPopoverContent side="top" align="center" sideOffset={8} arrow>
          {contextPopover}
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
