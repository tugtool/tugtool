/**
 * gallery-tide-status-row.tsx — plan-of-record reference for the
 * tide-card Z2 status row.
 *
 * **Status: plan of record.** The design spike (rounds 1–9) is
 * resolved. This card now documents the chosen design rather than
 * exploring alternatives. The composed row at the top is the
 * canonical layout; the all-states reference beneath it documents
 * every behavior the leftmost indicator can show.
 *
 * # Design
 *
 *  - **Leftmost — phase/transport indicator.** Concentric dot + ring.
 *    The dot is the constant — always visible, color encodes state
 *    (`success` for active, `caution` for awaiting/restoring/
 *    interrupt, `danger` for errored/offline, `default` for idle).
 *    The ring is the activity-signal layer: rendered only for ACTIVE
 *    (animated) states, pulses outward via `tide-status-ring-pulse`.
 *    Centering via `translate(-50%,-50%)` keeps the ring concentric
 *    with the dot through the scale animation.
 *  - **Middle — five F5 cells.** Uniform-width columns containing
 *    `TIME · TOKENS · TOTAL TIME · TOTAL TOKENS · CONTEXT`. Each cell
 *    is the IBM-1620-inspired endcap-rule label apparatus above a
 *    centered value. `formatTimeAlwaysHours` (`Hh Mm SSs`) for time
 *    cells, `formatTokensCaps` (`K`/`M`/`G`) for token cells. CONTEXT
 *    numerator color-codes by usage ratio.
 *  - **Spacing — C-wider-gap.** `gap: 2xl` (~32px) + `paddingInline:
 *    lg` (~16px). Indicator has generous breathing room from the
 *    cells block.
 *  - **No chevron.** The status bar does not collapse.
 *
 * # Card structure
 *
 *  1. **Plan of record** — the chosen composed row at the user's
 *     selected scenario + session state.
 *  2. **All session states** — reference grid showing the indicator's
 *     behavior in every `CodeSessionPhase` × `TransportState` ×
 *     `interruptInFlight` combination.
 *
 * Controls (Tug components, responder-chain wired via
 * `useResponderForm`): scenario picker, next-scenario button,
 * auto-tick switch, session-state picker.
 *
 * @module components/tugways/cards/gallery-tide-status-row
 */

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

function F5Cell({
  label,
  valueNode,
}: {
  label: string;
  valueNode: React.ReactElement;
}): React.ReactElement {
  return (
    <span
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
    <F5Cell key="time" label="TIME" valueNode={plainValue(formatTimeAlwaysHours(v.perTurnActiveMs))} />,
    <F5Cell key="tokens" label="TOKENS" valueNode={plainValue(formatTokensCaps(v.perTurnTokens))} />,
    <F5Cell key="total-time" label="TOTAL TIME" valueNode={plainValue(formatTimeAlwaysHours(v.totalActiveMs))} />,
    <F5Cell key="total-tokens" label="TOTAL TOKENS" valueNode={plainValue(formatTokensCaps(v.totalTokens))} />,
    <F5Cell key="context" label="CONTEXT" valueNode={contextValue(v)} />,
  ];
}

// ---------------------------------------------------------------------------
// Plan-of-record composed row — indicator + cells, C-wider-gap spacing
// ---------------------------------------------------------------------------

function ComposedRow({
  v,
  state,
}: {
  v: StatusValues;
  state: TugStateIndicatorState;
}): React.ReactElement {
  return (
    <div
      style={{
        ...cardSurface,
        paddingInline: "var(--tug-space-lg)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "var(--tug-space-2xl)",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          flex: "0 0 auto",
        }}
      >
        <TugStateIndicator state={state} size={16} />
      </span>

      <div
        style={{
          flex: "1 1 auto",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--tug-space-md)",
          minWidth: 0,
        }}
      >
        {buildCellNodes(v)}
      </div>
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
            <TugStateIndicator state={s.state} size={16} />
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
            Concentric pulsing-ring indicator (left) + five F5 cells (right). Row gap 2xl
            (~32px), paddingInline lg (~16px). Scenario picker drives the cell values;
            session-state picker drives the indicator behavior. This is the canonical layout
            that will be promoted into the production tide-card Z2 renderer.
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
      </div>
    </ResponderScope>
  );
}
