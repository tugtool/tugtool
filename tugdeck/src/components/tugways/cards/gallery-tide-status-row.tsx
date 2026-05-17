/**
 * gallery-tide-status-row.tsx — design-spike gallery card for the
 * tide-card Z2 status row.
 *
 * **Round 2.** V1 (fixed-width values, right-aligned digits) won the
 * first cut. Every variant below uses the V1 stability foundation
 * (fixed-width slots, right-aligned digits, mono + tabular figures)
 * and explores ONE other axis on top of it:
 *
 *   - **§1 Font experiments** — same layout, different typefaces.
 *     B612 Mono is the Airbus cockpit instrument font we just bundled
 *     for this study; JetBrains Mono is the other contender. Compare
 *     against the existing Hack mono and against label/value font
 *     splits.
 *   - **§2 Dividers / chrome** — same font, different visual
 *     separators between sections (bullets, hairlines, brackets,
 *     framed cells, recessed grooves, alternating tints, ticks,
 *     ribs). The right-aligned values make the bullet feel too soft;
 *     this section explores stronger separators.
 *   - **§3 Horizontal layout** — using more of Z2's width. Centered
 *     vs distributed vs fixed-column vs split-justified.
 *   - **§4 Chrome flourishes** — small graphical accents: leading-
 *     zero placeholders, bracket framing, tick marks, marker rules,
 *     thin section caps.
 *
 * Controls at the top:
 *   - **scenario** — walk through realistic value ranges.
 *   - **next →** step manually.
 *   - **auto-tick** — flip the scenario every 1.5s.
 *
 * After the round-2 review, the winning combination is promoted into
 * `tide-card-telemetry-renderers`.
 *
 * @module components/tugways/cards/gallery-tide-status-row
 */

import React, { useEffect, useState } from "react";

import { TugArcGauge } from "@/components/tugways/tug-arc-gauge";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import {
  formatDurationMs,
  formatTokens,
} from "./tide-card-telemetry-renderers";

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
// Reserved widths — max-realistic representation per metric in ch
// ---------------------------------------------------------------------------
const VALUE_WIDTH_TIME_CH = 7;     // `99h 59m`
const VALUE_WIDTH_TOKENS_CH = 7;   // `999.99M`
const VALUE_WIDTH_CONTEXT_CH = 15; // `999.99k / 1.00M`

// ---------------------------------------------------------------------------
// Shared style atoms — every variant inherits these
// ---------------------------------------------------------------------------

const MONO_DEFAULT = "var(--tug-font-mono, monospace)";
const MONO_B612 = '"B612 Mono", var(--tug-font-mono, monospace)';
const MONO_JETBRAINS = '"JetBrains Mono", var(--tug-font-mono, monospace)';
const SANS = "var(--tug-font-family-sans, system-ui, sans-serif)";

const cardSurface = (
  font: string = MONO_DEFAULT,
  fontSize: string = "0.6875rem",
): React.CSSProperties => ({
  backgroundColor: "var(--tug7-surface-card-primary-normal-status-rest)",
  borderTop: "1px solid var(--tug7-element-global-border-normal-default-rest)",
  borderBottom: "1px solid var(--tug7-element-global-border-normal-default-rest)",
  padding: "var(--tug-space-md)",
  fontFamily: font,
  fontVariantNumeric: "tabular-nums",
  fontSize,
  lineHeight: 1.2,
});

const labelMuted = (font: string = MONO_DEFAULT): React.CSSProperties => ({
  fontFamily: font,
  color: "var(--tug7-element-global-text-normal-muted-rest)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 500,
});

const valueStrong = (font: string = MONO_DEFAULT): React.CSSProperties => ({
  fontFamily: font,
  color: "var(--tug7-element-global-text-normal-strong-rest)",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
});

const valuePinned = (
  font: string = MONO_DEFAULT,
  widthCh: number = VALUE_WIDTH_TIME_CH,
): React.CSSProperties => ({
  ...valueStrong(font),
  display: "inline-block",
  minWidth: `${widthCh}ch`,
  textAlign: "right",
});

const sepBullet: React.CSSProperties = {
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

const variantStackStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--tug-space-md)",
};

const variantTitleStyle: React.CSSProperties = {
  fontFamily: MONO_DEFAULT,
  fontSize: "0.6875rem",
  color: "var(--tug7-element-global-text-normal-muted-rest)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const variantNoteStyle: React.CSSProperties = {
  fontFamily: MONO_DEFAULT,
  fontSize: "0.625rem",
  color: "var(--tug7-element-global-text-normal-muted-rest)",
  opacity: 0.85,
};

// ---------------------------------------------------------------------------
// Reusable item building blocks
// ---------------------------------------------------------------------------

interface ItemSpec {
  label: string;
  value: string;
  widthCh: number;
}

function buildItems(v: StatusValues): ItemSpec[] {
  return [
    { label: "time:", value: formatDurationMs(v.perTurnActiveMs), widthCh: VALUE_WIDTH_TIME_CH },
    { label: "tokens:", value: formatTokens(v.perTurnTokens), widthCh: VALUE_WIDTH_TOKENS_CH },
    { label: "total time:", value: formatDurationMs(v.totalActiveMs), widthCh: VALUE_WIDTH_TIME_CH },
    { label: "total tokens:", value: formatTokens(v.totalTokens), widthCh: VALUE_WIDTH_TOKENS_CH },
  ];
}

function contextRatio(v: StatusValues): string {
  return `${formatTokens(v.contextTokens)} / ${formatTokens(v.contextMax)}`;
}

function BareArc({ v, size = 28 }: { v: StatusValues; size?: number }): React.ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", width: size }}>
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

// Reusable text-only item with pinned width.
function PinnedItem({
  label,
  value,
  widthCh,
  font = MONO_DEFAULT,
}: {
  label: string;
  value: string;
  widthCh: number;
  font?: string;
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
      <span style={labelMuted(font)}>{label}</span>
      <span style={valuePinned(font, widthCh)}>{value}</span>
    </span>
  );
}

function PinnedContext({
  v,
  font = MONO_DEFAULT,
  arcSize = 28,
}: {
  v: StatusValues;
  font?: string;
  arcSize?: number;
}): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--tug-space-xs)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={labelMuted(font)}>context:</span>
      <span style={valuePinned(font, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
      <BareArc v={v} size={arcSize} />
    </span>
  );
}

// =============================================================================
// §1 — FONT EXPERIMENTS
// =============================================================================
// All use V1's fixed-width pinned-value foundation. The variable is the
// typeface (and where it lives — whole row vs values-only vs split).

function rowFlex(
  font: string,
  fontSize: string = "0.6875rem",
): React.CSSProperties {
  return {
    ...cardSurface(font, fontSize),
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--tug-space-sm)",
  };
}

function FontVariant({
  v,
  font,
  fontSize,
}: {
  v: StatusValues;
  font: string;
  fontSize?: string;
}): React.ReactElement {
  const items = buildItems(v);
  return (
    <div style={rowFlex(font, fontSize)}>
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          <PinnedItem label={it.label} value={it.value} widthCh={it.widthCh} font={font} />
          <span style={sepBullet}>•</span>
          {i === items.length - 1 ? null : null}
        </React.Fragment>
      ))}
      <PinnedContext v={v} font={font} />
    </div>
  );
}

function F1Hack({ v }: { v: StatusValues }): React.ReactElement {
  return <FontVariant v={v} font={MONO_DEFAULT} />;
}

function F2B612Mono({ v }: { v: StatusValues }): React.ReactElement {
  return <FontVariant v={v} font={MONO_B612} />;
}

function F3JetBrainsMono({ v }: { v: StatusValues }): React.ReactElement {
  return <FontVariant v={v} font={MONO_JETBRAINS} />;
}

function F4B612Larger({ v }: { v: StatusValues }): React.ReactElement {
  return <FontVariant v={v} font={MONO_B612} fontSize="0.75rem" />;
}

function F5SansLabelB612Value({ v }: { v: StatusValues }): React.ReactElement {
  // Labels in sans (chrome), values in B612 mono (data) — splits the
  // visual register so digits read as instrumentation against
  // softer label text. Reduces "wall of mono" feel.
  const items = buildItems(v);
  return (
    <div style={rowFlex(SANS)}>
      {items.map((it) => (
        <React.Fragment key={it.label}>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: "var(--tug-space-2xs)", whiteSpace: "nowrap" }}>
            <span style={labelMuted(SANS)}>{it.label}</span>
            <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
          </span>
          <span style={sepBullet}>•</span>
        </React.Fragment>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-xs)", whiteSpace: "nowrap" }}>
        <span style={labelMuted(SANS)}>context:</span>
        <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

function F6B612BoldValues({ v }: { v: StatusValues }): React.ReactElement {
  // B612 Mono throughout, but values render at weight 700 to push the
  // numeric data forward more strongly. Labels stay at the medium
  // weight 500 of the standard label treatment.
  const items = buildItems(v);
  const valueBold: React.CSSProperties = {
    ...valuePinned(MONO_B612),
    fontWeight: 700,
  };
  return (
    <div style={rowFlex(MONO_B612)}>
      {items.map((it) => (
        <React.Fragment key={it.label}>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: "var(--tug-space-2xs)", whiteSpace: "nowrap" }}>
            <span style={labelMuted(MONO_B612)}>{it.label}</span>
            <span style={{ ...valueBold, minWidth: `${it.widthCh}ch` }}>{it.value}</span>
          </span>
          <span style={sepBullet}>•</span>
        </React.Fragment>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-xs)", whiteSpace: "nowrap" }}>
        <span style={labelMuted(MONO_B612)}>context:</span>
        <span style={{ ...valueBold, minWidth: `${VALUE_WIDTH_CONTEXT_CH}ch` }}>{contextRatio(v)}</span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

// =============================================================================
// §2 — DIVIDERS / CHROME
// =============================================================================
// V1 layout, B612 Mono. The variable is what separates sections.

const RAIL_COLOR = "var(--tug7-element-global-border-normal-default-rest)";

function DividerRow({
  v,
  divider,
  itemSpacing = "var(--tug-space-md)",
  font = MONO_B612,
}: {
  v: StatusValues;
  divider: React.ReactNode | "none";
  itemSpacing?: string;
  font?: string;
}): React.ReactElement {
  const items = buildItems(v);
  return (
    <div
      style={{
        ...cardSurface(font),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: itemSpacing,
      }}
    >
      {items.map((it) => (
        <React.Fragment key={it.label}>
          <PinnedItem label={it.label} value={it.value} widthCh={it.widthCh} font={font} />
          {divider === "none" ? null : divider}
        </React.Fragment>
      ))}
      <PinnedContext v={v} font={font} />
    </div>
  );
}

function D1Bullet({ v }: { v: StatusValues }): React.ReactElement {
  return <DividerRow v={v} divider={<span style={sepBullet}>•</span>} />;
}

function D2Hairline({ v }: { v: StatusValues }): React.ReactElement {
  const rail: React.CSSProperties = {
    display: "inline-block",
    width: 1,
    alignSelf: "stretch",
    backgroundColor: RAIL_COLOR,
    opacity: 0.5,
  };
  return <DividerRow v={v} divider={<span style={rail} />} itemSpacing="var(--tug-space-lg)" />;
}

function D3HairlineStrong({ v }: { v: StatusValues }): React.ReactElement {
  // Slightly stronger hairline — full opacity rather than the muted
  // 0.5 of D2. Reads as a real divider against the dark status surface.
  const rail: React.CSSProperties = {
    display: "inline-block",
    width: 1,
    alignSelf: "stretch",
    backgroundColor: RAIL_COLOR,
  };
  return <DividerRow v={v} divider={<span style={rail} />} itemSpacing="var(--tug-space-lg)" />;
}

function D4ShortHairlineTicks({ v }: { v: StatusValues }): React.ReactElement {
  // Short 60%-height vertical line centered between items, leaving
  // breathing room top and bottom — reads as an instrument tick mark
  // rather than a full divider.
  const tick: React.CSSProperties = {
    display: "inline-block",
    width: 1,
    height: "60%",
    backgroundColor: RAIL_COLOR,
  };
  return (
    <DividerRow
      v={v}
      divider={
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            alignSelf: "stretch",
          }}
        >
          <span style={tick} />
        </span>
      }
      itemSpacing="var(--tug-space-lg)"
    />
  );
}

function D5DoubleRule({ v }: { v: StatusValues }): React.ReactElement {
  // Pair of thin rules with a 2px gap — reads as a real instrument
  // bezel/seam between data groups.
  const doubleRail: React.CSSProperties = {
    display: "inline-flex",
    alignSelf: "stretch",
    gap: 2,
  };
  const rail: React.CSSProperties = {
    width: 1,
    backgroundColor: RAIL_COLOR,
    opacity: 0.7,
  };
  return (
    <DividerRow
      v={v}
      divider={
        <span style={doubleRail}>
          <span style={rail} />
          <span style={rail} />
        </span>
      }
      itemSpacing="var(--tug-space-lg)"
    />
  );
}

function D6Pipe({ v }: { v: StatusValues }): React.ReactElement {
  return (
    <DividerRow
      v={v}
      divider={
        <span style={{ ...sepBullet, fontFamily: MONO_B612 }}>│</span>
      }
      itemSpacing="var(--tug-space-md)"
    />
  );
}

function D7FramedCells({ v }: { v: StatusValues }): React.ReactElement {
  // Each section sits in a bordered cell — full chrome around each
  // metric. Most distinct visual grouping.
  const items = buildItems(v);
  const cellStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "var(--tug-space-2xs)",
    padding: "var(--tug-space-2xs) var(--tug-space-sm)",
    border: `1px solid ${RAIL_COLOR}`,
    borderRadius: 3,
  };
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--tug-space-xs)",
      }}
    >
      {items.map((it) => (
        <span key={it.label} style={cellStyle}>
          <span style={labelMuted(MONO_B612)}>{it.label}</span>
          <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
        </span>
      ))}
      <span style={cellStyle}>
        <span style={labelMuted(MONO_B612)}>context:</span>
        <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

function D8RecessedGroove({ v }: { v: StatusValues }): React.ReactElement {
  // Each section sits in a recessed "well" (inset shadow) — the
  // chrome reads as a milled instrument face rather than borders.
  const items = buildItems(v);
  const wellStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "var(--tug-space-2xs)",
    padding: "3px var(--tug-space-sm)",
    borderRadius: 2,
    boxShadow:
      "inset 0 1px 0 0 rgb(0 0 0 / 0.25), inset 0 -1px 0 0 rgb(255 255 255 / 0.04)",
  };
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--tug-space-xs)",
      }}
    >
      {items.map((it) => (
        <span key={it.label} style={wellStyle}>
          <span style={labelMuted(MONO_B612)}>{it.label}</span>
          <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
        </span>
      ))}
      <span style={wellStyle}>
        <span style={labelMuted(MONO_B612)}>context:</span>
        <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

function D9TopTickHeader({ v }: { v: StatusValues }): React.ReactElement {
  // Each section gets a thin tick rule ABOVE it (like instrument
  // scale markings). Reads as labeled measurement zones on a
  // continuous strip rather than discrete blocks.
  const items = buildItems(v);
  const ticked: React.CSSProperties = {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    paddingTop: 2,
  };
  const tickBar: React.CSSProperties = {
    width: "100%",
    height: 1,
    backgroundColor: RAIL_COLOR,
  };
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--tug-space-lg)",
      }}
    >
      {items.map((it) => (
        <span key={it.label} style={ticked}>
          <span style={tickBar} />
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: "var(--tug-space-2xs)" }}>
            <span style={labelMuted(MONO_B612)}>{it.label}</span>
            <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
          </span>
        </span>
      ))}
      <span style={ticked}>
        <span style={tickBar} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-xs)" }}>
          <span style={labelMuted(MONO_B612)}>context:</span>
          <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
          <BareArc v={v} />
        </span>
      </span>
    </div>
  );
}

function D10AltTint({ v }: { v: StatusValues }): React.ReactElement {
  // Alternating background tint per cell — subtle banding so the eye
  // can tell adjacent sections apart without explicit dividers.
  const items = buildItems(v);
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        padding: 0,
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        justifyContent: "center",
      }}
    >
      {items.map((it, i) => (
        <span
          key={it.label}
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: "var(--tug-space-2xs)",
            padding: "var(--tug-space-md) var(--tug-space-md)",
            backgroundColor:
              i % 2 === 0
                ? "transparent"
                : "var(--tug7-surface-global-data-tinted-default-rest)",
          }}
        >
          <span style={labelMuted(MONO_B612)}>{it.label}</span>
          <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
        </span>
      ))}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--tug-space-xs)",
          padding: "var(--tug-space-md) var(--tug-space-md)",
          backgroundColor:
            items.length % 2 === 0
              ? "transparent"
              : "var(--tug7-surface-global-data-tinted-default-rest)",
        }}
      >
        <span style={labelMuted(MONO_B612)}>context:</span>
        <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

function D11BracketsAroundLabels({ v }: { v: StatusValues }): React.ReactElement {
  // [TIME] 1.8s • [TOKENS] 30.3k — instrument-readout convention:
  // bracketed label, then value. The brackets create visual chunking
  // without explicit dividers between sections.
  const items = buildItems(v);
  return (
    <div style={rowFlex(MONO_B612)}>
      {items.map((it) => (
        <span
          key={it.label}
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: "var(--tug-space-2xs)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={labelMuted(MONO_B612)}>[{it.label.replace(":", "")}]</span>
          <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
        </span>
      ))}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--tug-space-xs)",
          whiteSpace: "nowrap",
        }}
      >
        <span style={labelMuted(MONO_B612)}>[CONTEXT]</span>
        <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

// =============================================================================
// §3 — HORIZONTAL LAYOUT (using more of Z2's width)
// =============================================================================

function L1Centered({ v }: { v: StatusValues }): React.ReactElement {
  return <D2Hairline v={v} />;
}

function L2SpaceBetween({ v }: { v: StatusValues }): React.ReactElement {
  // Distribute across the full Z2 width — items hug the edges, the
  // arc gauge anchors the right edge. Maximum air between sections,
  // anchored layout (always fills the row).
  const items = buildItems(v);
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {items.map((it) => (
        <PinnedItem key={it.label} label={it.label} value={it.value} widthCh={it.widthCh} font={MONO_B612} />
      ))}
      <PinnedContext v={v} font={MONO_B612} />
    </div>
  );
}

function L3SpaceBetweenWithRails({ v }: { v: StatusValues }): React.ReactElement {
  // Distributed + hairline rails. Items still anchor edge-to-edge
  // BUT the rails make the visual chunking explicit.
  const items = buildItems(v);
  const rail: React.CSSProperties = {
    display: "inline-block",
    width: 1,
    alignSelf: "stretch",
    backgroundColor: RAIL_COLOR,
  };
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          <PinnedItem label={it.label} value={it.value} widthCh={it.widthCh} font={MONO_B612} />
          {i < items.length && <span style={rail} />}
        </React.Fragment>
      ))}
      <PinnedContext v={v} font={MONO_B612} />
    </div>
  );
}

function L4EqualColumns({ v }: { v: StatusValues }): React.ReactElement {
  // CSS Grid with equal-fr columns. Each metric sits centered in its
  // column track; the row uses the full Z2 width AND every section
  // gets the same horizontal real estate. Hairlines between.
  const items = buildItems(v);
  const cells = items.length + 1; // include context
  return (
    <div style={cardSurface(MONO_B612)}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cells}, 1fr)`,
          alignItems: "center",
        }}
      >
        {items.map((it, i) => (
          <span
            key={it.label}
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              justifyContent: "center",
              gap: "var(--tug-space-2xs)",
              borderRight:
                i < cells - 1 ? `1px solid ${RAIL_COLOR}` : undefined,
              padding: "0 var(--tug-space-sm)",
            }}
          >
            <span style={labelMuted(MONO_B612)}>{it.label}</span>
            <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
          </span>
        ))}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--tug-space-xs)",
            padding: "0 var(--tug-space-sm)",
          }}
        >
          <span style={labelMuted(MONO_B612)}>context:</span>
          <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
          <BareArc v={v} />
        </span>
      </div>
    </div>
  );
}

function L5GroupedPerTurnVsTotal({ v }: { v: StatusValues }): React.ReactElement {
  // Group per-turn metrics on the left, total metrics in the middle,
  // context on the right — three GROUPS separated by strong rails,
  // with thin separators within each group. Communicates the semantic
  // structure visually.
  const railStyle: React.CSSProperties = {
    display: "inline-block",
    width: 1,
    alignSelf: "stretch",
    backgroundColor: RAIL_COLOR,
  };
  const subSep: React.CSSProperties = { ...sepBullet };
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--tug-space-md)",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: "var(--tug-space-sm)",
        }}
      >
        <PinnedItem
          label="time:"
          value={formatDurationMs(v.perTurnActiveMs)}
          widthCh={VALUE_WIDTH_TIME_CH}
          font={MONO_B612}
        />
        <span style={subSep}>•</span>
        <PinnedItem
          label="tokens:"
          value={formatTokens(v.perTurnTokens)}
          widthCh={VALUE_WIDTH_TOKENS_CH}
          font={MONO_B612}
        />
      </span>
      <span style={railStyle} />
      <span
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: "var(--tug-space-sm)",
        }}
      >
        <PinnedItem
          label="total time:"
          value={formatDurationMs(v.totalActiveMs)}
          widthCh={VALUE_WIDTH_TIME_CH}
          font={MONO_B612}
        />
        <span style={subSep}>•</span>
        <PinnedItem
          label="total tokens:"
          value={formatTokens(v.totalTokens)}
          widthCh={VALUE_WIDTH_TOKENS_CH}
          font={MONO_B612}
        />
      </span>
      <span style={railStyle} />
      <PinnedContext v={v} font={MONO_B612} />
    </div>
  );
}

function L6PaddedDistributed({ v }: { v: StatusValues }): React.ReactElement {
  // Like L2 but with explicit horizontal padding on the row that
  // creates a visual margin against the card edges. Reads as a
  // chrome strip rather than edge-to-edge data.
  const items = buildItems(v);
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        paddingInline: "var(--tug-space-2xl)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {items.map((it) => (
        <PinnedItem key={it.label} label={it.label} value={it.value} widthCh={it.widthCh} font={MONO_B612} />
      ))}
      <PinnedContext v={v} font={MONO_B612} />
    </div>
  );
}

// =============================================================================
// §4 — CHROME FLOURISHES
// =============================================================================

function H1ZeroPlaceholders({ v }: { v: StatusValues }): React.ReactElement {
  // Pad values with placeholder digits (faint) so the active value
  // sits at the right edge of a visually constant column.
  // "1.8s" rendered as ".....1.8s" with the dots in low-opacity.
  // Reads as a deliberate instrument-fill aesthetic.
  function padded(value: string, widthCh: number): React.ReactElement {
    const pad = Math.max(0, widthCh - value.length);
    return (
      <span style={valuePinned(MONO_B612, widthCh)}>
        <span style={{ opacity: 0.18 }}>{"·".repeat(pad)}</span>
        {value}
      </span>
    );
  }
  const items = buildItems(v);
  return (
    <div style={rowFlex(MONO_B612)}>
      {items.map((it) => (
        <React.Fragment key={it.label}>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: "var(--tug-space-2xs)" }}>
            <span style={labelMuted(MONO_B612)}>{it.label}</span>
            {padded(it.value, it.widthCh)}
          </span>
          <span style={sepBullet}>•</span>
        </React.Fragment>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-xs)" }}>
        <span style={labelMuted(MONO_B612)}>context:</span>
        {padded(contextRatio(v), VALUE_WIDTH_CONTEXT_CH)}
        <BareArc v={v} />
      </span>
    </div>
  );
}

function H2TickedDividers({ v }: { v: StatusValues }): React.ReactElement {
  // Vertical hairline + small cap ticks at top and bottom of each
  // divider — like the gradation marks on instrument scales.
  const tickedDivider = (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        alignSelf: "stretch",
        justifyContent: "center",
        gap: 1,
        height: "100%",
      }}
    >
      <span style={{ width: 5, height: 1, backgroundColor: RAIL_COLOR }} />
      <span style={{ width: 1, flex: 1, backgroundColor: RAIL_COLOR }} />
      <span style={{ width: 5, height: 1, backgroundColor: RAIL_COLOR }} />
    </span>
  );
  return <DividerRow v={v} divider={tickedDivider} itemSpacing="var(--tug-space-lg)" />;
}

function H3UnderlinedValues({ v }: { v: StatusValues }): React.ReactElement {
  // Each value gets a subtle underline rule beneath — reads as a
  // measurement scale beneath the digits. Bullets between sections.
  const items = buildItems(v);
  return (
    <div style={rowFlex(MONO_B612)}>
      {items.map((it) => (
        <React.Fragment key={it.label}>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: "var(--tug-space-2xs)" }}>
            <span style={labelMuted(MONO_B612)}>{it.label}</span>
            <span
              style={{
                ...valuePinned(MONO_B612, it.widthCh),
                borderBottom: `1px solid ${RAIL_COLOR}`,
                paddingBottom: 1,
              }}
            >
              {it.value}
            </span>
          </span>
          <span style={sepBullet}>•</span>
        </React.Fragment>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--tug-space-xs)" }}>
        <span style={labelMuted(MONO_B612)}>context:</span>
        <span
          style={{
            ...valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH),
            borderBottom: `1px solid ${RAIL_COLOR}`,
            paddingBottom: 1,
          }}
        >
          {contextRatio(v)}
        </span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

function H4LabelsAboveValues({ v }: { v: StatusValues }): React.ReactElement {
  // Two-line layout: tiny labels above each value. Pinned widths
  // keep the columns stable. Uses more vertical real estate but
  // reads like a true control cluster.
  const items = buildItems(v);
  const cellStyle: React.CSSProperties = {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 1,
  };
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingInline: "var(--tug-space-xl)",
      }}
    >
      {items.map((it) => (
        <span key={it.label} style={cellStyle}>
          <span style={{ ...labelMuted(MONO_B612), fontSize: "0.5625rem" }}>
            {it.label.replace(":", "")}
          </span>
          <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
        </span>
      ))}
      <span style={cellStyle}>
        <span style={{ ...labelMuted(MONO_B612), fontSize: "0.5625rem" }}>
          context
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--tug-space-xs)",
          }}
        >
          <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>
            {contextRatio(v)}
          </span>
          <BareArc v={v} />
        </span>
      </span>
    </div>
  );
}

function H5DotLeader({ v }: { v: StatusValues }): React.ReactElement {
  // Classic typographic dot-leader between label and value (like a
  // table of contents). The value pins right, the label pins left,
  // and a dotted rule fills the middle of each item's fixed-width
  // slot.
  const items = buildItems(v);
  const itemWidthCh = 14; // label + leader + value
  function cell(label: string, value: string): React.ReactElement {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          width: `${itemWidthCh}ch`,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <span style={labelMuted(MONO_B612)}>{label}</span>
        <span
          aria-hidden="true"
          style={{
            flex: 1,
            margin: "0 4px",
            borderBottom: `1px dotted ${RAIL_COLOR}`,
            transform: "translateY(-2px)",
          }}
        />
        <span style={valueStrong(MONO_B612)}>{value}</span>
      </span>
    );
  }
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingInline: "var(--tug-space-lg)",
      }}
    >
      {items.map((it) => (
        <React.Fragment key={it.label}>{cell(it.label, it.value)}</React.Fragment>
      ))}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--tug-space-xs)",
          whiteSpace: "nowrap",
        }}
      >
        <span style={labelMuted(MONO_B612)}>context:</span>
        <span style={valueStrong(MONO_B612)}>{contextRatio(v)}</span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

function H6ChevronGroups({ v }: { v: StatusValues }): React.ReactElement {
  // Chevron-style group enclosures: `‹ TIME 1.8s ›` — bracketed
  // sections with angle-bracket framing. Reads as terminal-prompt-
  // style data chunks.
  const items = buildItems(v);
  const cellStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "var(--tug-space-2xs)",
    whiteSpace: "nowrap",
  };
  const chevron: React.CSSProperties = {
    ...sepBullet,
    fontFamily: MONO_B612,
  };
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--tug-space-md)",
      }}
    >
      {items.map((it) => (
        <span key={it.label} style={cellStyle}>
          <span style={chevron}>‹</span>
          <span style={labelMuted(MONO_B612)}>{it.label.replace(":", "")}</span>
          <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
          <span style={chevron}>›</span>
        </span>
      ))}
      <span style={cellStyle}>
        <span style={chevron}>‹</span>
        <span style={labelMuted(MONO_B612)}>CONTEXT</span>
        <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
        <BareArc v={v} />
        <span style={chevron}>›</span>
      </span>
    </div>
  );
}

function H7SegmentedRail({ v }: { v: StatusValues }): React.ReactElement {
  // A single continuous bottom rail under the row, broken by visible
  // gaps between sections — reads as a segmented base rail like an
  // instrument scale.
  const items = buildItems(v);
  const cellStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "var(--tug-space-2xs)",
    paddingBottom: 4,
    borderBottom: `1px solid ${RAIL_COLOR}`,
  };
  return (
    <div
      style={{
        ...cardSurface(MONO_B612),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--tug-space-md)",
        paddingInline: "var(--tug-space-xl)",
      }}
    >
      {items.map((it) => (
        <span key={it.label} style={cellStyle}>
          <span style={labelMuted(MONO_B612)}>{it.label}</span>
          <span style={valuePinned(MONO_B612, it.widthCh)}>{it.value}</span>
        </span>
      ))}
      <span style={{ ...cellStyle, alignItems: "center" }}>
        <span style={labelMuted(MONO_B612)}>context:</span>
        <span style={valuePinned(MONO_B612, VALUE_WIDTH_CONTEXT_CH)}>{contextRatio(v)}</span>
        <BareArc v={v} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper + variant catalog
// ---------------------------------------------------------------------------

interface VariantEntry {
  id: string;
  title: string;
  note: string;
  render: (v: StatusValues) => React.ReactElement;
}

const SECTION_FONTS: VariantEntry[] = [
  { id: "f1", title: "F1 — Hack (current default mono)", note: "Today's font. Reads cleanly but isn't built for instruments.", render: (v) => <F1Hack v={v} /> },
  { id: "f2", title: "F2 — B612 Mono (Airbus cockpit)", note: "Designed for aircraft instrument displays. Maximum legibility under stress.", render: (v) => <F2B612Mono v={v} /> },
  { id: "f3", title: "F3 — JetBrains Mono", note: "Modern code-editor mono with tabular figures by default. Crisp at small sizes.", render: (v) => <F3JetBrainsMono v={v} /> },
  { id: "f4", title: "F4 — B612 Mono @ 12px", note: "B612 bumped one notch larger. Trades chrome real estate for digit legibility.", render: (v) => <F4B612Larger v={v} /> },
  { id: "f5", title: "F5 — Sans labels, B612 mono values", note: "Splits the register: soft sans labels, hard mono digits. Reduces 'wall of mono' feel.", render: (v) => <F5SansLabelB612Value v={v} /> },
  { id: "f6", title: "F6 — B612 Mono Bold values", note: "Values render at weight 700. Numeric data feels heavier; labels recede further.", render: (v) => <F6B612BoldValues v={v} /> },
];

const SECTION_DIVIDERS: VariantEntry[] = [
  { id: "d1", title: "D1 — Bullet (current production)", note: "Baseline. Reads as soft punctuation against right-aligned values.", render: (v) => <D1Bullet v={v} /> },
  { id: "d2", title: "D2 — Hairline rail (muted)", note: "1px vertical rail at 50% opacity. Subtle but unambiguous chunking.", render: (v) => <D2Hairline v={v} /> },
  { id: "d3", title: "D3 — Hairline rail (full)", note: "Same rail at full opacity — pushes harder as a real divider.", render: (v) => <D3HairlineStrong v={v} /> },
  { id: "d4", title: "D4 — Short tick mark", note: "60%-height vertical line. Reads as an instrument scale tick rather than a divider.", render: (v) => <D4ShortHairlineTicks v={v} /> },
  { id: "d5", title: "D5 — Double rule (bezel seam)", note: "Pair of thin rails with a 2px gap. Bezel/seam feel between data groups.", render: (v) => <D5DoubleRule v={v} /> },
  { id: "d6", title: "D6 — Pipe character │", note: "Box-drawing pipe. Lighter weight than an actual rule but communicates a column edge.", render: (v) => <D6Pipe v={v} /> },
  { id: "d7", title: "D7 — Framed cells", note: "Each section in a 1px bordered cell. Maximum visual chunking.", render: (v) => <D7FramedCells v={v} /> },
  { id: "d8", title: "D8 — Recessed groove", note: "Inset shadow on each section — reads as a milled instrument face.", render: (v) => <D8RecessedGroove v={v} /> },
  { id: "d9", title: "D9 — Top tick header", note: "Thin rule ABOVE each section. Instrument scale-marking convention.", render: (v) => <D9TopTickHeader v={v} /> },
  { id: "d10", title: "D10 — Alternating tint", note: "Subtle background banding between adjacent cells. No explicit dividers needed.", render: (v) => <D10AltTint v={v} /> },
  { id: "d11", title: "D11 — Bracketed labels [LABEL]", note: "Instrument-readout convention: [LABEL] value, no separators needed.", render: (v) => <D11BracketsAroundLabels v={v} /> },
];

const SECTION_LAYOUT: VariantEntry[] = [
  { id: "l1", title: "L1 — Centered, hairlines (== D2)", note: "Center-justified group. Wastes side margins; chunks via hairlines.", render: (v) => <L1Centered v={v} /> },
  { id: "l2", title: "L2 — Space-between (full width)", note: "Items distribute edge-to-edge. Uses every pixel of Z2's width.", render: (v) => <L2SpaceBetween v={v} /> },
  { id: "l3", title: "L3 — Space-between + rails", note: "Distributed AND chunked. Most distinct organization.", render: (v) => <L3SpaceBetweenWithRails v={v} /> },
  { id: "l4", title: "L4 — Equal columns (CSS Grid)", note: "Every section gets the same horizontal space. Rigid but predictable.", render: (v) => <L4EqualColumns v={v} /> },
  { id: "l5", title: "L5 — Grouped per-turn vs total", note: "Three semantic groups: [turn] · [session totals] · [context]. Strong rails between groups, soft bullets within.", render: (v) => <L5GroupedPerTurnVsTotal v={v} /> },
  { id: "l6", title: "L6 — Padded distributed", note: "Space-between with extra side padding. Reads as a chrome strip.", render: (v) => <L6PaddedDistributed v={v} /> },
];

const SECTION_FLOURISHES: VariantEntry[] = [
  { id: "h1", title: "H1 — Leading dot placeholders", note: "···1.8s — pad with faint dots so digits sit at a constant right edge.", render: (v) => <H1ZeroPlaceholders v={v} /> },
  { id: "h2", title: "H2 — Capped tick dividers", note: "Hairline + small cap-ticks at top and bottom — instrument-scale gradation feel.", render: (v) => <H2TickedDividers v={v} /> },
  { id: "h3", title: "H3 — Underlined values", note: "Each value sits over a subtle rule. Measurement-scale-beneath-digit aesthetic.", render: (v) => <H3UnderlinedValues v={v} /> },
  { id: "h4", title: "H4 — Tiny labels above values", note: "Two-line cells. Bigger footprint but reads as a real control cluster.", render: (v) => <H4LabelsAboveValues v={v} /> },
  { id: "h5", title: "H5 — Dot-leader between label and value", note: "Classic typographic dot-leader: label ··· value. Pins both ends per cell.", render: (v) => <H5DotLeader v={v} /> },
  { id: "h6", title: "H6 — Chevron-framed groups ‹...›", note: "Terminal-prompt-style angle-bracket framing per section.", render: (v) => <H6ChevronGroups v={v} /> },
  { id: "h7", title: "H7 — Segmented base rail", note: "Each section's value sits on its own short underline — reads as a segmented instrument scale.", render: (v) => <H7SegmentedRail v={v} /> },
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
  fontFamily: MONO_DEFAULT,
  fontSize: "0.75rem",
  padding: "2px 6px",
};

const controlButtonStyle: React.CSSProperties = {
  fontFamily: MONO_DEFAULT,
  fontSize: "0.75rem",
  padding: "2px 8px",
  cursor: "pointer",
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
      {/* Controls */}
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
          <span style={{ ...labelMuted(MONO_DEFAULT), fontSize: "0.6875rem" }}>scenario</span>
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
          <span style={{ ...labelMuted(MONO_DEFAULT), fontSize: "0.6875rem" }}>auto-tick (1.5s)</span>
        </label>
        <span
          style={{
            fontFamily: MONO_DEFAULT,
            fontSize: "0.6875rem",
            color: "var(--tug7-element-global-text-normal-muted-rest)",
            marginLeft: "auto",
          }}
        >
          context: {Math.round((values.contextTokens / values.contextMax) * 100)}%
        </span>
      </div>

      <VariantSection
        title="§1 — Font experiments"
        entries={SECTION_FONTS}
        values={values}
      />
      <TugSeparator />
      <VariantSection
        title="§2 — Dividers / chrome"
        entries={SECTION_DIVIDERS}
        values={values}
      />
      <TugSeparator />
      <VariantSection
        title="§3 — Horizontal layout"
        entries={SECTION_LAYOUT}
        values={values}
      />
      <TugSeparator />
      <VariantSection
        title="§4 — Chrome flourishes"
        entries={SECTION_FLOURISHES}
        values={values}
      />
    </div>
  );
}
