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
 * "option" uses a neutral/achromatic token for calm configuration-control
 * styling appropriate for switches. "accent" falls back to the CSS default
 * (accent token). All other roles inject a tone token. [D03]
 *
 * @selector [data-role="<role>"]
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
 * (e.g., --tug-element-tone-fill-normal-active-rest, not --tug-tone-action).
 */
const ROLE_TONE_MAP: Record<string, string> = {
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
   * Semantic role for the on-state track color.
   * Injects --tug-toggle-on-color and --tug-toggle-on-hover-color as inline
   * CSS custom properties; CSS falls back to global tokens when not set.
   *
   * "option" uses --tug-element-global-text-normal-muted-rest (neutral/achromatic).
   * "accent" suppresses injection and falls back to the CSS default (accent token).
   * All other roles inject the corresponding --tug-element-tone-fill-* token. [L06]
   *
   * @selector [data-role="<role>"]
   * @default "option"
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
    // Three-branch role injection logic. [L06]
    //
    // Branch 1 — "option": inject fg-muted directly (neutral/achromatic).
    //   The option role does not map to any --tug-tone-* token; it uses
    //   --tug-element-global-text-normal-muted-rest for a calm, achromatic on-state.
    //
    // Branch 2 — other non-accent roles (action/agent/data/success/caution/danger):
    //   inject the corresponding --tug-tone-* token via ROLE_TONE_MAP.
    //
    // Branch 3 — "accent": no injection; accent is the CSS-default fallback.
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
