/**
 * TugSwitch -- tugways public API for toggle switches.
 *
 * Wraps @radix-ui/react-switch for accessible on/off toggling.
 * All visual states driven by --tug-base-toggle-track-* and --tug-base-toggle-thumb
 * tokens — theme switches update CSS variables with no React re-renders.
 *
 * Features:
 *   - Two states: off, on (checked)
 *   - Inline label with click-to-toggle
 *   - Size variants matching other controls
 *   - Disabled state
 *   - Optional role prop for 7-role color system (D03, D04)
 *
 * [D03] Role color via inline CSS custom property injection
 * [D04] Token-driven control state model
 * [D05] Component token naming: --tug-base-toggle-*, --tug-base-toggle-thumb
 */

import React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
import type { TugBadgeRole } from "@/components/tugways/tug-badge";
import "./tug-switch.css";

// ---- Types ----

/** Switch size names — matches TugCheckbox/TugInput/TugButton sizes */
export type TugSwitchSize = "sm" | "md" | "lg";

/**
 * Role type for TugSwitch — mirrors TugBadgeRole for the 7-role system.
 * Default is "accent" (current accent-orange on-state).
 */
export type TugSwitchRole = TugBadgeRole;

/**
 * Maps role prop values to tone token suffixes.
 * Necessary because the prop API uses "action" but tone tokens use "active"
 * (i.e., --tug-base-tone-active, not --tug-base-tone-action).
 * [D03, Table T04]
 */
const ROLE_TONE_MAP: Record<TugSwitchRole, string> = {
  accent:  "accent",
  action:  "active",
  agent:   "agent",
  data:    "data",
  success: "success",
  caution: "caution",
  danger:  "danger",
};

/**
 * TugSwitch props.
 */
export interface TugSwitchProps {
  /** Controlled checked state. */
  checked?: boolean;
  /** Default checked state (uncontrolled). */
  defaultChecked?: boolean;
  /** Callback when checked state changes. */
  onCheckedChange?: (checked: boolean) => void;
  /** Inline label text. */
  label?: string;
  /** Size variant. Default: "md" */
  size?: TugSwitchSize;
  /** Disabled state. Default: false */
  disabled?: boolean;
  /** Form field name. */
  name?: string;
  /** Form field value. */
  value?: string;
  /** Required for form validation. Default: false */
  required?: boolean;
  /** Additional CSS class names on the wrapper. */
  className?: string;
  /** Accessibility label (when no visible label is provided). */
  "aria-label"?: string;
  /**
   * Color role for the on-state track. Default: "accent".
   * Injects --tug-toggle-on-color and --tug-toggle-on-hover-color via inline
   * CSS custom properties; the CSS falls back to global tokens when not set.
   * [D03, D04, Spec S01]
   */
  role?: TugSwitchRole;
}

// ---- TugSwitch ----

export const TugSwitch = React.forwardRef<HTMLButtonElement, TugSwitchProps>(
  function TugSwitch(
    {
      checked,
      defaultChecked,
      onCheckedChange,
      label,
      size = "md",
      disabled = false,
      name,
      value,
      required = false,
      className,
      "aria-label": ariaLabel,
      role,
    },
    ref,
  ) {
    // Compute inline style and data-role attribute for non-accent roles. [D03, Spec S01]
    const isRoleColored = role !== undefined && role !== "accent";
    const roleStyle: React.CSSProperties | undefined = isRoleColored
      ? ({
          "--tug-toggle-on-color": `var(--tug-base-tone-${ROLE_TONE_MAP[role]})`,
          "--tug-toggle-on-hover-color": `color-mix(in oklch, var(--tug-base-tone-${ROLE_TONE_MAP[role]}), white 15%)`,
        } as React.CSSProperties)
      : undefined;

    const switchNode = (
      <SwitchPrimitive.Root
        ref={ref}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        name={name}
        value={value}
        required={required}
        aria-label={!label ? ariaLabel : undefined}
        className={cn("tug-switch", `tug-switch-size-${size}`)}
        style={roleStyle}
        data-role={isRoleColored ? role : undefined}
      >
        <SwitchPrimitive.Thumb className="tug-switch-thumb" />
      </SwitchPrimitive.Root>
    );

    if (!label) {
      return switchNode;
    }

    return (
      <label
        className={cn(
          "tug-switch-wrapper",
          disabled && "tug-switch-wrapper-disabled",
          className,
        )}
      >
        {switchNode}
        <span className={cn("tug-switch-label", `tug-switch-label-${size}`)}>
          {label}
        </span>
      </label>
    );
  },
);
