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
 *
 * [D04] Token-driven control state model
 * [D05] Component token naming: --tug-base-toggle-*, --tug-base-toggle-thumb
 */

import React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
import "./tug-switch.css";

// ---- Types ----

/** Switch size names — matches TugCheckbox/TugInput/TugButton sizes */
export type TugSwitchSize = "sm" | "md" | "lg";

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
    },
    ref,
  ) {
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
