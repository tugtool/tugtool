/**
 * TugCheckbox — Accessible checkbox with checked, unchecked, and indeterminate states.
 *
 * Wraps @radix-ui/react-checkbox. Supports three checked states (checked, unchecked,
 * indeterminate), inline label, size variants, disabled state, and role-based color
 * injection via CSS custom properties.
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D03] appearance via stylesheet injection, [D05] component token naming,
 *            [D06] components/tugways public API
 */

import "./tug-checkbox.css";

import React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Types ----

/** Checkbox size names — matches TugInput/TugButton sizes */
export type TugCheckboxSize = "sm" | "md" | "lg";

/** Re-export Radix checked state for convenience */
export type TugCheckedState = boolean | "indeterminate";

/**
 * Semantic role for the checkbox on-state color.
 *
 * Every role injects a --tug7-surface-toggle-primary-normal-{role}-* token.
 * "option" is a calm neutral; "accent" is the brand color; others are signal colors.
 *
 * @selector [data-role="<role>"]
 */
export type TugCheckboxRole =
  | "option"
  | "accent"
  | "action"
  | "agent"
  | "data"
  | "success"
  | "caution"
  | "danger";

/**
 * Maps role prop values to toggle-primary token suffixes.
 * The prop API uses "action" but the token system uses "active"
 * (e.g., --tug7-surface-toggle-primary-normal-active-rest).
 */
const ROLE_TOKEN_MAP: Record<string, string> = {
  option:  "option",
  accent:  "accent",
  action:  "active",
  agent:   "agent",
  data:    "data",
  success: "success",
  caution: "caution",
  danger:  "danger",
};

/** TugCheckbox props. */
export interface TugCheckboxProps {
  /**
   * Controlled checked state. Supports true, false, or "indeterminate".
   * @selector [data-state="checked"] | [data-state="unchecked"] | [data-state="indeterminate"]
   */
  checked?: TugCheckedState;
  /** Default checked state (uncontrolled). */
  defaultChecked?: TugCheckedState;
  /** Callback when checked state changes. */
  onCheckedChange?: (checked: TugCheckedState) => void;
  /** Inline label text. Renders a wrapping label element. */
  label?: string;
  /**
   * Visual size variant.
   * @selector .tug-checkbox-size-sm | .tug-checkbox-size-md | .tug-checkbox-size-lg
   * @default "md"
   */
  size?: TugCheckboxSize;
  /**
   * Disables the checkbox.
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
   * Semantic role for the checked/indeterminate on-state color.
   * Injects --tugx-toggle-on-color and --tugx-toggle-on-hover-color as inline
   * CSS custom properties using --tug7-surface-toggle-primary-normal-{role}-* tokens.
   *
   * Every role (including "option" and "accent") follows the same path — no special cases. [L06]
   *
   * @selector [data-role="<role>"]
   * @default "option"
   */
  role?: TugCheckboxRole;
}

// ---- TugCheckbox ----

export const TugCheckbox = React.forwardRef<HTMLButtonElement, TugCheckboxProps>(
  function TugCheckbox(
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
    // Role injection — every role uses a surface-toggle-primary token. [L06]
    // No special cases. A checkbox fill is a surface, not a foreground mark.
    const tokenSuffix = ROLE_TOKEN_MAP[role] ?? role;
    const roleStyle = {
      "--tugx-toggle-on-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-rest)`,
      "--tugx-toggle-on-hover-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-hover)`,
      "--tugx-toggle-disabled-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-disabled)`,
    } as React.CSSProperties;
    const dataRole = role === "accent" ? undefined : role;

    const checkboxNode = (
      <CheckboxPrimitive.Root
        ref={ref}
        data-slot="tug-checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        name={name}
        value={value}
        required={required}
        aria-label={!label ? ariaLabel : undefined}
        className={cn("tug-checkbox", `tug-checkbox-size-${size}`)}
        style={roleStyle}
        data-role={dataRole}
      >
        <CheckboxPrimitive.Indicator className="tug-checkbox-indicator">
          <span className="tug-checkbox-icon-check" aria-hidden="true">
            <Check />
          </span>
          <span className="tug-checkbox-icon-mixed" aria-hidden="true">
            <Minus />
          </span>
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );

    if (!label) {
      return checkboxNode;
    }

    return (
      <label
        className={cn(
          "tug-checkbox-wrapper",
          disabled && "tug-checkbox-wrapper-disabled",
          className,
        )}
      >
        {checkboxNode}
        <span className={cn("tug-checkbox-label", `tug-checkbox-label-${size}`)}>
          {label}
        </span>
      </label>
    );
  },
);

/* ---------------------------------------------------------------------------
 * CheckIcon — internal sub-component removed.
 *
 * Icon visibility is now CSS-driven via [data-state] on the parent indicator.
 * The .tug-checkbox-icon-check span is visible by default; .tug-checkbox-icon-mixed
 * is hidden. When data-state="indeterminate", CSS swaps visibility. [L06]
 * ---------------------------------------------------------------------------*/
