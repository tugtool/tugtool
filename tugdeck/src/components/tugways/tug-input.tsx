/**
 * TugInput -- tugways public API for text inputs.
 *
 * Wraps a plain <input> element (not a Radix primitive). All visual states
 * are driven by --tug-base-field-* tokens — theme switches update CSS
 * variables at the DOM level with no React re-renders.
 *
 * States: rest, hover, focus, disabled, readOnly.
 * Validation: default, invalid, valid, warning.
 * Sizes: sm (28px), md (32px), lg (36px) — matching TugButton heights.
 *
 * [D04] Token-driven control state model
 * [D05] Component token naming: --tug-base-field-*
 */

import React from "react";
import { cn } from "@/lib/utils";
import "./tug-input.css";

// ---- Types ----

/** TugInput size names — matches TugButton sizes */
export type TugInputSize = "sm" | "md" | "lg";

/** TugInput validation state */
export type TugInputValidation = "default" | "invalid" | "valid" | "warning";

/**
 * TugInput props -- extends native input attributes.
 */
export interface TugInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Size variant. Default: "md" */
  size?: TugInputSize;
  /** Validation state. Default: "default" */
  validation?: TugInputValidation;
}

// ---- TugInput ----

export const TugInput = React.forwardRef<HTMLInputElement, TugInputProps>(
  function TugInput(
    { size = "md", validation = "default", className, ...rest },
    ref,
  ) {
    const inputClassName = cn(
      "tug-input",
      `tug-input-size-${size}`,
      validation === "invalid" && "tug-input-invalid",
      validation === "valid" && "tug-input-valid",
      validation === "warning" && "tug-input-warning",
      className,
    );

    return (
      <input
        ref={ref}
        className={inputClassName}
        aria-invalid={validation === "invalid" ? "true" : undefined}
        {...rest}
      />
    );
  },
);
