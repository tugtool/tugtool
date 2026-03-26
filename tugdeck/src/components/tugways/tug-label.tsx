/**
 * TugLabel — label for form controls.
 *
 * Wraps @radix-ui/react-label for click-to-focus behavior. Supports size
 * variants, multiline with ellipsis truncation (end/start/middle), leading
 * icon, required indicator, and disabled state. All colors via --tug7-* tokens.
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide
 * Decisions: [D04] token-driven control states, [D05] component token naming
 */

import "./tug-label.css";

import React, { useRef, useLayoutEffect, useState, useCallback } from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

// ---- Types ----

/** TugLabel size names — matches TugInput sizes */
export type TugLabelSize = "sm" | "md" | "lg";

/** TugLabel props. */
export interface TugLabelProps extends Omit<React.ComponentPropsWithoutRef<"label">, "children"> {
  /** Text content of the label (string only — required for truncation). */
  children: string;
  /**
   * Size variant.
   * @selector .tug-label-size-sm | .tug-label-size-md | .tug-label-size-lg
   * @default "md"
   */
  size?: TugLabelSize;
  /**
   * Maximum number of lines before truncation.
   * @default unlimited
   */
  maxLines?: number;
  /**
   * Ellipsis mode when maxLines is exceeded.
   * @selector .tug-label-clamp-none | .tug-label-ellipsis-end | .tug-label-ellipsis-start | .tug-label-ellipsis-middle
   * @default "end"
   */
  ellipsis?: "none" | "end" | "start" | "middle";
  /**
   * Show required indicator (asterisk).
   * @default false
   */
  required?: boolean;
  /**
   * Disabled appearance.
   * @selector .tug-label-disabled
   * @default false
   */
  disabled?: boolean;
  /** Leading icon (React node, typically a Lucide icon). */
  icon?: React.ReactNode;
  /** Icon color (CSS color value or token). Defaults to label text color. */
  iconColor?: string;
}

// ---- Truncation helpers ----

/**
 * Truncate text from the start: "…bcdef"
 * Used when ellipsis="start" and text overflows maxLines.
 */
function truncateStart(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return "…" + text.slice(text.length - maxLen + 1);
}

/**
 * Truncate text from the middle: "ab…ef"
 * Used when ellipsis="middle" and text overflows maxLines.
 */
function truncateMiddle(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const half = Math.floor((maxLen - 1) / 2);
  const endLen = maxLen - 1 - half;
  return text.slice(0, half) + "…" + text.slice(text.length - endLen);
}

// ---- TugLabel ----

export const TugLabel = React.forwardRef<HTMLLabelElement, TugLabelProps>(
  function TugLabel(
    {
      children,
      htmlFor,
      size = "md",
      maxLines,
      ellipsis = "end",
      required = false,
      disabled = false,
      icon,
      iconColor,
      className,
      ...rest
    },
    ref,
  ) {
    const textRef = useRef<HTMLSpanElement>(null);
    const [truncatedText, setTruncatedText] = useState<string | null>(null);

    // For start/middle ellipsis, we need to measure whether the text overflows
    // and iteratively truncate until it fits.
    const needsJSTruncation =
      maxLines !== undefined &&
      maxLines > 0 &&
      (ellipsis === "start" || ellipsis === "middle");

    const computeTruncation = useCallback(() => {
      const el = textRef.current;
      if (!el || !needsJSTruncation || !maxLines) return;

      // Reset to full text to measure
      el.textContent = children;

      // Check if text actually overflows
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16;
      const maxHeight = lineHeight * maxLines;

      if (el.scrollHeight <= maxHeight + 1) {
        // No overflow — show full text
        setTruncatedText(null);
        return;
      }

      // Binary search for the right truncation length
      const truncator = ellipsis === "start" ? truncateStart : truncateMiddle;
      let lo = 1;
      let hi = children.length;
      let bestLen = 1;

      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        el.textContent = truncator(children, mid);

        if (el.scrollHeight <= maxHeight + 1) {
          bestLen = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }

      const result = truncator(children, bestLen);
      el.textContent = result;
      setTruncatedText(result);
    }, [children, maxLines, ellipsis, needsJSTruncation]);

    useLayoutEffect(() => {
      computeTruncation();
    }, [computeTruncation]);

    // Observe resize to recompute truncation when container width changes.
    // Debounce via rAF to avoid "ResizeObserver loop completed with
    // undelivered notifications".
    useLayoutEffect(() => {
      if (!needsJSTruncation || !textRef.current) return;

      let rafId = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          computeTruncation();
        });
      });
      observer.observe(textRef.current);
      return () => {
        cancelAnimationFrame(rafId);
        observer.disconnect();
      };
    }, [needsJSTruncation, computeTruncation]);

    // Determine which text to display
    const displayText = needsJSTruncation && truncatedText !== null
      ? truncatedText
      : children;

    const hasMaxLines = maxLines !== undefined && maxLines > 0;

    const textClassName = cn(
      "tug-label-text",
      hasMaxLines && ellipsis === "none" && "tug-label-clamp-none",
      hasMaxLines && ellipsis === "end" && "tug-label-ellipsis-end",
      needsJSTruncation && (
        ellipsis === "start" ? "tug-label-ellipsis-start" :
        ellipsis === "middle" ? "tug-label-ellipsis-middle" : undefined
      ),
    );

    const labelClassName = cn(
      "tug-label",
      `tug-label-size-${size}`,
      disabled && "tug-label-disabled",
      className,
    );

    const textStyle = hasMaxLines
      ? { "--tug-label-max-lines": maxLines } as React.CSSProperties
      : undefined;

    return (
      <LabelPrimitive.Root
        ref={ref}
        data-slot="tug-label"
        htmlFor={htmlFor}
        className={labelClassName}
        {...rest}
      >
        {icon && (
          <span
            className="tug-label-icon"
            style={iconColor ? { color: iconColor } : undefined}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <span
          ref={textRef}
          className={textClassName}
          style={textStyle}
        >
          {displayText}
          {required && <span className="tug-label-required" aria-hidden="true"> *</span>}
        </span>
      </LabelPrimitive.Root>
    );
  },
);
