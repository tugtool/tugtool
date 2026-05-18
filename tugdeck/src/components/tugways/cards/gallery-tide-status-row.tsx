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

function buildCellNodes(v: StatusValues): React.ReactElement[] {
  return [
    <F5Cell key="time" priority="time" label="TIME" valueNode={plainValue(formatTimeAlwaysHours(v.perTurnActiveMs))} />,
    <F5Cell key="tokens" priority="tokens" label="TOKENS" valueNode={plainValue(formatTokensCaps(v.perTurnTokens))} />,
    <F5Cell key="context" priority="context" label="CONTEXT" valueNode={contextValue(v)} />,
  ];
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
}: {
  v: StatusValues;
  state: TugStateIndicatorState;
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
      {buildCellNodes(v)}
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
  const [autoTick, setAutoTick] = useState(false);

  useEffect(() => {
    if (!autoTick) return;
    const id = setInterval(() => {
      setScenarioIdx((i) => (i + 1) % SCENARIOS.length);
    }, 1500);
    return () => clearInterval(id);
  }, [autoTick]);

  // Stable sender IDs for the responder-chain bindings.
  const scenarioPopupId = useId();
  const statePopupId = useId();
  const autoTickSwitchId = useId();

  // Wire the popup-button + switch dispatches through the chain via
  // useResponderForm. TugPopupButton items dispatch `setValueString`
  // with their `value` payload; TugSwitch dispatches `toggle` with a
  // boolean. The bindings here forward each to its local setState.
  // [L11] migration pattern.
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [scenarioPopupId]: (v: string) => setScenarioIdx(Number(v)),
      [statePopupId]: (v: string) => setStateIdx(Number(v)),
    },
    toggle: {
      [autoTickSwitchId]: setAutoTick,
    },
  });

  const scenario = SCENARIOS[scenarioIdx];
  const values = scenario.values;
  const state = STATE_SCENARIOS[stateIdx].state;
  const ratioPct = Math.round((values.contextTokens / values.contextMax) * 100);

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
            picker drives the indicator behavior. This is the canonical layout that will be
            promoted into the production tide-card Z2 renderer.
          </div>
          <ComposedRow v={values} state={state} />
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
