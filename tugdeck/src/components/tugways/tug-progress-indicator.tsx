/**
 * TugProgressIndicator — Unified indicator for indeterminate progress, phase,
 * and determinate progress.
 *
 * Six visual variants live behind one prop surface:
 *
 *   ring          — stroked SVG arc (determinate or indeterminate rotating)
 *   bar           — horizontal track + fill (determinate or barber-pole)
 *   pie           — conic-gradient wedge (determinate or rotating)
 *   spinner       — single-arc rotor
 *   pulsing-dot   — dot + WAAPI pulsing ring (replaces TugStateIndicator)
 *   wave          — three-bar staggered pulse (replaces TugThinkingIndicator)
 *
 * The component is a compound dispatch [L20]: it owns role-color injection,
 * effective-state resolution (explicit props × phaseVisual), label layout,
 * ARIA progressbar semantics, and the TugBox disabled cascade. The internal
 * variant component owns the glyph itself and its animation.
 *
 * Five states cover every variant's lifecycle:
 *
 *   running       — animated (the canonical indeterminate / in-flight pose)
 *   paused        — animation frozen mid-pose (animation-play-state: paused)
 *   stopped       — quiescent rest pose, no animation (outlined ring,
 *                   empty bar, dot without ring, static bars)
 *   completed     — finished pose, no animation (closed filled ring, full
 *                   bar, large solid dot, peak-pose bars)
 *   aborted       — canceled/halted pose, danger-tinted, no animation
 *                   (subsumes the old `errored` and `interruptInFlight`
 *                   treatments)
 *
 * `disabled` is a state per the seven-slot convention [T-classification]:
 *  it dims and freezes any variant, independent of `state`.
 *
 * **State implies role.** When no explicit `role` is passed (and no
 * `phaseVisual` returns one), the effective role defaults from the
 * effective state via {@link defaultRoleForState}:
 *
 *   running   → action   (blue — work in flight)
 *   paused    → caution  (yellow — held)
 *   stopped   → inherit  (muted — quiescent)
 *   completed → success  (green — finished)
 *   aborted   → danger   (red — canceled / errored)
 *
 * This is a deliberate conflation: state IS visually paired with a
 * role in nearly every callsite, and the default removes a repetitive
 * `role={statusToRole(state)}` mapping that every consumer would
 * otherwise re-derive. The explicit `role` prop still wins for the
 * cases that need to override (e.g. `restoring → caution + running`).
 *
 * Phase API (replaces TugStateIndicator's CodeSession-aware reducer):
 *
 *   phase         — caller-defined identifier emitted as data-phase
 *   phaseLabels   — phase → human-readable label map; doubles as the
 *                   width-stabilize set for labelAlign="center"
 *   phaseVisual   — phase → partial { role, state }; explicit role/state
 *                   props win over phaseVisual returns
 *
 * Layout:
 *   glyphPosition — left | right | both (paired mirrored glyphs)
 *   labelAlign    — start (default) | center (reserves the widest
 *                   phaseLabels entry's width via CSS grid stack)
 *   labelPosition — inline | tooltip (suppress inline label; surface in
 *                   a hover tooltip)
 *
 * Laws: [L02] state arrives via props from the consumer's external store;
 *       [L06] appearance via CSS / DOM attributes, never React state;
 *       [L13] motion runs through CSS keyframes (ring/bar/pie/spinner)
 *             or TugAnimator (pulsing-dot/wave) per the internal variant;
 *       [L15] token-driven states;
 *       [L16] pairings declared in CSS;
 *       [L19] component authoring guide;
 *       [L20] token sovereignty — internal variants own their glyph; the
 *             public component owns role-color injection and layout.
 *
 * @module components/tugways/tug-progress-indicator
 */

import "./tug-progress-indicator.css";

import React from "react";

import { cn } from "@/lib/utils";
import { TugTooltip } from "@/components/tugways/tug-tooltip";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { TugProgressRing } from "./internal/tug-progress-ring";
import { TugProgressBar } from "./internal/tug-progress-bar";
import { TugProgressPie } from "./internal/tug-progress-pie";
import { TugProgressSpinner } from "./internal/tug-progress-spinner";
import { TugProgressPulsingDot } from "./internal/tug-progress-pulsing-dot";
import { TugProgressWave } from "./internal/tug-progress-wave";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TugProgressIndicatorVariant =
  | "ring"
  | "bar"
  | "pie"
  | "spinner"
  | "pulsing-dot"
  | "wave";

/**
 * Semantic role. `inherit` resolves the indicator fill to `currentColor` so
 * the glyph picks up its host's text tone — useful in muted prose contexts
 * where the indicator should read as part of the surrounding copy rather
 * than as a separate accent.
 */
export type TugProgressIndicatorRole =
  | "inherit"
  | "action"
  | "agent"
  | "data"
  | "option"
  | "success"
  | "caution"
  | "danger";

export type TugProgressIndicatorState =
  | "running"
  | "paused"
  | "stopped"
  | "completed"
  | "aborted";

export type TugProgressIndicatorGlyphPosition = "left" | "right" | "both";

export type TugProgressIndicatorLabelPosition = "inline" | "tooltip";

export type TugProgressIndicatorLabelAlign = "start" | "center";

/**
 * Partial visual returned by {@link TugProgressIndicatorProps.phaseVisual}.
 * Explicit `role` / `state` props on the indicator always win over fields
 * returned here.
 */
export interface TugProgressIndicatorPhaseVisual {
  readonly role?: TugProgressIndicatorRole;
  readonly state?: TugProgressIndicatorState;
}

/**
 * Default {@link TugProgressIndicatorProps.formatValue} — a whole-number
 * percentage of `max`, e.g. `0.42 → "42%"`. Exported so consumers can reuse
 * the canonical format (and so it is unit-testable on its own).
 */
export function defaultProgressValueLabel(value: number, max: number): string {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return `${Math.round(pct)}%`;
}

// ---------------------------------------------------------------------------
// Role → token resolution
// ---------------------------------------------------------------------------

/**
 * Aliases the public role name to the suffix used in the seven-slot token
 * names. `action` resolves to `active` — matches the convention TugProgress
 * established and that `TugLabel` already mirrors so role names line up
 * across primitives.
 */
const ROLE_TO_TOKEN_SUFFIX: Record<Exclude<TugProgressIndicatorRole, "inherit">, string> = {
  action: "active",
  agent: "agent",
  data: "data",
  option: "option",
  success: "success",
  caution: "caution",
  danger: "danger",
};

/**
 * All variants resolve their fill from the same token family —
 * `--tug7-surface-toggle-primary-normal-{role}-rest` — so the role
 * tone reads identically across ring/bar/pie/spinner/pulsing-dot/
 * wave. This is the same family used for any control-surface tone
 * elsewhere in the system; switching to it makes the indicator's
 * blue match every other "active" control's blue at a glance.
 */
function buildFillStyle(
  _variant: TugProgressIndicatorVariant,
  role: TugProgressIndicatorRole,
): React.CSSProperties {
  if (role === "inherit") {
    return { "--tugx-progress-indicator-fill": "currentColor" } as React.CSSProperties;
  }
  const suffix = ROLE_TO_TOKEN_SUFFIX[role];
  return {
    "--tugx-progress-indicator-fill": `var(--tug7-surface-toggle-primary-normal-${suffix}-rest)`,
  } as React.CSSProperties;
}

/**
 * Default role for a given effective state. The state×role pairing is
 * the design system's standard mapping; callsites that don't want to
 * override simply pass `state` and the role falls out automatically.
 *
 *   running   → action   (blue — work in flight)
 *   paused    → caution  (yellow — held)
 *   stopped   → inherit  (muted — quiescent)
 *   completed → success  (green — finished)
 *   aborted   → danger   (red — canceled / errored)
 */
function defaultRoleForState(state: TugProgressIndicatorState): TugProgressIndicatorRole {
  switch (state) {
    case "running":
      return "action";
    case "paused":
      return "caution";
    case "completed":
      return "success";
    case "aborted":
      return "danger";
    case "stopped":
    default:
      return "inherit";
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TugProgressIndicatorProps
  extends Omit<React.ComponentPropsWithoutRef<"span">, "role" | "children"> {
  /**
   * Visual treatment.
   * @selector [data-variant="ring"] | [data-variant="bar"] | [data-variant="pie"] | [data-variant="spinner"] | [data-variant="pulsing-dot"] | [data-variant="wave"]
   * @default "ring"
   */
  variant?: TugProgressIndicatorVariant;

  /**
   * Semantic role tone. `inherit` resolves the fill to `currentColor`.
   * Omit for the theme's default accent tone (per-variant).
   * @selector [data-role="<role>"]
   */
  role?: TugProgressIndicatorRole;

  /**
   * Lifecycle state. `running` animates the variant's canonical
   * indeterminate motion; the other four states paint a static pose.
   * `aborted` always renders in the danger tone regardless of `role`.
   * @selector [data-state="running"] | [data-state="paused"] | [data-state="stopped"] | [data-state="completed"] | [data-state="aborted"]
   * @default "running"
   */
  state?: TugProgressIndicatorState;

  /**
   * Disables the indicator (dims + freezes motion). Also driven by the
   * TugBox disabled cascade.
   * @selector [data-disabled]
   * @default false
   */
  disabled?: boolean;

  /**
   * Determinate progress value, 0 to `max`. Only honored by `ring`, `bar`,
   * and `pie` — other variants ignore. When undefined, the variant runs
   * its indeterminate motion (driven by `state`).
   */
  value?: number;

  /**
   * Maximum value for determinate progress.
   * @default 1
   */
  max?: number;

  /**
   * Show the determinate value as a text readout alongside the glyph. Only
   * meaningful when `value` is set (determinate); ignored otherwise. The
   * readout sits at the trailing end of the row — for the `bar` variant the
   * track flexes and the readout sits to its right (the canonical labeled-
   * bar layout); for `ring` / `pie` it trails the glyph. Formatted by
   * {@link formatValue}.
   * @selector [data-slot="tug-progress-indicator"] .tug-progress-indicator-value
   * @default false
   */
  showValue?: boolean;

  /**
   * Formatter for the {@link showValue} readout. Receives the current
   * `value` and `max`; defaults to a whole-number percentage
   * ({@link defaultProgressValueLabel}, e.g. `42%`).
   */
  formatValue?: (value: number, max: number) => string;

  /**
   * Geometric size in CSS px. Applied as `--tugx-progress-indicator-size`.
   * @default 16
   */
  size?: number;

  /**
   * Caller-defined phase identifier. Emitted as `data-phase` on the root
   * and used by `phaseVisual` / `phaseLabels` to look up presentation.
   * @selector [data-phase="<phase>"]
   */
  phase?: string;

  /**
   * Phase → human-readable label map. The active phase's entry is used
   * for the visible label / tooltip when `label` is omitted; the entire
   * map drives the width-stabilize behavior for `labelAlign="center"`.
   */
  phaseLabels?: Record<string, string>;

  /**
   * Phase → partial visual ({@link TugProgressIndicatorPhaseVisual}).
   * Returned `role` / `state` fields are defaults — explicit `role` /
   * `state` props on the indicator override them.
   */
  phaseVisual?: (phase: string) => TugProgressIndicatorPhaseVisual;

  /**
   * Visible label text. Overrides `phaseLabels[phase]`. When omitted and
   * a phase is set, the label resolves to `phaseLabels[phase]`.
   */
  label?: string;

  /**
   * Where to render the visible label.
   *   inline   — render alongside the glyph(s)
   *   tooltip  — suppress inline; surface in a hover tooltip
   * @selector [data-label-position="inline"] | [data-label-position="tooltip"]
   * @default "inline"
   */
  labelPosition?: TugProgressIndicatorLabelPosition;

  /**
   * Label alignment within its layout slot. `center` activates the
   * width-stabilize behavior — every `phaseLabels` entry is rendered as
   * a hidden ghost in the same grid cell as the live label, so the cell
   * sizes to the widest entry and the live label centers within it.
   * @selector [data-label-align="start"] | [data-label-align="center"]
   * @default "start"
   */
  labelAlign?: TugProgressIndicatorLabelAlign;

  /**
   * Glyph layout. `both` renders two synchronized glyphs bracketing the
   * label.
   * @selector [data-glyph-position="left"] | [data-glyph-position="right"] | [data-glyph-position="both"]
   * @default "left"
   */
  glyphPosition?: TugProgressIndicatorGlyphPosition;

  /** Accessible label when no visible label is set. */
  "aria-label"?: string;
}

// ---------------------------------------------------------------------------
// Glyph dispatch
// ---------------------------------------------------------------------------

interface GlyphProps {
  variant: TugProgressIndicatorVariant;
  state: TugProgressIndicatorState;
  disabled: boolean;
  value?: number;
  max: number;
  size: number;
}

function renderGlyph({ variant, state, disabled, value, max, size }: GlyphProps): React.ReactElement {
  switch (variant) {
    case "ring":
      return <TugProgressRing value={value} max={max} size={size} state={state} disabled={disabled} />;
    case "bar":
      return <TugProgressBar value={value} max={max} size={size} state={state} disabled={disabled} />;
    case "pie":
      return <TugProgressPie value={value} max={max} size={size} state={state} disabled={disabled} />;
    case "spinner":
      return <TugProgressSpinner size={size} state={state} disabled={disabled} />;
    case "pulsing-dot":
      return <TugProgressPulsingDot size={size} state={state} disabled={disabled} />;
    case "wave":
      return <TugProgressWave size={size} state={state} disabled={disabled} />;
  }
}

// ---------------------------------------------------------------------------
// TugProgressIndicator
// ---------------------------------------------------------------------------

export const TugProgressIndicator = React.forwardRef<HTMLSpanElement, TugProgressIndicatorProps>(
  function TugProgressIndicator(
    {
      variant = "ring",
      role,
      state,
      disabled = false,
      value,
      max = 1,
      showValue = false,
      formatValue = defaultProgressValueLabel,
      size = 16,
      phase,
      phaseLabels,
      phaseVisual,
      label,
      labelPosition = "inline",
      labelAlign = "start",
      glyphPosition = "left",
      className,
      style,
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Resolve state first (explicit > phaseVisual > default), then role
    // (explicit > phaseVisual > default-from-state). State implies role
    // by default — see `defaultRoleForState`.
    const phaseDerived =
      phase !== undefined && phaseVisual !== undefined ? phaseVisual(phase) : undefined;
    const effectiveState: TugProgressIndicatorState =
      state ?? phaseDerived?.state ?? "running";
    const effectiveRole: TugProgressIndicatorRole =
      role ?? phaseDerived?.role ?? defaultRoleForState(effectiveState);

    // Visible label text: explicit label wins; otherwise the phase's entry.
    const visibleLabel =
      label !== undefined
        ? label
        : phase !== undefined && phaseLabels !== undefined
          ? phaseLabels[phase]
          : undefined;

    const isDeterminate = value !== undefined;

    const ariaProps: Record<string, string | number | undefined> = {
      "aria-valuenow": isDeterminate ? Math.round((value / max) * 100) : undefined,
      "aria-valuemin": isDeterminate ? 0 : undefined,
      "aria-valuemax": isDeterminate ? 100 : undefined,
    };

    const fillStyle = buildFillStyle(variant, effectiveRole);

    const rootStyle: React.CSSProperties = {
      ...fillStyle,
      ["--tugx-progress-indicator-size" as string]: `${size}px`,
      ...style,
    };

    const glyphProps: GlyphProps = {
      variant,
      state: effectiveState,
      disabled: effectiveDisabled,
      value,
      max,
      size,
    };

    const leftGlyph = glyphPosition !== "right" ? renderGlyph(glyphProps) : null;
    const rightGlyph = glyphPosition !== "left" ? renderGlyph(glyphProps) : null;

    const showInlineLabel = labelPosition === "inline" && visibleLabel !== undefined;
    const isCenterAligned = labelAlign === "center";

    // Center-with-longest-phase: render every phaseLabels entry as a hidden
    // ghost in the same grid cell as the live label. The cell sizes to the
    // widest entry; the live label centers within it. CSS-only — no
    // measure-and-set effect [L06].
    const labelSlot = showInlineLabel ? (
      <span
        className={cn(
          "tug-progress-indicator-label",
          isCenterAligned && "tug-progress-indicator-label-center",
        )}
      >
        {isCenterAligned && phaseLabels !== undefined && (
          <>
            {Object.entries(phaseLabels).map(([key, text]) => (
              <span
                key={key}
                className="tug-progress-indicator-label-ghost"
                aria-hidden="true"
              >
                {text}
              </span>
            ))}
          </>
        )}
        <span className="tug-progress-indicator-label-active">{visibleLabel}</span>
      </span>
    ) : null;

    // Determinate value readout. The `progressbar` role already exposes the
    // value via `aria-valuenow`, so the visible text is decorative
    // (`aria-hidden`) to avoid a double announcement. For the `bar` variant
    // the track flexes and this trails it on the same row [L06].
    const valueText =
      showValue && value !== undefined ? formatValue(value, max) : undefined;
    const valueSlot =
      valueText !== undefined ? (
        <span className="tug-progress-indicator-value" aria-hidden="true">
          {valueText}
        </span>
      ) : null;

    const root = (
      <span
        ref={ref}
        data-slot="tug-progress-indicator"
        data-variant={variant}
        data-role={effectiveRole}
        data-state={effectiveState}
        data-disabled={effectiveDisabled || undefined}
        data-phase={phase}
        data-label-position={labelPosition}
        data-label-align={labelAlign}
        data-glyph-position={glyphPosition}
        role="progressbar"
        aria-label={ariaLabel ?? visibleLabel ?? phase}
        className={cn("tug-progress-indicator", className)}
        style={rootStyle}
        {...ariaProps}
        {...rest}
      >
        {leftGlyph && <span className="tug-progress-indicator-glyph">{leftGlyph}</span>}
        {labelSlot}
        {rightGlyph && <span className="tug-progress-indicator-glyph">{rightGlyph}</span>}
        {valueSlot}
      </span>
    );

    // Tooltip mode: wrap the bare root in a TugTooltip carrying the label
    // text. Suppressed when no label text is available.
    if (labelPosition === "tooltip" && visibleLabel !== undefined) {
      return (
        <TugTooltip content={visibleLabel} side="top">
          {root}
        </TugTooltip>
      );
    }
    return root;
  },
);
