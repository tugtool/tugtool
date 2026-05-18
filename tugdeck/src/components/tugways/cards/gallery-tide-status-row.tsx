/**
 * gallery-tide-status-row.tsx — design-spike gallery card for the
 * tide-card Z2 status row.
 *
 * **Round 8 — final down-select.** Round 7 chose:
 *
 *   - **§2 indicator** → P6 @ 16px (concentric pulsing ring)
 *   - **§3 chevron** → 16px
 *   - **§4 endcap** → T1 (locked in)
 *   - **§5 composed row** → C-wider-gap
 *
 * Round 8 changes:
 *
 *   - **Ring renders in ALL session states.** Round 7 gated the ring
 *     behind `v.animated`, which hid it for idle / errored / offline.
 *     Fix: always render the ring; only the keyframe animation is
 *     conditional. Static states show a quiet outline around the dot.
 *   - **All-states grid.** A new sub-section renders P6 @ 16px once
 *     per session state, side-by-side, so every state can be compared
 *     at a glance without flipping the dropdown.
 *   - **Tug controls.** Replaced the native `<select>` / `<input
 *     type="checkbox">` / `<button>` at the top of the card with
 *     TugPopupButton / TugSwitch / TugPushButton, wired through the
 *     responder-chain pattern via `useResponderForm` (`setValueString`
 *     + `toggle` bindings).
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
// Session state model
// ---------------------------------------------------------------------------

type DemoPhase =
  | "idle"
  | "submitting"
  | "awaiting_first_token"
  | "streaming"
  | "tool_work"
  | "awaiting_approval"
  | "replaying"
  | "errored";

type DemoTransport = "online" | "offline" | "restoring";

interface SessionState {
  phase: DemoPhase;
  transport: DemoTransport;
  interruptInFlight: boolean;
}

const STATE_SCENARIOS: ReadonlyArray<{ id: string; label: string; state: SessionState }> = [
  { id: "idle_online", label: "idle · online", state: { phase: "idle", transport: "online", interruptInFlight: false } },
  { id: "submitting", label: "submitting · online", state: { phase: "submitting", transport: "online", interruptInFlight: false } },
  { id: "awaiting_first", label: "awaiting_first_token · online", state: { phase: "awaiting_first_token", transport: "online", interruptInFlight: false } },
  { id: "streaming", label: "streaming · online", state: { phase: "streaming", transport: "online", interruptInFlight: false } },
  { id: "tool_work", label: "tool_work · online", state: { phase: "tool_work", transport: "online", interruptInFlight: false } },
  { id: "awaiting_approval", label: "awaiting_approval · online", state: { phase: "awaiting_approval", transport: "online", interruptInFlight: false } },
  { id: "interrupted_streaming", label: "streaming · INTERRUPT in flight", state: { phase: "streaming", transport: "online", interruptInFlight: true } },
  { id: "offline", label: "idle · OFFLINE", state: { phase: "idle", transport: "offline", interruptInFlight: false } },
  { id: "restoring", label: "submitting · RESTORING", state: { phase: "submitting", transport: "restoring", interruptInFlight: false } },
  { id: "errored", label: "errored · online", state: { phase: "errored", transport: "online", interruptInFlight: false } },
  { id: "replaying", label: "replaying · online", state: { phase: "replaying", transport: "online", interruptInFlight: false } },
];

// ---------------------------------------------------------------------------
// Tokens, surfaces, base styles
// ---------------------------------------------------------------------------

const MONO = "var(--tug-font-mono, monospace)";
const RAIL_COLOR = "var(--tug7-element-global-border-normal-default-rest)";
// Round 8 fix: previous TEXT_NORMAL used `text-normal-strong-rest`,
// which doesn't exist in either theme. `color:` silently fell back to
// inherited (so values rendered), but `background-color:` on the dot
// fell back to transparent — the dot disappeared. Use the valid
// `text-normal-default-rest` for general text + `text-normal-success-rest`
// for the active-state indicator color (per user request — green = active).
const TEXT_NORMAL = "var(--tug7-element-global-text-normal-default-rest)";
const TEXT_MUTED = "var(--tug7-element-global-text-normal-muted-rest)";
const TEXT_SUCCESS = "var(--tug7-element-global-text-normal-success-rest)";
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

const variantStackStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--tug-space-md)",
};

const variantTitleStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "0.6875rem",
  color: TEXT_MUTED,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
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
// Phase visual mapping
// ---------------------------------------------------------------------------

interface PhaseVisual {
  color: string;
  /** Whether the outer ring pulses outward (or sits static around the dot). */
  animated: boolean;
  label: string;
}

function phaseVisualFor(state: SessionState): PhaseVisual {
  // Color is the primary state cue; pulse animation is the secondary
  // (active vs. waiting). The dot is ALWAYS visible — every state
  // maps to a real token, never to an undefined fallback.
  //
  //   active (working)              → success (green) + pulse
  //   waiting for user / restoring  → caution (yellow) + pulse
  //   error / offline               → danger (red), no pulse
  //   idle (ready, no activity)     → default text (light gray), no pulse
  if (state.transport === "offline") {
    return { color: TEXT_DANGER, animated: false, label: "offline" };
  }
  if (state.transport === "restoring") {
    return { color: TEXT_CAUTION, animated: true, label: "restoring" };
  }
  if (state.interruptInFlight) {
    return { color: TEXT_CAUTION, animated: true, label: "interrupting" };
  }
  switch (state.phase) {
    case "errored":
      return { color: TEXT_DANGER, animated: false, label: "errored" };
    case "submitting":
    case "awaiting_first_token":
    case "streaming":
    case "tool_work":
    case "replaying":
      return { color: TEXT_SUCCESS, animated: true, label: state.phase };
    case "awaiting_approval":
      return { color: TEXT_CAUTION, animated: true, label: "awaiting_approval" };
    case "idle":
    default:
      return { color: TEXT_NORMAL, animated: false, label: "idle" };
  }
}

// ---------------------------------------------------------------------------
// P6 — Concentric pulsing ring
// ---------------------------------------------------------------------------
//
// The dot is the constant — ALWAYS visible, always at full opacity.
// Its color encodes state (success / caution / danger / default
// — each maps to a real theme token, no transparent fallback).
//
// The ring is the activity-signal layer ON TOP of the dot, only
// rendered for ACTIVE (animated) states. Static states (idle,
// errored, offline) show just the bare dot — cleaner reading at a
// glance. The pulse keyframe combines translate(-50%, -50%) with
// scale(...) so the ring grows AROUND the dot without drifting off
// axis.

function ConcentricPulsingRing({
  state,
  size = 16,
}: {
  state: SessionState;
  size?: number;
}): React.ReactElement {
  const v = phaseVisualFor(state);
  const dotSize = Math.max(4, Math.round(size * 0.5));
  return (
    <span
      title={v.label}
      aria-label={v.label}
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        flex: "0 0 auto",
      }}
    >
      {/* Inner dot — solid filled circle, ALWAYS fully visible.
          Color encodes state (success / caution / danger / default).
          No opacity dimming — the dot is a status LED, not a hint.
          The pulse animation (ring only) carries the active/static
          distinction without sacrificing the dot's visibility. */}
      <span
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: dotSize,
          height: dotSize,
          borderRadius: 999,
          backgroundColor: v.color,
          transform: "translate(-50%, -50%)",
        }}
      />
      {/* Outer pulsing ring — only rendered for ACTIVE states
          (animated). Static states (idle, errored, offline) show
          just the dot, cleaner. The dot is the constant; the ring
          is the activity-signal layer on top. */}
      {v.animated && (
        <span
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: size,
            height: size,
            borderRadius: 999,
            border: `1px solid ${v.color}`,
            boxSizing: "border-box",
            transform: "translate(-50%, -50%)",
            animation: "tide-status-ring-pulse 1.6s ease-out infinite",
          }}
        />
      )}
    </span>
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
// §1 row: cells only (F5 baseline)
// ---------------------------------------------------------------------------

function CellsOnlyRow({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <div
      style={{
        ...cardSurface,
        paddingInline: "var(--tug-space-2xl)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--tug-space-md)",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {buildCellNodes(v)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §5 — C-wider-gap composed row (the chosen spacing) — indicator + cells
// ---------------------------------------------------------------------------

function ComposedRow({
  v,
  state,
}: {
  v: StatusValues;
  state: SessionState;
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
        <ConcentricPulsingRing state={state} size={16} />
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
            <ConcentricPulsingRing state={s.state} size={16} />
          </span>
          <span style={{ color: TEXT_MUTED, fontSize: "0.625rem" }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section / variant wrappers
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: string }): React.ReactElement {
  return (
    <div style={sectionTitleStyle}>
      <TugLabel size="xs">{children}</TugLabel>
    </div>
  );
}

function VariantBlock({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-2xs)" }}>
      <div style={variantTitleStyle}>{title}</div>
      <div style={variantNoteStyle}>{note}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline keyframes
// ---------------------------------------------------------------------------

const INLINE_KEYFRAMES = `
@keyframes tide-status-ring-pulse {
  0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.7; }
  100% { transform: translate(-50%, -50%) scale(1.55); opacity: 0; }
}
`;

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
        <style>{INLINE_KEYFRAMES}</style>

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

        {/* §1 — Distribution baseline */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
          <SectionTitle>§1 — F5 distribution baseline (cells only)</SectionTitle>
          <div style={variantStackStyle}>
            <VariantBlock
              title="R6-base — F5 row with width:100% + space-between"
              note="Reference for the cells-only F5 design. The distribution fix the production CSS needs."
            >
              <CellsOnlyRow v={values} />
            </VariantBlock>
          </div>
        </section>

        <TugSeparator />

        {/* §2 — P6 @ 16px in every state */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
          <SectionTitle>§2 — P6 concentric pulsing ring @ 16px — all session states</SectionTitle>
          <div style={{ ...variantNoteStyle, marginBottom: "var(--tug-space-sm)" }}>
            Dot is the constant — always visible, color encodes state (success / caution / danger /
            default, each mapped to a real theme token). Ring is the activity layer on top, only
            rendered for ACTIVE states. Static states (idle, errored, offline) show just the bare dot.
            Grid below shows P6 @ 16px once per session state, side-by-side.
          </div>
          <div style={variantStackStyle}>
            <VariantBlock
              title="All states grid — P6 @ 16px"
              note="Every state from idle to errored, with the indicator rendered at its actual production size."
            >
              <AllStatesGrid />
            </VariantBlock>
            <VariantBlock
              title="Interactive single — driven by session-state dropdown"
              note="Pick a state above to see the indicator at full row scale."
            >
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
                <ConcentricPulsingRing state={state} size={16} />
                <span style={{ color: TEXT_MUTED, fontSize: "0.625rem" }}>
                  state = {STATE_SCENARIOS[stateIdx].label}
                </span>
              </div>
            </VariantBlock>
          </div>
        </section>

        <TugSeparator />

        {/* §4 — T1 endcap (locked in) */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
          <SectionTitle>§4 — Endcap: T1 custom EndcapRuleLabel (LOCKED IN)</SectionTitle>
          <div style={{ ...variantNoteStyle }}>
            The current production EndcapRuleLabel — one-sided ticks pointing down at 0.55 opacity,
            hairline rule. Visible in every cell of every row throughout this gallery.
          </div>
        </section>

        <TugSeparator />

        {/* §5 — C-wider-gap composed target row */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
          <SectionTitle>§5 — Composed target row: C-wider-gap (chosen spacing)</SectionTitle>
          <div style={{ ...variantNoteStyle, marginBottom: "var(--tug-space-sm)" }}>
            The integration target. P6 @ 16px indicator (left), F5 cells filling the rest of the
            row. Row gap is 2xl (~32px), paddingInline is lg. Chevron + collapse removed — the
            row is always full.
          </div>
          <div style={variantStackStyle}>
            <VariantBlock
              title="C-wider-gap — indicator + cells, gap: 2xl, paddingInline: lg"
              note="The chosen spacing strategy. Indicator has generous breathing room from the cells block."
            >
              <ComposedRow v={values} state={state} />
            </VariantBlock>
          </div>
        </section>
      </div>
    </ResponderScope>
  );
}
