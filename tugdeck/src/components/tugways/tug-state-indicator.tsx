/**
 * TugStateIndicator -- concentric dot + ring status indicator.
 *
 * Two visible elements clocked independently:
 *
 *  - **Dot** — a small solid circle whose tone class is set directly
 *    by React on every render. The dot's color updates on the next
 *    paint after `state` changes.
 *  - **Ring** — a thin circle border around the dot, animated by
 *    TugAnimator as a chain of finite one-shot pulses. One pulse
 *    runs at a time; when its `.finished` resolves, the chain reads
 *    the latest tone via a ref and either starts the next pulse (in
 *    the new tone) or stops (when the new state is static).
 *
 * The "pulse completes in its starting color" guarantee falls out of
 * pulses being finite one-shots. Each pulse runs to completion on
 * its own clock; the dot's color update during the pulse is
 * decoupled (different element, different class). Mid-pulse state
 * changes leave the in-flight pulse untouched; the new tone takes
 * over on the next pulse in the chain, or the ring vanishes if the
 * new tone is static.
 *
 * Laws: [L02] state arrives via props from the consumer's
 *       `useSyncExternalStore` subscription — this component owns no
 *       reducer-derived state.
 *       [L06] tone changes go through DOM (CSS class on the dot,
 *       imperative style on the ring), never React state.
 *       [L13] motion runs through TugAnimator (WAAPI) — finite one-
 *       shot pulses chained on `.finished`. No CSS `animation: ...
 *       infinite`; no manual `animationend` listeners.
 *       [L19] component authoring guide (file pair, module
 *       docstring, `data-slot`, `@selector` / `@default` on every
 *       CSS-targetable prop, `forwardRef`, `...rest` spread, merged
 *       `style`).
 *       [L20] composes TugTooltip without overriding tooltip-scoped
 *       tokens.
 *
 * @module components/tugways/tug-state-indicator
 */

import "./tug-state-indicator.css";

import React, { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import { TugTooltip } from "@/components/tugways/tug-tooltip";
import {
  animate,
  type TugAnimation,
} from "@/components/tugways/tug-animator";
import type {
  CodeSessionPhase,
  TransportState,
} from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TugStateIndicatorTone =
  | "default"
  | "success"
  | "caution"
  | "danger";

export type TugStateIndicatorLabelPosition = "left" | "right" | "hidden";

export interface TugStateIndicatorVisual {
  readonly tone: TugStateIndicatorTone;
  readonly animated: boolean;
  readonly label: string;
}

export interface TugStateIndicatorState {
  readonly phase: CodeSessionPhase;
  readonly transportState: TransportState;
  readonly interruptInFlight: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Map `phase × transportState × interruptInFlight` onto the
 * indicator's visible state. Transport health dominates phase: an
 * offline wire reads as `danger` regardless of the reducer's phase;
 * a restoring wire reads as `caution + pulse`. An in-flight
 * interrupt promotes the indicator to `caution + pulse` so the user
 * sees that the stop request has not been lost between request and
 * ack. Otherwise the phase enum drives the tone.
 *
 * Exported for unit tests and reuse by paired sibling components
 * (tooltip body, label) that need to dispatch on the same triple.
 */
export function indicatorVisualFor(
  state: TugStateIndicatorState,
): TugStateIndicatorVisual {
  if (state.transportState === "offline") {
    return { tone: "danger", animated: false, label: "offline" };
  }
  if (state.transportState === "restoring") {
    return { tone: "caution", animated: true, label: "restoring" };
  }
  if (state.interruptInFlight) {
    return { tone: "caution", animated: true, label: "interrupting" };
  }
  switch (state.phase) {
    case "errored":
      return { tone: "danger", animated: false, label: "errored" };
    case "submitting":
    case "awaiting_first_token":
    case "streaming":
    case "tool_work":
    case "replaying":
      return { tone: "success", animated: true, label: state.phase };
    case "awaiting_approval":
      return { tone: "caution", animated: true, label: "awaiting_approval" };
    case "idle":
    default:
      return { tone: "default", animated: false, label: "idle" };
  }
}

/**
 * Canonical human-readable phase title used by the visible label and
 * by the tooltip's bold title row. Exported so paired sibling
 * components and tests can dispatch on the same mapping.
 */
export const PHASE_HUMAN_LABEL: Record<CodeSessionPhase, string> = {
  idle: "Idle",
  submitting: "Submitting message",
  awaiting_first_token: "Awaiting first response",
  streaming: "Streaming response",
  tool_work: "Running tools",
  awaiting_approval: "Awaiting your approval",
  replaying: "Replaying session",
  errored: "Last turn errored",
};

/**
 * Resolve the visible-label text for a state: the consumer's
 * `label` prop wins if provided; otherwise the canonical
 * {@link PHASE_HUMAN_LABEL} entry for the state's phase. Exported
 * for unit tests.
 */
export function labelTextFor(
  state: TugStateIndicatorState,
  override?: string,
): string {
  if (override !== undefined) return override;
  return PHASE_HUMAN_LABEL[state.phase];
}

const PULSE_DURATION_MS = 1600;

const PULSE_KEYFRAMES: Keyframe[] = [
  { transform: "translate(-50%, -50%) scale(0.85)", opacity: 0.7 },
  { transform: "translate(-50%, -50%) scale(1.55)", opacity: 0 },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TugStateIndicatorProps
  extends React.ComponentPropsWithoutRef<"span"> {
  /**
   * The session triple the indicator dispatches on. Tone + animated
   * flag are derived via {@link indicatorVisualFor}.
   */
  state: TugStateIndicatorState;
  /**
   * Dot + ring diameter in CSS px. Applied as the
   * `--tugx-state-indicator-size` custom property on the root; the
   * dot's diameter is half this value.
   * @selector .tug-state-indicator (custom property --tugx-state-indicator-size)
   * @default 16
   */
  size?: number;
  /**
   * Where to render the human-readable phase label relative to the
   * dot/ring glyph. `"hidden"` suppresses the label and surfaces the
   * same content via {@link TugTooltip} on hover; `"left"` and
   * `"right"` render the label inline and suppress the tooltip
   * (the same information is already on screen).
   *
   * Per [L06], the position toggle is appearance — it drives the
   * `data-label-position` attribute on the root span and CSS reads
   * it; no React state in a wrapper.
   *
   * @selector [data-label-position="left"] | [data-label-position="right"] | [data-label-position="hidden"]
   * @default "right"
   */
  labelPosition?: TugStateIndicatorLabelPosition;
  /**
   * Optional override of the visible label text. When omitted, the
   * label resolves to {@link PHASE_HUMAN_LABEL}`[state.phase]`.
   */
  label?: string;
}

// ---------------------------------------------------------------------------
// TugStateIndicator
// ---------------------------------------------------------------------------

export const TugStateIndicator = React.forwardRef<
  HTMLSpanElement,
  TugStateIndicatorProps
>(function TugStateIndicator(
  {
    state,
    size = 16,
    labelPosition = "right",
    label,
    className,
    style,
    ...rest
  },
  forwardedRef,
) {
  const v = indicatorVisualFor(state);
  const ringRef = useRef<HTMLSpanElement | null>(null);
  const pulseRef = useRef<TugAnimation | null>(null);
  const latestRef = useRef<TugStateIndicatorVisual>(v);
  latestRef.current = v;

  // Start one finite WAAPI pulse on the ring, in the current tone,
  // and chain on `.finished` -- read the LATEST tone at that moment
  // (via `latestRef`, not closure capture) and decide what to do.
  const startPulse = useCallback(() => {
    const el = ringRef.current;
    if (!el) return;
    const tone = latestRef.current.tone;
    el.style.borderColor = `var(--tugx-state-indicator-tone-${tone})`;
    el.style.display = "block";

    const anim = animate(el, PULSE_KEYFRAMES, {
      duration: PULSE_DURATION_MS,
      easing: "ease-out",
    });
    pulseRef.current = anim;

    anim.finished
      .then(() => {
        pulseRef.current = null;
        const next = latestRef.current;
        if (next.animated) {
          startPulse();
        } else if (ringRef.current) {
          ringRef.current.style.display = "none";
        }
      })
      .catch(() => {
        // Cancellation path (unmount, snap-to-end). Nothing to clean
        // up beyond clearing the ref -- the cleanup effect handles
        // visibility on unmount, and a fresh pulse will be started
        // by the kickoff effect if the consumer remounts.
        pulseRef.current = null;
      });
  }, []);

  // Kickoff: when the derived visual changes, start a pulse if none
  // is in flight AND the new state is animated. If a pulse is
  // already running, leave it alone -- the chain's `.finished`
  // handler reads `latestRef` and decides at boundary time.
  useEffect(() => {
    if (pulseRef.current !== null) return;
    if (!v.animated) return;
    startPulse();
  }, [v.tone, v.animated, startPulse]);

  // Unmount: cancel the in-flight pulse so its `.then` handler does
  // not fire after the ring element is gone.
  useEffect(() => {
    return () => {
      const anim = pulseRef.current;
      if (anim) {
        anim.cancel("snap-to-end");
        pulseRef.current = null;
      }
    };
  }, []);

  const rootStyle: React.CSSProperties = {
    ["--tugx-state-indicator-size" as string]: `${size}px`,
    ...style,
  };

  const labelText = labelTextFor(state, label);
  const labelVisible = labelPosition !== "hidden";

  const root = (
    <span
      ref={forwardedRef}
      data-slot="tug-state-indicator"
      data-label-position={labelPosition}
      className={cn("tug-state-indicator", className)}
      aria-label={v.label}
      style={rootStyle}
      {...rest}
    >
      <span className="tug-state-indicator-glyph">
        <span
          className={cn(
            "tug-state-indicator-dot",
            `tug-state-indicator-dot--${v.tone}`,
          )}
        />
        <span ref={ringRef} className="tug-state-indicator-ring" />
      </span>
      {labelVisible && (
        <span className="tug-state-indicator-label">{labelText}</span>
      )}
    </span>
  );

  if (labelVisible) return root;

  return (
    <TugTooltip
      content={<TugStateIndicatorTooltip state={state} />}
      side="top"
    >
      {root}
    </TugTooltip>
  );
});

/* ---------------------------------------------------------------------------
 * TugStateIndicatorTooltip — bolded phase title + muted secondary
 * lines for transport degradation and interrupt-in-flight.
 * -------------------------------------------------------------------------*/

interface TugStateIndicatorTooltipProps {
  state: TugStateIndicatorState;
}

function TugStateIndicatorTooltip({
  state,
}: TugStateIndicatorTooltipProps): React.ReactElement {
  const secondaries: string[] = [];
  if (state.transportState === "offline") secondaries.push("Disconnected");
  if (state.transportState === "restoring") secondaries.push("Reconnecting…");
  if (state.interruptInFlight) secondaries.push("Interrupt requested");
  return (
    <div className="tug-state-indicator-tooltip">
      <div className="tug-state-indicator-tooltip-title">
        {PHASE_HUMAN_LABEL[state.phase]}
      </div>
      {secondaries.map((s) => (
        <div key={s} className="tug-state-indicator-tooltip-secondary">
          {s}
        </div>
      ))}
    </div>
  );
}
