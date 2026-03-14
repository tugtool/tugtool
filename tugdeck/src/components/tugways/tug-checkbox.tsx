/**
 * TugCheckbox -- tugways public API for checkboxes.
 *
 * Wraps Radix Checkbox for accessible checked/unchecked/indeterminate state.
 * All visual states driven by --tug-base-toggle-track-* and --tug-base-checkmark
 * tokens — theme switches update CSS variables with no React re-renders.
 *
 * Features:
 *   - Three states: unchecked, checked, indeterminate (mixed)
 *   - Inline label with click-to-toggle
 *   - Size variants matching other controls
 *   - Disabled state
 *   - Optional role prop for 7-role color system (D03, D04)
 *
 * [D03] Role color via inline CSS custom property injection
 * [D04] Token-driven control state model
 * [D05] Component token naming: --tug-base-toggle-*, --tug-base-checkmark
 */

import React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import "./tug-checkbox.css";

// ---- Types ----

/** Checkbox size names — matches TugInput/TugButton sizes */
export type TugCheckboxSize = "sm" | "md" | "lg";

/** Re-export Radix checked state for convenience */
export type TugCheckedState = boolean | "indeterminate";

/**
 * Role type for TugCheckbox.
 *
 * Defined independently from TugBadgeRole to avoid coupling the checkbox
 * role system to the badge role system. Includes "option" alongside the
 * existing 7 badge roles. Default is "option" (neutral/achromatic on-state).
 *
 * [D06] TugCheckbox and TugSwitch default to role='option'
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
 * (i.e., --tug-base-tone-active, not --tug-base-tone-action).
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
 * TugCheckbox props.
 */
export interface TugCheckboxProps {
  /** Controlled checked state. */
  checked?: TugCheckedState;
  /** Default checked state (uncontrolled). */
  defaultChecked?: TugCheckedState;
  /** Callback when checked state changes. */
  onCheckedChange?: (checked: TugCheckedState) => void;
  /** Inline label text. */
  label?: string;
  /** Size variant. Default: "md" */
  size?: TugCheckboxSize;
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
   * Color role for the checked/indeterminate on-state. Default: "option".
   * Injects --tug-toggle-on-color and --tug-toggle-on-hover-color via inline
   * CSS custom properties; the CSS falls back to global tokens when not set.
   *
   * "option" uses --tug-base-fg-muted directly (neutral/achromatic — no signal
   * hue chroma) rather than a --tug-base-tone-* token. This provides calm
   * configuration-control styling appropriate for checkboxes. [D06]
   *
   * "accent" suppresses injection entirely and falls back to the CSS default
   * (accent-orange on-state token). All other roles inject a tone token.
   * [D03, D04, D06, Spec S01]
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
    // Three-branch role injection logic. [D03, D06, Spec S01]
    //
    // Branch 1 — "option": inject fg-muted directly (neutral/achromatic).
    //   The option role does not map to any --tug-base-tone-* token; it uses
    //   --tug-base-fg-muted for a calm, unchromatic on-state color. [D06]
    //
    // Branch 2 — other non-accent roles (action/agent/data/success/caution/danger):
    //   inject the corresponding --tug-base-tone-* token via ROLE_TONE_MAP.
    //
    // Branch 3 — "accent" (explicit): no injection; accent is the CSS-default
    //   fallback and does not need inline style override.
    let roleStyle: React.CSSProperties | undefined;
    let dataRole: string | undefined;

    if (role === "option") {
      roleStyle = {
        "--tug-toggle-on-color": "var(--tug-base-fg-muted)",
        "--tug-toggle-on-hover-color": "var(--tug-base-fg-subtle)",
      } as React.CSSProperties;
      dataRole = "option";
    } else if (role !== "accent" && ROLE_TONE_MAP[role] !== undefined) {
      const toneSuffix = ROLE_TONE_MAP[role];
      roleStyle = {
        "--tug-toggle-on-color": `var(--tug-base-tone-${toneSuffix})`,
        "--tug-toggle-on-hover-color": `color-mix(in oklch, var(--tug-base-tone-${toneSuffix}), white 15%)`,
      } as React.CSSProperties;
      dataRole = role;
    }
    // else: role === "accent" — no injection, CSS default applies.

    const checkboxNode = (
      <CheckboxPrimitive.Root
        ref={ref}
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
          <CheckIcon />
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

// ---- CheckIcon: renders Check or Minus based on data-state ----

/**
 * Renders the appropriate icon based on parent checkbox state.
 * Radix Checkbox only renders the Indicator when checked or indeterminate,
 * so we inspect the parent's data-state to pick the right icon.
 */
function CheckIcon() {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [isIndeterminate, setIsIndeterminate] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Walk up to the checkbox root to read data-state
    const root = el.closest(".tug-checkbox");
    if (root) {
      setIsIndeterminate(root.getAttribute("data-state") === "indeterminate");
    }
  });

  return (
    <span ref={ref} style={{ display: "contents" }}>
      {isIndeterminate ? <Minus /> : <Check />}
    </span>
  );
}
