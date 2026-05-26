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
import { useCopyableText } from "./use-copyable-text";

// ---- Types ----

/** TugLabel size names — matches --tug-font-size-* theme tokens. */
export type TugLabelSize =
  | "8xs" | "7xs" | "6xs" | "5xs" | "4xs" | "3xs" | "2xs"
  | "xs" | "sm" | "md" | "lg" | "xl"
  | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "8xl";

/**
 * TugLabel role — paints the label text in a standard role tone
 * (`--tug7-element-tone-text-normal-<role>-rest`). Use for labels
 * that need to mirror a role-driven accent in a surrounding
 * surface (e.g. a `TugTaskItem`'s in-progress row whose ring is
 * `TugProgressIndicator role="action"`). The role suffix follows
 * the same "action → active" alias TugProgressIndicator uses, so the same role name
 * lights up the same color family across both primitives.
 */
export type TugLabelRole =
  | "accent"
  | "action"
  | "agent"
  | "caution"
  | "danger"
  | "data"
  | "success";

/** TugLabel text alignment. */
export type TugLabelAlign = "start" | "center" | "end";

/**
 * TugLabel emphasis — a volume scale for how loud the label speaks.
 *
 * - `shout`: bold + ALL CAPS.
 * - `strong`: bold.
 * - `normal` (default): inherits the base weight/style.
 * - `calm`: muted gray, upright — quieter than normal.
 * - `whisper`: muted gray + italic — like a whisper, the quietest tier.
 *
 * `calm` and `whisper` paint `--tug7-element-global-text-normal-muted-rest`;
 * `whisper` adds italic on top. When `role` is also set, the emphasis color
 * wins (source order in the cascade), so reach for `role` when a role-driven
 * accent should show through.
 */
export type TugLabelEmphasis = "calm" | "normal" | "shout" | "strong" | "whisper";

/** TugLabel props. */
export interface TugLabelProps extends Omit<React.ComponentPropsWithoutRef<"label">, "children"> {
  /** Text content of the label (string only — required for truncation). */
  children: string;
  /**
   * Size variant.
   * @selector .tug-label-size-xs | .tug-label-size-sm | .tug-label-size-md | .tug-label-size-lg
   * @default "md"
   */
  size?: TugLabelSize;
  /**
   * Role tone — paints the label with the standard
   * `--tug7-element-tone-text-normal-<role>-rest` token. Use for
   * labels paired with role-driven accents (e.g. an in-progress
   * task row whose ring is `TugProgressIndicator role="action"`).
   * @selector .tug-label-role-action | .tug-label-role-success | …
   */
  role?: TugLabelRole;
  /**
   * Emphasis variant — a volume scale from `shout` (loudest) to
   * `whisper` (quietest). `calm` and `whisper` both paint the
   * muted text token; `whisper` adds italic.
   * @selector .tug-label-emphasis-calm | .tug-label-emphasis-whisper | .tug-label-emphasis-strong | .tug-label-emphasis-shout
   * @default "normal"
   */
  emphasis?: TugLabelEmphasis;
  /**
   * Use monospace font.
   * @selector .tug-label-mono
   * @default false
   */
  mono?: boolean;
  /**
   * Text alignment.
   * @selector .tug-label-align-center | .tug-label-align-end
   * @default "start"
   */
  align?: TugLabelAlign;
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
      role,
      emphasis = "normal",
      mono = false,
      align = "start",
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
    const labelRef = useRef<HTMLLabelElement | null>(null);

    // Labels are copyable — right-click → Copy copies the label's text
    // content. This is intrinsic to the component, not opt-in.
    const copyable = useCopyableText({
      ref: labelRef as React.MutableRefObject<HTMLElement | null>,
      getText: () => children,
      disabled: false,
      forwardedRef: ref as React.Ref<HTMLElement>,
    });
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
      role !== undefined && `tug-label-role-${role}`,
      emphasis !== "normal" && `tug-label-emphasis-${emphasis}`,
      mono && "tug-label-mono",
      align !== "start" && `tug-label-align-${align}`,
      disabled && "tug-label-disabled",
      className,
    );

    const textStyle = hasMaxLines
      ? { "--tug-label-max-lines": maxLines } as React.CSSProperties
      : undefined;

    return (
      <>
        <LabelPrimitive.Root
          ref={copyable.composedRef as React.Ref<HTMLLabelElement>}
          data-slot="tug-label"
          htmlFor={htmlFor}
          className={labelClassName}
          onContextMenu={copyable.handleContextMenu}
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
        {copyable.contextMenu}
      </>
    );
  },
);
