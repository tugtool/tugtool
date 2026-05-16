/**
 * gallery-tug-arc-gauge.tsx — `TugArcGauge` demo tab for the
 * Component Gallery.
 *
 * Four sections — see [#step-20-2](roadmap/tide-assistant-rendering.md#step-20-2):
 *
 *   1. Interactive sandbox — slider for `value`, numeric inputs for
 *      `min` / `max`, toggles for `density`, `fillRole`, label,
 *      caution / danger thresholds, AND start / sweep angles for the
 *      custom geometry. The gauge re-renders live; sweep the slider
 *      to confirm color transitions match expectation and that the
 *      arc redraws smoothly across the 180° boundary where the SVG
 *      `large-arc-flag` flips from 0 to 1.
 *   2. Scale × threshold matrix — three scales (chrome strip ~32 px
 *      diameter → readable ~80 px → showcase ~180 px) across three
 *      threshold configs (no thresholds → below caution → above
 *      danger). Mirrors the linear gauge's matrix structure so the
 *      two primitives can be visually compared at matching scales.
 *   3. Geometry variants — five different arc shapes at the readable
 *      scale: default "C" sweep, full circle, top half-circle,
 *      top-right quarter-arc, top-left quarter-arc. Gates that the
 *      `geometry` prop produces sensible output at non-default
 *      angles.
 *
 * @module components/tugways/cards/gallery-tug-arc-gauge
 */

import React from "react";

import { TugArcGauge } from "@/components/tugways/tug-arc-gauge";
import type {
  TugArcGaugeDensity,
  TugArcGaugeGeometry,
} from "@/components/tugways/tug-arc-gauge";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Inline styles — kept module-local to mirror sibling gallery cards.
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "1rem",
  marginBottom: "0.75rem",
  fontFamily: "var(--tug-font-mono, monospace)",
  fontSize: "0.75rem",
};

const controlGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
};

const inputStyle: React.CSSProperties = {
  width: "5rem",
  padding: "2px 4px",
  fontFamily: "var(--tug-font-mono, monospace)",
  fontSize: "0.75rem",
};

const matrixStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr 1fr 1fr",
  gap: "1rem 1.25rem",
  alignItems: "center",
};

const matrixRowLabelStyle: React.CSSProperties = {
  fontFamily: "var(--tug-font-mono, monospace)",
  fontSize: "0.6875rem",
  color: "var(--tug7-element-global-text-normal-muted-rest)",
  whiteSpace: "nowrap",
};

const matrixHeaderStyle: React.CSSProperties = {
  ...matrixRowLabelStyle,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const geometryRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, 1fr)",
  gap: "1rem",
  alignItems: "end",
};

const geometryCellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.5rem",
};

const geometryCellLabelStyle: React.CSSProperties = {
  fontFamily: "var(--tug-font-mono, monospace)",
  fontSize: "0.6875rem",
  color: "var(--tug7-element-global-text-normal-muted-rest)",
  textAlign: "center",
};

// ---------------------------------------------------------------------------
// Cell wrappers that pin the gauge size at each scale.
// ---------------------------------------------------------------------------

const STRIP_SIZE: React.CSSProperties = { width: "32px" };
const READABLE_SIZE: React.CSSProperties = { width: "80px" };
const SHOWCASE_SIZE: React.CSSProperties = { width: "180px" };

// ---------------------------------------------------------------------------
// Predefined geometry variants for the third section.
// ---------------------------------------------------------------------------

interface GeometryVariant {
  label: string;
  geometry: TugArcGaugeGeometry;
}

const GEOMETRY_VARIANTS: ReadonlyArray<GeometryVariant> = [
  { label: "default C-sweep", geometry: { startAngleDeg: 135, sweepAngleDeg: 270 } },
  { label: "full circle", geometry: { startAngleDeg: 0, sweepAngleDeg: 360 } },
  { label: "top half-circle", geometry: { startAngleDeg: 180, sweepAngleDeg: 180 } },
  { label: "top-left quarter", geometry: { startAngleDeg: 180, sweepAngleDeg: 90 } },
  { label: "top-right quarter", geometry: { startAngleDeg: 270, sweepAngleDeg: 90 } },
];

// ---------------------------------------------------------------------------
// GalleryTugArcGauge
// ---------------------------------------------------------------------------

export function GalleryTugArcGauge(): React.ReactElement {
  // Interactive sandbox state.
  const [value, setValue] = React.useState<number>(60);
  const [min, setMin] = React.useState<number>(0);
  const [max, setMax] = React.useState<number>(100);
  const [density, setDensity] =
    React.useState<TugArcGaugeDensity>("detailed");
  const [fillRole, setFillRole] =
    React.useState<"default" | "info" | "success">("default");
  const [labelText, setLabelText] = React.useState<string>("LOAD");
  const [cautionPct, setCautionPct] = React.useState<number>(75);
  const [dangerPct, setDangerPct] = React.useState<number>(90);
  const [startAngle, setStartAngle] = React.useState<number>(135);
  const [sweepAngle, setSweepAngle] = React.useState<number>(270);

  const thresholds = React.useMemo(
    () => ({ caution: cautionPct / 100, danger: dangerPct / 100 }),
    [cautionPct, dangerPct],
  );

  const geometry = React.useMemo(
    () => ({ startAngleDeg: startAngle, sweepAngleDeg: sweepAngle }),
    [startAngle, sweepAngle],
  );

  return (
    <div className="cg-content" data-testid="gallery-tug-arc-gauge">
      {/* ============================================================
          1. Interactive sandbox
          ============================================================ */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Interactive sandbox</TugLabel>
        <div style={labelStyle}>
          Tune <code>value</code>, density, <code>fillRole</code>, the
          caution / danger thresholds, AND the arc's{" "}
          <code>startAngleDeg</code> / <code>sweepAngleDeg</code>.
          Sweep the value slider to verify the arc redraws smoothly
          across the 180° boundary where the SVG{" "}
          <code>large-arc-flag</code> flips.
        </div>

        <div style={controlsRowStyle}>
          <div style={{ ...controlGroupStyle, flex: "1 1 14rem" }}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-value">
              value ({value.toFixed(1)})
            </label>
            <input
              id="cg-arcgauge-value"
              type="range"
              min={min}
              max={max}
              step={(max - min) / 200}
              value={value}
              onChange={(e) => setValue(Number(e.currentTarget.value))}
            />
          </div>
          <div style={controlGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-min">min</label>
            <input
              id="cg-arcgauge-min"
              type="number"
              style={inputStyle}
              value={min}
              onChange={(e) => setMin(Number(e.currentTarget.value))}
            />
          </div>
          <div style={controlGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-max">max</label>
            <input
              id="cg-arcgauge-max"
              type="number"
              style={inputStyle}
              value={max}
              onChange={(e) => setMax(Number(e.currentTarget.value))}
            />
          </div>
          <div style={controlGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-density">
              density
            </label>
            <select
              id="cg-arcgauge-density"
              style={inputStyle}
              value={density}
              onChange={(e) =>
                setDensity(e.currentTarget.value as TugArcGaugeDensity)
              }
            >
              <option value="compact">compact</option>
              <option value="detailed">detailed</option>
            </select>
          </div>
          <div style={controlGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-fillrole">
              fillRole
            </label>
            <select
              id="cg-arcgauge-fillrole"
              style={inputStyle}
              value={fillRole}
              onChange={(e) =>
                setFillRole(
                  e.currentTarget.value as "default" | "info" | "success",
                )
              }
            >
              <option value="default">default</option>
              <option value="info">info</option>
              <option value="success">success</option>
            </select>
          </div>
          <div style={controlGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-label">label</label>
            <input
              id="cg-arcgauge-label"
              type="text"
              style={inputStyle}
              value={labelText}
              onChange={(e) => setLabelText(e.currentTarget.value)}
            />
          </div>
          <div style={controlGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-caution">
              caution %
            </label>
            <input
              id="cg-arcgauge-caution"
              type="number"
              min={0}
              max={100}
              style={inputStyle}
              value={cautionPct}
              onChange={(e) => setCautionPct(Number(e.currentTarget.value))}
            />
          </div>
          <div style={controlGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-danger">
              danger %
            </label>
            <input
              id="cg-arcgauge-danger"
              type="number"
              min={0}
              max={100}
              style={inputStyle}
              value={dangerPct}
              onChange={(e) => setDangerPct(Number(e.currentTarget.value))}
            />
          </div>
          <div style={controlGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-start">
              start °
            </label>
            <input
              id="cg-arcgauge-start"
              type="number"
              min={0}
              max={359}
              style={inputStyle}
              value={startAngle}
              onChange={(e) => setStartAngle(Number(e.currentTarget.value))}
            />
          </div>
          <div style={controlGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="cg-arcgauge-sweep">
              sweep °
            </label>
            <input
              id="cg-arcgauge-sweep"
              type="number"
              min={0}
              max={360}
              style={inputStyle}
              value={sweepAngle}
              onChange={(e) => setSweepAngle(Number(e.currentTarget.value))}
            />
          </div>
        </div>

        <div style={{ width: "200px" }}>
          <TugArcGauge
            value={value}
            min={min}
            max={max}
            thresholds={thresholds}
            label={labelText !== "" ? labelText : undefined}
            density={density}
            fillRole={fillRole}
            geometry={geometry}
            formatValue={(v) => v.toFixed(1)}
          />
        </div>
      </div>

      <TugSeparator />

      {/* ============================================================
          2. Scale × threshold matrix
          ============================================================ */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Scale × threshold matrix
        </TugLabel>
        <div style={labelStyle}>
          Three scales (chrome strip → readable → showcase) across
          three threshold configurations. Mirrors the linear-gauge
          matrix so the two primitives can be compared at matching
          scales.
        </div>

        <div style={matrixStyle}>
          {/* Header row */}
          <span />
          <span style={matrixHeaderStyle}>no thresholds</span>
          <span style={matrixHeaderStyle}>below caution (60%)</span>
          <span style={matrixHeaderStyle}>above danger (95%)</span>

          {/* Row 1 — strip */}
          <span style={matrixRowLabelStyle}>
            STRIP
            <br />
            (~32 px, compact)
          </span>
          <div style={STRIP_SIZE}>
            <TugArcGauge value={60} min={0} max={100} density="compact" />
          </div>
          <div style={STRIP_SIZE}>
            <TugArcGauge
              value={60}
              min={0}
              max={100}
              density="compact"
              thresholds={{ caution: 0.75, danger: 0.9 }}
            />
          </div>
          <div style={STRIP_SIZE}>
            <TugArcGauge
              value={95}
              min={0}
              max={100}
              density="compact"
              thresholds={{ caution: 0.75, danger: 0.9 }}
            />
          </div>

          {/* Row 2 — readable (compact + label) */}
          <span style={matrixRowLabelStyle}>
            READABLE
            <br />
            (~80 px, compact + label)
          </span>
          <div style={READABLE_SIZE}>
            <TugArcGauge
              value={60}
              min={0}
              max={100}
              density="compact"
              label="LOAD"
            />
          </div>
          <div style={READABLE_SIZE}>
            <TugArcGauge
              value={60}
              min={0}
              max={100}
              density="compact"
              label="LOAD"
              thresholds={{ caution: 0.75, danger: 0.9 }}
            />
          </div>
          <div style={READABLE_SIZE}>
            <TugArcGauge
              value={95}
              min={0}
              max={100}
              density="compact"
              label="LOAD"
              thresholds={{ caution: 0.75, danger: 0.9 }}
            />
          </div>

          {/* Row 3 — showcase (detailed) */}
          <span style={matrixRowLabelStyle}>
            SHOWCASE
            <br />
            (~180 px, detailed)
          </span>
          <div style={SHOWCASE_SIZE}>
            <TugArcGauge
              value={60}
              min={0}
              max={100}
              density="detailed"
              label="QUANTITY"
            />
          </div>
          <div style={SHOWCASE_SIZE}>
            <TugArcGauge
              value={60}
              min={0}
              max={100}
              density="detailed"
              label="QUANTITY"
              thresholds={{ caution: 0.75, danger: 0.9 }}
            />
          </div>
          <div style={SHOWCASE_SIZE}>
            <TugArcGauge
              value={95}
              min={0}
              max={100}
              density="detailed"
              label="QUANTITY"
              thresholds={{ caution: 0.75, danger: 0.9 }}
            />
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ============================================================
          3. Geometry variants
          ============================================================ */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Geometry variants
        </TugLabel>
        <div style={labelStyle}>
          Five different arc shapes at the readable (compact) scale.
          Same <code>value=60</code>; only <code>geometry</code>{" "}
          differs. Gates that the prop produces sensible output at
          non-default angles and that the full-circle branch (two
          semicircle arcs) renders without seams.
        </div>

        <div style={geometryRowStyle}>
          {GEOMETRY_VARIANTS.map((variant) => (
            <div key={variant.label} style={geometryCellStyle}>
              <div style={READABLE_SIZE}>
                <TugArcGauge
                  value={60}
                  min={0}
                  max={100}
                  density="compact"
                  geometry={variant.geometry}
                />
              </div>
              <span style={geometryCellLabelStyle}>
                {variant.label}
                <br />
                <code>
                  {variant.geometry.startAngleDeg}° /{" "}
                  {variant.geometry.sweepAngleDeg}°
                </code>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
