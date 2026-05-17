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
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { TurnEntry } from "@/lib/code-session-store/types";
import {
  deriveSessionTotals,
  perTurnContextSize,
} from "@/lib/code-session-store/telemetry";
import {
  DEFAULT_CONTEXT_MAX_TOKENS,
  resolveModelContextMax,
} from "@/lib/model-context-max";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";

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
 * Combined session status row — one centered group containing every
 * session-level datum the status bar surfaces, separated by bullets:
 *
 *   time: 1m 23s • tokens: 12.3k • total time: 1h 04m • total tokens: 1.05M • context: 200k / 1.0M [arc]
 *
 * Each item is independently collapsible via container queries on the
 * host (the priority order from most-to-least persistent is `context`,
 * `tokens`, `time`, `total-tokens`, `total-time`). Bullet separators
 * are siblings of their preceding item so the `+` adjacent-sibling
 * selector can hide them at the same breakpoint that hides the item.
 *
 * `time` / `tokens` read off the LAST COMMITTED turn — during an
 * in-flight turn the previous turn's values stay surfaced. `total
 * time` / `total tokens` use `deriveSessionTotals` (committed turns
 * only). The cumulative-active surface re-renders on the 1Hz tick so
 * that any side-channel that bumps the committed sum mid-second still
 * surfaces promptly.
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
  useLiveTick();

  const lastTurn =
    snap.transcript.length > 0
      ? snap.transcript[snap.transcript.length - 1]
      : null;
  const perTurnActiveMs = lastTurn !== null ? lastTurn.activeMs : 0;
  const perTurnContextTokens =
    lastTurn !== null ? perTurnContextSize(lastTurn) : 0;
  const contextMax =
    meta !== null ? resolveModelContextMax(meta) : DEFAULT_CONTEXT_MAX_TOKENS;
  const totals = deriveSessionTotals(snap.transcript);
  const totalTokensSum =
    totals.totalInputTokens +
    totals.totalCacheReadTokens +
    totals.totalCacheCreationTokens +
    totals.totalOutputTokens;

  const contextMaxText = formatTokens(contextMax);
  const formatContextRatio = useCallback(
    (v: number) => `${formatTokens(v)} / ${contextMaxText}`,
    [contextMaxText],
  );

  return (
    <div
      className="tide-telemetry-status-row"
      data-slot="tide-telemetry-status-row"
    >
      <span
        className="tide-telemetry-status-item"
        data-priority="time"
      >
        <span className="tide-telemetry-status-label">time:</span>
        <span className="tide-telemetry-status-value">
          {formatDurationMs(perTurnActiveMs)}
        </span>
      </span>
      <span className="tide-telemetry-status-sep" aria-hidden="true">•</span>
      <span
        className="tide-telemetry-status-item"
        data-priority="tokens"
      >
        <span className="tide-telemetry-status-label">tokens:</span>
        <span className="tide-telemetry-status-value">
          {formatTokens(perTurnContextTokens)}
        </span>
      </span>
      <span className="tide-telemetry-status-sep" aria-hidden="true">•</span>
      <span
        className="tide-telemetry-status-item"
        data-priority="total-time"
      >
        <span className="tide-telemetry-status-label">total time:</span>
        <span className="tide-telemetry-status-value">
          {formatDurationMs(totals.totalActiveMs)}
        </span>
      </span>
      <span className="tide-telemetry-status-sep" aria-hidden="true">•</span>
      <span
        className="tide-telemetry-status-item"
        data-priority="total-tokens"
      >
        <span className="tide-telemetry-status-label">total tokens:</span>
        <span className="tide-telemetry-status-value">
          {formatTokens(totalTokensSum)}
        </span>
      </span>
      <span className="tide-telemetry-status-sep" aria-hidden="true">•</span>
      <span
        className="tide-telemetry-status-item tide-telemetry-status-item-context"
        data-priority="context"
      >
        <span className="tide-telemetry-status-label">context:</span>
        <TugArcGauge
          className="tide-telemetry-window-utilization"
          data-slot="tide-telemetry-window-utilization"
          value={perTurnContextTokens}
          min={0}
          max={contextMax}
          density="compact"
          formatValue={formatContextRatio}
          thresholds={{ caution: 0.75, danger: 0.9 }}
        />
      </span>
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
