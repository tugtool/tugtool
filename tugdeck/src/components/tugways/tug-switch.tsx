/**
 * TugSwitch — Toggle switch with track and thumb.
 *
 * Wraps @radix-ui/react-switch. Supports size variants, inline label,
 * disabled state, and role-based color injection via CSS custom properties.
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D03] appearance via stylesheet injection, [D05] component token naming,
 *            [D06] components/tugways public API
 */

import "./tug-switch.css";

import React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

// ---- Types ----

/** Switch size names — matches TugCheckbox/TugInput/TugButton sizes */
export type TugSwitchSize = "sm" | "md" | "lg";

/**
 * Semantic role for the switch on-state color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 *
 * @selector [data-role="<role>"]
 */
export type TugSwitchRole =
  | "option"
  | "action"
  | "agent"
  | "data"
  | "success"
  | "caution"
  | "danger";

/**
 * Maps role prop values to toggle-track token suffixes.
 * The prop API uses "action" but the token system uses "active"
 * (e.g., --tug7-surface-toggle-track-normal-active-rest).
 * "accent" is not in this map — it's the implicit default when no role is provided.
 */
const ROLE_TOKEN_MAP: Record<string, string> = {
  option:  "option",
  action:  "active",
  agent:   "agent",
  data:    "data",
  success: "success",
  caution: "caution",
  danger:  "danger",
};

/** TugSwitch props. */
export interface TugSwitchProps {
  /**
   * Controlled checked state.
   * @selector [data-state="checked"] | [data-state="unchecked"]
   */
  checked?: boolean;
  /** Default checked state (uncontrolled). */
  defaultChecked?: boolean;
  /** Callback when checked state changes. */
  onCheckedChange?: (checked: boolean) => void;
  /** Inline label text. Renders a wrapping label element. */
  label?: string;
  /**
   * Visual size variant.
   * @selector .tug-switch-size-sm | .tug-switch-size-md | .tug-switch-size-lg
   * @default "md"
   */
  size?: TugSwitchSize;
  /**
   * Disables the switch.
   * @selector :disabled | [data-disabled]
   * @default false
   */
  disabled?: boolean;
  /** Form field name. */
  name?: string;
  /** Form field value. */
  value?: string;
  /**
   * Marks the field as required for form validation.
   * @default false
   */
  required?: boolean;
  /** Additional CSS class names on the wrapper element. */
  className?: string;
  /** Accessibility label when no visible label is provided. */
  "aria-label"?: string;
  /**
   * Semantic role for the on-state track color. Omit for the theme's accent color.
   * Injects --tugx-toggle-on-color, --tugx-toggle-on-hover-color, and
   * --tugx-toggle-disabled-color as inline CSS custom properties.
   *
   * Single path, zero branches. [L06]
   *
   * @selector [data-role="<role>"]
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
    // Role injection — every path injects surface-toggle-track tokens. [L06]
    // No role prop = accent. Single path, zero branches.
    const tokenSuffix = role ? (ROLE_TOKEN_MAP[role] ?? role) : "accent";
    const roleStyle = {
      "--tugx-toggle-on-color": `var(--tug7-surface-toggle-track-normal-${tokenSuffix}-rest)`,
      "--tugx-toggle-on-hover-color": `var(--tug7-surface-toggle-track-normal-${tokenSuffix}-hover)`,
      "--tugx-toggle-disabled-color": `var(--tug7-surface-toggle-track-normal-${tokenSuffix}-disabled)`,
    } as React.CSSProperties;
    const dataRole = role;

    const switchNode = (
      <SwitchPrimitive.Root
        ref={ref}
        data-slot="tug-switch"
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
