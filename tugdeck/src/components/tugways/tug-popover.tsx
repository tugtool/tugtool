/**
 * TugPopover — Anchored interactive popup wrapping @radix-ui/react-popover.
 *
 * Exposes a compound API: TugPopover (root), TugPopoverTrigger (trigger),
 * TugPopoverContent (styled chrome with portal, arrow, animation), and
 * TugPopoverClose (re-export of Radix Close). Focus is trapped inside the
 * popover; Escape closes it and returns focus to the trigger.
 *
 * Laws: [L06] appearance via CSS/DOM, never React state,
 *       [L13] motion compliance — animation durations scale via --tug-timing,
 *       [L14] Radix Presence owns DOM lifecycle — use CSS keyframes,
 *       [L16] pairings declared,
 *       [L17] component aliases resolve to base tier in one hop,
 *       [L19] component authoring guide
 */

import "./tug-popover.css";

import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * TugPopover
 * ---------------------------------------------------------------------------*/

/** TugPopover props. */
export interface TugPopoverProps {
  /** Controlled open state. */
  open?: boolean;
  /** Default open state (uncontrolled). */
  defaultOpen?: boolean;
  /** Called when open state changes. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Whether popover is modal (traps focus, dims outside).
   * @default false
   */
  modal?: boolean;
  children: React.ReactNode;
}

/**
 * Thin wrapper on Radix Popover.Root. Place TugPopoverTrigger and
 * TugPopoverContent as direct children.
 */
export function TugPopover({
  open,
  defaultOpen,
  onOpenChange,
  modal = false,
  children,
}: TugPopoverProps) {
  return (
    <Popover.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      modal={modal}
    >
      {children}
    </Popover.Root>
  );
}

/* ---------------------------------------------------------------------------
 * TugPopoverTrigger
 * ---------------------------------------------------------------------------*/

/** TugPopoverTrigger props. */
export interface TugPopoverTriggerProps {
  /**
   * Render as child element, merging Radix behavior onto it.
   * @default true
   */
  asChild?: boolean;
  children: React.ReactNode;
}

/**
 * Thin wrapper on Radix Popover.Trigger. Defaults to asChild so the caller's
 * element is used directly as the trigger without a wrapper button.
 */
export function TugPopoverTrigger({ asChild = true, children }: TugPopoverTriggerProps) {
  return <Popover.Trigger asChild={asChild}>{children}</Popover.Trigger>;
}

/* ---------------------------------------------------------------------------
 * TugPopoverContent
 * ---------------------------------------------------------------------------*/

/** TugPopoverContent props. */
export interface TugPopoverContentProps {
  /**
   * Which side of the trigger to place the popover.
   * @selector [data-side="top"] | [data-side="bottom"] | [data-side="left"] | [data-side="right"]
   * @default "bottom"
   */
  side?: "top" | "bottom" | "left" | "right";
  /**
   * Alignment along the side axis.
   * @selector [data-align="start"] | [data-align="center"] | [data-align="end"]
   * @default "center"
   */
  align?: "start" | "center" | "end";
  /**
   * Distance from trigger in px.
   * @default 6
   */
  sideOffset?: number;
  /**
   * Show the arrow pointer.
   * @default false
   */
  arrow?: boolean;
  /** Additional CSS class names. */
  className?: string;
  children: React.ReactNode;
}

/**
 * Styled wrapper on Radix Portal + Content + optional Arrow. Owns the
 * popover chrome: background, border, shadow, border-radius, and
 * enter/exit animations. Internal spacing is left to the caller.
 */
export const TugPopoverContent = React.forwardRef<HTMLDivElement, TugPopoverContentProps>(
  function TugPopoverContent(
    { side = "bottom", align = "center", sideOffset = 6, arrow = false, className, children },
    ref,
  ) {
    return (
      <Popover.Portal>
        <Popover.Content
          ref={ref}
          data-slot="tug-popover"
          className={cn("tug-popover-content", className)}
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          {children}
          {arrow && <Popover.Arrow className="tug-popover-arrow" />}
        </Popover.Content>
      </Popover.Portal>
    );
  },
);

/* ---------------------------------------------------------------------------
 * TugPopoverClose
 * ---------------------------------------------------------------------------*/

/**
 * Re-export of Radix Popover.Close. Renders a button that closes the popover
 * when activated. Use with asChild to render a custom element.
 */
export const TugPopoverClose = Popover.Close;
