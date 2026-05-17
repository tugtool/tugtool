/**
 * gallery-tide-status-row.tsx — design-spike gallery card for the
 * tide-card Z2 status row.
 *
 * **Round 7 — down-selected.** Round 6 chose:
 *
 *   - **§2 indicator** → P6 concentric pulsing ring (with concentric
 *     centering bug to fix)
 *   - **§3 chevron** → bigger than the round-6 14px default
 *   - **§4 endcap** → stay with T1 (custom EndcapRuleLabel, current
 *     production design)
 *   - **§5 composed row** → more horizontal breathing room for the
 *     leftmost indicator and rightmost chevron (round-6's was too
 *     cramped)
 *
 * Round 7 narrows the gallery to those choices and explores the
 * remaining knobs:
 *
 *   §1 — Distribution-fix baseline (one variant, for reference)
 *   §2 — P6 concentric fix + size variations (12 / 14 / 16 / 18 px)
 *   §3 — Chevron size variations (14 / 16 / 18 / 20 px)
 *   §4 — T1 endcap locked in (no variants; called out for completeness)
 *   §5 — Composed-row spacing studies (5 variations with different
 *        gap / padding / zone strategies for the indicator+chevron)
 *
 * Once these pick, we promote into production and the design study
 * for Z2 is done.
 *
 * @module components/tugways/cards/gallery-tide-status-row
 */

import React, { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

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
const TEXT_NORMAL = "var(--tug7-element-global-text-normal-strong-rest)";
const TEXT_MUTED = "var(--tug7-element-global-text-normal-muted-rest)";
const TEXT_CAUTION = "var(--tug7-element-global-text-normal-caution-rest)";
const TEXT_DANGER = "var(--tug7-element-global-text-normal-danger-rest)";

const DEFAULT_LABEL_SIZE = "0.5625rem";
const DEFAULT_VALUE_SIZE = "0.6875rem";
const LABEL_LETTER_SPACING = "0.18em";

const labelMuted: React.CSSProperties = {
  fontFamily: MONO,
  color: TEXT_MUTED,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 500,
};

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
// Custom EndcapRuleLabel (T1 — current production / chosen design)
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
  animated: boolean;
  label: string;
}

function phaseVisualFor(state: SessionState): PhaseVisual {
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
      return { color: TEXT_NORMAL, animated: true, label: state.phase };
    case "awaiting_approval":
      return { color: TEXT_CAUTION, animated: true, label: "awaiting_approval" };
    case "idle":
    default:
      return { color: TEXT_MUTED, animated: false, label: "idle" };
  }
}

// ---------------------------------------------------------------------------
// P6 — Concentric pulsing ring (FIXED)
// ---------------------------------------------------------------------------
//
// Centering fix: each child sits at top:50% / left:50% with a
// translate(-50%, -50%) anchor, so it stays perfectly centered on
// the container's geometric middle regardless of element size or
// border weight. The ring uses box-sizing: border-box so the 1px
// border doesn't extend the visual extent past `size`.
//
// The pulse keyframe combines translate(-50%, -50%) with scale(...)
// so the ring grows outward AROUND the dot rather than drifting off
// to one side.

function ConcentricPulsingRing({
  state,
  size,
}: {
  state: SessionState;
  size: number;
}): React.ReactElement {
  const v = phaseVisualFor(state);
  // The inner dot scales with the container — about 50% of size.
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
      {/* Inner dot — solid filled circle, centered. */}
      <span
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: dotSize,
          height: dotSize,
          borderRadius: 999,
          backgroundColor: v.color,
          opacity: v.animated ? 0.95 : 0.65,
          transform: "translate(-50%, -50%)",
        }}
      />
      {/* Outer pulsing ring — 1px border, box-sized so the border
          doesn't bleed past the container; centered via the same
          translate anchor as the dot. The keyframe combines the
          translate with the scale so the ring stays centered while
          it grows outward. */}
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
// Chevron control
// ---------------------------------------------------------------------------

function ChevronControl({
  collapsed,
  onToggle,
  size = 18,
}: {
  collapsed: boolean;
  onToggle: () => void;
  size?: number;
}): React.ReactElement {
  const Icon = collapsed ? ChevronsLeft : ChevronsRight;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Expand status bar" : "Collapse status bar"}
      style={{
        appearance: "none",
        background: "transparent",
        border: "none",
        padding: 4,
        cursor: "pointer",
        color: TEXT_MUTED,
        display: "inline-flex",
        alignItems: "center",
        opacity: 0.75,
        flex: "0 0 auto",
      }}
    >
      <Icon size={size} strokeWidth={1.75} />
    </button>
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
// §1 — Distribution-fix baseline row
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
// §5 — Composed row spacing variations
// ---------------------------------------------------------------------------
//
// Each variation takes the same indicator + cells + chevron contents
// and lays them out with a different spacing strategy. The goal is
// to give the leftmost indicator and rightmost chevron MORE breathing
// room than round-6's cramped baseline.

interface ComposedRowProps {
  v: StatusValues;
  state: SessionState;
  collapsed: boolean;
  onToggleCollapse: () => void;
  indicatorSize: number;
  chevronSize: number;
  /** Spacing strategy. */
  variant:
    | "tight"
    | "wide-gap"
    | "wider-gap"
    | "padded-zones"
    | "fixed-zones-divided";
}

function ComposedRow({
  v,
  state,
  collapsed,
  onToggleCollapse,
  indicatorSize,
  chevronSize,
  variant,
}: ComposedRowProps): React.ReactElement {
  // Resolve spacing knobs per variant.
  let rowGap = "var(--tug-space-md)";
  let rowPaddingInline = "var(--tug-space-md)";
  let indicatorPaddingInline = "0";
  let chevronPaddingInline = "0";
  let showDividers = false;
  let indicatorMinWidth: number | undefined;
  let chevronMinWidth: number | undefined;

  switch (variant) {
    case "tight":
      // Round-6 baseline — too cramped, kept for reference.
      break;
    case "wide-gap":
      rowGap = "var(--tug-space-xl)";
      rowPaddingInline = "var(--tug-space-lg)";
      break;
    case "wider-gap":
      rowGap = "var(--tug-space-2xl)";
      rowPaddingInline = "var(--tug-space-lg)";
      break;
    case "padded-zones":
      // Indicator + chevron get internal padding plus a generous row
      // gap; reads as zoned chrome around the data block.
      rowGap = "var(--tug-space-lg)";
      rowPaddingInline = "var(--tug-space-md)";
      indicatorPaddingInline = "var(--tug-space-md)";
      chevronPaddingInline = "var(--tug-space-md)";
      break;
    case "fixed-zones-divided":
      // Fixed-width left/right zones with a hairline divider before
      // and after the cells block. Reads like an instrument-panel
      // bezel separating the chrome zones from the data zone.
      rowGap = "0";
      rowPaddingInline = "0";
      indicatorMinWidth = 56;
      chevronMinWidth = 56;
      showDividers = true;
      break;
  }

  const indicator = (
    <ConcentricPulsingRing state={state} size={indicatorSize} />
  );

  const indicatorZone = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        paddingInline: indicatorPaddingInline,
        minWidth: indicatorMinWidth,
      }}
    >
      {indicator}
    </span>
  );

  const chevronZone = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        paddingInline: chevronPaddingInline,
        minWidth: chevronMinWidth,
      }}
    >
      <ChevronControl
        collapsed={collapsed}
        onToggle={onToggleCollapse}
        size={chevronSize}
      />
    </span>
  );

  const divider = (
    <span
      style={{
        display: "inline-block",
        width: 1,
        alignSelf: "stretch",
        backgroundColor: RAIL_COLOR,
        opacity: 0.4,
      }}
    />
  );

  return (
    <div
      style={{
        ...cardSurface,
        paddingInline: rowPaddingInline,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: rowGap,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {indicatorZone}
      {showDividers && divider}

      {!collapsed && (
        <div
          style={{
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--tug-space-md)",
            minWidth: 0,
            paddingInline: showDividers ? "var(--tug-space-lg)" : 0,
          }}
        >
          {buildCellNodes(v)}
        </div>
      )}
      {collapsed && <span style={{ flex: "1 1 auto" }} />}

      {showDividers && divider}
      {chevronZone}
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
// Indicator-in-isolation demo box (for §2 size sweep)
// ---------------------------------------------------------------------------

function IndicatorIsolated({
  state,
  size,
  description,
}: {
  state: SessionState;
  size: number;
  description: string;
}): React.ReactElement {
  return (
    <div
      style={{
        ...cardSurface,
        paddingInline: "var(--tug-space-md)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "var(--tug-space-lg)",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <ConcentricPulsingRing state={state} size={size} />
      <span style={{ color: TEXT_MUTED, fontSize: "0.625rem" }}>
        {description}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls + chrome
// ---------------------------------------------------------------------------

const controlSelectStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "0.75rem",
  padding: "2px 6px",
};

const controlButtonStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "0.75rem",
  padding: "2px 8px",
  cursor: "pointer",
};

const labelMutedSmall: React.CSSProperties = {
  ...labelMuted,
  fontSize: "0.6875rem",
};

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
  const [collapsedDemo, setCollapsedDemo] = useState(false);

  useEffect(() => {
    if (!autoTick) return;
    const id = setInterval(() => {
      setScenarioIdx((i) => (i + 1) % SCENARIOS.length);
    }, 1500);
    return () => clearInterval(id);
  }, [autoTick]);

  const scenario = SCENARIOS[scenarioIdx];
  const values = scenario.values;
  const state = STATE_SCENARIOS[stateIdx].state;
  const ratioPct = Math.round((values.contextTokens / values.contextMax) * 100);

  return (
    <div
      className="cg-content"
      data-testid="gallery-tide-status-row"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--tug-space-xl)",
        padding: "var(--tug-space-md)",
      }}
    >
      <style>{INLINE_KEYFRAMES}</style>

      {/* Sticky controls */}
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-2xs)" }}>
          <span style={labelMutedSmall}>scenario</span>
          <select
            style={controlSelectStyle}
            value={String(scenarioIdx)}
            onChange={(e) => setScenarioIdx(Number(e.currentTarget.value))}
          >
            {SCENARIOS.map((s, i) => (
              <option key={s.id} value={String(i)}>{s.label}</option>
            ))}
          </select>
        </label>
        <button type="button" style={controlButtonStyle} onClick={() => setScenarioIdx((i) => (i + 1) % SCENARIOS.length)}>
          next →
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-2xs)" }}>
          <input type="checkbox" checked={autoTick} onChange={(e) => setAutoTick(e.currentTarget.checked)} />
          <span style={labelMutedSmall}>auto-tick (1.5s)</span>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-2xs)" }}>
          <span style={labelMutedSmall}>session state</span>
          <select
            style={controlSelectStyle}
            value={String(stateIdx)}
            onChange={(e) => setStateIdx(Number(e.currentTarget.value))}
          >
            {STATE_SCENARIOS.map((s, i) => (
              <option key={s.id} value={String(i)}>{s.label}</option>
            ))}
          </select>
        </label>
        <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED, marginLeft: "auto" }}>
          context: {ratioPct}%
          {ratioPct >= 90 && <span style={{ color: TEXT_DANGER }}> ▲ danger</span>}
          {ratioPct >= 75 && ratioPct < 90 && <span style={{ color: TEXT_CAUTION }}> ▲ caution</span>}
        </span>
      </div>

      {/* §1 — Distribution baseline */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
        <SectionTitle>§1 — F5 distribution baseline (cells only, no indicator / chevron)</SectionTitle>
        <div style={variantStackStyle}>
          <VariantBlock
            title="R6-base — F5 row with width:100% + space-between"
            note="Reference for the cells-only F5 design. The fix the production CSS still needs."
          >
            <CellsOnlyRow v={values} />
          </VariantBlock>
        </div>
      </section>

      <TugSeparator />

      {/* §2 — P6 indicator: concentric fix + size sweep */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
        <SectionTitle>§2 — P6 concentric pulsing ring (FIXED) — size sweep</SectionTitle>
        <div style={{ ...variantNoteStyle, marginBottom: "var(--tug-space-sm)" }}>
          The concentric centering bug from round 6 is fixed — each child sits at
          top:50%/left:50% with translate(-50%, -50%) so the ring's center is
          perfectly aligned on the dot's center. The pulse keyframe combines the
          translate with the scale so the ring grows AROUND the dot rather than
          drifting off-axis. Use the session-state dropdown above to verify in
          every state (idle / streaming / caution / errored / offline).
        </div>
        <div style={variantStackStyle}>
          <VariantBlock title="P6 @ 12px (round-6 size, fixed)" note="Smallest variant. Dot is 6px; ring is 12px.">
            <IndicatorIsolated state={state} size={12} description="12px container, 6px dot" />
          </VariantBlock>
          <VariantBlock title="P6 @ 14px" note="Mid-size. Dot 7px, ring 14px.">
            <IndicatorIsolated state={state} size={14} description="14px container, 7px dot" />
          </VariantBlock>
          <VariantBlock title="P6 @ 16px" note="Reads more present at row scale.">
            <IndicatorIsolated state={state} size={16} description="16px container, 8px dot" />
          </VariantBlock>
          <VariantBlock title="P6 @ 18px" note="Biggest variant. Matches the body-row typography weight more strongly.">
            <IndicatorIsolated state={state} size={18} description="18px container, 9px dot" />
          </VariantBlock>
        </div>
      </section>

      <TugSeparator />

      {/* §3 — Chevron size sweep */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
        <SectionTitle>§3 — Chevron size sweep</SectionTitle>
        <div style={{ ...variantNoteStyle, marginBottom: "var(--tug-space-sm)" }}>
          Round 6 used 14px; user noted this is too small. Sweep through 14 / 16 / 18 / 20
          to pick the right size. Click any to toggle expanded ⇄ collapsed state (state is
          shared across all chevrons in this gallery).
        </div>
        <div style={variantStackStyle}>
          {[14, 16, 18, 20].map((size) => (
            <VariantBlock
              key={size}
              title={`Chevron @ ${size}px`}
              note={`Lucide ChevronsLeft / ChevronsRight at size=${size}, strokeWidth=1.75.`}
            >
              <div
                style={{
                  ...cardSurface,
                  paddingInline: "var(--tug-space-md)",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                <span style={{ color: TEXT_MUTED, fontSize: "0.625rem" }}>
                  state: {collapsedDemo ? "COLLAPSED" : "EXPANDED"}
                </span>
                <ChevronControl
                  collapsed={collapsedDemo}
                  onToggle={() => setCollapsedDemo((c) => !c)}
                  size={size}
                />
              </div>
            </VariantBlock>
          ))}
        </div>
      </section>

      <TugSeparator />

      {/* §4 — T1 endcap (locked in — informational) */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
        <SectionTitle>§4 — Endcap: T1 custom EndcapRuleLabel (LOCKED IN)</SectionTitle>
        <div style={{ ...variantNoteStyle }}>
          Round 6 picked T1 (the current production custom EndcapRuleLabel — one-sided
          ticks pointing down at 0.55 opacity, hairline rule). All composed rows below
          use this. No variants to compare here; called out for completeness so this
          section's status is visible.
        </div>
      </section>

      <TugSeparator />

      {/* §5 — Composed-row spacing studies */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
        <SectionTitle>§5 — Composed-row spacing (indicator + cells + chevron)</SectionTitle>
        <div style={{ ...variantNoteStyle, marginBottom: "var(--tug-space-sm)" }}>
          Round-6 baseline was too cramped — the indicator and chevron were tight
          against the cell strip. Five spacing strategies. All use P6 @ 16px + chevron @
          18px (good defaults; tune per §2 and §3 picks). Click the chevron on any row to
          watch the collapsed shape: only indicator + chevron stay visible.
        </div>
        <div style={variantStackStyle}>
          <VariantBlock
            title="C-tight — round-6 baseline (cramped, for reference)"
            note="gap: md, paddingInline: md. The original cramped layout."
          >
            <ComposedRow
              v={values}
              state={state}
              collapsed={collapsedDemo}
              onToggleCollapse={() => setCollapsedDemo((c) => !c)}
              indicatorSize={16}
              chevronSize={18}
              variant="tight"
            />
          </VariantBlock>
          <VariantBlock
            title="C-wide-gap — bigger row gap"
            note="gap: xl (~24px), paddingInline: lg (~16px). Direct increase of inter-element spacing."
          >
            <ComposedRow
              v={values}
              state={state}
              collapsed={collapsedDemo}
              onToggleCollapse={() => setCollapsedDemo((c) => !c)}
              indicatorSize={16}
              chevronSize={18}
              variant="wide-gap"
            />
          </VariantBlock>
          <VariantBlock
            title="C-wider-gap — even bigger gap"
            note="gap: 2xl (~32px), paddingInline: lg. Maximum lateral breathing room via gap alone."
          >
            <ComposedRow
              v={values}
              state={state}
              collapsed={collapsedDemo}
              onToggleCollapse={() => setCollapsedDemo((c) => !c)}
              indicatorSize={16}
              chevronSize={18}
              variant="wider-gap"
            />
          </VariantBlock>
          <VariantBlock
            title="C-padded-zones — internal padding around indicator + chevron"
            note="Indicator and chevron sit inside zones with their own paddingInline (md) plus a row gap (lg). Reads as zoned chrome wrapping the data block."
          >
            <ComposedRow
              v={values}
              state={state}
              collapsed={collapsedDemo}
              onToggleCollapse={() => setCollapsedDemo((c) => !c)}
              indicatorSize={16}
              chevronSize={18}
              variant="padded-zones"
            />
          </VariantBlock>
          <VariantBlock
            title="C-fixed-zones-divided — fixed 56px zones + hairline dividers"
            note="Indicator and chevron in fixed-width zones, separated from the cells by 1px hairline rails. Reads like an instrument-panel bezel — chrome zones vs data zone."
          >
            <ComposedRow
              v={values}
              state={state}
              collapsed={collapsedDemo}
              onToggleCollapse={() => setCollapsedDemo((c) => !c)}
              indicatorSize={16}
              chevronSize={18}
              variant="fixed-zones-divided"
            />
          </VariantBlock>
        </div>
      </section>
    </div>
  );
}
