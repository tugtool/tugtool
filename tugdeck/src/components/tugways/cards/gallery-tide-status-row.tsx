/**
 * gallery-tide-status-row.tsx — design-spike gallery card for the
 * tide-card Z2 status row.
 *
 * **Round 5.** Round 4 chose EA2 and EA4 (plain values, label
 * above/below, UNIFORM endcap-rule widths). Round 5 keeps that
 * foundation and explores four orthogonal refinements:
 *
 *   1. **Centered values** — drop the fixed-width right-pinned value
 *      slot in favor of natural-width values centered horizontally
 *      within the apparatus width. The apparatus columns stay rigidly
 *      stable (uniform widths), but values are now visually centered
 *      under / over their labels regardless of length.
 *
 *   2. **CAPITAL magnitude abbreviations** — `K`, `M`, `G` instead of
 *      `k`, `M`. Reads as instrument shorthand.
 *
 *   3. **Time format variations:**
 *      - Default keeps current `formatDurationMs` for per-turn time;
 *        the new `formatDurationWithSeconds` for total time (always
 *        appends seconds at every magnitude).
 *      - Always-minutes (`0m 12s` shape) for per-turn time.
 *      - Always-hours (`0h 0m 12s` shape) for per-turn time.
 *
 *   4. **Total time always shows seconds** — regardless of which time
 *      variant the per-turn cell uses, total time keeps the seconds
 *      component visible.
 *
 * @module components/tugways/cards/gallery-tide-status-row
 */

import React, { useEffect, useState } from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Scenarios + values
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
  {
    id: "fresh",
    label: "Fresh session",
    values: {
      perTurnActiveMs: 1_800,
      perTurnTokens: 30_300,
      totalActiveMs: 1_800,
      totalTokens: 30_300,
      contextTokens: 30_300,
      contextMax: ONE_MILLION,
    },
  },
  {
    id: "early",
    label: "Early session",
    values: {
      perTurnActiveMs: 12_400,
      perTurnTokens: 5_100,
      totalActiveMs: 14_200,
      totalTokens: 5_100,
      contextTokens: 5_100,
      contextMax: ONE_MILLION,
    },
  },
  {
    id: "longTurn",
    label: "Long turn",
    values: {
      perTurnActiveMs: 83_400,
      perTurnTokens: 87_500,
      totalActiveMs: 124_200,
      totalTokens: 92_000,
      contextTokens: 87_500,
      contextMax: ONE_MILLION,
    },
  },
  {
    id: "deepSession",
    label: "Deep session",
    values: {
      perTurnActiveMs: 12_300,
      perTurnTokens: 30_000,
      totalActiveMs: 3_840_000,
      totalTokens: 5_050_000,
      contextTokens: 195_000,
      contextMax: ONE_MILLION,
    },
  },
  {
    id: "approachingCap",
    label: "Approaching cap (caution)",
    values: {
      perTurnActiveMs: 14_200,
      perTurnTokens: 65_000,
      totalActiveMs: 600_000,
      totalTokens: 4_200_000,
      contextTokens: 780_000,
      contextMax: ONE_MILLION,
    },
  },
  {
    id: "nearCap",
    label: "Near cap (danger)",
    values: {
      perTurnActiveMs: 4_200,
      perTurnTokens: 18_000,
      totalActiveMs: 1_394_000,
      totalTokens: 9_800_000,
      contextTokens: 905_000,
      contextMax: ONE_MILLION,
    },
  },
  {
    id: "marathon",
    label: "Marathon",
    values: {
      perTurnActiveMs: 8_100,
      perTurnTokens: 22_000,
      totalActiveMs: 16_200_000,
      totalTokens: 47_200_000,
      contextTokens: 950_000,
      contextMax: ONE_MILLION,
    },
  },
];

// ---------------------------------------------------------------------------
// Formatters — local to this gallery; do NOT export back into the
// production renderer until the design is chosen.
// ---------------------------------------------------------------------------

/** Default per-turn time format — `1.8s`, `12s`, `1m 04s`, `1h 04m`. */
function formatDurationMs(ms: number): string {
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
 * Default time format BUT always includes seconds at every magnitude.
 * Per round-5 spec: total time keeps the seconds visible regardless
 * of whether hours / minutes are also shown.
 */
function formatDurationWithSeconds(ms: number): string {
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
  const s = totalSec % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * Always-minutes time format — `Mm SSs` shape at every magnitude.
 * `0m 12s` even when seconds are < 60; `270m 00s` when crossing
 * many hours (hours roll into the minutes counter). Always includes
 * the seconds component.
 */
function formatTimeAlwaysMinutes(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0m 00s";
  const totalSec = Math.max(0, Math.floor(ms / 1_000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * Always-hours time format — `Hh Mm SSs` shape at every magnitude.
 * `0h 0m 12s` even when below an hour. Always includes hours and
 * minutes (zero-padded for minutes, single-digit for hours).
 */
function formatTimeAlwaysHours(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0h 0m 00s";
  const totalSec = Math.max(0, Math.floor(ms / 1_000));
  const h = Math.floor(totalSec / 3_600);
  const m = Math.floor((totalSec % 3_600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * Token count formatter using **uppercase** magnitude abbreviations:
 * `K` (kilo), `M` (mega), `G` (giga). Round-5 instrument-shorthand
 * convention.
 */
function formatTokensCaps(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}G`;
}

// ---------------------------------------------------------------------------
// Time-mode dispatcher
// ---------------------------------------------------------------------------

type TimeMode = "default" | "minutes" | "hours";

interface TimeModeBundle {
  /** Per-turn time formatter. */
  time: (ms: number) => string;
  /** Total-time formatter — always includes seconds per round-5 spec. */
  totalTime: (ms: number) => string;
  /** Max realistic width of per-turn time text, in ch. */
  timeMaxCh: number;
  /** Max realistic width of total-time text, in ch. */
  totalTimeMaxCh: number;
  /** Label suffix for the variant title. */
  label: string;
}

function getTimeMode(mode: TimeMode): TimeModeBundle {
  switch (mode) {
    case "minutes":
      return {
        time: formatTimeAlwaysMinutes,
        totalTime: formatTimeAlwaysMinutes,
        timeMaxCh: 8, // "59m 00s"
        totalTimeMaxCh: 9, // "270m 00s"
        label: "always-minutes",
      };
    case "hours":
      return {
        time: formatTimeAlwaysHours,
        totalTime: formatTimeAlwaysHours,
        timeMaxCh: 10, // "0h 59m 00s"
        totalTimeMaxCh: 11, // "4h 30m 00s"
        label: "always-hours",
      };
    case "default":
    default:
      return {
        time: formatDurationMs,
        // Default total time format with always-seconds appended.
        totalTime: formatDurationWithSeconds,
        timeMaxCh: 6, // "1h 04m"
        totalTimeMaxCh: 10, // "1h 04m 23s"
        label: "default + total-seconds",
      };
  }
}

// ---------------------------------------------------------------------------
// Reserved widths + tokens
// ---------------------------------------------------------------------------

const VALUE_WIDTH_TOKENS_CH = 7; // `999.99M` worst case
const VALUE_WIDTH_CONTEXT_CH = 15; // `999.99K / 1.00M` worst case

const MONO = "var(--tug-font-mono, monospace)";
const RAIL_COLOR = "var(--tug7-element-global-border-normal-default-rest)";
const TEXT_NORMAL = "var(--tug7-element-global-text-normal-strong-rest)";
const TEXT_MUTED = "var(--tug7-element-global-text-normal-muted-rest)";
const TEXT_CAUTION = "var(--tug7-element-global-text-normal-caution-rest)";
const TEXT_DANGER = "var(--tug7-element-global-text-normal-danger-rest)";

const DEFAULT_LABEL_SIZE = "0.5625rem"; // 9px (locked from R1)
const DEFAULT_VALUE_SIZE = "0.6875rem"; // 11px (locked from R1)

const LABEL_LETTER_SPACING = "0.18em";

// ---------------------------------------------------------------------------
// Surface + base styles
// ---------------------------------------------------------------------------

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

const valueStrong: React.CSSProperties = {
  fontFamily: MONO,
  color: TEXT_NORMAL,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
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

// ---------------------------------------------------------------------------
// EndcapRuleLabel — IBM-1620-inspired apparatus
// ---------------------------------------------------------------------------

interface EndcapRuleLabelProps {
  label: string;
  width: string;
  ticksDirection: "down" | "up";
  capLength?: number;
  ruleOpacity?: number;
  letterSpacing?: string;
  labelSize?: string;
}

function EndcapRuleLabel({
  label,
  width,
  ticksDirection,
  capLength = 5,
  ruleOpacity = 0.55,
  letterSpacing = LABEL_LETTER_SPACING,
  labelSize = DEFAULT_LABEL_SIZE,
}: EndcapRuleLabelProps): React.ReactElement {
  const ticksDown = ticksDirection === "down";

  const containerStyle: React.CSSProperties = {
    position: "relative",
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    width,
    gap: 4,
    [ticksDown ? "marginBottom" : "marginTop"]: capLength,
  };

  const ruleFillStyle: React.CSSProperties = {
    flex: 1,
    height: 1,
    backgroundColor: RAIL_COLOR,
    opacity: ruleOpacity,
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: labelSize,
    letterSpacing,
    color: TEXT_MUTED,
    textTransform: "uppercase",
    fontWeight: 500,
    padding: "0 4px",
    transform: "translateY(0.5px)",
  };

  const tickAnchorStyle: React.CSSProperties = ticksDown
    ? { top: "50%", height: capLength }
    : { bottom: "50%", height: capLength };

  return (
    <div style={containerStyle}>
      <span
        style={{
          position: "absolute",
          left: 0,
          ...tickAnchorStyle,
          width: 1,
          backgroundColor: RAIL_COLOR,
          opacity: ruleOpacity,
        }}
      />
      <span style={ruleFillStyle} />
      <span style={labelStyle}>{label}</span>
      <span style={ruleFillStyle} />
      <span
        style={{
          position: "absolute",
          right: 0,
          ...tickAnchorStyle,
          width: 1,
          backgroundColor: RAIL_COLOR,
          opacity: ruleOpacity,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value rendering
// ---------------------------------------------------------------------------
//
// Round-5: drop fixed-width right-pinned mode. Every value renders
// natural-width (`whiteSpace: nowrap`) and the wrapping cell centers
// it within the uniform apparatus width.

function PlainValue({ value }: { value: string }): React.ReactElement {
  return (
    <span
      style={{
        ...valueStrong,
        fontSize: DEFAULT_VALUE_SIZE,
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  );
}

function ContextValue({ v }: { v: StatusValues }): React.ReactElement {
  const numColor = contextNumeratorColor(v);
  return (
    <span
      style={{
        ...valueStrong,
        fontSize: DEFAULT_VALUE_SIZE,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: numColor }}>{formatTokensCaps(v.contextTokens)}</span>
      <span style={{ color: TEXT_MUTED, opacity: 0.7 }}>
        {` / ${formatTokensCaps(v.contextMax)}`}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cell — endcap-rule label + centered value
// ---------------------------------------------------------------------------

interface CellSpec {
  label: string;
  valueNode: React.ReactElement;
  /** Worst-case value width in ch (used for apparatus width sizing). */
  valueWidthCh: number;
}

interface CellOpts {
  labelPos: "above" | "below";
  uniformWidthCh: number;
  capLength?: number;
  ruleOpacity?: number;
  letterSpacing?: string;
}

function labelVisualWidthCh(label: string, letterSpacing: string): number {
  const factor = letterSpacing.endsWith("em") ? parseFloat(letterSpacing) : 0;
  return label.length * (1 + factor);
}

function Cell({
  spec,
  opts,
}: {
  spec: CellSpec;
  opts: CellOpts;
}): React.ReactElement {
  const widthCss = `${opts.uniformWidthCh}ch`;
  const ticksDirection: "up" | "down" =
    opts.labelPos === "above" ? "down" : "up";

  const labelEl = (
    <EndcapRuleLabel
      label={spec.label}
      width={widthCss}
      ticksDirection={ticksDirection}
      capLength={opts.capLength}
      ruleOpacity={opts.ruleOpacity}
      letterSpacing={opts.letterSpacing}
    />
  );

  // Value centered within the uniform apparatus width. Drops the
  // R4-era min-width / text-align right pinning per round-5 spec —
  // values render natural-width, and the apparatus's centering keeps
  // them visually anchored under (or over) the label center.
  const valueWrap = (
    <span
      style={{
        display: "inline-flex",
        justifyContent: "center",
        width: widthCss,
      }}
    >
      {spec.valueNode}
    </span>
  );

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      {opts.labelPos === "above" ? labelEl : valueWrap}
      {opts.labelPos === "above" ? valueWrap : labelEl}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Specs + uniform width computation
// ---------------------------------------------------------------------------

function buildSpecs(v: StatusValues, mode: TimeModeBundle): CellSpec[] {
  return [
    {
      label: "TIME",
      valueNode: <PlainValue value={mode.time(v.perTurnActiveMs)} />,
      valueWidthCh: mode.timeMaxCh,
    },
    {
      label: "TOKENS",
      valueNode: <PlainValue value={formatTokensCaps(v.perTurnTokens)} />,
      valueWidthCh: VALUE_WIDTH_TOKENS_CH,
    },
    {
      label: "TOTAL TIME",
      valueNode: <PlainValue value={mode.totalTime(v.totalActiveMs)} />,
      valueWidthCh: mode.totalTimeMaxCh,
    },
    {
      label: "TOTAL TOKENS",
      valueNode: <PlainValue value={formatTokensCaps(v.totalTokens)} />,
      valueWidthCh: VALUE_WIDTH_TOKENS_CH,
    },
    {
      label: "CONTEXT",
      valueNode: <ContextValue v={v} />,
      valueWidthCh: VALUE_WIDTH_CONTEXT_CH,
    },
  ];
}

/**
 * Uniform width across all cells. Computed from the widest cell's
 * `max(label-visual-width, value-width) + 4ch breathing room`. The
 * +4ch is the apparatus internal padding (label inner padding + rule
 * minimum). Ensures every cell's apparatus is strictly wider than
 * the longer of its label or value.
 */
function uniformWidthCh(specs: CellSpec[], letterSpacing: string): number {
  let max = 0;
  for (const s of specs) {
    const labelChars = labelVisualWidthCh(s.label, letterSpacing);
    const candidate = Math.max(labelChars, s.valueWidthCh) + 4;
    if (candidate > max) max = candidate;
  }
  return Math.ceil(max);
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowOpts {
  timeMode: TimeMode;
  labelPos: "above" | "below";
  capLength?: number;
  ruleOpacity?: number;
  letterSpacing?: string;
  paddingInline?: string;
}

function StatusRow({
  v,
  opts,
}: {
  v: StatusValues;
  opts: RowOpts;
}): React.ReactElement {
  const mode = getTimeMode(opts.timeMode);
  const specs = buildSpecs(v, mode);
  const letterSpacing = opts.letterSpacing ?? LABEL_LETTER_SPACING;
  const uCh = uniformWidthCh(specs, letterSpacing);
  const cellOpts: CellOpts = {
    labelPos: opts.labelPos,
    uniformWidthCh: uCh,
    capLength: opts.capLength,
    ruleOpacity: opts.ruleOpacity,
    letterSpacing,
  };
  return (
    <div
      style={{
        ...cardSurface,
        paddingInline: opts.paddingInline ?? "var(--tug-space-2xl)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--tug-space-md)",
      }}
    >
      {specs.map((s) => (
        <Cell key={s.label} spec={s} opts={cellOpts} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round-5 variants (6 total)
// ---------------------------------------------------------------------------

// §1 — Default time format (per-turn keeps current formatDurationMs;
// total time uses formatDurationWithSeconds)

function R5_F1({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <StatusRow
      v={v}
      opts={{ timeMode: "default", labelPos: "above" }}
    />
  );
}

function R5_F2({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <StatusRow
      v={v}
      opts={{ timeMode: "default", labelPos: "below" }}
    />
  );
}

// §2 — Always-minutes time format

function R5_F3({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <StatusRow
      v={v}
      opts={{ timeMode: "minutes", labelPos: "above" }}
    />
  );
}

function R5_F4({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <StatusRow
      v={v}
      opts={{ timeMode: "minutes", labelPos: "below" }}
    />
  );
}

// §3 — Always-hours time format

function R5_F5({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <StatusRow
      v={v}
      opts={{ timeMode: "hours", labelPos: "above" }}
    />
  );
}

function R5_F6({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <StatusRow
      v={v}
      opts={{ timeMode: "hours", labelPos: "below" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Variant catalog
// ---------------------------------------------------------------------------

interface VariantEntry {
  id: string;
  title: string;
  note: string;
  render: (v: StatusValues) => React.ReactElement;
}

const SECTION_DEFAULT_TIME: VariantEntry[] = [
  {
    id: "f1",
    title: "F1 — LABEL ABOVE · default time · TOTAL TIME always-seconds",
    note: "EA2 carried forward with centered values, CAPS magnitudes, and TOTAL TIME always shows seconds (e.g. `1h 04m 23s` instead of `1h 04m`). Per-turn TIME keeps the existing format.",
    render: (v) => <R5_F1 v={v} />,
  },
  {
    id: "f2",
    title: "F2 — LABEL BELOW · default time · TOTAL TIME always-seconds",
    note: "EA4 carried forward with centered values, CAPS magnitudes, and TOTAL TIME always shows seconds.",
    render: (v) => <R5_F2 v={v} />,
  },
];

const SECTION_ALWAYS_MINUTES: VariantEntry[] = [
  {
    id: "f3",
    title: "F3 — LABEL ABOVE · always-minutes time (`0m 12s` shape)",
    note: "Per-turn TIME and TOTAL TIME both render as `Mm SSs` at every magnitude. Hours roll into the minutes counter (a marathon session reads `270m 00s` rather than `4h 30m`).",
    render: (v) => <R5_F3 v={v} />,
  },
  {
    id: "f4",
    title: "F4 — LABEL BELOW · always-minutes time",
    note: "Same as F3 with labels below.",
    render: (v) => <R5_F4 v={v} />,
  },
];

const SECTION_ALWAYS_HOURS: VariantEntry[] = [
  {
    id: "f5",
    title: "F5 — LABEL ABOVE · always-hours time (`0h 0m 12s` shape)",
    note: "Per-turn TIME and TOTAL TIME both render as `Hh Mm SSs` at every magnitude. A fresh session's first turn shows `0h 0m 01s`; a marathon reads `4h 30m 00s`.",
    render: (v) => <R5_F5 v={v} />,
  },
  {
    id: "f6",
    title: "F6 — LABEL BELOW · always-hours time",
    note: "Same as F5 with labels below.",
    render: (v) => <R5_F6 v={v} />,
  },
];

function VariantBlock({
  entry,
  values,
}: {
  entry: VariantEntry;
  values: StatusValues;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-2xs)" }}>
      <div style={variantTitleStyle}>{entry.title}</div>
      <div style={variantNoteStyle}>{entry.note}</div>
      {entry.render(values)}
    </div>
  );
}

function VariantSection({
  title,
  entries,
  values,
}: {
  title: string;
  entries: VariantEntry[];
  values: StatusValues;
}): React.ReactElement {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--tug-space-md)" }}>
      <div style={sectionTitleStyle}>
        <TugLabel size="xs">{title}</TugLabel>
      </div>
      <div style={variantStackStyle}>
        {entries.map((e) => (
          <VariantBlock key={e.id} entry={e} values={values} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Controls
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
  fontFamily: MONO,
  color: TEXT_MUTED,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 500,
  fontSize: "0.6875rem",
};

// ---------------------------------------------------------------------------
// GalleryTideStatusRow
// ---------------------------------------------------------------------------

export function GalleryTideStatusRow(): React.ReactElement {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [autoTick, setAutoTick] = useState(false);

  useEffect(() => {
    if (!autoTick) return;
    const id = setInterval(() => {
      setScenarioIdx((i) => (i + 1) % SCENARIOS.length);
    }, 1500);
    return () => clearInterval(id);
  }, [autoTick]);

  const scenario = SCENARIOS[scenarioIdx];
  const values = scenario.values;
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
          backgroundColor:
            "var(--tug7-surface-card-primary-normal-default-rest)",
          borderBottom: `1px solid ${RAIL_COLOR}`,
        }}
      >
        <label
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-2xs)" }}
        >
          <span style={labelMutedSmall}>scenario</span>
          <select
            style={controlSelectStyle}
            value={String(scenarioIdx)}
            onChange={(e) => setScenarioIdx(Number(e.currentTarget.value))}
          >
            {SCENARIOS.map((s, i) => (
              <option key={s.id} value={String(i)}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          style={controlButtonStyle}
          onClick={() => setScenarioIdx((i) => (i + 1) % SCENARIOS.length)}
        >
          next →
        </button>
        <label
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-2xs)" }}
        >
          <input
            type="checkbox"
            checked={autoTick}
            onChange={(e) => setAutoTick(e.currentTarget.checked)}
          />
          <span style={labelMutedSmall}>auto-tick (1.5s)</span>
        </label>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "0.6875rem",
            color: TEXT_MUTED,
            marginLeft: "auto",
          }}
        >
          context: {ratioPct}%
          {ratioPct >= 90 && (
            <span style={{ color: TEXT_DANGER }}> ▲ danger</span>
          )}
          {ratioPct >= 75 && ratioPct < 90 && (
            <span style={{ color: TEXT_CAUTION }}> ▲ caution</span>
          )}
        </span>
      </div>

      <VariantSection
        title="§1 — Default time + TOTAL TIME always-seconds"
        entries={SECTION_DEFAULT_TIME}
        values={values}
      />
      <TugSeparator />
      <VariantSection
        title="§2 — Always-minutes time (`Mm SSs`)"
        entries={SECTION_ALWAYS_MINUTES}
        values={values}
      />
      <TugSeparator />
      <VariantSection
        title="§3 — Always-hours time (`Hh Mm SSs`)"
        entries={SECTION_ALWAYS_HOURS}
        values={values}
      />
    </div>
  );
}
