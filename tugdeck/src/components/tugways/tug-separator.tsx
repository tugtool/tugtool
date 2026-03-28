/**
 * TugSeparator — Horizontal or vertical divider with optional label, ornament, or end caps.
 *
 * Original component (no Radix). Renders a div with role="separator" and
 * proper aria-orientation. Supports plain lines, labeled dividers ("— OR —"),
 * ornamental dividers (Unicode glyphs or SVG ReactNodes), and capped lines
 * with perpendicular end strokes (vintage console style).
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide
 */

import "./tug-separator.css";

import React from "react";
import { cn } from "@/lib/utils";

// ---- Types ----

export type TugSeparatorOrientation = "horizontal" | "vertical";
export type TugSeparatorAlign = "start" | "center" | "end";

export interface TugSeparatorProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "role" | "children"> {
  /**
   * Divider direction.
   * @selector .tug-separator-horizontal | .tug-separator-vertical
   * @default "horizontal"
   */
  orientation?: TugSeparatorOrientation;

  /**
   * Label text centered on the divider line.
   * The line breaks around the label with a gap.
   * Horizontal only. Mutually exclusive with ornament.
   * @selector .tug-separator-labeled
   */
  label?: string;

  /**
   * Centered ornament — a Unicode character, short string, or ReactNode (for SVG).
   * The line breaks around the ornament, just like a label.
   * Horizontal only. Mutually exclusive with label.
   *
   * Common values:
   * - Single glyph: "◆", "✦", "❦", "⁂", "§"
   * - Dinkus pattern: "* * *", "· · ·", "✦ ✦ ✦"
   * - ReactNode: an inline SVG for wood-ornament-style richness
   *
   * @selector .tug-separator-ornamented
   */
  ornament?: React.ReactNode;

  /**
   * Perpendicular end caps on the line terminations.
   * Inspired by vintage computer console labeling where lines
   * end with short perpendicular strokes: ├──── LABEL ────┤
   * Horizontal only.
   * @selector .tug-separator-capped
   * @default false
   */
  capped?: boolean;

  /**
   * Constrains the separator length. Any CSS length value: "50%", "200px", etc.
   * For horizontal: controls width. For vertical: controls height.
   * @default "100%" for horizontal, "auto" for vertical
   */
  length?: string;

  /**
   * Alignment when length is less than 100%.
   * @selector .tug-separator-align-start | .tug-separator-align-center | .tug-separator-align-end
   * @default "center"
   */
  align?: TugSeparatorAlign;

  /**
   * Size of the ornament. Any CSS length value.
   * For SVG ornaments: sets width and height.
   * For text/glyph ornaments: sets font-size.
   * @default "1.5em" for SVG, "1.25em" for text (via CSS)
   */
  ornamentSize?: string;

  /**
   * Vertical offset for the ornament. Any CSS length value.
   * Positive moves down, negative moves up. Use to fine-tune
   * vertical alignment per glyph — different characters sit
   * differently in their bounding box.
   * @default "-0.05em" (via CSS)
   */
  ornamentOffset?: string;

  /**
   * Decorative separators (the common case) are hidden from the
   * accessibility tree. Set to false when the separator conveys
   * meaningful structure (e.g., between form sections).
   * @default true
   */
  decorative?: boolean;
}

// ---- TugSeparator ----

export const TugSeparator = React.forwardRef<HTMLDivElement, TugSeparatorProps>(
  function TugSeparator(
    {
      orientation = "horizontal",
      label,
      ornament,
      capped = false,
      length,
      align = "center",
      ornamentSize,
      ornamentOffset,
      decorative = true,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const isHorizontal = orientation === "horizontal";

    // label wins over ornament if both provided
    const effectiveLabel = isHorizontal ? label : undefined;
    const effectiveOrnament = isHorizontal && !effectiveLabel ? ornament : undefined;

    const centerContent = isHorizontal ? (
      effectiveLabel ? (
        <span className="tug-separator-label" aria-hidden="true">{effectiveLabel}</span>
      ) : effectiveOrnament ? (
        <span
        className="tug-separator-ornament"
        aria-hidden="true"
        style={(ornamentSize || ornamentOffset) ? {
          ...(ornamentSize ? { fontSize: ornamentSize } : {}),
          ...(ornamentOffset ? { transform: `translateY(${ornamentOffset})` } : {}),
        } as React.CSSProperties : undefined}
      >{effectiveOrnament}</span>
      ) : null
    ) : null;

    // Length and alignment as inline style
    const lengthStyle: React.CSSProperties = {};
    if (length) {
      if (isHorizontal) {
        lengthStyle.width = length;
      } else {
        lengthStyle.height = length;
      }
    }

    return (
      <div
        ref={ref}
        data-slot="tug-separator"
        role={decorative ? "none" : "separator"}
        aria-orientation={!decorative ? orientation : undefined}
        className={cn(
          "tug-separator",
          isHorizontal ? "tug-separator-horizontal" : "tug-separator-vertical",
          effectiveLabel && "tug-separator-labeled",
          effectiveOrnament && !effectiveLabel && "tug-separator-ornamented",
          capped && isHorizontal && "tug-separator-capped",
          length && `tug-separator-align-${align}`,
          className,
        )}
        style={{ ...lengthStyle, ...style }}
        {...rest}
      >
        {centerContent}
      </div>
    );
  },
);
