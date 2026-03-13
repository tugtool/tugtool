/**
 * TugLabel -- tugways public API for labels.
 *
 * Wraps Radix Label for click-to-focus behavior on associated controls.
 * All visual states driven by --tug-base-field-* tokens.
 *
 * Features:
 *   - Multiline text: wraps at component width, up to `maxLines`
 *   - Ellipsis truncation: `end` (CSS-native), `start`, `middle` (JS-computed)
 *   - Optional leading icon with configurable color via `iconColor`
 *   - Required indicator (asterisk)
 *   - Size variants matching TugInput
 *
 * [D04] Token-driven control state model
 * [D05] Component token naming: --tug-base-field-*
 */

import React, { useRef, useLayoutEffect, useState, useCallback } from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";
import "./tug-label.css";

// ---- Types ----

/** TugLabel size names — matches TugInput sizes */
export type TugLabelSize = "sm" | "md" | "lg";

/** Ellipsis mode for text truncation */
export type TugLabelEllipsis = "none" | "end" | "start" | "middle";

/**
 * TugLabel props.
 */
export interface TugLabelProps {
  /** Text content of the label */
  children: string;
  /** Associate with a form control via htmlFor */
  htmlFor?: string;
  /** Size variant. Default: "md" */
  size?: TugLabelSize;
  /** Maximum number of lines before truncation. Default: unlimited */
  maxLines?: number;
  /** Ellipsis mode when maxLines is exceeded. Default: "end" */
  ellipsis?: TugLabelEllipsis;
  /** Show required indicator (asterisk). Default: false */
  required?: boolean;
  /** Disabled appearance. Default: false */
  disabled?: boolean;
  /** Leading icon (React node, typically a Lucide icon) */
  icon?: React.ReactNode;
  /** Icon color (CSS color value or token). Defaults to label text color. */
  iconColor?: string;
  /** Additional CSS class names */
  className?: string;
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

    // CSS class for the text span (end ellipsis uses CSS-native line-clamp)
    const useEndClamp =
      maxLines !== undefined &&
      maxLines > 0 &&
      (ellipsis === "end" || ellipsis === "none");

    const textClassName = cn(
      "tug-label-text",
      useEndClamp && ellipsis === "end" && "tug-label-ellipsis-end",
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

    // Inline style for maxLines (used by CSS line-clamp)
    const textStyle: React.CSSProperties = {};
    if (maxLines !== undefined && maxLines > 0) {
      (textStyle as Record<string, unknown>)["--tug-label-max-lines"] = maxLines;
    }

    return (
      <LabelPrimitive.Root
        ref={ref}
        htmlFor={htmlFor}
        className={labelClassName}
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
