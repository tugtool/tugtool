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
 *   - `"discrete"`: keyboard arrow keys, Home/End — no
 *     begin/change/commit window, just a single committed value.
 *     (Radix slider does not bind wheel events, so scroll-wheel
 *     interactions are not part of the slider's dispatch surface.)
 *
 * Parent responders bind via the `setValueNumber` slot in
 * `useResponderForm`; the setter's second argument is the phase, so
 * consumers can branch on the phase if they care about the drag
 * lifecycle (e.g. snapshot on `"begin"`, roll back on `"cancel"`).
 * Value-picker consumers that treat every intermediate value as a
 * committed value can declare a unary setter `(v: number) => void`
 * — TypeScript accepts it because the narrower signature is
 * assignable to the wider slot type.
 *
 * ## Slider value is semantic data, not appearance
 *
 * A slider's value flows through React's controlled-component cycle
 * because Radix's `SliderPrimitive.Root` reads its thumb position
 * from the `value` prop via `useControllableState`. When the prop
 * doesn't update, Radix never re-renders, and the thumb cannot move.
 * That means every drag frame must propagate through React state for
 * the slider to function at all — there is no "DOM-only" variant.
 *
 * This does not violate [L06]. L06 is about ephemeral visual effects
 * (hover highlights, focus rings, `data-state` toggles, active press
 * animations) — state whose only purpose is appearance. A slider's
 * value is semantic data: it represents a setting the user is
 * choosing, and the thumb position is derived from that data. Data
 * flowing through React to drive a visual is the normal React
 * contract, not an L06 violation.
 *
 * It also does not violate [L08]. L08 is explicitly scoped to
 * *mutation transactions* — the "preview → commit" UX pattern where
 * a draft mutation is visualized before being persisted (see
 * `gallery-mutation-tx.tsx`). A volume slider is not a mutation
 * transaction: there is no "uncommitted preview" state. Every
 * intermediate value IS a committed value.
 *
 * A TugSlider used inside a true mutation transaction would look
 * different: the consumer would buffer preview values in refs and
 * apply DOM-level appearance changes to the thing being previewed
 * (a mock card, a color swatch, a position), with the slider's own
 * value state tracking the draft throughout the drag. That's an
 * orthogonal concern from TugSlider's own rendering, which must use
 * the controlled-component cycle regardless.
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
 * ## Escape-mid-drag cancel phase
 *
 * Pressing Escape on the focused thumb while a drag is in progress
 * dispatches `phase: "cancel"` carrying the `value` that was current
 * at drag start (the same `value` payload that `"begin"` carried).
 * A parent responder that drove a live preview on `"change"` can
 * subscribe to `"cancel"` and roll back to the begin snapshot without
 * needing to buffer it themselves.
 *
 * After dispatching `"cancel"`, TugSlider suppresses any follow-up
 * Radix `onValueCommit` (via a `cancelledRef` flag) so the cancelled
 * drag doesn't double-fire as a `"commit"` once focus leaves the
 * thumb. The Escape key also blurs the thumb, preserving the pre-A2.6
 * keyboard behavior.
 *
 * Pointer-cancel (the OS aborts a pointer gesture — iOS native scroll
 * takes over, a system modal steals input, the pointer capture is
 * released involuntarily) IS distinguished from pointer-release. The
 * window-level `pointercancel` listener dispatches `phase: "cancel"`
 * with the pre-drag value snapshot and sets `cancelledRef` so any
 * follow-up spurious `onValueCommit` from Radix is suppressed. A
 * normal `pointerup` just clears `draggingRef` and lets Radix's
 * `onValueCommit` flow the commit dispatch.
 *
 * Laws: [L06] appearance via CSS, [L11] controls emit actions;
 *       responders handle actions, [L15] token-driven states,
 *       [L16] pairings declared, [L19] component authoring guide
 * Decisions: [D05] component token naming
 */

import "./tug-slider.css";

import React, { useCallback, useId, useLayoutEffect, useRef } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";
import type { TugFormatter } from "@/lib/tug-format";
import { TugValueInput } from "./tug-value-input";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useControlDispatch } from "./use-control-dispatch";
import { TUG_ACTIONS } from "./action-vocabulary";

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
    const controlDispatch = useControlDispatch();
    const fallbackSenderId = useId();
    const effectiveSenderId = senderId ?? fallbackSenderId;
    const draggingRef = useRef(false);
    // Snapshot of the controlled `value` at drag start — carried on
    // the "cancel" dispatch so a parent responder that held a live-
    // preview buffer can roll back to the pre-drag state without
    // needing to remember the begin payload themselves.
    const beginValueRef = useRef<number>(value);
    // Set by the Escape-cancel handler; consumed by handleSliderCommit
    // to suppress a follow-up Radix onValueCommit that would otherwise
    // turn a cancelled drag into a spurious "commit" dispatch.
    const cancelledRef = useRef(false);

    const dispatchSetValue = useCallback(
      (
        v: number,
        phase: "begin" | "change" | "commit" | "discrete" | "cancel",
      ) => {
        controlDispatch({
          action: TUG_ACTIONS.SET_VALUE,
          value: v,
          sender: effectiveSenderId,
          phase,
        });
      },
      [controlDispatch, effectiveSenderId],
    );

    // Live ref to the latest `dispatchSetValue` so the window-level
    // listener installed once at mount can call the current-render
    // closure without re-registering. Matches the live-proxy pattern
    // used by `useResponder` for action handlers. [L07]
    const dispatchSetValueRef = useRef(dispatchSetValue);
    dispatchSetValueRef.current = dispatchSetValue;

    // ---- Window-level pointerup / pointercancel handling ----
    //
    // Two distinct concerns share the same registration effect:
    //
    // 1. **pointerup (leak-recovery safety net).** Happy path: Radix
    //    fires `onValueCommit` on pointer release → `handleSliderCommit`
    //    clears `draggingRef`. Leak path: user pointerdowns on the
    //    slider, drags outside the browser window, and releases —
    //    Radix's pointerup may not fire, leaving `draggingRef` stuck
    //    at `true`. Our listener unconditionally clears the flag on
    //    any window pointerup. It does NOT dispatch — commit
    //    semantics remain Radix's responsibility via the normal
    //    `onValueCommit` path.
    //
    // 2. **pointercancel → cancel phase.** When the OS aborts a
    //    pointer gesture (pointer enters a native scroll on iOS, a
    //    system modal steals input, etc.), the browser fires
    //    `pointercancel` instead of `pointerup` and Radix does NOT
    //    fire `onValueCommit`. For an in-progress drag, this is
    //    semantically a cancel: the user did not intend the last
    //    preview value as the final state. We dispatch `phase:
    //    "cancel"` with the pre-drag snapshot (so parents can roll
    //    back a live preview to the begin value) and set
    //    `cancelledRef` so any follow-up spurious `onValueCommit`
    //    from Radix is suppressed.
    //
    // Registered via useLayoutEffect per [L03]: pointer-handler
    // dependencies must be installed before any browser event can
    // fire. The effect's empty dep array keeps the registration
    // stable; live-ref lookup on `dispatchSetValueRef` captures the
    // current-render closure without re-registering.
    useLayoutEffect(() => {
      if (typeof window === "undefined") return;

      const onPointerUp = () => {
        // Normal release — just clear the flag. Don't dispatch; Radix
        // handles commit through onValueCommit on its own.
        draggingRef.current = false;
      };

      const onPointerCancel = () => {
        if (draggingRef.current) {
          dispatchSetValueRef.current(beginValueRef.current, "cancel");
          draggingRef.current = false;
          cancelledRef.current = true;
        }
      };

      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      return () => {
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
      };
    }, []);

    // ---- Pointer tracking ----
    //
    // Start the drag here so the "begin" dispatch carries the
    // pre-change value (the current prop), letting parents snapshot
    // initial state for a live-preview rollback if they need one.
    // We also stash the pre-drag value in `beginValueRef` so a later
    // Escape-cancel can roll back to the same snapshot even after
    // "change" dispatches have mutated the controlled prop.
    const handlePointerDown = useCallback(
      (_e: React.PointerEvent<HTMLSpanElement>) => {
        if (effectiveDisabled) return;
        draggingRef.current = true;
        cancelledRef.current = false;
        beginValueRef.current = value;
        dispatchSetValue(value, "begin");
      },
      [effectiveDisabled, dispatchSetValue, value],
    );

    // ---- Radix value adapter ----
    //
    // While dragging → "change". Otherwise (keyboard: arrows, Home,
    // End, PageUp, PageDown) → "discrete". `handleValueCommit` below
    // will then no-op for non-drag paths so we don't double-dispatch.
    //
    // Second disabled gate: Radix itself refuses to call `onValueChange`
    // when `disabled` is true (see `disabled ? void 0 : handleSlideStart`
    // in react-slider/dist/index.mjs), but we guard here anyway as a
    // defence-in-depth safety net — if Radix ever regresses or a
    // consumer synthesizes a dispatch via other means, a disabled
    // slider still refuses to emit.
    const handleSliderChange = useCallback(
      (vals: number[]) => {
        if (effectiveDisabled) return;
        const next = vals[0];
        if (draggingRef.current) {
          dispatchSetValue(next, "change");
        } else {
          dispatchSetValue(next, "discrete");
        }
      },
      [dispatchSetValue, effectiveDisabled],
    );

    // ---- Radix commit adapter ----
    //
    // Fires at the end of both pointer drags and keyboard
    // interactions. We only dispatch "commit" if a pointer drag was
    // actually in progress AND was not cancelled via Escape —
    // otherwise the earlier onValueChange already dispatched
    // "discrete" (keyboard path) or the cancel handler already
    // rolled things back (Escape path), and this would be a
    // spurious duplicate.
    const handleSliderCommit = useCallback(
      (vals: number[]) => {
        if (effectiveDisabled) return;
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        if (!draggingRef.current) return;
        draggingRef.current = false;
        dispatchSetValue(vals[0], "commit");
      },
      [dispatchSetValue, effectiveDisabled],
    );

    // ---- Thumb keydown: Escape cancel + Enter/Escape blur ----
    //
    // Escape mid-drag dispatches `phase: "cancel"` with the pre-drag
    // value snapshot, so a parent responder that drove a live preview
    // on `"change"` can roll back. We then flip `cancelledRef` so any
    // follow-up Radix `onValueCommit` (e.g. from the drag ending when
    // focus leaves the thumb on blur) is suppressed and doesn't
    // double-fire as a "commit" after the cancel.
    //
    // Escape / Enter also blur the thumb — this is pre-A2.6 behavior
    // and is preserved. The blur itself may or may not reach Radix's
    // onValueCommit depending on whether a value actually changed
    // since begin; cancelledRef covers both paths.
    const handleThumbKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLSpanElement>) => {
        if (effectiveDisabled) return;
        if (e.key === "Escape") {
          if (draggingRef.current) {
            dispatchSetValue(beginValueRef.current, "cancel");
            draggingRef.current = false;
            cancelledRef.current = true;
          }
          e.preventDefault();
          e.currentTarget.blur();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      },
      [dispatchSetValue, effectiveDisabled],
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
            data-tug-focus="refuse"
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
