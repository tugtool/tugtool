/**
 * TugProgress — Unified progress indicator with pluggable visual treatments.
 *
 * Compound composition [L20]: dispatches to internal variant components
 * (TugProgressSpinner, TugProgressBar, TugProgressRing) based on the variant
 * prop. Owns mode logic (indeterminate vs. determinate via value prop), label
 * rendering, ARIA progressbar semantics, and role color injection. Internal
 * variants own their visual rendering and animations.
 *
 * Laws: [L06] appearance via CSS, [L13] animations via CSS keyframes,
 *       [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide, [L20] token sovereignty
 */

import "./tug-progress.css";

import React from "react";
import { cn } from "@/lib/utils";
import { TugProgressSpinner } from "./internal/tug-progress-spinner";
import { TugProgressBar } from "./internal/tug-progress-bar";
import { TugProgressRing } from "./internal/tug-progress-ring";
import { TugProgressPie } from "./internal/tug-progress-pie";
import { useTugBoxDisabled } from "./internal/tug-box-context";

// ---- Types ----

/** Visual treatment for TugProgress. */
export type TugProgressVariant = "spinner" | "bar" | "ring" | "pie";

/** Size variant for TugProgress. */
export type TugProgressSize = "sm" | "md" | "lg";

/**
 * Semantic role for the progress fill / spinner / ring color.
 * Same union as other role-injected controls, but defined locally —
 * TugProgress is not a group-family component and should not import
 * from tug-group-utils.
 *
 * NOTE: If this role union continues to duplicate across components,
 * consider extracting to a shared location (e.g., internal/tug-roles.ts).
 */
export type TugProgressRole =
  | "option" | "action" | "agent" | "data"
  | "success" | "caution" | "danger";

// ---- Role injection ----

const ROLE_TOKEN_MAP: Record<string, string> = {
  option: "option",
  action: "active",
  agent: "agent",
  data: "data",
  success: "success",
  caution: "caution",
  danger: "danger",
};

function buildProgressRoleStyle(role?: TugProgressRole): React.CSSProperties {
  const suffix = role ? (ROLE_TOKEN_MAP[role] ?? role) : "accent";
  return {
    "--tugx-progress-fill": `var(--tug7-surface-toggle-primary-normal-${suffix}-rest)`,
  } as React.CSSProperties;
}

// ---- Props ----

export interface TugProgressProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "role" | "children"> {
  /**
   * Visual treatment.
   * @selector .tug-progress-variant-spinner | .tug-progress-variant-bar | .tug-progress-variant-ring | .tug-progress-variant-pie
   * @default "spinner"
   */
  variant?: TugProgressVariant;

  /**
   * Progress value, 0 to max. When undefined, the indicator is indeterminate.
   * When a number, the indicator shows determinate progress.
   * The transition from undefined → number triggers the indeterminate-to-determinate
   * visual crossfade.
   */
  value?: number;

  /**
   * Maximum value. Progress fraction = value / max.
   * @default 1
   */
  max?: number;

  /**
   * Size variant. Controls dimensions of the spinner or bar height.
   * @selector .tug-progress-sm | .tug-progress-md | .tug-progress-lg
   * @default "md"
   */
  size?: TugProgressSize;

  /**
   * Label text. Shown above the bar or beside the spinner/ring.
   * Can include dynamic text: "Uploading 3 of 10 files", "47%", etc.
   * The component does NOT auto-format value as percentage — the caller
   * controls the label text entirely.
   */
  label?: string;

  /**
   * Semantic role color for the progress fill / spinner color.
   * Omit for the theme's accent color.
   * @selector [data-role="<role>"]
   */
  role?: TugProgressRole;

  /**
   * Disables the progress indicator. Animations freeze,
   * colors dim. Also driven by TugBox disabled cascade.
   * @selector [data-disabled]
   * @default false
   */
  disabled?: boolean;

  /** Accessible label when no visible label. */
  "aria-label"?: string;
}

// ---- TugProgress ----

export const TugProgress = React.forwardRef<HTMLDivElement, TugProgressProps>(
  function TugProgress({
    variant = "spinner",
    value,
    max = 1,
    size = "md",
    label,
    role,
    disabled = false,
    className,
    style,
    "aria-label": ariaLabel,
    ...rest
  }, ref) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;
    const isDeterminate = value !== undefined;

    const roleStyle = buildProgressRoleStyle(role);

    // ARIA: progressbar with conditional value attributes
    const ariaProps: Record<string, string | number | undefined> = {
      "aria-valuenow": isDeterminate ? Math.round((value / max) * 100) : undefined,
      "aria-valuemin": isDeterminate ? 0 : undefined,
      "aria-valuemax": isDeterminate ? 100 : undefined,
    };

    // Render the internal variant
    const control = (() => {
      switch (variant) {
        case "bar":
          return <TugProgressBar value={value} max={max} size={size} disabled={effectiveDisabled} />;
        case "ring":
          return <TugProgressRing value={value} max={max} size={size} disabled={effectiveDisabled} />;
        case "pie":
          return <TugProgressPie value={value} max={max} size={size} disabled={effectiveDisabled} />;
        case "spinner":
        default:
          return <TugProgressSpinner size={size} disabled={effectiveDisabled} />;
      }
    })();

    return (
      <div
        ref={ref}
        data-slot="tug-progress"
        role="progressbar"
        aria-label={ariaLabel ?? label}
        data-role={role}
        data-disabled={effectiveDisabled || undefined}
        className={cn(
          "tug-progress",
          `tug-progress-variant-${variant}`,
          `tug-progress-${size}`,
          effectiveDisabled && "tug-progress-disabled",
          className,
        )}
        style={{ ...roleStyle, ...style }}
        {...ariaProps}
        {...rest}
      >
        {/* Bar layout: label above, control below */}
        {variant === "bar" && label && (
          <span className="tug-progress-label">{label}</span>
        )}

        <span className="tug-progress-control">
          {control}
        </span>

        {/* Spinner/ring layout: control left, label right */}
        {variant !== "bar" && label && (
          <span className="tug-progress-label">{label}</span>
        )}
      </div>
    );
  },
);
