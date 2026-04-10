/**
 * TugTooltip — Hover/focus tooltip wrapping @radix-ui/react-tooltip.
 *
 * Provides TugTooltipProvider (shared delay config) and TugTooltip (inline
 * API: child element becomes the trigger, content + optional shortcut badge
 * rendered inside the tooltip bubble). Supports truncation-aware mode where
 * the tooltip is suppressed when the trigger content is not actually clipped.
 *
 * ## Chain-reactive dismissal via observeDispatch
 *
 * While the tooltip is open, TugTooltip subscribes to
 * `manager.observeDispatch`. Any action flowing through the responder
 * chain — a keyboard shortcut, a button click elsewhere, a programmatic
 * dispatch — dismisses the tooltip. Rationale: a click that triggers
 * unrelated app activity is a strong signal the user is no longer
 * interested in the hovered content, and matches the macOS convention
 * of hover-surfaced affordances evaporating on any deliberate action.
 *
 * Tooltips never self-dispatch (they are display-only), so no blinkRef
 * guard is needed. When rendered outside a ResponderChainProvider
 * (standalone previews, unit tests that don't mount a provider),
 * `useResponderChain()` returns null and the subscription is silently
 * skipped — Radix's own hover/focus dismissal keeps working unchanged.
 *
 * To gate the subscription and close the tooltip from JS, TugTooltip
 * now always tracks a local mirror of Radix's open state via
 * `onOpenChange`. In pure uncontrolled mode this is a no-op relative
 * to prior behavior — Radix still calls `onOpenChange(true/false)`
 * during hover/focus, we update the mirror, and Radix sees the mirror
 * flow back through the `open` prop. Truncation suppression and
 * controlled-mode forwarding behave exactly as before.
 *
 * Laws: [L06] appearance via CSS/DOM — truncation suppress ref, not state,
 *       [L11] controls emit actions; responders handle actions,
 *       [L13] motion compliance — animation durations scale via --tug-timing,
 *       [L14] Radix Presence owns DOM lifecycle — use CSS keyframes,
 *       [L16] pairings declared, [L19] component authoring guide
 */

import "./tug-tooltip.css";

import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";

/* ---------------------------------------------------------------------------
 * TugTooltipProvider
 * ---------------------------------------------------------------------------*/

/** TugTooltipProvider props. */
export interface TugTooltipProviderProps {
  /**
   * Delay in ms before tooltip appears on hover.
   * @default 500
   */
  delayDuration?: number;
  /**
   * Window in ms after closing where the next tooltip opens instantly.
   * @default 300
   */
  skipDelayDuration?: number;
  /** App subtree. */
  children: React.ReactNode;
}

/**
 * Thin wrapper around Radix Tooltip.Provider. Place once at the app root
 * near other top-level providers (TugThemeProvider, ResponderChainProvider).
 */
export function TugTooltipProvider({
  delayDuration = 500,
  skipDelayDuration = 300,
  children,
}: TugTooltipProviderProps) {
  return (
    <Tooltip.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration}>
      {children}
    </Tooltip.Provider>
  );
}

/* ---------------------------------------------------------------------------
 * TugTooltip
 * ---------------------------------------------------------------------------*/

/** TugTooltip props. */
export interface TugTooltipProps {
  /**
   * Content rendered inside the tooltip bubble. Accepts ReactNode for rich
   * multi-line tooltips.
   */
  content: React.ReactNode;
  /**
   * Keyboard shortcut string rendered as a styled kbd badge alongside content.
   * @selector .tug-tooltip-shortcut
   */
  shortcut?: string;
  /**
   * Which side of the trigger to place the tooltip.
   * @selector [data-side="top"] | [data-side="bottom"] | [data-side="left"] | [data-side="right"]
   * @default "top"
   */
  side?: "top" | "bottom" | "left" | "right";
  /**
   * Alignment along the side axis.
   * @selector [data-align="start"] | [data-align="center"] | [data-align="end"]
   * @default "center"
   */
  align?: "start" | "center" | "end";
  /**
   * Distance in px from the trigger element.
   * @default 6
   */
  sideOffset?: number;
  /**
   * Render the directional arrow pointer.
   * @default true
   */
  arrow?: boolean;
  /** Override delay duration for this specific tooltip. */
  delayDuration?: number;
  /**
   * Only show when the trigger content is visually clipped (overflow ellipsis).
   * Measures scrollWidth vs clientWidth (and scrollHeight vs clientHeight) on
   * each pointerenter. Suppresses open when content fits; never blocks close.
   * Uses a ref for suppress state — no React state, no re-render. [L06]
   * @default false
   */
  truncated?: boolean;
  /** Controlled open state. */
  open?: boolean;
  /**
   * Seed the initial open state for uncontrolled mode. Useful for tests
   * that want to render a pre-opened tooltip without driving pointer
   * events through Radix. Ignored in controlled mode (the consumer owns
   * the state via `open`).
   * @default false
   */
  defaultOpen?: boolean;
  /** Controlled state callback. */
  onOpenChange?: (open: boolean) => void;
  /** The trigger element. Rendered with Radix asChild — no wrapper div. */
  children: React.ReactElement;
}

/**
 * Inline tooltip API. Wrap any element to give it a tooltip:
 *
 * ```tsx
 * <TugTooltip content="Save document" shortcut="⌘S">
 *   <button>💾</button>
 * </TugTooltip>
 * ```
 *
 * Does not use forwardRef — TugTooltip is a wrapper, not a DOM element.
 */
export function TugTooltip({
  content,
  shortcut,
  side = "top",
  align = "center",
  sideOffset = 6,
  arrow = true,
  delayDuration,
  truncated = false,
  open: controlledOpen,
  defaultOpen,
  onOpenChange: controlledOnOpenChange,
  children,
}: TugTooltipProps) {
  // Local mirror of Radix's open state. Always tracked (not just in
  // truncated mode) so the observeDispatch effect below has a stable
  // boolean to gate on and a setter to drive chain-reactive dismissal.
  // Radix is bound to this via `open` / `onOpenChange` below, so hover /
  // focus events still flow through Radix's delay machinery normally —
  // Radix calls `onOpenChange(true)` after the delay, we update the
  // mirror, and the mirror flows back into Radix through the `open`
  // prop on the next render.
  const [openMirror, setOpenMirror] = React.useState<boolean>(defaultOpen ?? false);

  // Ref holds suppress flag — appearance concern only, no re-render needed [L06].
  const suppressOpenRef = React.useRef(false);

  // Ref to the trigger DOM element for truncation measurement.
  const triggerElRef = React.useRef<Element | null>(null);

  // Determine whether we operate in controlled or uncontrolled mode.
  // Controlled = the consumer owns the open state via the `open` prop.
  // `onOpenChange` alone does not make the component controlled — a
  // consumer may observe state changes without owning the value.
  const isControlled = controlledOpen !== undefined;

  // The effective open value handed to Radix. In controlled mode the
  // consumer owns it; otherwise we use our local mirror. Truncation
  // suppression is applied inside handleOpenChange at the open
  // transition, not here.
  const effectiveOpen = isControlled ? controlledOpen : openMirror;

  function handleOpenChange(nextOpen: boolean) {
    // Never block close — only suppress open when truncated and not clipped. [L06]
    if (truncated && nextOpen === true && suppressOpenRef.current) {
      return;
    }
    if (!isControlled) {
      setOpenMirror(nextOpen);
    }
    controlledOnOpenChange?.(nextOpen);
  }

  // Chain-reactive dismissal via observeDispatch. [L11]
  //
  // Manager is null when rendered outside a ResponderChainProvider
  // (standalone previews, unit tests without a provider); the effect
  // then short-circuits and Radix's own hover/focus dismissal keeps
  // working unchanged. Tooltips never self-dispatch, so no blink guard
  // is needed — any action flowing through the chain dismisses.
  //
  // Uses useLayoutEffect per [L03] so the subscription is in place
  // before any paint that could deliver a dispatch.
  const manager = useResponderChain();
  React.useLayoutEffect(() => {
    if (!effectiveOpen || !manager) return;
    return manager.observeDispatch(() => {
      handleOpenChange(false);
    });
    // handleOpenChange is a fresh closure each render but its behavior
    // is stable for a given (isControlled, controlledOnOpenChange, truncated)
    // tuple; re-subscribing on every render would churn the effect,
    // so we intentionally narrow deps to the gating values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOpen, manager]);

  // Callback ref that captures the trigger DOM element for measurement.
  // Merged onto the Radix Trigger child via React.cloneElement on the asChild path.
  const triggerCallbackRef = React.useCallback((el: Element | null) => {
    triggerElRef.current = el;
  }, []);

  function handlePointerEnter() {
    if (!truncated) return;
    const el = triggerElRef.current;
    if (!el) {
      suppressOpenRef.current = false;
      return;
    }
    // Synchronous DOM measurement — one read, no layout thrash.
    const isClipped =
      el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
    suppressOpenRef.current = !isClipped;
  }

  // Radix Root props: always bind open + onOpenChange to our mirror so
  // the observeDispatch effect has a stable gate and a programmatic
  // close path. delayDuration is forwarded only when the caller
  // overrides the provider-level default.
  const rootProps: React.ComponentPropsWithoutRef<typeof Tooltip.Root> = {
    ...(delayDuration !== undefined ? { delayDuration } : {}),
    open: effectiveOpen,
    onOpenChange: handleOpenChange,
  };

  // Clone the child to attach the callback ref + pointerEnter handler for
  // truncation measurement. The Radix asChild trigger merges these.
  const trigger = truncated
    ? React.cloneElement(children, {
        ref: triggerCallbackRef,
        onPointerEnter: (e: React.PointerEvent) => {
          handlePointerEnter();
          // Preserve any existing onPointerEnter on the child.
          const existing = (children.props as Record<string, unknown>).onPointerEnter;
          if (typeof existing === "function") {
            (existing as (e: React.PointerEvent) => void)(e);
          }
        },
      } as Record<string, unknown>)
    : children;

  return (
    <Tooltip.Root {...rootProps}>
      <Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          data-slot="tug-tooltip"
          className={cn("tug-tooltip-content")}
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          {content}
          {shortcut && <kbd className="tug-tooltip-shortcut">{shortcut}</kbd>}
          {arrow && <Tooltip.Arrow className="tug-tooltip-arrow" />}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
