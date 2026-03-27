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
   * Show tick marks at each step interval along the track.
   * @default false
   */
  showTicks?: boolean;
  /** Icon rendered before the track (e.g., quiet speaker). */
  leadingIcon?: React.ReactNode;
  /** Icon rendered after the track (e.g., loud speaker). */
  trailingIcon?: React.ReactNode;
  /**
   * Fill the entire track with the accent color (not just the range).
   * Useful with ticks where the two-tone range is distracting.
   * @selector .tug-slider-track-filled
   * @default false
   */
  trackFilled?: boolean;
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
      showTicks = false,
      leadingIcon,
      trailingIcon,
      trackFilled = false,
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

    // ---- Tick marks ----

    const tickCount = showTicks ? Math.round((max - min) / step) + 1 : 0;
    const ticks = showTicks ? (
      <div className="tug-slider-ticks" aria-hidden="true">
        {Array.from({ length: tickCount }, (_, i) => (
          <span
            key={i}
            className="tug-slider-tick"
            style={{ left: `${(i / (tickCount - 1)) * 100}%` }}
          />
        ))}
      </div>
    ) : null;

    // ---- Track + value input block ----

    const trackAndInput = (
      <>
        {leadingIcon && (
          <span className="tug-slider-icon" aria-hidden="true">{leadingIcon}</span>
        )}

        <div className="tug-slider-track-wrapper">
          <SliderPrimitive.Root
            value={[value]}
            onValueChange={handleSliderChange}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            className="tug-slider-root"
          >
            <SliderPrimitive.Track className={cn("tug-slider-track", trackFilled && "tug-slider-track-filled")}>
              <SliderPrimitive.Range className="tug-slider-range" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb
              className={cn("tug-slider-thumb", showTicks && "tug-slider-thumb-diamond")}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </SliderPrimitive.Root>
          {ticks}
        </div>

        {trailingIcon && (
          <span className="tug-slider-icon" aria-hidden="true">{trailingIcon}</span>
        )}

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
