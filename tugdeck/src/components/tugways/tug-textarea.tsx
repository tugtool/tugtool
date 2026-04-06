/**
 * TugTextarea — tugways public API for multi-line text inputs.
 *
 * Wraps a plain <textarea> element (not a Radix primitive). All visual states
 * are driven by --tug7-field-* tokens — theme switches update CSS
 * variables at the DOM level with no React re-renders.
 *
 * Auto-resize adjusts height imperatively via the native input event [L06].
 * Character counter renders below the textarea when maxLength is set.
 *
 * Laws: [L06] appearance via CSS / imperative DOM for auto-resize,
 *       [L15] token-driven states, [L16] pairings declared, [L19] component authoring guide
 * Decisions: [D04] token-driven control state model, [D05] component token naming
 */

import "./tug-textarea.css";

import React, { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";

// ---- Types ----

/** TugTextarea size names — matches TugInput and TugButton sizes */
export type TugTextareaSize = "sm" | "md" | "lg";

/** TugTextarea validation state */
export type TugTextareaValidation = "default" | "invalid" | "valid" | "warning";

/** TugTextarea resize direction */
export type TugTextareaResize = "horizontal" | "vertical" | "both";

/** TugTextarea props — extends native textarea attributes. */
export interface TugTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  /**
   * Visual size variant.
   * @selector .tug-textarea-size-sm | .tug-textarea-size-md | .tug-textarea-size-lg
   * @default "md"
   */
  size?: TugTextareaSize;
  /**
   * Validation state. Controls border color.
   * @selector .tug-textarea-invalid | .tug-textarea-valid | .tug-textarea-warning
   * @default "default"
   */
  validation?: TugTextareaValidation;
  /**
   * User-resizable direction. Sets CSS resize property.
   * When omitted, the textarea is not user-resizable (resize: none).
   * @selector .tug-textarea-resize-horizontal | .tug-textarea-resize-vertical | .tug-textarea-resize-both
   * @default undefined (not resizable)
   */
  resize?: TugTextareaResize;
  /**
   * Number of visible text rows. Maps to the HTML rows attribute.
   * @default 3
   */
  rows?: number;
  /**
   * Maximum character count. When provided, renders a character counter
   * below the textarea showing "current / max".
   * @default undefined (no limit, no counter)
   */
  maxLength?: number;
  /**
   * Auto-resize: grow the textarea height to fit content, up to maxRows.
   * Implemented via imperative DOM height adjustment [L06].
   * @default false
   */
  autoResize?: boolean;
  /**
   * Maximum rows before scrolling kicks in. Only meaningful when autoResize is true.
   * @default undefined (no limit — grows indefinitely)
   */
  maxRows?: number;
  /**
   * Focus indication style.
   * "background" — subtle background shift on focus (default).
   * "ring" — accent border ring on focus.
   * @default "background"
   */
  focusStyle?: "background" | "ring";
  /**
   * Remove visible border. For embedding in compound components
   * where the parent owns the border treatment.
   * @default false
   */
  borderless?: boolean;
}

// ---- TugTextarea ----

export const TugTextarea = React.forwardRef<
  HTMLTextAreaElement,
  TugTextareaProps
>(function TugTextarea(
  {
    size = "md",
    validation = "default",
    resize,
    rows = 3,
    maxLength,
    autoResize = false,
    maxRows,
    focusStyle = "background",
    borderless = false,
    className,
    disabled,
    onChange,
    value,
    defaultValue,
    ...rest
  },
  ref,
) {
  const boxDisabled = useTugBoxDisabled();
  const effectiveDisabled = disabled || boxDisabled;

  // Internal ref for imperative DOM manipulation; merged with forwarded ref.
  const internalRef = useRef<HTMLTextAreaElement>(null);

  // Counter state — track current character count for the counter display.
  const [charCount, setCharCount] = useState<number>(() => {
    if (value !== undefined) return String(value).length;
    if (defaultValue !== undefined) return String(defaultValue).length;
    return 0;
  });

  // Merge the forwarded ref with our internal ref.
  const setRef = React.useCallback(
    (el: HTMLTextAreaElement | null) => {
      (internalRef as React.MutableRefObject<HTMLTextAreaElement | null>).current =
        el;
      if (typeof ref === "function") {
        ref(el);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current =
          el;
      }
    },
    [ref],
  );

  // Auto-resize: adjust height imperatively on input events [L06].
  useLayoutEffect(() => {
    if (!autoResize) return;
    const el = internalRef.current;
    if (!el) return;

    const adjust = () => {
      // Collapse to auto so scrollHeight reflects content only.
      el.style.height = "auto";
      const scrollHeight = el.scrollHeight;

      if (maxRows) {
        const style = window.getComputedStyle(el);
        const lineHeight = parseFloat(style.lineHeight) || 16;
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const paddingBottom = parseFloat(style.paddingBottom) || 0;
        const maxHeight = lineHeight * maxRows + paddingTop + paddingBottom;

        if (scrollHeight > maxHeight) {
          el.style.height = maxHeight + "px";
          el.style.overflow = "auto";
        } else {
          el.style.height = scrollHeight + "px";
          el.style.overflow = "hidden";
        }
      } else {
        el.style.height = scrollHeight + "px";
        el.style.overflow = "hidden";
      }
    };

    // Size on mount.
    adjust();

    // Listen to native input events for immediate response.
    el.addEventListener("input", adjust);
    return () => {
      el.removeEventListener("input", adjust);
    };
  }, [autoResize, maxRows]);

  // Handle onChange to track character count for the counter.
  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCharCount(e.target.value.length);
      onChange?.(e);
    },
    [onChange],
  );

  const textareaClassName = cn(
    "tug-textarea",
    `tug-textarea-size-${size}`,
    validation === "invalid" && "tug-textarea-invalid",
    validation === "valid" && "tug-textarea-valid",
    validation === "warning" && "tug-textarea-warning",
    resize && !autoResize && `tug-textarea-resize-${resize}`,
    autoResize && "tug-textarea-auto-resize",
    className,
  );

  // Determine counter color class.
  const counterClassName = cn(
    "tug-textarea-counter",
    maxLength !== undefined &&
      charCount >= maxLength &&
      "tug-textarea-counter-danger",
    maxLength !== undefined &&
      charCount < maxLength &&
      charCount >= maxLength - Math.ceil(maxLength * 0.1) &&
      "tug-textarea-counter-warning",
  );

  const textarea = (
    <textarea
      ref={setRef}
      data-slot="tug-textarea"
      data-focus-style={focusStyle}
      data-borderless={borderless || undefined}
      className={textareaClassName}
      disabled={effectiveDisabled}
      aria-invalid={validation === "invalid" ? "true" : undefined}
      rows={rows}
      maxLength={maxLength}
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      {...rest}
    />
  );

  if (maxLength !== undefined) {
    return (
      <div className="tug-textarea-wrapper">
        {textarea}
        <span className={counterClassName}>
          {charCount} / {maxLength}
        </span>
      </div>
    );
  }

  return textarea;
});
