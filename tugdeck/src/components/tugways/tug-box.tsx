/**
 * TugBox — grouping container with optional visual chrome and disabled cascade.
 *
 * Renders a <fieldset> element for grouping variants (plain, bordered, filled)
 * and an <hr> for the separator variant. A disabled prop cascades to all
 * controls inside via TugBoxContext — the cascade is recursive: a disabled
 * outer box disables all inner boxes and their controls.
 *
 * Variants: plain (invisible grouping), bordered (border, no fill),
 * filled (border + sunken background), separator (horizontal rule).
 * Label position: legend (in border line) or above (heading above children).
 * Inset padding scales with size: sm/md/lg.
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared,
 *       [L19] component authoring guide
 */

import "./tug-box.css";

import React from "react";
import { cn } from "@/lib/utils";
import { TugBoxContext, useTugBoxDisabled } from "./internal/tug-box-context";

// ---- Types ----

/** TugBox size names — controls label font size and inset padding scale. */
export type TugBoxSize = "sm" | "md" | "lg";

/** TugBox border-radius options. */
export type TugBoxRounded = "none" | "sm" | "md" | "lg" | "full";

const ROUNDED_MAP: Record<TugBoxRounded, string> = {
  none: "0",
  sm: "0.25rem",   // 4px
  md: "0.375rem",  // 6px
  lg: "0.5rem",    // 8px
  full: "9999px",  // pill
};

/**
 * TugBox visual variant.
 * @selector .tug-box-plain | .tug-box-bordered | .tug-box-filled | .tug-box-separator
 */
export type TugBoxVariant = "plain" | "bordered" | "filled" | "separator";

/**
 * Where the label appears.
 * @selector .tug-box-label-legend | .tug-box-label-above
 */
export type TugBoxLabelPosition = "legend" | "above";

/** TugBox user-resizable direction. */
export type TugBoxResize = "horizontal" | "vertical" | "both";

/** TugBox props. */
export interface TugBoxProps
  extends Omit<React.FieldsetHTMLAttributes<HTMLFieldSetElement>, "disabled"> {
  /** Visible label text. Rendered as <legend> or <span> depending on labelPosition. */
  label?: string;
  /**
   * Where the label appears relative to the box.
   * - "legend": in the border line (standard fieldset/legend).
   * - "above": above the box content as a standalone heading.
   * @selector .tug-box-label-legend | .tug-box-label-above
   * @default "legend"
   */
  labelPosition?: TugBoxLabelPosition;
  /**
   * Visual variant controlling border and background.
   * - "plain": invisible — functional grouping only, no visual chrome.
   * - "bordered": visible border, no background fill.
   * - "filled": visible border + subtle background fill.
   * - "separator": renders as a horizontal rule (no children, no label).
   * @selector .tug-box-plain | .tug-box-bordered | .tug-box-filled | .tug-box-separator
   * @default "plain"
   */
  variant?: TugBoxVariant;
  /**
   * Internal padding between the border and children.
   * When true, applies size-appropriate padding. When false, no padding.
   * Defaults to true for bordered/filled, false for plain.
   * @selector .tug-box-inset
   */
  inset?: boolean;
  /**
   * Border radius for bordered/filled variants.
   * @default "lg"
   */
  rounded?: TugBoxRounded;
  /**
   * Disables all controls inside this box. Cascades recursively to nested TugBoxes.
   * @selector [disabled] | [data-disabled]
   * @default false
   */
  disabled?: boolean;
  /**
   * Visual size — controls label font size and inset padding scale.
   * @selector .tug-box-sm | .tug-box-md | .tug-box-lg
   * @default "md"
   */
  size?: TugBoxSize;
  /**
   * User-resizable direction. Requires bordered or filled variant.
   * Sets CSS resize and overflow: hidden on the fieldset.
   * When omitted, the box is not resizable.
   * @selector .tug-box-resize-horizontal | .tug-box-resize-vertical | .tug-box-resize-both
   */
  resize?: TugBoxResize;
  /** Box content. Not used when variant is "separator". */
  children?: React.ReactNode;
}

// ---- TugBox ----

export const TugBox = React.forwardRef<HTMLFieldSetElement, TugBoxProps>(
  function TugBox(
    {
      label,
      labelPosition = "legend",
      variant = "plain",
      inset,
      rounded = "lg",
      disabled = false,
      size = "md",
      resize,
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    // Merge with parent TugBox disabled via context cascade.
    const parentDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || parentDisabled;

    // Provide merged context to children so nested controls see the cascade.
    const ctxValue = React.useMemo(
      () => ({ disabled: effectiveDisabled }),
      [effectiveDisabled],
    );

    // Separator variant — renders <hr>, no children, no label, no context.
    if (variant === "separator") {
      return (
        <hr
          data-slot="tug-box"
          className={cn("tug-box", "tug-box-separator", className)}
          {...(rest as React.HTMLAttributes<HTMLHRElement>)}
        />
      );
    }

    // Inset default: true for bordered/filled, false for plain.
    const resolvedInset = inset ?? (variant === "bordered" || variant === "filled");

    // Border radius — only meaningful for bordered/filled.
    const hasBorder = variant === "bordered" || variant === "filled";
    const resolvedRadius = hasBorder ? ROUNDED_MAP[rounded] : undefined;

    return (
      <TugBoxContext.Provider value={ctxValue}>
        <fieldset
          ref={ref}
          data-slot="tug-box"
          disabled={effectiveDisabled}
          data-disabled={effectiveDisabled || undefined}
          className={cn(
            "tug-box",
            `tug-box-${variant}`,
            `tug-box-${size}`,
            resolvedInset && "tug-box-inset",
            resize && `tug-box-resize-${resize}`,
            className,
          )}
          style={{ borderRadius: resolvedRadius, ...style }}
          {...rest}
        >
          {label && labelPosition === "legend" && (
            <legend className="tug-box-legend">{label}</legend>
          )}
          {label && labelPosition === "above" && (
            <span className="tug-box-label-above">{label}</span>
          )}
          {children}
        </fieldset>
      </TugBoxContext.Provider>
    );
  },
);
