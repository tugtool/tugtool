/**
 * TugSwitch -- tugways public API for toggle switches.
 *
 * Wraps @radix-ui/react-switch for accessible on/off toggling.
 * All visual states driven by --tug-toggle-track-* and --tug-element-toggle-thumb-normal-plain-rest
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
 * [D05] Component token naming: --tug-toggle-*, --tug-element-toggle-thumb-normal-plain-rest
 */

import React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
import "./tug-switch.css";

// ---- Types ----

/** Switch size names — matches TugCheckbox/TugInput/TugButton sizes */
export type TugSwitchSize = "sm" | "md" | "lg";

/**
 * Role type for TugSwitch.
 *
 * Defined independently from TugBadgeRole to avoid coupling the switch
 * role system to the badge role system. Includes "option" alongside the
 * existing 7 badge roles. Default is "option" (neutral/achromatic on-state).
 *
 * [D06] TugCheckbox and TugSwitch default to role='option'
 */
export type TugSwitchRole =
  | "option"
  | "accent"
  | "action"
  | "agent"
  | "data"
  | "success"
  | "caution"
  | "danger";

/**
 * Maps non-option, non-accent role prop values to tone token suffixes.
 * Necessary because the prop API uses "action" but tone tokens use "active"
 * (i.e., --tug-element-tone-fill-normal-active-rest, not --tug-tone-action).
 * [D03, Table T04]
 */
const ROLE_TONE_MAP: Record<string, string> = {
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
   * Color role for the on-state track. Default: "option".
   * Injects --tug-toggle-on-color and --tug-toggle-on-hover-color via inline
   * CSS custom properties; the CSS falls back to global tokens when not set.
   *
   * "option" uses --tug-element-global-text-normal-muted-rest directly (neutral/achromatic — no signal
   * hue chroma) rather than a --tug-tone-* token. This provides calm
   * configuration-control styling appropriate for switches. [D06]
   *
   * "accent" suppresses injection entirely and falls back to the CSS default
   * (accent-orange on-state token). All other roles inject a tone token.
   * [D03, D04, D06, Spec S01]
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
      role = "option",
    },
    ref,
  ) {
    // Three-branch role injection logic. [D03, D06, Spec S01]
    //
    // Branch 1 — "option": inject fg-muted directly (neutral/achromatic).
    //   The option role does not map to any --tug-tone-* token; it uses
    //   --tug-element-global-text-normal-muted-rest for a calm, unchromatic on-state color. [D06]
    //
    // Branch 2 — other non-accent roles (action/agent/data/success/caution/danger):
    //   inject the corresponding --tug-tone-* token via ROLE_TONE_MAP.
    //
    // Branch 3 — "accent" (explicit): no injection; accent is the CSS-default
    //   fallback and does not need inline style override.
    let roleStyle: React.CSSProperties | undefined;
    let dataRole: string | undefined;

    if (role === "option") {
      roleStyle = {
        "--tug-toggle-on-color": "var(--tug-element-global-text-normal-muted-rest)",
        "--tug-toggle-on-hover-color": "var(--tug-element-global-text-normal-subtle-rest)",
      } as React.CSSProperties;
      dataRole = "option";
    } else if (role !== "accent" && ROLE_TONE_MAP[role] !== undefined) {
      const toneSuffix = ROLE_TONE_MAP[role];
      roleStyle = {
        "--tug-toggle-on-color": `var(--tug-element-tone-fill-normal-${toneSuffix}-rest)`,
        "--tug-toggle-on-hover-color": `color-mix(in oklch, var(--tug-element-tone-fill-normal-${toneSuffix}-rest), white 15%)`,
      } as React.CSSProperties;
      dataRole = role;
    }
    // else: role === "accent" — no injection, CSS default applies.

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
        data-role={dataRole}
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
