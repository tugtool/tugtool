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

import React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";
import type { TugFormatter } from "@/lib/tug-format";
import { TugValueInput } from "./tug-value-input";

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
    // ---- Radix value adapter ----

    const handleSliderChange = React.useCallback(
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
          <TugValueInput
            value={value}
            onValueCommit={onValueChange}
            formatter={formatter}
            min={min}
            max={max}
            step={step}
            size={size}
            disabled={disabled}
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
