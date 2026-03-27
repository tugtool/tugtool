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
import { useTugBoxDisabled } from "./internal/tug-box-context";

// ---- Types ----

/** Checkbox size names — matches TugInput/TugButton sizes */
export type TugCheckboxSize = "sm" | "md" | "lg";

/** Re-export Radix checked state for convenience */
export type TugCheckedState = boolean | "indeterminate";

/**
 * Semantic role for the checkbox on-state color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 *
 * @selector [data-role="<role>"]
 */
export type TugCheckboxRole =
  | "option"
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
   * Semantic role for the on-state color. Omit for the theme's accent color.
   * Injects --tugx-toggle-on-color, --tugx-toggle-on-hover-color, and
   * --tugx-toggle-disabled-color as inline CSS custom properties.
   *
   * Single path, zero branches. [L06]
   *
   * @selector [data-role="<role>"]
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
      role,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Role injection — every path injects surface-toggle-primary tokens. [L06]
    // No role prop = accent. Single path, zero branches.
    const tokenSuffix = role ? (ROLE_TOKEN_MAP[role] ?? role) : "accent";
    const roleStyle = {
      "--tugx-toggle-on-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-rest)`,
      "--tugx-toggle-on-hover-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-hover)`,
      "--tugx-toggle-disabled-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-disabled)`,
    } as React.CSSProperties;

    const checkboxNode = (
      <CheckboxPrimitive.Root
        ref={ref}
        data-slot="tug-checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={effectiveDisabled}
        name={name}
        value={value}
        required={required}
        aria-label={!label ? ariaLabel : undefined}
        className={cn("tug-checkbox", `tug-checkbox-size-${size}`, !label && className)}
        style={roleStyle}
        data-role={role}
        {...rest}
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
          effectiveDisabled && "tug-checkbox-wrapper-disabled",
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
