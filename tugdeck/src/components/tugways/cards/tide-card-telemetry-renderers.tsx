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
 * Combined session status row — the canonical Z2 design chosen by the
 * Step 20.4 HMR study (F5 variant from the design spike gallery).
 *
 * **Layout — five uniform-width cells, label-above-value:**
 *
 *   ┌──── TIME ────┐  ┌──── TOKENS ────┐  ┌── TOTAL TIME ──┐  …  ┌── CONTEXT ──┐
 *      0h 0m 12s         30.3K            0h 0m 12s              30.3K / 1.00M
 *
 * Every cell is a two-row stack: an IBM-1620 letterspaced label
 * embedded in a hairline rule with downward endcap ticks, sitting
 * above a centered value. The five cells share a single uniform
 * apparatus width (`--tugx-tide-status-cell-width`) so the row
 * never jitters — values can change width inside their cell, but
 * the cell columns themselves stay rock-stable.
 *
 * **Formats:**
 *  - `time`/`total time` → `formatTimeAlwaysHours` (`Hh Mm SSs` shape).
 *    Per-turn time and total time both surface the seconds component
 *    so the readout never goes dark on a low-magnitude value.
 *  - `tokens`/`total tokens` → `formatTokensCaps` (`K`/`M`/`G`).
 *  - `context` → `formatTokensCaps(current) / formatTokensCaps(max)`,
 *    with the numerator color-coded by usage ratio (caution at ≥75%,
 *    danger at ≥90% via the `--tug7-element-global-text-normal-{caution,danger}`
 *    tokens). No arc gauge — the colored numerator is the entire
 *    graphical cue.
 *
 * `time` / `tokens` read off the LAST COMMITTED turn — during an
 * in-flight turn the previous turn's values stay surfaced. `total
 * time` / `total tokens` use `deriveSessionTotals`. The
 * always-hours formatter is re-evaluated on the 1Hz live tick so
 * any side-channel that bumps the committed sum mid-second still
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

  // Color-coded context numerator. The `/` and denominator stay
  // muted so the live numerator reads first. Threshold class is
  // applied to the wrapping span; the CSS rule paints the
  // numerator's color via descendant selector.
  const ratio = contextMax > 0 ? perTurnContextTokens / contextMax : 0;
  const contextThreshold: "normal" | "caution" | "danger" =
    ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "caution" : "normal";

  return (
    <div
      className="tide-telemetry-status-row"
      data-slot="tide-telemetry-status-row"
    >
      <span
        className="tide-telemetry-status-cell"
        data-priority="time"
      >
        <TideTelemetryEndcapRuleLabel label="TIME" ticksDirection="down" />
        <span className="tide-telemetry-status-value-wrap">
          <span className="tide-telemetry-status-value">
            {formatTimeAlwaysHours(perTurnActiveMs)}
          </span>
        </span>
      </span>
      <span
        className="tide-telemetry-status-cell"
        data-priority="tokens"
      >
        <TideTelemetryEndcapRuleLabel label="TOKENS" ticksDirection="down" />
        <span className="tide-telemetry-status-value-wrap">
          <span className="tide-telemetry-status-value">
            {formatTokensCaps(perTurnContextTokens)}
          </span>
        </span>
      </span>
      <span
        className="tide-telemetry-status-cell"
        data-priority="total-time"
      >
        <TideTelemetryEndcapRuleLabel label="TOTAL TIME" ticksDirection="down" />
        <span className="tide-telemetry-status-value-wrap">
          <span className="tide-telemetry-status-value">
            {formatTimeAlwaysHours(totals.totalActiveMs)}
          </span>
        </span>
      </span>
      <span
        className="tide-telemetry-status-cell"
        data-priority="total-tokens"
      >
        <TideTelemetryEndcapRuleLabel label="TOTAL TOKENS" ticksDirection="down" />
        <span className="tide-telemetry-status-value-wrap">
          <span className="tide-telemetry-status-value">
            {formatTokensCaps(totalTokensSum)}
          </span>
        </span>
      </span>
      <span
        className="tide-telemetry-status-cell"
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
