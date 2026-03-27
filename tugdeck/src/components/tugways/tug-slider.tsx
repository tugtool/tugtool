/**
 * TugSlider — Horizontal range slider with optional editable value input.
 *
 * Wraps @radix-ui/react-slider. Supports inline and stacked layouts,
 * size variants, formatted value display with an editable input, and
 * disabled state.
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D05] component token naming
 */

import "./tug-slider.css";

import React, { useRef, useCallback, useLayoutEffect } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";
import type { TugFormatter } from "@/lib/tug-format";
import { validateNumericInput } from "@/lib/tug-validate";

// ---- Types ----

/** Slider size names. */
export type TugSliderSize = "sm" | "md" | "lg";

/** Slider layout names. */
export type TugSliderLayout = "inline" | "stacked";

/** TugSlider props. */
export interface TugSliderProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "onChange"> {
  /** Controlled numeric value. */
  value: number;
  /** Callback when the value changes. */
  onValueChange: (value: number) => void;
  /**
   * Minimum value.
   * @default 0
   */
  min?: number;
  /**
   * Maximum value.
   * @default 100
   */
  max?: number;
  /**
   * Step increment.
   * @default 1
   */
  step?: number;
  /** Visible label text. Enables layout class when provided. */
  label?: string;
  /**
   * Layout when a label is present.
   * - inline: label left, track center, value input right — one row
   * - stacked: label on top, track + value input on bottom row
   * @selector .tug-slider-inline | .tug-slider-stacked
   * @default "inline"
   */
  layout?: TugSliderLayout;
  /**
   * Show an editable numeric value input alongside the track.
   * @default true
   */
  showValue?: boolean;
  /**
   * Formatter for display and parsing of the value input.
   * When omitted, the raw number is rendered as a string.
   */
  formatter?: TugFormatter<number>;
  /**
   * Visual size variant.
   * @selector .tug-slider-sm | .tug-slider-md | .tug-slider-lg
   * @default "md"
   */
  size?: TugSliderSize;
  /**
   * Disables the slider and value input.
   * @selector [aria-disabled="true"]
   * @default false
   */
  disabled?: boolean;
}

// ---- TugSlider ----

export const TugSlider = React.forwardRef<HTMLDivElement, TugSliderProps>(
  function TugSlider(
    {
      value,
      onValueChange,
      min = 0,
      max = 100,
      step = 1,
      label,
      layout = "inline",
      showValue = true,
      formatter,
      size = "md",
      disabled = false,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    // ---- Imperative value input management [L06] ----
    //
    // The value input is managed entirely through DOM, not React state.
    // No re-renders during the focus → edit → blur cycle. This ensures
    // select-all works on focus and keystrokes are never dropped.

    const inputRef = useRef<HTMLInputElement>(null);
    const editingRef = useRef<boolean>(false);
    const escapeRef = useRef<boolean>(false);
    // Guards against mouseup deselecting text after click-to-focus.
    const justFocusedRef = useRef<boolean>(false);

    // ---- Value input width based on max ----

    const displayMax = formatter ? formatter.format(max) : String(max);
    const inputWidth = `${displayMax.length + 2}ch`;

    // ---- Sync input display value when not editing [L06] ----
    //
    // When the slider value changes externally (drag, prop change) and
    // the input is not being edited, update the DOM directly.

    const displayValue = formatter ? formatter.format(value) : String(value);

    useLayoutEffect(() => {
      const input = inputRef.current;
      if (input && !editingRef.current) {
        input.value = displayValue;
      }
    }, [displayValue]);

    // ---- Input handlers (all imperative, zero React state) ----

    const handleInputFocus = useCallback(() => {
      const input = inputRef.current;
      if (!input) return;
      editingRef.current = true;
      escapeRef.current = false;
      justFocusedRef.current = true;
      // Show raw number for editing, then select all for type-to-replace.
      input.value = String(value);
      input.select();
    }, [value]);

    // Prevent the mouseup after click-to-focus from placing the cursor
    // and deselecting the text. Only suppressed on the first mouseup
    // after focus — subsequent clicks within the field work normally.
    const handleInputMouseUp = useCallback(
      (e: React.MouseEvent<HTMLInputElement>) => {
        if (justFocusedRef.current) {
          e.preventDefault();
          justFocusedRef.current = false;
        }
      },
      [],
    );

    const handleInputKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          escapeRef.current = true;
          // Revert to display value before blurring.
          const display = formatter ? formatter.format(value) : String(value);
          e.currentTarget.value = display;
          editingRef.current = false;
          e.currentTarget.blur();
        }
      },
      [value, formatter],
    );

    const handleInputBlur = useCallback(() => {
      const input = inputRef.current;
      editingRef.current = false;

      if (escapeRef.current) {
        escapeRef.current = false;
        return;
      }

      // Validate the typed text: parse → clamp → snap.
      const raw = input?.value ?? "";
      const validated = validateNumericInput(raw, { min, max, step });
      if (validated !== null) {
        onValueChange(validated);
      }

      // Restore display format (whether validated or reverted).
      if (input) {
        const display = formatter
          ? formatter.format(validated ?? value)
          : String(validated ?? value);
        input.value = display;
      }
    }, [min, max, step, value, formatter, onValueChange]);

    // ---- Radix value adapter ----

    const handleSliderChange = useCallback(
      (vals: number[]) => onValueChange(vals[0]),
      [onValueChange],
    );

    // ---- Layout class ----

    const layoutClass = label
      ? layout === "inline"
        ? "tug-slider-inline"
        : "tug-slider-stacked"
      : undefined;

    // ---- Track + value input block ----

    const trackAndInput = (
      <>
        <SliderPrimitive.Root
          value={[value]}
          onValueChange={handleSliderChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="tug-slider-root"
        >
          <SliderPrimitive.Track className="tug-slider-track">
            <SliderPrimitive.Range className="tug-slider-range" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb className="tug-slider-thumb" />
        </SliderPrimitive.Root>

        {showValue && (
          <input
            ref={inputRef}
            type="text"
            className="tug-slider-value-input"
            defaultValue={displayValue}
            style={{ width: inputWidth }}
            disabled={disabled}
            aria-label="Value"
            onFocus={handleInputFocus}
            onMouseUp={handleInputMouseUp}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
          />
        )}
      </>
    );

    return (
      <div
        ref={ref}
        data-slot="tug-slider"
        className={cn(
          "tug-slider",
          `tug-slider-${size}`,
          layoutClass,
          className,
        )}
        aria-disabled={disabled || undefined}
        style={style}
        {...rest}
      >
        {label && (
          <span className="tug-slider-label">{label}</span>
        )}

        {layout === "stacked" && label ? (
          <div className="tug-slider-controls">{trackAndInput}</div>
        ) : (
          trackAndInput
        )}
      </div>
    );
  },
);
