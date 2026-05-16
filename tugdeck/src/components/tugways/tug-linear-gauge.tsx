/**
 * TugLinearGauge — horizontal-fill quantity gauge primitive.
 *
 * General-purpose labeled bar that maps a `value` from `[min, max]`
 * into a proportional fill, with optional threshold-based color
 * zones. Stateless presentation surface — the consumer owns
 * `value` and supplies `min` / `max` from its own domain.
 *
 * Two density modes:
 *
 *  - `compact` (default): slim inline strip designed for chrome
 *    surfaces like the tide-card status strip (~20 px tall row,
 *    bar + readout inline, optional inline label).
 *  - `detailed`: stacked face with major / minor ticks above the
 *    bar, percent + value + label centered, hi / lo labels framing
 *    the bar ends. Designed for dashboard / gallery scale.
 *
 * Color role is derived from `value`'s position relative to optional
 * `thresholds`:
 *
 *  - `value` ≥ `thresholds.danger`  → fill paints with `--tugx-gauge-fill-danger-color`
 *  - `value` ≥ `thresholds.caution` → fill paints with `--tugx-gauge-fill-caution-color`
 *  - otherwise                      → fill paints with `--tugx-gauge-fill-{fillRole}-color`
 *
 * The `danger` band is a strict superset of `caution`: when both
 * thresholds are configured and `value` exceeds both, only the
 * `danger` color renders.
 *
 * Laws:
 *  - [L06] appearance via CSS / DOM, not React state. Role is
 *    encoded as a `data-role` attribute on the root; the matching
 *    CSS rule paints the fill via the role's token slot.
 *  - [L17] every `--tugx-gauge-*` slot resolves to a `--tug7-*` or
 *    `--tug-*` base token in one hop (declared in
 *    `tug-linear-gauge.css` `body{}`).
 *  - [L19] component authoring — file pair, module docstring,
 *    `data-slot="tug-linear-gauge"`.
 *  - [L20] component-token sovereignty — owns `--tugx-gauge-*`;
 *    composes no other component's slot tokens. The sibling
 *    `TugArcGauge` ([#step-20-2]) shares the color sub-family
 *    (`fill-{role}-color`, `track-color`, etc.) by reading the same
 *    slot names; geometry slots are namespaced per gauge.
 *  - [L24] structure zone for the React tree; the fill width and
 *    role attribute are appearance — pushed onto the DOM via inline
 *    style + attribute, not React state.
 *
 * Accessibility: `role="meter"` with `aria-valuemin` / `aria-valuemax`
 * / `aria-valuenow`. When `label` is provided, `aria-valuetext` reads
 * `"{formattedValue} {label}"`.
 *
 * @module components/tugways/tug-linear-gauge
 */

import "./tug-linear-gauge.css";

import React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Fill role drives which `--tugx-gauge-fill-{role}-color` token paints
 * the bar. `caution` and `danger` are reserved for threshold-derived
 * states; consumers do not set them directly via `fillRole`. The
 * derivation lives in `effectiveFillRole`.
 */
export type TugLinearGaugeFillRole =
  | "default"
  | "info"
  | "success"
  | "caution"
  | "danger";

/** Density mode — `compact` for chrome strips, `detailed` for full faces. */
export type TugLinearGaugeDensity = "compact" | "detailed";

/**
 * Threshold fractions (0..1, relative to the [min, max] domain). When
 * `value`'s fractional position crosses a threshold, the fill role is
 * promoted to `caution` (then `danger`) regardless of `fillRole`.
 */
export interface TugLinearGaugeThresholds {
  /** Fraction (0..1) above which the fill switches to `caution`. */
  caution?: number;
  /** Fraction (0..1) above which the fill switches to `danger`. */
  danger?: number;
}

export interface TugLinearGaugeProps
  extends Omit<
    React.ComponentPropsWithoutRef<"div">,
    "role" | "aria-valuemin" | "aria-valuemax" | "aria-valuenow" | "aria-valuetext"
  > {
  /** Current value, in domain units. Out-of-range values clamp into [min, max]. */
  value: number;
  /** Domain minimum. */
  min: number;
  /** Domain maximum. Must satisfy `max > min`; otherwise the geometry
   *  helpers throw a configuration error. */
  max: number;
  /**
   * Optional warning-zone fractions. See module docstring for the
   * promotion rules. Omitted thresholds disable that band.
   */
  thresholds?: TugLinearGaugeThresholds;
  /**
   * Optional label rendered alongside the readout. In `compact`
   * density the label sits inline after the value; in `detailed`
   * density it sits below the percent text.
   */
  label?: string;
  /**
   * Optional formatter for the displayed value (and for the hi / lo
   * labels in `detailed` density). Defaults to `String(value)`. For
   * a tokens / context-window display, a consumer would write:
   * `formatValue={(v) => `${(v / 1000).toFixed(1)}k`}`.
   */
  formatValue?: (value: number) => string;
  /** Density mode. Defaults to `compact`. */
  density?: TugLinearGaugeDensity;
  /**
   * Base fill role when no threshold is exceeded. Defaults to
   * `default`. Note: `caution` and `danger` are derived from
   * thresholds — pass them via `thresholds`, not here.
   */
  fillRole?: "default" | "info" | "success";
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing — no DOM, no React)
// ---------------------------------------------------------------------------

/**
 * Validate the domain configuration. `max` must be strictly greater
 * than `min` — equal-or-inverted bounds produce a degenerate gauge
 * (division by zero in the fill ratio) and surface as a silent NaN
 * width unless caught here.
 */
function assertValidDomain(min: number, max: number): void {
  if (!(max > min)) {
    throw new Error(
      `TugLinearGauge: max (${max}) must be strictly greater than min (${min})`,
    );
  }
}

/**
 * Clamp `value` into `[min, max]`. Values outside the domain produce a
 * saturated fill at the corresponding edge rather than a fill that
 * over- or underflows the track visually.
 */
export function clampToDomain(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Compute the fractional fill (0..1) for `value` in `[min, max]`.
 * Out-of-range values clamp. Throws on `max <= min` (configuration
 * error — see {@link assertValidDomain}).
 */
export function computeFillRatio(value: number, min: number, max: number): number {
  assertValidDomain(min, max);
  return (clampToDomain(value, min, max) - min) / (max - min);
}

/**
 * Derive the effective fill role from a fractional position and the
 * caller-supplied base role + thresholds. `danger` strictly supersedes
 * `caution` (both checks evaluate, the higher one wins). Thresholds
 * not in `(0, 1]` are honored as-is — callers can pass `0.001` to mean
 * "always danger" or `1.0` to mean "only at saturation."
 */
export function effectiveFillRole(
  ratio: number,
  baseRole: "default" | "info" | "success",
  thresholds?: TugLinearGaugeThresholds,
): TugLinearGaugeFillRole {
  if (thresholds?.danger !== undefined && ratio >= thresholds.danger) {
    return "danger";
  }
  if (thresholds?.caution !== undefined && ratio >= thresholds.caution) {
    return "caution";
  }
  return baseRole;
}

// ---------------------------------------------------------------------------
// Tick generation for the detailed density
// ---------------------------------------------------------------------------

/**
 * Default tick configuration for the `detailed` density. Held as a
 * module constant rather than props per the [#step-20-1] scope note —
 * we deliberately collapsed the mockup's per-instance tick knobs into
 * sensible density-driven defaults.
 */
const DETAILED_TICK_CONFIG = {
  /** Major ticks across the full track, inclusive of both endpoints. */
  majorCount: 11,
  /** Minor ticks between each pair of major ticks. */
  minorBetween: 4,
} as const;

/** Major-tick positions as fractions of the track width (0..1). */
function detailedMajorPositions(): ReadonlyArray<number> {
  const positions: number[] = [];
  for (let i = 0; i < DETAILED_TICK_CONFIG.majorCount; i++) {
    positions.push(i / (DETAILED_TICK_CONFIG.majorCount - 1));
  }
  return positions;
}

/** Minor-tick positions as fractions of the track width (0..1). */
function detailedMinorPositions(): ReadonlyArray<number> {
  const positions: number[] = [];
  const segments = DETAILED_TICK_CONFIG.majorCount - 1;
  const stepsPerSegment = DETAILED_TICK_CONFIG.minorBetween + 1;
  for (let segment = 0; segment < segments; segment++) {
    for (let step = 1; step <= DETAILED_TICK_CONFIG.minorBetween; step++) {
      positions.push((segment + step / stepsPerSegment) / segments);
    }
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TugLinearGauge = React.forwardRef<
  HTMLDivElement,
  TugLinearGaugeProps
>(function TugLinearGauge(
  {
    value,
    min,
    max,
    thresholds,
    label,
    formatValue,
    density = "compact",
    fillRole = "default",
    className,
    ...rest
  }: TugLinearGaugeProps,
  ref,
) {
  const ratio = computeFillRatio(value, min, max);
  const role = effectiveFillRole(ratio, fillRole, thresholds);
  const display = formatValue ?? ((v: number) => String(v));
  const valueText = display(value);
  const ariaValueText = label !== undefined ? `${valueText} ${label}` : valueText;
  const percentText = `${(ratio * 100).toFixed(1)}%`;

  // Layout-stability contract: reserve enough horizontal space for
  // the longest formatted bound. Combined with `font-variant-numeric:
  // tabular-nums` (in the stylesheet) and a right-aligned `text-align`,
  // this keeps the bar's flex-grown width constant across value
  // changes — without this the readout's natural width oscillates per
  // character count and the bar visibly shifts. Consumers passing
  // fractional intermediate values (slider sweeps producing
  // non-integer ticks against an integer-default formatter) should
  // supply a fixed-precision `formatValue` to extend this guarantee
  // to those values too.
  const valueMinChars = Math.max(display(min).length, display(max).length);
  const valueStyle: React.CSSProperties = {
    minWidth: `${valueMinChars}ch`,
    textAlign: "right",
  };

  return (
    <div
      ref={ref}
      data-slot="tug-linear-gauge"
      data-density={density}
      data-role={role}
      className={cn("tug-linear-gauge", className)}
      role="meter"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={ariaValueText}
      {...rest}
    >
      {density === "detailed" ? (
        <DetailedTicks />
      ) : null}
      <div className="tug-linear-gauge-track">
        <div
          className="tug-linear-gauge-fill"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      {density === "detailed" ? (
        <div className="tug-linear-gauge-hilo">
          <span className="tug-linear-gauge-lo">{display(min)}</span>
          <span className="tug-linear-gauge-hi">{display(max)}</span>
        </div>
      ) : null}
      <div className="tug-linear-gauge-readout">
        <span className="tug-linear-gauge-value" style={valueStyle}>
          {valueText}
        </span>
        {density === "detailed" ? (
          <span className="tug-linear-gauge-percent">{percentText}</span>
        ) : null}
        {label !== undefined ? (
          <span className="tug-linear-gauge-label">{label}</span>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Detailed-density tick rail. Module-private — emitted only when the
 * primitive is rendered with `density="detailed"`. Tick positions are
 * deterministic (no props), so the rail is memoized as a constant
 * subtree to keep re-renders trivial.
 */
const DetailedTicks: React.FC = () => {
  const majors = detailedMajorPositions();
  const minors = detailedMinorPositions();
  return (
    <div className="tug-linear-gauge-ticks" aria-hidden="true">
      {minors.map((pos, i) => (
        <span
          key={`minor-${i}`}
          className="tug-linear-gauge-tick-minor"
          style={{ left: `${pos * 100}%` }}
        />
      ))}
      {majors.map((pos, i) => (
        <span
          key={`major-${i}`}
          className="tug-linear-gauge-tick-major"
          style={{ left: `${pos * 100}%` }}
        />
      ))}
    </div>
  );
};
