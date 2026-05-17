/**
 * gallery-tide-status-row.tsx — design-spike gallery card for the
 * tide-card Z2 status row.
 *
 * Surfaces the same five session-status datums (per-turn time,
 * per-turn tokens, total time, total tokens, context with arc) in
 * **six** alternative layouts so the user can compare them side-by-
 * side under value-change scenarios and pick the strongest.
 *
 * **Layout stability is the design goal.** The current production
 * row (Variant 0 below — the baseline) reads correctly but jitters
 * as content changes width. The remaining five variants explore
 * different stabilization strategies; the user can pick one and we'll
 * promote it into the real renderer (`tide-card-telemetry-renderers`).
 *
 * Controls at the top:
 *   - **Scenario picker** — swap between hand-crafted value scenarios
 *     (fresh session → long turn → near-cap → marathon) so each
 *     variant's jitter / stability is empirically visible.
 *   - **Auto-tick** — flip the scenario every 1.5s so jitter is
 *     unmistakable.
 *
 * @module components/tugways/cards/gallery-tide-status-row
 */

import React, { useEffect, useState } from "react";

import { TugArcGauge } from "@/components/tugways/tug-arc-gauge";
import { TugLinearGauge } from "@/components/tugways/tug-linear-gauge";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import {
  formatDurationMs,
  formatTokens,
} from "./tide-card-telemetry-renderers";

// ---------------------------------------------------------------------------
// Scenarios — hand-crafted value sets across the realistic value range
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
      perTurnActiveMs: 83_400, // 1m 23s
      perTurnTokens: 87_500,
      totalActiveMs: 124_200, // 2m 04s
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
      totalActiveMs: 3_840_000, // 1h 04m
      totalTokens: 5_050_000,
      contextTokens: 195_000,
      contextMax: ONE_MILLION,
    },
  },
  {
    id: "nearCap",
    label: "Near cap (danger)",
    values: {
      perTurnActiveMs: 4_200,
      perTurnTokens: 18_000,
      totalActiveMs: 1_394_000, // 23m 14s
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
      totalActiveMs: 16_200_000, // 4h 30m
      totalTokens: 47_200_000,
      contextTokens: 950_000,
      contextMax: ONE_MILLION,
    },
  },
];

// ---------------------------------------------------------------------------
// Reserved widths — the largest representation each metric can produce.
// ---------------------------------------------------------------------------
//
// Used by the fixed-width variants to pin each value cell to its
// worst-case width, eliminating jitter as values change.
//
// The widths are in `ch` units (one `ch` ≈ one tabular digit at the
// row's mono font); all six variants share the row's mono font, so
// `ch` is the natural unit.
//
//   - time      → `99h 59m`         = 7 chars
//   - tokens    → `999.99M`         = 7 chars  (extreme upper bound)
//   - ctx ratio → `999.99k / 1.00M` = 15 chars  (numerator + ` / ` + denom)

const VALUE_WIDTH_TIME_CH = 7;
const VALUE_WIDTH_TOKENS_CH = 7;
const VALUE_WIDTH_CONTEXT_CH = 15;

// ---------------------------------------------------------------------------
// Shared inline styles
// ---------------------------------------------------------------------------

const monoFamily = "var(--tug-font-mono, monospace)";

const cardSurface: React.CSSProperties = {
  backgroundColor: "var(--tug7-surface-card-primary-normal-status-rest)",
  borderTop:
    "1px solid var(--tug7-element-global-border-normal-default-rest)",
  borderBottom:
    "1px solid var(--tug7-element-global-border-normal-default-rest)",
  padding: "var(--tug-space-md)",
  fontFamily: monoFamily,
  fontVariantNumeric: "tabular-nums",
  fontSize: "0.6875rem", // 11px — matches the gauge's compact readout
  lineHeight: 1.2,
};

const labelMuted: React.CSSProperties = {
  color: "var(--tug7-element-global-text-normal-muted-rest)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 500,
};

const valueStrong: React.CSSProperties = {
  color: "var(--tug7-element-global-text-normal-strong-rest)",
  fontWeight: 600,
};

const sepStyle: React.CSSProperties = {
  color: "var(--tug7-element-global-text-normal-muted-rest)",
  opacity: 0.6,
  userSelect: "none",
};

const sectionTitleStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--tug-space-2xs)",
  marginBottom: "var(--tug-space-sm)",
};

const variantNoteStyle: React.CSSProperties = {
  fontFamily: monoFamily,
  fontSize: "0.6875rem",
  color: "var(--tug7-element-global-text-normal-muted-rest)",
};

// ---------------------------------------------------------------------------
// Variant 0 — Baseline (production today, intentionally fluid)
// ---------------------------------------------------------------------------

function Variant0Baseline({ v }: { v: StatusValues }): React.ReactElement {
  const contextRatio = `${formatTokens(v.contextTokens)} / ${formatTokens(v.contextMax)}`;
  return (
    <div
      style={{
        ...cardSurface,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--tug-space-sm)",
      }}
    >
      <BaselineItem label="time:" value={formatDurationMs(v.perTurnActiveMs)} />
      <Sep />
      <BaselineItem label="tokens:" value={formatTokens(v.perTurnTokens)} />
      <Sep />
      <BaselineItem label="total time:" value={formatDurationMs(v.totalActiveMs)} />
      <Sep />
      <BaselineItem label="total tokens:" value={formatTokens(v.totalTokens)} />
      <Sep />
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--tug-space-xs)",
          whiteSpace: "nowrap",
        }}
      >
        <span style={labelMuted}>context:</span>
        <ContextArc v={v} formatted={contextRatio} />
      </span>
    </div>
  );
}

function BaselineItem({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "var(--tug-space-2xs)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={labelMuted}>{label}</span>
      <span style={valueStrong}>{value}</span>
    </span>
  );
}

function Sep(): React.ReactElement {
  return <span style={sepStyle}>•</span>;
}

// ---------------------------------------------------------------------------
// Variant 1 — Fixed-width values, right-aligned
// ---------------------------------------------------------------------------

function Variant1FixedWidthRight({
  v,
}: {
  v: StatusValues;
}): React.ReactElement {
  return (
    <div
      style={{
        ...cardSurface,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--tug-space-sm)",
      }}
    >
      <FixedItem
        label="time:"
        value={formatDurationMs(v.perTurnActiveMs)}
        widthCh={VALUE_WIDTH_TIME_CH}
      />
      <Sep />
      <FixedItem
        label="tokens:"
        value={formatTokens(v.perTurnTokens)}
        widthCh={VALUE_WIDTH_TOKENS_CH}
      />
      <Sep />
      <FixedItem
        label="total time:"
        value={formatDurationMs(v.totalActiveMs)}
        widthCh={VALUE_WIDTH_TIME_CH}
      />
      <Sep />
      <FixedItem
        label="total tokens:"
        value={formatTokens(v.totalTokens)}
        widthCh={VALUE_WIDTH_TOKENS_CH}
      />
      <Sep />
      <ContextItem v={v} valueWidthCh={VALUE_WIDTH_CONTEXT_CH} />
    </div>
  );
}

function FixedItem({
  label,
  value,
  widthCh,
}: {
  label: string;
  value: string;
  widthCh: number;
}): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "var(--tug-space-2xs)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={labelMuted}>{label}</span>
      <span
        style={{
          ...valueStrong,
          display: "inline-block",
          minWidth: `${widthCh}ch`,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </span>
  );
}

function ContextItem({
  v,
  valueWidthCh,
}: {
  v: StatusValues;
  valueWidthCh: number;
}): React.ReactElement {
  const ratio = `${formatTokens(v.contextTokens)} / ${formatTokens(v.contextMax)}`;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--tug-space-xs)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={labelMuted}>context:</span>
      <span
        style={{
          ...valueStrong,
          display: "inline-block",
          minWidth: `${valueWidthCh}ch`,
          textAlign: "right",
        }}
      >
        {ratio}
      </span>
      <BareArc v={v} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Variant 2 — Two-line stacked badges (LABEL above / VALUE below)
// ---------------------------------------------------------------------------

function Variant2StackedBadges({
  v,
}: {
  v: StatusValues;
}): React.ReactElement {
  return (
    <div
      style={{
        ...cardSurface,
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        justifyContent: "center",
        gap: "var(--tug-space-md)",
      }}
    >
      <StackedCell
        label="TIME"
        value={formatDurationMs(v.perTurnActiveMs)}
        widthCh={VALUE_WIDTH_TIME_CH}
      />
      <BadgeDivider />
      <StackedCell
        label="TOKENS"
        value={formatTokens(v.perTurnTokens)}
        widthCh={VALUE_WIDTH_TOKENS_CH}
      />
      <BadgeDivider />
      <StackedCell
        label="TOTAL TIME"
        value={formatDurationMs(v.totalActiveMs)}
        widthCh={VALUE_WIDTH_TIME_CH}
      />
      <BadgeDivider />
      <StackedCell
        label="TOTAL TOKENS"
        value={formatTokens(v.totalTokens)}
        widthCh={VALUE_WIDTH_TOKENS_CH}
      />
      <BadgeDivider />
      <StackedContextCell v={v} />
    </div>
  );
}

function StackedCell({
  label,
  value,
  widthCh,
}: {
  label: string;
  value: string;
  widthCh: number;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        minWidth: `${widthCh + 1}ch`,
      }}
    >
      <span style={{ ...labelMuted, fontSize: "0.625rem" }}>{label}</span>
      <span style={{ ...valueStrong, fontSize: "0.8125rem" }}>{value}</span>
    </div>
  );
}

function StackedContextCell({ v }: { v: StatusValues }): React.ReactElement {
  const ratio = `${formatTokens(v.contextTokens)} / ${formatTokens(v.contextMax)}`;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        minWidth: `${VALUE_WIDTH_CONTEXT_CH + 3}ch`,
      }}
    >
      <span style={{ ...labelMuted, fontSize: "0.625rem" }}>CONTEXT</span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--tug-space-xs)",
        }}
      >
        <span style={{ ...valueStrong, fontSize: "0.8125rem" }}>{ratio}</span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

function BadgeDivider(): React.ReactElement {
  return (
    <span
      style={{
        width: 1,
        background: "var(--tug7-element-global-border-normal-default-rest)",
        opacity: 0.5,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Variant 3 — All-gauges instrument cluster (linear gauges + arc)
// ---------------------------------------------------------------------------
//
// Treats every metric as a meter. The per-turn metrics use a session-
// typical normalization (e.g., a 60s "typical turn"), the cumulative
// metrics use a "session-typical" normalization (1 hour, 10M tokens).
// Reads like an aviation panel — every metric has a graphical position
// AND a numeric readout. Maximum complex-machine feel.

const TYPICAL_TURN_MS = 60_000;
const TYPICAL_TURN_TOKENS = 100_000;
const TYPICAL_SESSION_MS = 60 * 60 * 1000; // 1h
const TYPICAL_SESSION_TOKENS = 10_000_000; // 10M

function Variant3AllGauges({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <div
      style={{
        ...cardSurface,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--tug-space-md)",
      }}
    >
      <GaugeCell
        label="TIME"
        valueText={formatDurationMs(v.perTurnActiveMs)}
        value={v.perTurnActiveMs}
        max={TYPICAL_TURN_MS}
        widthCh={VALUE_WIDTH_TIME_CH}
      />
      <BadgeDivider />
      <GaugeCell
        label="TOKENS"
        valueText={formatTokens(v.perTurnTokens)}
        value={v.perTurnTokens}
        max={TYPICAL_TURN_TOKENS}
        widthCh={VALUE_WIDTH_TOKENS_CH}
      />
      <BadgeDivider />
      <GaugeCell
        label="TOTAL TIME"
        valueText={formatDurationMs(v.totalActiveMs)}
        value={v.totalActiveMs}
        max={TYPICAL_SESSION_MS}
        widthCh={VALUE_WIDTH_TIME_CH}
      />
      <BadgeDivider />
      <GaugeCell
        label="TOTAL TOKENS"
        valueText={formatTokens(v.totalTokens)}
        value={v.totalTokens}
        max={TYPICAL_SESSION_TOKENS}
        widthCh={VALUE_WIDTH_TOKENS_CH}
      />
      <BadgeDivider />
      <StackedContextCell v={v} />
    </div>
  );
}

function GaugeCell({
  label,
  valueText,
  value,
  max,
  widthCh,
}: {
  label: string;
  valueText: string;
  value: number;
  max: number;
  widthCh: number;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "3px",
        minWidth: `${widthCh + 2}ch`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          gap: "var(--tug-space-2xs)",
          width: "100%",
          justifyContent: "center",
        }}
      >
        <span style={{ ...labelMuted, fontSize: "0.625rem" }}>{label}</span>
        <span
          style={{
            ...valueStrong,
            fontSize: "0.75rem",
            display: "inline-block",
            minWidth: `${widthCh}ch`,
            textAlign: "right",
          }}
        >
          {valueText}
        </span>
      </div>
      <div style={{ width: "100%", minWidth: `${widthCh + 1}ch` }}>
        <TugLinearGauge
          value={Math.min(value, max)}
          min={0}
          max={max}
          density="compact"
          thresholds={{ caution: 0.75, danger: 0.95 }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant 4 — Pinned grid (CSS Grid with fixed column tracks)
// ---------------------------------------------------------------------------
//
// The row IS a grid with reserved-width columns per item. Each item
// owns its track; separators sit in their own micro-columns. The
// whole row's intrinsic width is fully determined by the track sum,
// so the row's centered-in-Z2 position is invariant under content
// change.

function Variant4PinnedGrid({ v }: { v: StatusValues }): React.ReactElement {
  // Compute label widths (in ch) — accounts for the longest label
  // we want to surface at each priority.
  const labelTime = "time:".length;
  const labelTokens = "tokens:".length;
  const labelTotalTime = "total time:".length;
  const labelTotalTokens = "total tokens:".length;
  const labelContext = "context:".length;
  const sepCh = 1; // bullet

  // 5 items × (label + value) + 4 separators.
  // Each item is two grid columns: [label][value]; separators are
  // single columns.
  const cols = [
    `${labelTime}ch`,
    `${VALUE_WIDTH_TIME_CH}ch`,
    `${sepCh}ch`,
    `${labelTokens}ch`,
    `${VALUE_WIDTH_TOKENS_CH}ch`,
    `${sepCh}ch`,
    `${labelTotalTime}ch`,
    `${VALUE_WIDTH_TIME_CH}ch`,
    `${sepCh}ch`,
    `${labelTotalTokens}ch`,
    `${VALUE_WIDTH_TOKENS_CH}ch`,
    `${sepCh}ch`,
    `${labelContext}ch`,
    `${VALUE_WIDTH_CONTEXT_CH}ch`,
    "auto", // arc gauge
  ].join(" ");

  const ratio = `${formatTokens(v.contextTokens)} / ${formatTokens(v.contextMax)}`;
  return (
    <div style={cardSurface}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: cols,
          alignItems: "center",
          justifyContent: "center",
          columnGap: "var(--tug-space-2xs)",
          width: "max-content",
          margin: "0 auto",
        }}
      >
        <span style={labelMuted}>time:</span>
        <span style={{ ...valueStrong, textAlign: "right" }}>
          {formatDurationMs(v.perTurnActiveMs)}
        </span>
        <span style={{ ...sepStyle, textAlign: "center" }}>•</span>

        <span style={labelMuted}>tokens:</span>
        <span style={{ ...valueStrong, textAlign: "right" }}>
          {formatTokens(v.perTurnTokens)}
        </span>
        <span style={{ ...sepStyle, textAlign: "center" }}>•</span>

        <span style={labelMuted}>total time:</span>
        <span style={{ ...valueStrong, textAlign: "right" }}>
          {formatDurationMs(v.totalActiveMs)}
        </span>
        <span style={{ ...sepStyle, textAlign: "center" }}>•</span>

        <span style={labelMuted}>total tokens:</span>
        <span style={{ ...valueStrong, textAlign: "right" }}>
          {formatTokens(v.totalTokens)}
        </span>
        <span style={{ ...sepStyle, textAlign: "center" }}>•</span>

        <span style={labelMuted}>context:</span>
        <span style={{ ...valueStrong, textAlign: "right" }}>{ratio}</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            marginLeft: "var(--tug-space-xs)",
          }}
        >
          <BareArc v={v} />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant 5 — Sparkline tail (compact numeric + magnitude bar)
// ---------------------------------------------------------------------------
//
// Per metric: label + fixed-width numeric + a thin magnitude bar
// (color follows threshold). Dense and graphical without two-lining.

function Variant5SparklineTail({
  v,
}: {
  v: StatusValues;
}): React.ReactElement {
  return (
    <div
      style={{
        ...cardSurface,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--tug-space-md)",
      }}
    >
      <SparkItem
        label="time:"
        valueText={formatDurationMs(v.perTurnActiveMs)}
        value={v.perTurnActiveMs}
        max={TYPICAL_TURN_MS}
        widthCh={VALUE_WIDTH_TIME_CH}
      />
      <Sep />
      <SparkItem
        label="tokens:"
        valueText={formatTokens(v.perTurnTokens)}
        value={v.perTurnTokens}
        max={TYPICAL_TURN_TOKENS}
        widthCh={VALUE_WIDTH_TOKENS_CH}
      />
      <Sep />
      <SparkItem
        label="total time:"
        valueText={formatDurationMs(v.totalActiveMs)}
        value={v.totalActiveMs}
        max={TYPICAL_SESSION_MS}
        widthCh={VALUE_WIDTH_TIME_CH}
      />
      <Sep />
      <SparkItem
        label="total tokens:"
        valueText={formatTokens(v.totalTokens)}
        value={v.totalTokens}
        max={TYPICAL_SESSION_TOKENS}
        widthCh={VALUE_WIDTH_TOKENS_CH}
      />
      <Sep />
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--tug-space-xs)",
          whiteSpace: "nowrap",
        }}
      >
        <span style={labelMuted}>context:</span>
        <span
          style={{
            ...valueStrong,
            display: "inline-block",
            minWidth: `${VALUE_WIDTH_CONTEXT_CH}ch`,
            textAlign: "right",
          }}
        >
          {`${formatTokens(v.contextTokens)} / ${formatTokens(v.contextMax)}`}
        </span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

function SparkItem({
  label,
  valueText,
  value,
  max,
  widthCh,
}: {
  label: string;
  valueText: string;
  value: number;
  max: number;
  widthCh: number;
}): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--tug-space-2xs)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={labelMuted}>{label}</span>
      <span
        style={{
          ...valueStrong,
          display: "inline-block",
          minWidth: `${widthCh}ch`,
          textAlign: "right",
        }}
      >
        {valueText}
      </span>
      <span style={{ width: 32, marginLeft: "2px" }}>
        <TugLinearGauge
          value={Math.min(value, max)}
          min={0}
          max={max}
          density="compact"
          thresholds={{ caution: 0.75, danger: 0.95 }}
        />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers — context arc gauge variants
// ---------------------------------------------------------------------------

// Renders the existing arc gauge with the in-element ratio readout.
// Matches the production renderer's shape so the baseline variant is
// truly the production design.
function ContextArc({
  v,
  formatted,
}: {
  v: StatusValues;
  formatted: string;
}): React.ReactElement {
  return (
    <TugArcGauge
      className="tide-telemetry-window-utilization"
      value={v.contextTokens}
      min={0}
      max={v.contextMax}
      density="compact"
      formatValue={() => formatted}
      thresholds={{ caution: 0.75, danger: 0.9 }}
    />
  );
}

// Bare arc — value is shown externally (in the variant's own readout
// span); the gauge is just the graphic. Suppresses the readout via
// an empty formatter and a CSS reach into the readout slot via
// className.
function BareArc({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        width: 28,
      }}
    >
      <TugArcGauge
        value={v.contextTokens}
        min={0}
        max={v.contextMax}
        density="compact"
        formatValue={() => ""}
        thresholds={{ caution: 0.75, danger: 0.9 }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function VariantSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section style={{ display: "flex", flexDirection: "column" }}>
      <div style={sectionTitleStyle}>
        <TugLabel size="xs">{title}</TugLabel>
        <span style={variantNoteStyle}>{note}</span>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// GalleryTideStatusRow — top-level card
// ---------------------------------------------------------------------------

const VARIANTS = [
  { id: "v0", title: "V0 — Baseline (production today; fluid widths)" },
  { id: "v1", title: "V1 — Fixed-width values, right-aligned" },
  { id: "v2", title: "V2 — Stacked label/value cells with dividers" },
  { id: "v3", title: "V3 — All-gauges instrument cluster" },
  { id: "v4", title: "V4 — CSS-Grid pinned tracks" },
  { id: "v5", title: "V5 — Inline sparkline tail" },
] as const;

const VARIANT_NOTES: Record<string, string> = {
  v0: "Current production. Items grow / shrink with content; whole row recenters and jitters.",
  v1: "Each value reserves max-realistic width; digits right-align inside. Row width invariant.",
  v2: "Two-line cells with vertical dividers. Reads like a control cluster; uses more vertical space.",
  v3: "Every metric is a small linear gauge with numeric readout. Maximum dashboard feel; needs typical-value normalizations.",
  v4: "CSS Grid with fixed column tracks. Every cell pinned; row width invariant + perfectly aligned.",
  v5: "Compact numeric + 32px magnitude bar per metric. Graphical without two-lining.",
};

const controlSelectStyle: React.CSSProperties = {
  fontFamily: monoFamily,
  fontSize: "0.75rem",
  padding: "2px 6px",
};

const controlButtonStyle: React.CSSProperties = {
  fontFamily: monoFamily,
  fontSize: "0.75rem",
  padding: "2px 8px",
  cursor: "pointer",
};

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

  return (
    <div
      className="cg-content"
      data-testid="gallery-tide-status-row"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--tug-space-lg)",
        padding: "var(--tug-space-md)",
      }}
    >
      {/* Controls — native HTML for scaffolding-only dev surface,
          matching the convention in gallery-tug-linear-gauge.tsx. */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--tug-space-md)",
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-2xs)" }}>
          <span style={{ ...labelMuted, fontSize: "0.6875rem" }}>scenario</span>
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-2xs)" }}>
          <input
            type="checkbox"
            checked={autoTick}
            onChange={(e) => setAutoTick(e.currentTarget.checked)}
          />
          <span style={{ ...labelMuted, fontSize: "0.6875rem" }}>auto-tick (1.5s)</span>
        </label>
        <span
          style={{
            fontFamily: monoFamily,
            fontSize: "0.6875rem",
            color: "var(--tug7-element-global-text-normal-muted-rest)",
            marginLeft: "auto",
          }}
        >
          context: {Math.round((values.contextTokens / values.contextMax) * 100)}%
        </span>
      </div>

      <TugSeparator />

      {/* Variants */}
      <VariantSection title={VARIANTS[0].title} note={VARIANT_NOTES.v0}>
        <Variant0Baseline v={values} />
      </VariantSection>

      <VariantSection title={VARIANTS[1].title} note={VARIANT_NOTES.v1}>
        <Variant1FixedWidthRight v={values} />
      </VariantSection>

      <VariantSection title={VARIANTS[2].title} note={VARIANT_NOTES.v2}>
        <Variant2StackedBadges v={values} />
      </VariantSection>

      <VariantSection title={VARIANTS[3].title} note={VARIANT_NOTES.v3}>
        <Variant3AllGauges v={values} />
      </VariantSection>

      <VariantSection title={VARIANTS[4].title} note={VARIANT_NOTES.v4}>
        <Variant4PinnedGrid v={values} />
      </VariantSection>

      <VariantSection title={VARIANTS[5].title} note={VARIANT_NOTES.v5}>
        <Variant5SparklineTail v={values} />
      </VariantSection>
    </div>
  );
}
