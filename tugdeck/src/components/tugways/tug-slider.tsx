/**
 * TugSlider — Horizontal range slider with optional editable value input.
 *
 * Wraps @radix-ui/react-slider. Supports inline and stacked layouts,
 * size variants, formatted value display with an editable input, and
 * disabled state.
 *
 * Per [L11], TugSlider is a control: the drag gesture dispatches
 * `setValue` actions through the responder chain with phases that
 * describe the interaction lifecycle:
 *
 *   - `"begin"`: pointerdown on the track or thumb (value is the
 *     current value before the drag moves it).
 *   - `"change"`: intermediate value updates during pointer drag.
 *   - `"commit"`: pointerup / drag release (final value).
 *   - `"discrete"`: keyboard arrow keys, Home/End, or wheel — no
 *     begin/change/commit window, just a single committed value.
 *
 * Parent responders bind via the `setValueNumber` slot in
 * `useResponderForm`; the setter's second argument is the phase, so
 * consumers can drive a ref-based live preview on `"change"` and only
 * persist state on `"commit"` / `"discrete"`. Consumers that don't
 * care about phases can declare a unary setter `(v: number) => void`
 * — TypeScript accepts it because the narrower signature is
 * assignable to the wider slot type.
 *
 * ## Nested TugValueInput sender-id propagation
 *
 * When `showValue` is true, TugSlider renders an internal `TugValueInput`
 * that also dispatches `setValue` on commit. To keep the parent
 * responder's binding simple, TugSlider passes its own `effectiveSenderId`
 * down to the nested input. The parent sees two kinds of dispatches
 * from the same sender: drag phases from the slider and `"discrete"`
 * commits from the text field. One binding handles both.
 *
 * ## Keyboard-vs-drag disambiguation
 *
 * Radix's `onValueChange` fires for both pointer drags and keyboard
 * interactions. We distinguish by tracking a `draggingRef` flag set on
 * `onPointerDown` and cleared in `onValueCommit`. During a pointer
 * drag the Radix sequence is:
 *
 *   pointerdown → onValueChange(...) × N → pointerup → onValueCommit
 *
 * `draggingRef` is true throughout, so those value changes become
 * `"change"` phase and the final Radix `onValueCommit` becomes
 * `"commit"`. For keyboard interaction Radix fires `onValueChange` and
 * then `onValueCommit` without any pointer events; `draggingRef` stays
 * false, the `onValueChange` dispatch uses `"discrete"` phase, and the
 * handler for `onValueCommit` no-ops so we don't double-dispatch.
 *
 * ## Known limitation: no cancel phase
 *
 * Radix does not expose a hook for pointer-cancel or Escape-mid-drag,
 * so TugSlider never dispatches `phase: "cancel"`. If a parent wants
 * to roll back a live preview on drag-cancel, the practical signals
 * are "commit fired" (no rollback) vs "blur without commit" (rollback)
 * — which today happens to be unreachable in the Radix slider because
 * any interaction that reaches onValueChange also reaches onValueCommit.
 * Flagged here for any future consumer that needs true cancel semantics.
 *
 * Laws: [L06] appearance via CSS, [L11] controls emit actions;
 *       responders handle actions, [L15] token-driven states,
 *       [L16] pairings declared, [L19] component authoring guide
 * Decisions: [D05] component token naming
 */

import "./tug-slider.css";

import React, { useCallback, useId, useRef } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";
import type { TugFormatter } from "@/lib/tug-format";
import { TugValueInput } from "./tug-value-input";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useResponderChain } from "./responder-chain-provider";

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
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Parent responders disambiguate multi-slider
   * forms by matching this id in their `setValue` handler bindings.
   * The nested `TugValueInput` (when `showValue` is true) inherits
   * this sender id so both drag and text-edit dispatches share a
   * single binding. [L11]
   */
  senderId?: string;
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
      senderId,
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
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // ---- Chain dispatch [L11] ----
    //
    // Phase disambiguation: Radix fires `onValueChange` for both
    // pointer drags and keyboard. We track whether a pointer drag is
    // in progress via `draggingRef`, flipped on `onPointerDown` and
    // cleared in `handleValueCommit`. See the module docstring for
    // the full sequence diagram.
    const manager = useResponderChain();
    const fallbackSenderId = useId();
    const effectiveSenderId = senderId ?? fallbackSenderId;
    const draggingRef = useRef(false);

    const dispatchSetValue = useCallback(
      (v: number, phase: "begin" | "change" | "commit" | "discrete") => {
        if (!manager) return;
        manager.dispatch({
          action: "setValue",
          value: v,
          sender: effectiveSenderId,
          phase,
        });
      },
      [manager, effectiveSenderId],
    );

    // ---- Pointer tracking ----
    //
    // Start the drag here so the "begin" dispatch carries the
    // pre-change value (the current prop), letting parents snapshot
    // initial state for a live-preview rollback if they need one.
    const handlePointerDown = useCallback(
      (_e: React.PointerEvent<HTMLSpanElement>) => {
        if (effectiveDisabled) return;
        draggingRef.current = true;
        dispatchSetValue(value, "begin");
      },
      [effectiveDisabled, dispatchSetValue, value],
    );

    // ---- Radix value adapter ----
    //
    // While dragging → "change". Otherwise (keyboard/wheel) →
    // "discrete". `handleValueCommit` below will then no-op for
    // non-drag paths so we don't double-dispatch.
    const handleSliderChange = useCallback(
      (vals: number[]) => {
        const next = vals[0];
        if (draggingRef.current) {
          dispatchSetValue(next, "change");
        } else {
          dispatchSetValue(next, "discrete");
        }
      },
      [dispatchSetValue],
    );

    // ---- Radix commit adapter ----
    //
    // Fires at the end of both pointer drags and keyboard
    // interactions. We only dispatch "commit" if a pointer drag was
    // actually in progress — otherwise the earlier onValueChange
    // already dispatched "discrete" and this would be a duplicate.
    const handleSliderCommit = useCallback(
      (vals: number[]) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        dispatchSetValue(vals[0], "commit");
      },
      [dispatchSetValue],
    );

    // ---- Thumb keydown: Escape/Enter release focus ----

    const handleThumbKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLSpanElement>) => {
        if (e.key === "Escape" || e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      },
      [],
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
            onValueCommit={handleSliderCommit}
            onPointerDown={handlePointerDown}
            min={min}
            max={max}
            step={step}
            disabled={effectiveDisabled}
            className="tug-slider-root"
          >
            <SliderPrimitive.Track className={cn("tug-slider-track", trackFilled && "tug-slider-track-filled")}>
              <SliderPrimitive.Range className="tug-slider-range" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb
              className={cn("tug-slider-thumb", showTicks && "tug-slider-thumb-diamond")}
              onKeyDown={handleThumbKeyDown}
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
            senderId={effectiveSenderId}
            formatter={formatter}
            min={min}
            max={max}
            step={step}
            size={size}
            disabled={effectiveDisabled}
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
        aria-disabled={effectiveDisabled || undefined}
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
