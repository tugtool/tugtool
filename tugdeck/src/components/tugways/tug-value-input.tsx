/**
 * TugValueInput — Compact inline numeric editor with formatted display.
 *
 * Standalone field for displaying and editing a single numeric value.
 * Supports formatted display (e.g. "75%"), type-to-replace on focus,
 * arrow key increment/decrement, validate-on-commit, and Escape to revert.
 * All input value management is imperative via refs — no React state for
 * the display/edit cycle. [L06]
 *
 * Laws: [L06] appearance via DOM refs not React state, [L15] token-driven states,
 *       [L16] pairings declared, [L19] component authoring guide
 * Decisions: [D05] component token naming
 */

import "./tug-value-input.css";

import React, { useRef, useCallback, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import type { TugFormatter } from "@/lib/tug-format";
import { clamp, validateNumericInput } from "@/lib/tug-validate";

// ---- Props ----

export interface TugValueInputProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "value" | "onChange" | "defaultValue" | "type"> {
  /** Current numeric value. Display is derived from this via the formatter. */
  value: number;
  /** Called when the user commits a new value (Enter, blur, or arrow key). */
  onValueCommit: (value: number) => void;
  /** Formatter for display/parse. When absent, shows raw number. */
  formatter?: TugFormatter<number>;
  /** Minimum value. Used for clamping on commit and arrow key lower bound. */
  min?: number;
  /** Maximum value. Used for clamping on commit and arrow key upper bound. */
  max?: number;
  /**
   * Step increment for arrow keys and snap-to-step on commit.
   * @default 1
   */
  step?: number;
  /**
   * Visual size variant.
   * @selector .tug-value-input-sm | .tug-value-input-md | .tug-value-input-lg
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * @selector [aria-disabled="true"]
   * @default false
   */
  disabled?: boolean;
}

// ---- TugValueInput ----

export const TugValueInput = React.forwardRef<HTMLInputElement, TugValueInputProps>(
  function TugValueInput(
    {
      value,
      onValueCommit,
      formatter,
      min,
      max,
      step = 1,
      size = "md",
      disabled = false,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    // ---- Imperative value management [L06] ----
    //
    // All input value changes go through DOM. No React state for the display/edit
    // cycle — this prevents re-renders on every keystroke and preserves text selection.

    const inputRef = useRef<HTMLInputElement>(null);
    const editingRef = useRef<boolean>(false);
    const escapeRef = useRef<boolean>(false);
    // Guards against mouseup deselecting text after click-to-focus.
    const justFocusedRef = useRef<boolean>(false);

    // ---- Merge forwarded ref with local ref ----

    const mergedRef = useCallback(
      (node: HTMLInputElement | null) => {
        (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }
      },
      [ref],
    );

    // ---- Input width based on max value length ----

    const displayMax = formatter ? formatter.format(max ?? 100) : String(max ?? 100);
    const inputWidth = `${displayMax.length + 2}ch`;

    // ---- Sync display value when not editing [L06] ----
    //
    // When value prop changes externally (e.g. slider drag, parent state update)
    // and the input is not being edited, update the DOM directly.

    const displayValue = formatter ? formatter.format(value) : String(value);

    useLayoutEffect(() => {
      const input = inputRef.current;
      if (input && !editingRef.current) {
        input.value = displayValue;
      }
    }, [displayValue]);

    // ---- Focus handler ----

    const handleFocus = useCallback(() => {
      const input = inputRef.current;
      if (!input) return;
      editingRef.current = true;
      escapeRef.current = false;
      justFocusedRef.current = true;
      // Keep formatted display on focus — the user edits in display units.
      // "50%" stays "50%", not "0.5". On commit, the formatter's parse() handles it.
      const display = formatter ? formatter.format(value) : String(value);
      input.value = display;
      input.select();
    }, [value, formatter]);

    // ---- MouseUp handler ----
    //
    // Prevent the mouseup after click-to-focus from placing the cursor
    // and deselecting the text. Only suppressed on the first mouseup
    // after focus — subsequent clicks within the field work normally.

    const handleMouseUp = useCallback(
      (e: React.MouseEvent<HTMLInputElement>) => {
        if (justFocusedRef.current) {
          e.preventDefault();
          justFocusedRef.current = false;
        }
      },
      [],
    );

    // ---- KeyDown handler ----

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          escapeRef.current = true;
          // Revert to display value before blurring.
          const display = formatter ? formatter.format(value) : String(value);
          e.currentTarget.value = display;
          editingRef.current = false;
          e.currentTarget.blur();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const effectiveMax = max ?? Infinity;
          const next = clamp(value + step, -Infinity, effectiveMax);
          onValueCommit(next);
          const input = inputRef.current;
          if (input) {
            input.value = formatter ? formatter.format(next) : String(next);
            input.select();
          }
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          const effectiveMin = min ?? -Infinity;
          const next = clamp(value - step, effectiveMin, Infinity);
          onValueCommit(next);
          const input = inputRef.current;
          if (input) {
            input.value = formatter ? formatter.format(next) : String(next);
            input.select();
          }
        }
      },
      [value, formatter, min, max, step, onValueCommit],
    );

    // ---- Blur handler ----

    const handleBlur = useCallback(() => {
      const input = inputRef.current;
      editingRef.current = false;

      if (escapeRef.current) {
        escapeRef.current = false;
        return;
      }

      // Parse the typed text. If a formatter is present, use its parse() first
      // (handles "75%" → 0.75, "$42" → 42, etc.). Fall back to plain numeric parse.
      const raw = input?.value ?? "";
      const effectiveMin = min ?? -Infinity;
      const effectiveMax = max ?? Infinity;
      let parsed: number | null = null;
      if (formatter) {
        parsed = formatter.parse(raw);
        // If formatter parse succeeded, still clamp and snap.
        if (parsed !== null) {
          parsed = clamp(parsed, effectiveMin, effectiveMax);
          if (step !== undefined) {
            const base = effectiveMin === -Infinity ? 0 : effectiveMin;
            parsed = Math.round((parsed - base) / step) * step + base;
          }
        }
      }
      // Fall back to plain numeric validation if no formatter or formatter parse failed.
      if (parsed === null) {
        parsed = validateNumericInput(raw, { min: effectiveMin, max: effectiveMax, step });
      }
      if (parsed !== null) {
        onValueCommit(parsed);
      }

      // Restore display format (whether validated or reverted).
      if (input) {
        const display = formatter
          ? formatter.format(validated ?? value)
          : String(validated ?? value);
        input.value = display;
      }
    }, [min, max, step, value, formatter, onValueCommit]);

    return (
      <input
        ref={mergedRef}
        type="text"
        data-slot="tug-value-input"
        className={cn("tug-value-input", `tug-value-input-${size}`, className)}
        defaultValue={displayValue}
        style={{ width: inputWidth, ...style }}
        aria-disabled={disabled || undefined}
        aria-label="Value"
        onFocus={handleFocus}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        {...rest}
      />
    );
  },
);
