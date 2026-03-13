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
 *
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
    },
    ref,
  ) {
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
