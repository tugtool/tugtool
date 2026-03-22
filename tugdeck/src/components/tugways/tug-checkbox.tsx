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
 * "option" uses a neutral/achromatic token for calm configuration-control
 * styling appropriate for checkboxes. "accent" falls back to the CSS default
 * (accent token). All other roles inject a tone token. [D03]
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
