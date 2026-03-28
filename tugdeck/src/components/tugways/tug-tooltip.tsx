/**
 * TugTooltip — Hover/focus tooltip wrapping @radix-ui/react-tooltip.
 *
 * Provides TugTooltipProvider (shared delay config) and TugTooltip (inline
 * API: child element becomes the trigger, content + optional shortcut badge
 * rendered inside the tooltip bubble). Supports truncation-aware mode where
 * the tooltip is suppressed when the trigger content is not actually clipped.
 *
 * Laws: [L06] appearance via CSS/DOM — truncation suppress ref, not state,
 *       [L13] motion compliance — animation durations scale via --tug-timing,
 *       [L14] Radix Presence owns DOM lifecycle — use CSS keyframes,
 *       [L16] pairings declared, [L19] component authoring guide
 */

import "./tug-tooltip.css";

import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

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
  onOpenChange: controlledOnOpenChange,
  children,
}: TugTooltipProps) {
  // Internal open state for the truncated mode controlled path.
  const [internalOpen, setInternalOpen] = React.useState(false);

  // Ref holds suppress flag — appearance concern only, no re-render needed [L06].
  const suppressOpenRef = React.useRef(false);

  // Ref to the trigger DOM element for truncation measurement.
  const triggerElRef = React.useRef<Element | null>(null);

  // Determine whether we operate in controlled or uncontrolled mode.
  const isControlled = controlledOpen !== undefined || controlledOnOpenChange !== undefined;

  // The effective open value and change handler for Radix Root.
  const effectiveOpen = truncated
    ? isControlled
      ? controlledOpen
      : internalOpen
    : controlledOpen;

  function handleOpenChange(nextOpen: boolean) {
    // Never block close — only suppress open when truncated and not clipped. [L06]
    if (truncated && nextOpen === true && suppressOpenRef.current) {
      return;
    }
    if (truncated && !isControlled) {
      setInternalOpen(nextOpen);
    }
    controlledOnOpenChange?.(nextOpen);
  }

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

  // Build Radix Root props — only pass controlled values when present.
  const rootProps: React.ComponentPropsWithoutRef<typeof Tooltip.Root> = {
    ...(delayDuration !== undefined ? { delayDuration } : {}),
    ...(truncated || isControlled
      ? {
          open: effectiveOpen,
          onOpenChange: handleOpenChange,
        }
      : controlledOnOpenChange
        ? { onOpenChange: controlledOnOpenChange }
        : {}),
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
