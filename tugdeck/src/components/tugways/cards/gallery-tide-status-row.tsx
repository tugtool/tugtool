/**
 * gallery-tide-status-row.tsx — plan-of-record reference for the
 * tide-card Z2 status row.
 *
 * **Status: plan of record.** The design spike (rounds 1–9) is
 * resolved. This card now documents the chosen design rather than
 * exploring alternatives. The composed row at the top is the
 * canonical layout; the all-states reference and width-survey rows
 * beneath it document the indicator's per-state behavior and the
 * row's container-query collapse priority.
 *
 * # Design
 *
 *  - **Leftmost — phase/transport indicator + label.** Concentric
 *    dot + ring with the canonical phase title rendered inline to
 *    the right (TugStateIndicator's default `labelPosition="right"`,
 *    landed in 20.4.3). The dot is the constant — always visible,
 *    color encodes state (`success` for active, `caution` for
 *    awaiting/restoring/interrupt, `danger` for errored/offline,
 *    `default` for idle). The ring is the activity-signal layer:
 *    rendered only for ACTIVE (animated) states, pulses outward via
 *    TugAnimator. The wrapping host span uses a fixed `width`
 *    (`INDICATOR_SLOT_WIDTH`, currently 220 px) — not `minWidth` —
 *    so the variable-width label (longest is "Awaiting first
 *    response") never expands the slot and the Time/Tokens/Context
 *    cells stay at a stable horizontal position across label-text
 *    changes.
 *  - **Middle — three F5 cells.** Uniform-width columns containing
 *    `TIME · TOKENS · CONTEXT`. Each cell is the IBM-1620-inspired
 *    endcap-rule label apparatus above a centered value.
 *    `formatTimeAlwaysHours` (`Hh Mm SSs`) for the time cell,
 *    `formatTokensCaps` (`K`/`M`/`G`) for the tokens cell. CONTEXT
 *    numerator color-codes by usage ratio. (The total-time / total-
 *    tokens cells from the pre-20.4.4 layout were removed; that data
 *    reappears in the per-area popovers in 20.4.7.)
 *  - **Spacing — single flex row, all gaps fluid.** `paddingInline:
 *    2xl` (24 px) gives the row generous margins at its left/right
 *    edges. The row is a flat 4-item flex layout (indicator, TIME,
 *    TOKENS, CONTEXT) with `justify-content: space-between` and a
 *    minimum `gap: 8 px`. All three inter-item gaps flex uniformly
 *    as the frame widens; no item's position is "stuck" to any
 *    other item.
 *  - **Collapse priority (gallery @container rules).** As the row
 *    narrows, whole cells hide in priority order — TIME, then
 *    TOKENS, then CONTEXT (the indicator + label always stays). The
 *    breakpoint for each tier is written in `ch` units inside the
 *    @container `calc()`, so it's derived from the actual rendered
 *    `19ch` cell width in whatever monospace font the browser is
 *    using — no guessing pixel widths. See
 *    `gallery-tide-status-row.css` for the calc expressions.
 *  - **No chevron.** The status bar does not collapse.
 *
 * # Card structure
 *
 *  1. **Plan of record** — the chosen composed row at the user's
 *     selected scenario + session state.
 *  2. **All session states** — reference grid showing the indicator's
 *     behavior in every `CodeSessionPhase` × `TransportState` ×
 *     `interruptInFlight` combination.
 *  3. **Container-query widths** — the canonical row inside a
 *     `resize: horizontal` frame so the collapse priority can be
 *     vetted by direct manipulation (drag the bottom-right corner of
 *     the frame to narrow it past the 430 / 260 breakpoints).
 *
 * Controls (Tug components, responder-chain wired via
 * `useResponderForm`): scenario picker, next-scenario button,
 * auto-tick switch, session-state picker.
 *
 * @module components/tugways/cards/gallery-tide-status-row
 */

import "./gallery-tide-status-row.css";

import React, { useEffect, useId, useState } from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import { TugSwitch } from "@/components/tugways/tug-switch";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugStateIndicator } from "@/components/tugways/tug-state-indicator";
import type { TugStateIndicatorState } from "@/components/tugways/tug-state-indicator";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";
import {
  isLivePhase,
  useLifecycleTick,
} from "@/lib/code-session-store/hooks/use-lifecycle-tick";
import {
  deriveInflightActiveMs,
  deriveTimeCellMs,
} from "@/lib/code-session-store/telemetry";
import type { CodeSessionSnapshot } from "@/lib/code-session-store/types";
import {
  TugPopover,
  TugPopoverContent,
  TugPopoverTrigger,
} from "@/components/tugways/tug-popover";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugArcGauge } from "@/components/tugways/tug-arc-gauge";
import type {
  TugArcGaugeSegment,
} from "@/components/tugways/tug-arc-gauge";
import {
  computeContextBreakdown,
  computeTimeSummary,
  computeTokensSummary,
} from "@/lib/code-session-store/telemetry";
import type {
  TurnCost,
  TurnEntry,
} from "@/lib/code-session-store/types";

// ---------------------------------------------------------------------------
// Value scenarios + status-row formatters
// ---------------------------------------------------------------------------

interface StatusValues {
  perTurnActiveMs: number;
  perTurnTokens: number;
  totalActiveMs: number;
  totalTokens: number;
  contextTokens: number;
  contextMax: number;
}

interface Scenario {
  readonly id: string;
  readonly label: string;
  readonly values: StatusValues;
}

const ONE_MILLION = 1_000_000;

const SCENARIOS: ReadonlyArray<Scenario> = [
  { id: "fresh", label: "Fresh session", values: { perTurnActiveMs: 1_800, perTurnTokens: 30_300, totalActiveMs: 1_800, totalTokens: 30_300, contextTokens: 30_300, contextMax: ONE_MILLION } },
  { id: "early", label: "Early session", values: { perTurnActiveMs: 12_400, perTurnTokens: 5_100, totalActiveMs: 14_200, totalTokens: 5_100, contextTokens: 5_100, contextMax: ONE_MILLION } },
  { id: "longTurn", label: "Long turn", values: { perTurnActiveMs: 83_400, perTurnTokens: 87_500, totalActiveMs: 124_200, totalTokens: 92_000, contextTokens: 87_500, contextMax: ONE_MILLION } },
  { id: "deepSession", label: "Deep session", values: { perTurnActiveMs: 12_300, perTurnTokens: 30_000, totalActiveMs: 3_840_000, totalTokens: 5_050_000, contextTokens: 195_000, contextMax: ONE_MILLION } },
  { id: "approachingCap", label: "Approaching cap (caution)", values: { perTurnActiveMs: 14_200, perTurnTokens: 65_000, totalActiveMs: 600_000, totalTokens: 4_200_000, contextTokens: 780_000, contextMax: ONE_MILLION } },
  { id: "nearCap", label: "Near cap (danger)", values: { perTurnActiveMs: 4_200, perTurnTokens: 18_000, totalActiveMs: 1_394_000, totalTokens: 9_800_000, contextTokens: 905_000, contextMax: ONE_MILLION } },
  { id: "marathon", label: "Marathon", values: { perTurnActiveMs: 8_100, perTurnTokens: 22_000, totalActiveMs: 16_200_000, totalTokens: 47_200_000, contextTokens: 950_000, contextMax: ONE_MILLION } },
];

function formatTokensCaps(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}G`;
}

function formatTimeAlwaysHours(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0h 0m 00s";
  const totalSec = Math.max(0, Math.floor(ms / 1_000));
  const h = Math.floor(totalSec / 3_600);
  const m = Math.floor((totalSec % 3_600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s.toString().padStart(2, "0")}s`;
}

// ---------------------------------------------------------------------------
// Synthetic in-flight bookkeeping for the gallery's live-clock demo
// ---------------------------------------------------------------------------

/**
 * Per-pause-axis bookkeeping for one yellow axis (awaiting-approval,
 * transport-downtime, or interrupt-in-flight) over the lifetime of a
 * simulated in-flight turn. `since` is the wall-clock ms when the
 * axis last opened (or `null` while closed); `intervals` is the
 * closed-segment history accumulated as the user toggles the axis on
 * and off via the state picker. Mirrors the reducer's bookkeeping
 * from `#step-20-4-5-a` — the gallery's synthetic snapshot reads from
 * this state in the same shape the production snapshot exposes.
 */
interface PauseAxisTrack {
  since: number | null;
  intervals: ReadonlyArray<readonly [number, number]>;
}

/**
 * Aggregate in-flight bookkeeping for the simulated turn the gallery
 * picks across. `submitAt` is captured once when the user transitions
 * from a terminal phase into a live phase (or via the explicit "New
 * turn" button) and preserved across subsequent live-phase changes,
 * so toggling between yellow and green states accumulates pause time
 * against the same submit anchor — exactly the production behavior.
 *
 * When the picker selects a terminal phase, the track collapses to
 * `EMPTY_INFLIGHT` and the synthetic snapshot's `inflightUserMessage`
 * goes `null`; the renderer's `deriveTimeCellMs` fallback then shows
 * the static post-commit scenario value (the "freeze at turn-complete"
 * demonstration).
 */
interface InflightTrack {
  submitAt: number | null;
  awaiting: PauseAxisTrack;
  transport: PauseAxisTrack;
  interrupt: PauseAxisTrack;
}

const EMPTY_AXIS: PauseAxisTrack = { since: null, intervals: [] };
const EMPTY_INFLIGHT: InflightTrack = {
  submitAt: null,
  awaiting: EMPTY_AXIS,
  transport: EMPTY_AXIS,
  interrupt: EMPTY_AXIS,
};

/**
 * Open a fresh in-flight turn at `now` — captures `submitAt` and
 * opens every axis whose `state` is currently "yellow". Used both at
 * mount (so the gallery shows a live clock immediately) and from the
 * "New turn" button when the user wants to restart the demo without
 * round-tripping through a terminal phase.
 */
function startInflight(
  state: TugStateIndicatorState,
  now: number,
): InflightTrack {
  return {
    submitAt: now,
    awaiting: {
      since: state.phase === "awaiting_approval" ? now : null,
      intervals: [],
    },
    transport: {
      since: state.transportState !== "online" ? now : null,
      intervals: [],
    },
    interrupt: {
      since: state.interruptInFlight ? now : null,
      intervals: [],
    },
  };
}

/**
 * Apply an open/close transition to one axis. If the axis should
 * become open and is currently closed, capture `now` as the segment
 * start. If it should become closed and is currently open, push the
 * `[since, now]` pair onto the intervals array. Otherwise preserve
 * the prior reference (no churn for unchanged axes).
 */
function applyAxisTransition(
  prev: PauseAxisTrack,
  wantOpen: boolean,
  now: number,
): PauseAxisTrack {
  if (wantOpen) {
    return prev.since === null ? { since: now, intervals: prev.intervals } : prev;
  }
  if (prev.since === null) {
    return prev;
  }
  return {
    since: null,
    intervals: [...prev.intervals, [prev.since, now] as const],
  };
}

/**
 * Apply a state-picker transition to the in-flight track. Terminal →
 * anything collapses to `EMPTY_INFLIGHT` (so the renderer falls back
 * to the static post-commit value). Terminal → live opens a fresh
 * turn at `now`. Live → live preserves `submitAt` and updates each
 * axis open/close per the new state.
 */
function applyStateChange(
  prev: InflightTrack,
  state: TugStateIndicatorState,
  now: number,
): InflightTrack {
  if (!isLivePhase(state.phase)) {
    return EMPTY_INFLIGHT;
  }
  if (prev.submitAt === null) {
    return startInflight(state, now);
  }
  return {
    submitAt: prev.submitAt,
    awaiting: applyAxisTransition(
      prev.awaiting,
      state.phase === "awaiting_approval",
      now,
    ),
    transport: applyAxisTransition(
      prev.transport,
      state.transportState !== "online",
      now,
    ),
    interrupt: applyAxisTransition(
      prev.interrupt,
      state.interruptInFlight,
      now,
    ),
  };
}

/**
 * Project the gallery's `InflightTrack` onto a `CodeSessionSnapshot`
 * in the same shape the production reducer exposes. The synthesized
 * snapshot is the input `deriveInflightActiveMs` reads; identity
 * stability isn't a concern here (the gallery never subscribes to
 * the snapshot via `useSyncExternalStore`).
 */
function buildSyntheticSnapshot(
  state: TugStateIndicatorState,
  inflight: InflightTrack,
): CodeSessionSnapshot {
  const inFlight = inflight.submitAt !== null;
  return {
    phase: state.phase,
    transportState: state.transportState,
    interruptInFlight: state.interruptInFlight,
    tugSessionId: "gallery",
    displayLabel: "gallery",
    sessionMode: "new",
    activeMsgId: null,
    canSubmit: !inFlight,
    canInterrupt: inFlight,
    pendingApproval: null,
    pendingQuestion: null,
    controlRequestLog: [],
    queuedSends: 0,
    transcript: [],
    inflightUserMessage: inFlight
      ? {
          text: "",
          atoms: [],
          submitAt: inflight.submitAt as number,
          turnKey: "gallery-turn",
        }
      : null,
    pendingDraftRestore: null,
    lastCost: null,
    lastContextBreakdown: null,
    lastError: null,
    lastReplayResult: null,
    replayPreflightActive: false,
    replaySoftBudgetElapsed: false,
    replayTimeoutDwellActive: false,
    awaitingApprovalIntervals: inflight.awaiting.intervals,
    awaitingApprovalSegmentStartedAt: inflight.awaiting.since,
    transportDowntimeIntervals: inflight.transport.intervals,
    transportDowntimeSegmentStartedAt: inflight.transport.since,
    interruptInFlightIntervals: inflight.interrupt.intervals,
    interruptInFlightSegmentStartedAt: inflight.interrupt.since,
  };
}

// ---------------------------------------------------------------------------
// Session state scenarios
// ---------------------------------------------------------------------------

// The gallery dispatches on the same `TugStateIndicatorState` triple
// the component reads — `phase × transportState × interruptInFlight`.

const STATE_SCENARIOS: ReadonlyArray<{ id: string; label: string; state: TugStateIndicatorState }> = [
  { id: "idle_online", label: "idle · online", state: { phase: "idle", transportState: "online", interruptInFlight: false } },
  { id: "submitting", label: "submitting · online", state: { phase: "submitting", transportState: "online", interruptInFlight: false } },
  { id: "awaiting_first", label: "awaiting_first_token · online", state: { phase: "awaiting_first_token", transportState: "online", interruptInFlight: false } },
  { id: "streaming", label: "streaming · online", state: { phase: "streaming", transportState: "online", interruptInFlight: false } },
  { id: "tool_work", label: "tool_work · online", state: { phase: "tool_work", transportState: "online", interruptInFlight: false } },
  { id: "awaiting_approval", label: "awaiting_approval · online", state: { phase: "awaiting_approval", transportState: "online", interruptInFlight: false } },
  { id: "interrupted_streaming", label: "streaming · INTERRUPT in flight", state: { phase: "streaming", transportState: "online", interruptInFlight: true } },
  { id: "offline", label: "idle · OFFLINE", state: { phase: "idle", transportState: "offline", interruptInFlight: false } },
  { id: "restoring", label: "submitting · RESTORING", state: { phase: "submitting", transportState: "restoring", interruptInFlight: false } },
  { id: "errored", label: "errored · online", state: { phase: "errored", transportState: "online", interruptInFlight: false } },
  { id: "replaying", label: "replaying · online", state: { phase: "replaying", transportState: "online", interruptInFlight: false } },
];

// ---------------------------------------------------------------------------
// Transcript fixtures for per-area popovers (20.4.7.A)
// ---------------------------------------------------------------------------

/**
 * Build a `TurnCost` with explicit per-category counts and a derived
 * (synthetic) `totalCostUsd`. Defaults to zero per category — callers
 * pass only the categories they care about for the fixture's shape.
 */
function fixtureCost(partial: Partial<TurnCost> = {}): TurnCost {
  const {
    inputTokens = 0,
    outputTokens = 0,
    cacheReadInputTokens = 0,
    cacheCreationInputTokens = 0,
    totalCostUsd,
  } = partial;
  const derivedCost =
    (inputTokens + outputTokens) * 0.000003 +
    cacheCreationInputTokens * 0.000004 +
    cacheReadInputTokens * 0.00000025;
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalCostUsd: totalCostUsd ?? derivedCost,
  };
}

/**
 * Build a complete `TurnEntry` from a small set of meaningful per-turn
 * fields. The remaining `TurnEntry` surface (`turnKey`, `msgId`,
 * `endedAt`, `ttftMs`, etc.) is filled with neutral defaults so the
 * fixtures stay terse — the popover content only reads `activeMs`,
 * `cost`, and `result`.
 */
function fixtureTurn(
  idx: number,
  partial: {
    activeMs?: number;
    cost?: Partial<TurnCost>;
    result?: "success" | "interrupted";
  } = {},
): TurnEntry {
  const { activeMs = 5_000, cost = {}, result = "success" } = partial;
  return {
    turnKey: `fixture-turn-${idx}`,
    msgId: `fixture-msg-${idx}`,
    userMessage: { text: "", attachments: [], submitAt: 0 },
    thinking: "",
    assistant: "",
    toolCalls: [],
    controlRequests: [],
    result,
    endedAt: 0,
    wallClockMs: activeMs,
    awaitingApprovalMs: 0,
    transportDowntimeMs: 0,
    activeMs,
    ttftMs: null,
    ttftcMs: null,
    reconnectCount: 0,
    maxStreamGapMs: 0,
    turnEndReason: result === "success" ? "complete" : "interrupted",
    cost: fixtureCost(cost),
  };
}

interface TranscriptScenario {
  readonly id: string;
  readonly label: string;
  readonly transcript: ReadonlyArray<TurnEntry>;
}

/**
 * Synthetic transcripts that drive the Time + Tokens popovers'
 * row-log + summary footer. Each shape exercises a different
 * popover state — empty / single-row / multi-row with mixed
 * terminal reasons / long-session — so the substrate is HMR-vettable
 * against the cases production will eventually hit.
 */
const TRANSCRIPT_SCENARIOS: ReadonlyArray<TranscriptScenario> = [
  { id: "empty", label: "Fresh (0 turns)", transcript: [] },
  {
    id: "single",
    label: "Single turn",
    transcript: [
      fixtureTurn(1, {
        activeMs: 4_200,
        cost: { inputTokens: 12_000, outputTokens: 1_800, cacheReadInputTokens: 2_400 },
      }),
    ],
  },
  {
    id: "short",
    label: "Short session (4 turns)",
    transcript: [
      fixtureTurn(1, {
        activeMs: 1_800,
        cost: { inputTokens: 9_400, outputTokens: 1_200 },
      }),
      fixtureTurn(2, {
        activeMs: 12_400,
        cost: { inputTokens: 14_200, outputTokens: 4_300, cacheReadInputTokens: 3_000 },
      }),
      fixtureTurn(3, {
        activeMs: 3_100,
        cost: { inputTokens: 11_800, outputTokens: 900 },
        result: "interrupted",
      }),
      fixtureTurn(4, {
        activeMs: 8_900,
        cost: { inputTokens: 13_400, outputTokens: 2_700, cacheCreationInputTokens: 1_500 },
      }),
    ],
  },
  {
    id: "deep",
    label: "Deep session (mixed outcomes)",
    transcript: [
      fixtureTurn(1, { activeMs: 1_500, cost: { inputTokens: 4_200, outputTokens: 600 } }),
      fixtureTurn(2, { activeMs: 6_400, cost: { inputTokens: 7_800, outputTokens: 1_900 } }),
      fixtureTurn(3, { activeMs: 24_800, cost: { inputTokens: 18_600, outputTokens: 8_400, cacheReadInputTokens: 5_400 } }),
      fixtureTurn(4, { activeMs: 2_100, cost: { inputTokens: 8_300, outputTokens: 1_100 }, result: "interrupted" }),
      fixtureTurn(5, { activeMs: 14_600, cost: { inputTokens: 12_900, outputTokens: 4_400 } }),
      fixtureTurn(6, { activeMs: 9_300, cost: { inputTokens: 11_200, outputTokens: 2_800, cacheCreationInputTokens: 2_000 } }),
      fixtureTurn(7, { activeMs: 31_900, cost: { inputTokens: 22_400, outputTokens: 12_100, cacheReadInputTokens: 9_800 } }),
      fixtureTurn(8, { activeMs: 4_700, cost: { inputTokens: 9_100, outputTokens: 1_700 } }),
      fixtureTurn(9, { activeMs: 18_200, cost: { inputTokens: 16_800, outputTokens: 6_300 } }),
      fixtureTurn(10, { activeMs: 7_400, cost: { inputTokens: 10_500, outputTokens: 2_200 }, result: "interrupted" }),
    ],
  },
];

// ---------------------------------------------------------------------------
// Tokens, surfaces, base styles
// ---------------------------------------------------------------------------

const MONO = "var(--tug-font-mono, monospace)";
const RAIL_COLOR = "var(--tug7-element-global-border-normal-default-rest)";
const TEXT_NORMAL = "var(--tug7-element-global-text-normal-default-rest)";
const TEXT_MUTED = "var(--tug7-element-global-text-normal-muted-rest)";
const TEXT_CAUTION = "var(--tug7-element-global-text-normal-caution-rest)";
const TEXT_DANGER = "var(--tug7-element-global-text-normal-danger-rest)";

const DEFAULT_LABEL_SIZE = "0.5625rem";
const DEFAULT_VALUE_SIZE = "0.6875rem";
const LABEL_LETTER_SPACING = "0.18em";

const sectionTitleStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--tug-space-2xs)",
  marginBottom: "var(--tug-space-sm)",
};

const variantNoteStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "0.625rem",
  color: TEXT_MUTED,
  opacity: 0.85,
};

function contextNumeratorColor(v: StatusValues): string {
  const ratio = v.contextTokens / v.contextMax;
  if (ratio >= 0.9) return TEXT_DANGER;
  if (ratio >= 0.75) return TEXT_CAUTION;
  return TEXT_NORMAL;
}

const cardSurface: React.CSSProperties = {
  backgroundColor: "var(--tug7-surface-card-primary-normal-status-rest)",
  borderTop: `1px solid ${RAIL_COLOR}`,
  borderBottom: `1px solid ${RAIL_COLOR}`,
  padding: "var(--tug-space-md)",
  fontFamily: MONO,
  fontVariantNumeric: "tabular-nums",
  fontSize: "0.6875rem",
  lineHeight: 1.2,
};

// ---------------------------------------------------------------------------
// Custom EndcapRuleLabel (T1 — locked-in design)
// ---------------------------------------------------------------------------

function EndcapRuleLabel({
  label,
  width,
  ticksDirection,
  capLength = 5,
  ruleOpacity = 0.55,
  letterSpacing = LABEL_LETTER_SPACING,
}: {
  label: string;
  width: string;
  ticksDirection: "down" | "up";
  capLength?: number;
  ruleOpacity?: number;
  letterSpacing?: string;
}): React.ReactElement {
  const ticksDown = ticksDirection === "down";
  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        flexDirection: "row",
        alignItems: "center",
        width,
        gap: 4,
        [ticksDown ? "marginBottom" : "marginTop"]: capLength,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          ...(ticksDown ? { top: "50%" } : { bottom: "50%" }),
          width: 1,
          height: capLength,
          backgroundColor: RAIL_COLOR,
          opacity: ruleOpacity,
        }}
      />
      <span style={{ flex: 1, height: 1, backgroundColor: RAIL_COLOR, opacity: ruleOpacity }} />
      <span
        style={{
          fontFamily: MONO,
          fontSize: DEFAULT_LABEL_SIZE,
          letterSpacing,
          color: TEXT_MUTED,
          textTransform: "uppercase",
          fontWeight: 500,
          padding: "0 4px",
          transform: "translateY(0.5px)",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, backgroundColor: RAIL_COLOR, opacity: ruleOpacity }} />
      <span
        style={{
          position: "absolute",
          right: 0,
          ...(ticksDown ? { top: "50%" } : { bottom: "50%" }),
          width: 1,
          height: capLength,
          backgroundColor: RAIL_COLOR,
          opacity: ruleOpacity,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// F5 cells (T1 endcap)
// ---------------------------------------------------------------------------

const UNIFORM_CELL_WIDTH = "19ch";

type CellPriority = "time" | "tokens" | "context";

function F5Cell({
  label,
  valueNode,
  priority,
}: {
  label: string;
  valueNode: React.ReactElement;
  priority: CellPriority;
}): React.ReactElement {
  return (
    <span
      className="gallery-tide-status-cell"
      data-priority={priority}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      <EndcapRuleLabel
        label={label}
        width={UNIFORM_CELL_WIDTH}
        ticksDirection="down"
      />
      <span
        style={{
          display: "inline-flex",
          justifyContent: "center",
          width: UNIFORM_CELL_WIDTH,
        }}
      >
        {valueNode}
      </span>
    </span>
  );
}

function plainValue(text: string): React.ReactElement {
  return (
    <span
      style={{
        fontFamily: MONO,
        color: TEXT_NORMAL,
        fontWeight: 600,
        fontSize: DEFAULT_VALUE_SIZE,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {text}
    </span>
  );
}

function contextValue(v: StatusValues): React.ReactElement {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontWeight: 600,
        fontSize: DEFAULT_VALUE_SIZE,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ color: contextNumeratorColor(v) }}>{formatTokensCaps(v.contextTokens)}</span>
      <span style={{ color: TEXT_MUTED, opacity: 0.7 }}>{` / ${formatTokensCaps(v.contextMax)}`}</span>
    </span>
  );
}

/**
 * Optional popover content keyed by cell priority. When a key is set,
 * `buildCellNodes` wraps the matching cell in a `TugPopoverTrigger`
 * with the status-cell anchor affordance class — the anchor pattern
 * established in 20.4.6. Keys with no value render the cell bare.
 *
 * The Z2 status row reuses this map's shape across both gallery
 * instances (plan-of-record + resize-frame): the plan-of-record
 * instance passes meaningful popover content for `time` and `tokens`;
 * the resize-frame instance omits the prop so the cell-collapse
 * behavior can be vetted without popovers interfering. CONTEXT's
 * popover (an arc-gauge breakdown) lands in 20.4.7.C.
 */
interface CellPopoverContent {
  time?: React.ReactNode;
  tokens?: React.ReactNode;
  context?: React.ReactNode;
}

function buildCellNodes(
  v: StatusValues,
  popovers?: CellPopoverContent,
): React.ReactElement[] {
  const entries: Array<{ priority: CellPriority; node: React.ReactElement }> = [
    {
      priority: "time",
      node: (
        <F5Cell
          priority="time"
          label="TIME"
          valueNode={plainValue(formatTimeAlwaysHours(v.perTurnActiveMs))}
        />
      ),
    },
    {
      priority: "tokens",
      node: (
        <F5Cell
          priority="tokens"
          label="TOKENS"
          valueNode={plainValue(formatTokensCaps(v.perTurnTokens))}
        />
      ),
    },
    {
      priority: "context",
      node: (
        <F5Cell priority="context" label="CONTEXT" valueNode={contextValue(v)} />
      ),
    },
  ];
  return entries.map(({ priority, node }) => {
    const content = popovers?.[priority];
    if (content === undefined) {
      return React.cloneElement(node, { key: priority });
    }
    // Anchor pattern: F5Cell wrapped in `gallery-tide-status-cell-clickable`
    // for the hover affordance hint (cursor + tinted background), then
    // composed into a TugPopover whose trigger uses asChild so Radix
    // merges click + ARIA onto the affordance span. The wrapper carries
    // `data-priority` so the @container collapse rules hide it
    // alongside the cell itself.
    return (
      <TugPopover key={priority}>
        <TugPopoverTrigger>
          <span
            className="gallery-tide-status-cell-clickable"
            data-priority={priority}
          >
            {node}
          </span>
        </TugPopoverTrigger>
        <TugPopoverContent side="top" align="center" sideOffset={8} arrow>
          {content}
        </TugPopoverContent>
      </TugPopover>
    );
  });
}

// ---------------------------------------------------------------------------
// Per-area popover content (20.4.7.A) — Time + Tokens
// ---------------------------------------------------------------------------

/**
 * One row in a per-area popover. Two-column layout — label on the
 * left, value on the right — with an optional `hint` rendered as a
 * trailing muted suffix and an optional `badge` rendered after the
 * value. Mirrors the dev-panel `FieldRow` visual language (mono
 * monospace, tabular numerics, label-left / value-right, muted hint
 * suffix) so the popover's row density matches the rest of the dev
 * surfaces the user works in. The badge slot is the per-row terminal-
 * state chip the row log uses.
 *
 * Kept inline in the gallery card rather than promoted into the
 * tugways library because the per-area popovers are still a workshop
 * surface — the production component (when 20.4.10 promotes this
 * into the real Z2 renderer) will choose whether this row primitive
 * graduates to a shared component.
 */
function PopoverRow({
  label,
  value,
  hint,
  badge,
}: {
  /**
   * Row label. Accepts arbitrary nodes (not just strings) so the
   * Context popover can prepend a per-row color swatch inline with
   * the label text; string-only callers (Time / Tokens row logs +
   * summary rows) pass plain strings unchanged.
   */
  label: React.ReactNode;
  value: string;
  hint?: string;
  badge?: React.ReactNode;
}): React.ReactElement {
  // Three-column grid: label (far left, muted), an annotation column
  // (badge OR hint, right-aligned so it abuts the value) and the
  // numeric value (far right). Numbers across rows share the same
  // `auto`-sized rightmost column, so different value lengths (e.g.
  // "4" vs "0h 0m 26s") still right-align on the same edge — the
  // reader can scan the column vertically without their eye chasing
  // ragged trailing chrome.
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        columnGap: "var(--tug-space-md)",
        alignItems: "baseline",
        fontFamily: MONO,
        fontVariantNumeric: "tabular-nums",
        fontSize: "0.6875rem",
        paddingBlock: 2,
      }}
    >
      <span style={{ color: TEXT_MUTED }}>{label}</span>
      <span
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "baseline",
          color: TEXT_MUTED,
          fontWeight: 400,
        }}
      >
        {badge !== undefined ? badge : hint !== undefined ? hint : null}
      </span>
      <span
        style={{
          color: TEXT_NORMAL,
          fontWeight: 600,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Small chip rendering the per-row terminal state (`TurnEntry.result`).
 * "success" reads as low-emphasis "ok" / muted ghost, "interrupted"
 * reads as `caution` so the row jumps out a little — the per-row
 * stripe the user scans the log for.
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
 * Popover-content frame shared by Time + Tokens + Context. Renders an
 * uppercase title bar, the body (passed in as `children`), and an
 * optional separator-fronted summary footer (`summaryFooter`). The
 * frame owns the layout chrome so popovers stay structurally
 * consistent across surfaces — only the body content differs.
 *
 * The default min/max width fits the Time + Tokens row lists (~280–360
 * px); the Context popover overrides `maxWidth` with a wider cap so
 * the large segmented gauge + legend layout fits side-by-side
 * without clipping.
 */
function PerAreaPopoverFrame({
  title,
  children,
  summaryFooter,
  minWidth = 280,
  maxWidth = 360,
}: {
  title: string;
  children: React.ReactNode;
  summaryFooter?: React.ReactNode;
  minWidth?: number;
  maxWidth?: number;
}): React.ReactElement {
  return (
    <div
      style={{
        padding: "var(--tug-space-md)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth,
        maxWidth,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: "0.625rem",
          letterSpacing: LABEL_LETTER_SPACING,
          textTransform: "uppercase",
          color: TEXT_MUTED,
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
      {summaryFooter !== undefined && summaryFooter !== null ? (
        <div
          style={{
            borderTop: `1px solid ${RAIL_COLOR}`,
            marginTop: 6,
            paddingTop: 6,
          }}
        >
          {summaryFooter}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "No committed turns yet" body — the empty-transcript path for both
 * popovers. Same muted typographic weight as the rest of the popover
 * body so the empty state doesn't read as an error.
 */
function EmptyTranscriptBody(): React.ReactElement {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: "0.6875rem",
        color: TEXT_MUTED,
        fontStyle: "italic",
        paddingBlock: 4,
      }}
    >
      No committed turns yet.
    </div>
  );
}

/**
 * `Time` popover content per plan `#step-20-4-7-a`: per-turn
 * `activeMs` log (committed turns only) + summary footer (count,
 * total, average) + optional in-flight footer that surfaces the live
 * current-turn elapsed when a turn is in flight.
 *
 * The summary block is computed by `computeTimeSummary` so the same
 * derivation pins the production popover (when 20.4.10 promotes it).
 * The in-flight slot is null while no turn is in flight; when set, it
 * receives the live `currentTurnActiveMs` from the gallery card
 * (already 1Hz-ticked via `useLifecycleTick`) and the rest of the
 * popover surface re-renders for free as a child of the gallery's
 * render cycle.
 */
function TimePopoverContent({
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
        transcript.map((t, i) => (
          <PopoverRow
            key={t.turnKey}
            label={`turn ${i + 1}`}
            value={formatTimeAlwaysHours(t.activeMs)}
            badge={<TerminalStateBadge result={t.result} />}
          />
        ))
      )}
    </PerAreaPopoverFrame>
  );
}

/**
 * Per-turn total token sum for the `Tokens` popover's row log. Mirrors
 * the headline `Tokens` cell's value across the row dimension: sum of
 * input + output + cache-read + cache-creation per committed turn.
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
 * `Tokens` popover content per plan `#step-20-4-7-a`: per-turn token
 * sum log + summary footer (count, total, average) + optional in-flight
 * footer. Same in-flight contract as `TimePopoverContent`: in-flight
 * turns are excluded from the row log and the summary footer, with
 * the live current-turn contribution surfaced as a separate footer
 * row when a turn is in flight.
 */
function TokensPopoverContent({
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
        transcript.map((t, i) => (
          <PopoverRow
            key={t.turnKey}
            label={`turn ${i + 1}`}
            value={formatTokensCaps(perTurnTotalTokens(t))}
            badge={<TerminalStateBadge result={t.result} />}
          />
        ))
      )}
    </PerAreaPopoverFrame>
  );
}

// ---------------------------------------------------------------------------
// Context popover — large segmented gauge + per-category legend
// ---------------------------------------------------------------------------

/**
 * Wrapper pinning the `Context` popover's large `TugArcGauge` at the
 * showcase scale (`180px`). Matches the gallery's `SHOWCASE_SIZE` in
 * `gallery-tug-arc-gauge.tsx` (the third gauge gallery card) so the
 * "large" gauge size used by the Context popover stays in lockstep
 * with the substrate gallery's own large demonstration.
 */
const CONTEXT_GAUGE_LARGE_PX = 180;

/**
 * Token-to-percent formatter. The legend rows + summary footer both
 * show the percent of context-window consumption — one decimal place
 * is plenty for human comparison (0.0% to 100.0%).
 */
function formatContextPercent(used: number, max: number): string {
  if (max <= 0) {
    return "0.0%";
  }
  return `${((used / max) * 100).toFixed(1)}%`;
}

/**
 * Map a categorical tone to the matching `--tugx-arc-gauge-segment-*-color`
 * CSS variable so the legend swatches read the same custom property
 * the gauge's segments do — themes that retune the segment palette
 * propagate to both surfaces without per-callsite hard-coding.
 */
function contextSegmentSwatchVar(tone: TugArcGaugeSegment["tone"]): string {
  return `var(--tugx-arc-gauge-segment-${tone}-color)`;
}

/**
 * `Context` popover content per plan `#step-20-4-7-c`: large
 * `TugArcGauge` in segmented mode showing the last committed turn's
 * five-category context-window breakdown (input / cache-read /
 * cache-creation / output / remainder), paired with a legend listing
 * each category's token count + percent of the window. The footer
 * shows the totalUsed / contextMax headline.
 *
 * In-flight contract per the plan: when opened during an in-flight
 * turn, the popover shows the **last committed** turn's breakdown
 * (the most-recent boundary at which a context picture is
 * meaningful). When the transcript is empty (no committed turns
 * yet), the popover renders an empty-state body without the gauge
 * or footer — the placeholder the plan calls out for the
 * pre-first-commit case.
 *
 * Reads the same `--tugx-arc-gauge-segment-*-color` slot family the
 * gauge primitive paints with; the popover never reaches for raw
 * `--tug7-*` tokens directly per [L17] / [L20].
 */
function ContextPopoverContent({
  transcript,
  contextMax,
}: {
  transcript: ReadonlyArray<TurnEntry>;
  contextMax: number;
}): React.ReactElement {
  const lastTurn =
    transcript.length > 0 ? transcript[transcript.length - 1] : null;
  if (lastTurn === null) {
    return (
      <PerAreaPopoverFrame title="Context window — last committed turn">
        <EmptyTranscriptBody />
      </PerAreaPopoverFrame>
    );
  }
  const breakdown = computeContextBreakdown(lastTurn, contextMax);
  const visibleSegments = breakdown.segments;
  return (
    <PerAreaPopoverFrame
      title="Context window — last committed turn"
      minWidth={400}
      maxWidth={500}
      summaryFooter={
        <>
          <PopoverRow
            label="used"
            value={formatTokensCaps(breakdown.totalUsed)}
            hint={formatContextPercent(breakdown.totalUsed, breakdown.contextMax)}
          />
          <PopoverRow
            label="max"
            value={formatTokensCaps(breakdown.contextMax)}
          />
        </>
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--tug-space-lg)",
          paddingBlock: 4,
        }}
      >
        <div
          style={{
            width: CONTEXT_GAUGE_LARGE_PX,
            flex: "0 0 auto",
          }}
        >
          <TugArcGauge
            min={0}
            max={breakdown.contextMax}
            // `value` is ignored in segments mode; pass 0 for the
            // documented fallback role.
            value={0}
            density="detailed"
            label="used"
            formatValue={formatTokensCaps}
            segments={visibleSegments}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          {visibleSegments.map((s) => (
            <PopoverRow
              key={s.id}
              label={
                <>
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      marginRight: 6,
                      verticalAlign: "middle",
                      backgroundColor: contextSegmentSwatchVar(s.tone),
                    }}
                  />
                  {s.label}
                </>
              }
              value={formatTokensCaps(s.value)}
              hint={formatContextPercent(s.value, breakdown.contextMax)}
            />
          ))}
        </div>
      </div>
    </PerAreaPopoverFrame>
  );
}

// ---------------------------------------------------------------------------
// Plan-of-record composed row — indicator + cells, C-wider-gap spacing
// ---------------------------------------------------------------------------

// Indicator + label host slot: a FIXED width (not minWidth) so the
// cells positions are stable across label-text changes. Sized for the
// longest PHASE_HUMAN_LABEL ("Awaiting first response", 23 chars in
// the row's mono font at 0.75rem ≈ 173px) + 16px glyph + 6px gap,
// plus ~25px buffer so verbose mono fallbacks still fit. If a future
// phase label is added longer than this, bump the constant.
const INDICATOR_SLOT_WIDTH = 220;

// Initial / min width for the resizable container-query demo live in
// `gallery-tide-status-row.css` (NOT in React inline style) so the
// user's drag persists across gallery re-renders. The CSS sets
// `width: 800px; min-width: 280px; max-width: 100%` on
// `.gallery-tide-status-resize-frame`; the @container breakpoints
// below it derive from the row's actual `19ch` cell width, so they
// stay correct regardless of which monospace font the browser picks.

function ComposedRow({
  v,
  state,
  popovers,
}: {
  v: StatusValues;
  state: TugStateIndicatorState;
  /**
   * Optional per-cell popover content keyed by cell priority. When
   * provided, the matching cells are wrapped in `TugPopoverTrigger`
   * with the status-cell anchor affordance class (the substrate from
   * 20.4.6). Pass `undefined` (or omit) to render bare cells — the
   * resize-frame instance leaves this off so cell-collapse can be
   * vetted without popovers competing for click handling.
   */
  popovers?: CellPopoverContent;
}): React.ReactElement {
  return (
    <div
      className="gallery-tide-status-row-host"
      style={{
        ...cardSurface,
        paddingInline: "var(--tug-space-2xl)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        // Single flex row holding the indicator + every visible cell.
        // `space-between` distributes them edge-to-edge with the
        // remaining row width absorbed into the gaps; `gap` is the
        // *minimum* inter-item spacing the gaps will ever shrink to.
        // All four (indicator → TIME → TOKENS → CONTEXT) gaps are
        // flexible — they grow uniformly as the row widens.
        justifyContent: "space-between",
        gap: 8,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          flex: "0 0 auto",
          width: INDICATOR_SLOT_WIDTH,
        }}
      >
        <TugStateIndicator state={state} size={16} />
      </span>
      {buildCellNodes(v, popovers)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2 — all states grid for P6 @ 16px
// ---------------------------------------------------------------------------

function AllStatesGrid(): React.ReactElement {
  return (
    <div
      style={{
        ...cardSurface,
        paddingInline: "var(--tug-space-lg)",
        paddingBlock: "var(--tug-space-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--tug-space-sm)",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {STATE_SCENARIOS.map((s) => (
        <div
          key={s.id}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--tug-space-md)",
          }}
        >
          <span style={{ display: "inline-flex", width: 20, justifyContent: "center" }}>
            <TugStateIndicator state={s.state} size={16} labelPosition="hidden" />
          </span>
          <span style={{ color: TEXT_MUTED, fontSize: "0.625rem" }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section title wrapper
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: string }): React.ReactElement {
  return (
    <div style={sectionTitleStyle}>
      <TugLabel size="xs">{children}</TugLabel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryTideStatusRow
// ---------------------------------------------------------------------------

export function GalleryTideStatusRow(): React.ReactElement {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [stateIdx, setStateIdx] = useState(3); // streaming · online — animation visible
  const [transcriptIdx, setTranscriptIdx] = useState(2); // "Short session"
  const [autoTick, setAutoTick] = useState(false);

  useEffect(() => {
    if (!autoTick) return;
    const id = setInterval(() => {
      setScenarioIdx((i) => (i + 1) % SCENARIOS.length);
    }, 1500);
    return () => clearInterval(id);
  }, [autoTick]);

  // Gallery-side in-flight simulator. `submitAt` is captured once at
  // mount (or via the "New turn" button) and preserved across
  // state-picker changes that stay within live phases — so toggling
  // between green and yellow states accumulates pause time against
  // the same submit anchor, exactly matching the production lifecycle
  // pause semantics.
  //
  // The bookkeeping is mutated only by the state-picker's
  // `setValueString` handler and the "New turn" button — both
  // user-gesture sources, both using the functional `setInflight(prev
  // => ...)` form so handlers read current state safely without
  // closing over a stale snapshot ([L07]). No `useEffect` derives
  // state from other state ([L02]'s broader principle); the
  // bookkeeping update lives at the call site that knows the change
  // is happening.
  //
  // `useLifecycleTick` returns a 1Hz tick value while phase is
  // non-terminal and `0` otherwise; `deriveTimeCellMs` reads it
  // through the synthetic snapshot and the helper's fallback covers
  // both the post-commit and never-submitted paths.
  const phase = STATE_SCENARIOS[stateIdx].state.phase;
  const tickAt = useLifecycleTick(phase);
  const [inflight, setInflight] = useState<InflightTrack>(() =>
    applyStateChange(EMPTY_INFLIGHT, STATE_SCENARIOS[stateIdx].state, Date.now()),
  );
  // `committedMs` is the production-analog "just-completed turn's
  // activeMs" — set the moment the user picks a terminal state from
  // the picker (snapshot of the running clock at that instant), so
  // the Time cell freezes at the running value instead of jumping to
  // a scenario default. Cleared on the next transition back to a
  // live phase (a new simulated turn is starting) and by the "New
  // turn" button.
  const [committedMs, setCommittedMs] = useState<number | null>(null);

  // Stable sender IDs for the responder-chain bindings.
  const scenarioPopupId = useId();
  const statePopupId = useId();
  const transcriptPopupId = useId();
  const autoTickSwitchId = useId();

  // Wire the popup-button + switch dispatches through the chain via
  // useResponderForm. TugPopupButton items dispatch `setValueString`
  // with their `value` payload; TugSwitch dispatches `toggle` with a
  // boolean. The bindings here forward each to its local setState.
  // [L11] migration pattern.
  //
  // The state picker's handler also computes the next `inflight`
  // bookkeeping in-line with the picker change — same call site, no
  // useEffect indirection ([L02]). The functional setter form reads
  // `prev` rather than closing over the current render's snapshot
  // ([L07]), so the handler is correct under back-to-back picks.
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [scenarioPopupId]: (v: string) => setScenarioIdx(Number(v)),
      [transcriptPopupId]: (v: string) => setTranscriptIdx(Number(v)),
      [statePopupId]: (v: string) => {
        const nextIdx = Number(v);
        const nextState = STATE_SCENARIOS[nextIdx].state;
        const now = Date.now();
        // Live → terminal: freeze the cell at the exact elapsed value
        // at this instant — the production-analog of `TurnEntry.activeMs`
        // landing at turn-complete. Recompute against the current
        // `inflight` track + a fresh `now` so the freeze is accurate
        // to the picker click, not to the most-recent 1Hz tick.
        if (!isLivePhase(nextState.phase) && inflight.submitAt !== null) {
          const snap = buildSyntheticSnapshot(state, inflight);
          setCommittedMs(deriveInflightActiveMs(snap, now) ?? 0);
        }
        // Terminal → live: clear the frozen value so the new turn's
        // live clock takes over without a stale freeze leaking
        // through the fallback path.
        if (isLivePhase(nextState.phase) && inflight.submitAt === null) {
          setCommittedMs(null);
        }
        setStateIdx(nextIdx);
        setInflight((prev) => applyStateChange(prev, nextState, now));
      },
    },
    toggle: {
      [autoTickSwitchId]: setAutoTick,
    },
  });

  const scenario = SCENARIOS[scenarioIdx];
  const baseValues = scenario.values;
  const state = STATE_SCENARIOS[stateIdx].state;
  const ratioPct = Math.round((baseValues.contextTokens / baseValues.contextMax) * 100);

  // Live-clock derivation. The synthetic snapshot reflects the
  // picker's current state + the accumulated `inflight` track; the
  // pure helper ticks the `Time` cell up at 1Hz while in flight,
  // pauses on yellow axes via the union math (the track carries the
  // closed-interval history of every yellow open/close cycle so far
  // this simulated turn), and falls back to the static scenario value
  // when no turn is in flight. The resulting `liveValues` keeps the
  // rest of the cell pipeline (formatters + ComposedRow) unchanged.
  const syntheticSnap = buildSyntheticSnapshot(state, inflight);
  // Fallback precedence: a `committedMs` capture (the just-frozen
  // value from the live → terminal transition) wins over the
  // scenario's static value. The scenario default only surfaces
  // before any simulated turn has run.
  const liveTimeMs = deriveTimeCellMs(
    syntheticSnap,
    tickAt,
    committedMs ?? baseValues.perTurnActiveMs,
  );
  const values: StatusValues = { ...baseValues, perTurnActiveMs: liveTimeMs };

  const scenarioItems: TugPopupButtonItem<string>[] = SCENARIOS.map((s, i) => ({
    action: TUG_ACTIONS.SET_VALUE,
    value: String(i),
    label: s.label,
  }));

  const stateItems: TugPopupButtonItem<string>[] = STATE_SCENARIOS.map((s, i) => ({
    action: TUG_ACTIONS.SET_VALUE,
    value: String(i),
    label: s.label,
  }));

  const transcriptScenario = TRANSCRIPT_SCENARIOS[transcriptIdx];
  const transcriptItems: TugPopupButtonItem<string>[] = TRANSCRIPT_SCENARIOS.map(
    (s, i) => ({
      action: TUG_ACTIONS.SET_VALUE,
      value: String(i),
      label: s.label,
    }),
  );

  // Per-area popover content for the Time + Tokens cells. Computed
  // here so the gallery's 1Hz live-tick (which drives `liveTimeMs`)
  // flows into the popover's in-flight footer for free — the popover
  // content is a child of this render, so every tick re-renders it
  // alongside the cells.
  const transcript = transcriptScenario.transcript;
  const isInflight = inflight.submitAt !== null;
  const cellPopovers: CellPopoverContent = {
    time: (
      <TimePopoverContent
        transcript={transcript}
        inflight={isInflight ? { currentTurnActiveMs: liveTimeMs } : null}
      />
    ),
    tokens: (
      <TokensPopoverContent
        transcript={transcript}
        inflight={
          isInflight
            ? { currentTurnTokens: baseValues.perTurnTokens }
            : null
        }
      />
    ),
    context: (
      <ContextPopoverContent
        transcript={transcript}
        contextMax={baseValues.contextMax}
      />
    ),
  };

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-tide-status-row"
        ref={responderRef as (el: HTMLDivElement | null) => void}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--tug-space-xl)",
          padding: "var(--tug-space-md)",
        }}
      >
        {/* Sticky controls — all Tug components now. */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--tug-space-md)",
            flexWrap: "wrap",
            position: "sticky",
            top: 0,
            zIndex: 1,
            padding: "var(--tug-space-sm)",
            backgroundColor: "var(--tug7-surface-card-primary-normal-default-rest)",
            borderBottom: `1px solid ${RAIL_COLOR}`,
          }}
        >
          <TugPopupButton
            label={`scenario: ${scenario.label}`}
            items={scenarioItems}
            senderId={scenarioPopupId}
            size="sm"
            aria-label="scenario"
          />
          <TugPushButton
            size="sm"
            onClick={() => setScenarioIdx((i) => (i + 1) % SCENARIOS.length)}
          >
            Next →
          </TugPushButton>
          <TugSwitch
            checked={autoTick}
            senderId={autoTickSwitchId}
            label="auto-tick (1.5s)"
            size="sm"
          />
          <TugPopupButton
            label={`state: ${STATE_SCENARIOS[stateIdx].label}`}
            items={stateItems}
            senderId={statePopupId}
            size="sm"
            aria-label="session state"
          />
          <TugPushButton
            size="sm"
            onClick={() => {
              setCommittedMs(null);
              setInflight(startInflight(state, Date.now()));
            }}
          >
            New turn
          </TugPushButton>
          <TugPopupButton
            label={`transcript: ${transcriptScenario.label}`}
            items={transcriptItems}
            senderId={transcriptPopupId}
            size="sm"
            aria-label="transcript scenario"
          />
          <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED, marginLeft: "auto" }}>
            context: {ratioPct}%
            {ratioPct >= 90 && <span style={{ color: TEXT_DANGER }}> ▲ danger</span>}
            {ratioPct >= 75 && ratioPct < 90 && <span style={{ color: TEXT_CAUTION }}> ▲ caution</span>}
          </span>
        </div>

        {/* Plan of record — the chosen composed row at the user's selected
            scenario + state. Featured at the top because this IS the design. */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
          <SectionTitle>Plan of record — Z2 status row</SectionTitle>
          <div style={{ ...variantNoteStyle, marginBottom: "var(--tug-space-sm)" }}>
            Four areas — TugStateIndicator (with inline label) + three F5 cells
            (TIME · TOKENS · CONTEXT) — in one flex row with
            `justify-content: space-between` and a small minimum gap, so all three
            inter-item spaces flex uniformly with row width. Row paddingInline 2xl (24px)
            for end margins. The indicator slot is a fixed
            {INDICATOR_SLOT_WIDTH}px wide — sized for the longest phase label
            ("Awaiting first response") — so the cell positions stay stable across
            label-text changes. Scenario picker drives the cell values; session-state
            picker drives the indicator behavior; transcript-scenario picker drives
            the per-area popovers (TIME, TOKENS, CONTEXT — click any cell). The
            Context popover renders the last committed turn's categorical
            breakdown via a large segmented TugArcGauge (20.4.7.B). This is the
            canonical layout that will be promoted into the production tide-card Z2
            renderer.
          </div>
          <ComposedRow v={values} state={state} popovers={cellPopovers} />
        </section>

        <TugSeparator />

        {/* All session states — reference grid for the indicator's per-state behavior. */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
          <SectionTitle>All session states — indicator reference</SectionTitle>
          <div style={{ ...variantNoteStyle, marginBottom: "var(--tug-space-sm)" }}>
            The indicator (P6 @ 16px) in every CodeSessionPhase × TransportState ×
            interruptInFlight combination. Dot is the constant — always visible, color encodes
            state. Ring is the activity-signal layer, only present for ACTIVE states (animated).
            Static states (idle, errored, offline) show just the bare dot.
          </div>
          <AllStatesGrid />
        </section>

        <TugSeparator />

        {/* Container-query collapse — single resizable frame, dragged by the user. */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
          <SectionTitle>Container-query collapse — drag to test</SectionTitle>
          <div style={{ ...variantNoteStyle, marginBottom: "var(--tug-space-sm)" }}>
            Drag the bottom-right corner of the frame below to narrow it. The row is a
            single 4-item flex layout — indicator, TIME, TOKENS, CONTEXT — with
            `justify-content: space-between` and a small minimum gap, so all four
            inter-item spaces flex uniformly as the frame widens. Gallery-only @container
            rules hide cells in priority order (TIME → TOKENS → CONTEXT) the moment they
            would no longer fit; the breakpoints are written in `ch` units so they track
            the row's actual monospace metrics, not a guessed pixel value. The frame's
            CSS-pinned `min-width` keeps the indicator itself from ever clipping.
          </div>
          <div className="gallery-tide-status-resize-frame">
            <ComposedRow v={values} state={state} />
          </div>
        </section>

      </div>
    </ResponderScope>
  );
}
