/**
 * TugInput — tugways public API for text inputs.
 *
 * Wraps a plain <input> element (not a Radix primitive). All visual states
 * are driven by --tug7-field-* tokens — theme switches update CSS
 * variables at the DOM level with no React re-renders.
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D04] token-driven control state model, [D05] component token naming
 */

import "./tug-input.css";

import React from "react";
import { cn } from "@/lib/utils";

// ---- Types ----

/** TugInput size names — matches TugButton sizes */
export type TugInputSize = "sm" | "md" | "lg";

/** TugInput validation state */
export type TugInputValidation = "default" | "invalid" | "valid" | "warning";

/** TugInput props — extends native input attributes. */
export interface TugInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /**
   * Visual size variant.
   * @selector .tug-input-size-sm | .tug-input-size-md | .tug-input-size-lg
   * @default "md"
   */
  size?: TugInputSize;
  /**
   * Validation state. Controls border color.
   * @selector .tug-input-invalid | .tug-input-valid | .tug-input-warning
   * @default "default"
   */
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
        data-slot="tug-input"
        className={inputClassName}
        aria-invalid={validation === "invalid" ? "true" : undefined}
        {...rest}
      />
    );
  },
);
