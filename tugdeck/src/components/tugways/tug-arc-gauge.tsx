/**
 * TugArcGauge — radial-fill quantity gauge primitive.
 *
 * The radial counterpart to {@link TugLinearGauge}. Maps `value` from
 * `[min, max]` into a proportional sweep along a circular arc, with
 * the same threshold-based color zones as the linear gauge and the
 * same `compact` / `detailed` density modes. Stateless presentation;
 * the consumer owns `value`.
 *
 * The arc's shape is configurable via `geometry.startAngleDeg` and
 * `geometry.sweepAngleDeg`. Defaults to a "C" sweep that leaves the
 * bottom 90° of the circle open — a familiar dashboard-dial
 * silhouette. Other useful shapes:
 *
 *  - Full circle:   `{ startAngleDeg: 0,   sweepAngleDeg: 360 }`
 *  - Half-circle:   `{ startAngleDeg: 180, sweepAngleDeg: 180 }` (top half)
 *  - Quarter-arc:   `{ startAngleDeg: 180, sweepAngleDeg: 90 }`  (top-left)
 *
 * Angle convention follows SVG: 0° points right (positive x-axis),
 * 90° points down, 180° points left, 270° points up. `sweepAngleDeg`
 * is always positive — the arc sweeps clockwise from
 * `startAngleDeg` for `sweepAngleDeg` degrees of arc. Negative sweeps
 * are rejected (a configuration error — see {@link arcPath}).
 *
 * Color slots are shared with `TugLinearGauge` via the
 * `--tugx-gauge-fill-{role}-color` family declared in
 * `tug-linear-gauge.css` body{}. Arc-specific geometry slots live in
 * `tug-arc-gauge.css` body{} under the `--tugx-gauge-arc-*`
 * namespace; the two gauges' geometry slots never collide.
 *
 * Laws:
 *  - [L06] appearance via SVG path mutation, not React state. The
 *    `value` drives one inline `d` attribute on the fill path; role
 *    color comes from `[data-role]` on the wrapper.
 *  - [L17] every `--tugx-gauge-arc-*` slot resolves to a `--tug7-*`
 *    or `--tug-*` base token in one hop. Shared color slots
 *    (`--tugx-gauge-fill-*`) are declared in `tug-linear-gauge.css`
 *    body{} per the same rule.
 *  - [L19] component authoring — file pair, module docstring,
 *    `data-slot="tug-arc-gauge"`.
 *  - [L20] component-token sovereignty — owns `--tugx-gauge-arc-*`
 *    exclusively; reads the shared `--tugx-gauge-fill-{role}-color`
 *    family. No primitive overrides another's slots.
 *  - [L24] structure zone for the React tree; arc path geometry is
 *    pushed to the SVG via inline `d` attribute — appearance, not
 *    React state.
 *
 * Accessibility: `role="meter"` on the wrapper with `aria-valuemin`
 * / `aria-valuemax` / `aria-valuenow`. When `label` is provided,
 * `aria-valuetext` reads `"{formattedValue} {label}"`. The SVG
 * itself has `aria-hidden="true"` because all semantics live on the
 * wrapper.
 *
 * @module components/tugways/tug-arc-gauge
 */

import "./tug-arc-gauge.css";

import React from "react";
import { cn } from "@/lib/utils";
import {
  computeFillRatio,
  effectiveFillRole,
  type GaugeFillRole,
  type GaugeThresholds,
} from "./gauge-math";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Re-exports for source compat with consumers that import from here. */
export type TugArcGaugeFillRole = GaugeFillRole;
export type TugArcGaugeThresholds = GaugeThresholds;

/** Density mode — `compact` for chrome / dashboard, `detailed` for
 *  the full mockup-style face with ticks. */
export type TugArcGaugeDensity = "compact" | "detailed";

/**
 * Arc-shape overrides. Both angles are in degrees, following the SVG
 * convention (0° right, 90° down, 180° left, 270° up). The arc sweeps
 * clockwise from `startAngleDeg` for `sweepAngleDeg` degrees. Defaults
 * to a "C" sweep: `startAngleDeg: 135`, `sweepAngleDeg: 270`.
 */
export interface TugArcGaugeGeometry {
  startAngleDeg: number;
  sweepAngleDeg: number;
}

export interface TugArcGaugeProps
  extends Omit<
    React.ComponentPropsWithoutRef<"div">,
    "role" | "aria-valuemin" | "aria-valuemax" | "aria-valuenow" | "aria-valuetext"
  > {
  /** Current value, in domain units. Out-of-range values clamp into `[min, max]`. */
  value: number;
  /** Domain minimum. */
  min: number;
  /** Domain maximum. Must satisfy `max > min`. */
  max: number;
  /**
   * Optional warning-zone fractions (0..1 relative to `[min, max]`).
   * See {@link GaugeThresholds} for the promotion rules.
   */
  thresholds?: TugArcGaugeThresholds;
  /**
   * Optional label rendered below the readout (compact) or inside the
   * arc beneath the percent text (detailed).
   */
  label?: string;
  /**
   * Optional formatter for the displayed value (and the hi / lo labels
   * in `detailed` density). Defaults to `String(value)`.
   */
  formatValue?: (value: number) => string;
  /** Density mode. Defaults to `compact`. */
  density?: TugArcGaugeDensity;
  /** Base fill role when no threshold is exceeded. Defaults to `default`. */
  fillRole?: "default" | "info" | "success";
  /**
   * Override the default "C" sweep. See {@link TugArcGaugeGeometry}.
   * The default is intentionally an unusual angle (135° / 270°) so an
   * accidentally-omitted geometry prop still produces a sensibly-
   * shaped gauge.
   */
  geometry?: TugArcGaugeGeometry;
}

// ---------------------------------------------------------------------------
// Default geometry — the "C" sweep
// ---------------------------------------------------------------------------

/**
 * Default arc shape: starts at the bottom-left (135°) and sweeps 270°
 * clockwise around to the bottom-right (45°), leaving the bottom 90°
 * of the circle open. The familiar dashboard-dial silhouette.
 */
export const DEFAULT_ARC_GEOMETRY: TugArcGaugeGeometry = {
  startAngleDeg: 135,
  sweepAngleDeg: 270,
};

// ---------------------------------------------------------------------------
// Arc geometry helpers (exported for testing — no DOM, no React)
// ---------------------------------------------------------------------------

/** Polar → cartesian for a unit-circle point at angle `angleDeg`. The
 *  caller scales by radius and translates to the center. */
function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

/**
 * Build the SVG `d` attribute for an arc segment.
 *
 *  - `cx`, `cy`: circle center.
 *  - `radius`: arc radius.
 *  - `startAngleDeg`: where the arc begins (SVG angle convention).
 *  - `sweepAngleDeg`: how many degrees the arc spans (always positive).
 *  - `fillRatio`: 0..1 — how much of the sweep is "filled" (the rest
 *    is empty / belongs to the track path, not this arc).
 *
 * Behavior at the edges:
 *
 *  - `fillRatio === 0` or `sweepAngleDeg === 0` → empty string (no
 *    path geometry; the consumer's `<path d="">` renders nothing).
 *  - Effective sweep (`sweepAngleDeg * fillRatio`) ≥ 360° → a full-
 *    circle path made of two semicircle arcs (a single SVG arc
 *    command cannot draw 360° because start === end and the path
 *    collapses).
 *  - Effective sweep > 180° → `large-arc-flag` = 1; otherwise 0.
 *
 * Throws on negative `sweepAngleDeg` (configuration error).
 */
export function arcPath(
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg: number,
  sweepAngleDeg: number,
  fillRatio: number,
): string {
  if (sweepAngleDeg < 0) {
    throw new Error(
      `tug-arc-gauge: sweepAngleDeg (${sweepAngleDeg}) must be >= 0; negative sweeps are not supported`,
    );
  }
  if (sweepAngleDeg === 0 || fillRatio === 0) {
    return "";
  }
  const effectiveSweep = sweepAngleDeg * fillRatio;
  if (effectiveSweep >= 360) {
    // Full-circle path — split into two semicircles because a single
    // SVG arc command with start === end collapses to nothing.
    const left = polarToCartesian(cx, cy, radius, startAngleDeg);
    const right = polarToCartesian(cx, cy, radius, startAngleDeg + 180);
    return [
      `M${left.x},${left.y}`,
      `A${radius},${radius} 0 1 1 ${right.x},${right.y}`,
      `A${radius},${radius} 0 1 1 ${left.x},${left.y}`,
    ].join(" ");
  }
  const start = polarToCartesian(cx, cy, radius, startAngleDeg);
  const end = polarToCartesian(cx, cy, radius, startAngleDeg + effectiveSweep);
  const largeArcFlag = effectiveSweep > 180 ? 1 : 0;
  return `M${start.x},${start.y} A${radius},${radius} 0 ${largeArcFlag} 1 ${end.x},${end.y}`;
}

// ---------------------------------------------------------------------------
// Tick generation for the detailed density
// ---------------------------------------------------------------------------

/**
 * Default tick configuration for the `detailed` density. Held as a
 * module constant rather than props — we deliberately collapsed the
 * mockup's per-instance tick knobs into sensible density-driven
 * defaults (mirrors {@link TugLinearGauge}'s approach).
 */
const DETAILED_TICK_CONFIG = {
  /** Major ticks across the full sweep, inclusive of both endpoints. */
  majorCount: 11,
  /** Minor ticks between each pair of major ticks. */
  minorBetween: 4,
} as const;

/** Major-tick angle positions across the sweep (inclusive endpoints). */
function detailedMajorAngles(
  startAngleDeg: number,
  sweepAngleDeg: number,
): ReadonlyArray<number> {
  const angles: number[] = [];
  for (let i = 0; i < DETAILED_TICK_CONFIG.majorCount; i++) {
    angles.push(
      startAngleDeg + (sweepAngleDeg * i) / (DETAILED_TICK_CONFIG.majorCount - 1),
    );
  }
  return angles;
}

/** Minor-tick angle positions, evenly spaced between major ticks. */
function detailedMinorAngles(
  startAngleDeg: number,
  sweepAngleDeg: number,
): ReadonlyArray<number> {
  const angles: number[] = [];
  const segments = DETAILED_TICK_CONFIG.majorCount - 1;
  const stepsPerSegment = DETAILED_TICK_CONFIG.minorBetween + 1;
  for (let segment = 0; segment < segments; segment++) {
    for (let step = 1; step <= DETAILED_TICK_CONFIG.minorBetween; step++) {
      const t = (segment + step / stepsPerSegment) / segments;
      angles.push(startAngleDeg + sweepAngleDeg * t);
    }
  }
  return angles;
}

// ---------------------------------------------------------------------------
// SVG viewBox sizing
// ---------------------------------------------------------------------------

/**
 * Viewbox metrics shared between the SVG and the tick / text
 * positioning. The radius is whatever fills the [0..VIEWBOX_SIZE]
 * box minus stroke + tick-outroom padding.
 */
const VIEWBOX_SIZE = 100;
const VIEWBOX_CENTER = VIEWBOX_SIZE / 2;
/** Inner radius (the arc's centerline). Reserves room for the stroke
 *  (which extends ±strokeWidth/2 from the centerline) and for the
 *  outer ticks rendered in the detailed density. */
const ARC_RADIUS_COMPACT = 42;
const ARC_RADIUS_DETAILED = 38;
const TICK_MAJOR_LENGTH = 6;
const TICK_MINOR_LENGTH = 3;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TugArcGauge = React.forwardRef<HTMLDivElement, TugArcGaugeProps>(
  function TugArcGauge(
    {
      value,
      min,
      max,
      thresholds,
      label,
      formatValue,
      density = "compact",
      fillRole = "default",
      geometry,
      className,
      ...rest
    }: TugArcGaugeProps,
    ref,
  ) {
    const { startAngleDeg, sweepAngleDeg } = geometry ?? DEFAULT_ARC_GEOMETRY;
    const ratio = computeFillRatio(value, min, max);
    const role = effectiveFillRole(ratio, fillRole, thresholds);
    const display = formatValue ?? ((v: number) => String(v));
    const valueText = display(value);
    const ariaValueText =
      label !== undefined ? `${valueText} ${label}` : valueText;
    const percentText = `${(ratio * 100).toFixed(1)}%`;

    const radius =
      density === "detailed" ? ARC_RADIUS_DETAILED : ARC_RADIUS_COMPACT;

    const trackD = arcPath(
      VIEWBOX_CENTER,
      VIEWBOX_CENTER,
      radius,
      startAngleDeg,
      sweepAngleDeg,
      1,
    );
    const fillD = arcPath(
      VIEWBOX_CENTER,
      VIEWBOX_CENTER,
      radius,
      startAngleDeg,
      sweepAngleDeg,
      ratio,
    );

    return (
      <div
        ref={ref}
        data-slot="tug-arc-gauge"
        data-density={density}
        data-role={role}
        className={cn("tug-arc-gauge", className)}
        role="meter"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={ariaValueText}
        {...rest}
      >
        <svg
          className="tug-arc-gauge-svg"
          viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
          aria-hidden="true"
        >
          {trackD !== "" ? (
            <path className="tug-arc-gauge-track" d={trackD} />
          ) : null}
          {fillD !== "" ? (
            <path className="tug-arc-gauge-fill" d={fillD} />
          ) : null}
          {density === "detailed" ? (
            <DetailedTicks
              startAngleDeg={startAngleDeg}
              sweepAngleDeg={sweepAngleDeg}
              radius={radius}
            />
          ) : null}
          {density === "detailed" ? (
            <>
              <text
                className="tug-arc-gauge-value-svg"
                x={VIEWBOX_CENTER}
                y={VIEWBOX_CENTER - 2}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {valueText}
              </text>
              <text
                className="tug-arc-gauge-percent-svg"
                x={VIEWBOX_CENTER}
                y={VIEWBOX_CENTER + 10}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {percentText}
              </text>
            </>
          ) : null}
        </svg>
        {density === "compact" ? (
          <div className="tug-arc-gauge-readout">
            <span className="tug-arc-gauge-value">{valueText}</span>
            {label !== undefined ? (
              <span className="tug-arc-gauge-label">{label}</span>
            ) : null}
          </div>
        ) : null}
        {density === "detailed" && label !== undefined ? (
          <span className="tug-arc-gauge-label tug-arc-gauge-label-detailed">
            {label}
          </span>
        ) : null}
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Detailed-density tick rail (rendered inside the SVG)
// ---------------------------------------------------------------------------

interface DetailedTicksProps {
  startAngleDeg: number;
  sweepAngleDeg: number;
  radius: number;
}

const DetailedTicks: React.FC<DetailedTicksProps> = ({
  startAngleDeg,
  sweepAngleDeg,
  radius,
}) => {
  const majors = detailedMajorAngles(startAngleDeg, sweepAngleDeg);
  const minors = detailedMinorAngles(startAngleDeg, sweepAngleDeg);
  return (
    <g className="tug-arc-gauge-ticks">
      {minors.map((angleDeg, i) => {
        const inner = polarToCartesian(
          VIEWBOX_CENTER,
          VIEWBOX_CENTER,
          radius + 2,
          angleDeg,
        );
        const outer = polarToCartesian(
          VIEWBOX_CENTER,
          VIEWBOX_CENTER,
          radius + 2 + TICK_MINOR_LENGTH,
          angleDeg,
        );
        return (
          <line
            key={`minor-${i}`}
            className="tug-arc-gauge-tick-minor"
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
          />
        );
      })}
      {majors.map((angleDeg, i) => {
        const inner = polarToCartesian(
          VIEWBOX_CENTER,
          VIEWBOX_CENTER,
          radius + 2,
          angleDeg,
        );
        const outer = polarToCartesian(
          VIEWBOX_CENTER,
          VIEWBOX_CENTER,
          radius + 2 + TICK_MAJOR_LENGTH,
          angleDeg,
        );
        return (
          <line
            key={`major-${i}`}
            className="tug-arc-gauge-tick-major"
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
          />
        );
      })}
    </g>
  );
};
