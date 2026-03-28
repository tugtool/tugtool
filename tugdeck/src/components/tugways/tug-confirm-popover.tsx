/**
 * TugConfirmPopover — Pre-built confirmation pattern composing TugPopover.
 *
 * Renders an anchored popover with a message, a cancel button, and a confirm
 * button. Supports both imperative (Promise-based ref) and declarative
 * (onConfirm/onCancel callback) usage modes.
 *
 * Composition: TugPopover owns the popover chrome (bg, border, shadow, animation).
 * This component adds only the confirmation-specific layout: message text and
 * button row. Never touches popover tokens. [L20]
 *
 * Laws: [L06] appearance via CSS/DOM, never React state,
 *       [L16] pairings declared,
 *       [L19] component authoring guide,
 *       [L20] token sovereignty — popover chrome owned by tug-popover.css
 */

import "./tug-confirm-popover.css";

import React from "react";
import {
  TugPopover,
  TugPopoverTrigger,
  TugPopoverContent,
} from "./tug-popover";
import { TugPushButton } from "./tug-push-button";
import type { TugButtonRole } from "./internal/tug-button";

/* ---------------------------------------------------------------------------
 * TugConfirmPopoverHandle
 * ---------------------------------------------------------------------------*/

/** Imperative handle for TugConfirmPopover. */
export interface TugConfirmPopoverHandle {
  /**
   * Opens the popover and returns a promise.
   * Resolves true if confirmed, false if cancelled or dismissed.
   */
  confirm: () => Promise<boolean>;
}

/* ---------------------------------------------------------------------------
 * TugConfirmPopoverProps
 * ---------------------------------------------------------------------------*/

/** TugConfirmPopover props. */
export interface TugConfirmPopoverProps {
  /** Confirmation message displayed in the popover body. */
  message: React.ReactNode;
  /**
   * Confirm button label.
   * @default "Confirm"
   */
  confirmLabel?: string;
  /**
   * Confirm button semantic role.
   * @default "danger"
   */
  confirmRole?: Extract<TugButtonRole, "danger" | "action" | "accent">;
  /**
   * Cancel button label.
   * @default "Cancel"
   */
  cancelLabel?: string;
  /** Called when confirmed (declarative mode). */
  onConfirm?: () => void;
  /** Called when cancelled or dismissed (declarative mode). */
  onCancel?: () => void;
  /**
   * Which side of the trigger to place the popover.
   * @default "bottom"
   */
  side?: "top" | "bottom" | "left" | "right";
  /**
   * Distance from trigger in px.
   * @default 6
   */
  sideOffset?: number;
  /** The trigger element. Wrapped with asChild by TugPopoverTrigger. */
  children: React.ReactElement;
}

/* ---------------------------------------------------------------------------
 * TugConfirmPopover
 * ---------------------------------------------------------------------------*/

/**
 * TugConfirmPopover — confirmation popover composing TugPopover.
 *
 * Use `ref.current.confirm()` for the imperative Promise API, or
 * supply `onConfirm`/`onCancel` for the declarative callback pattern.
 */
export const TugConfirmPopover = React.forwardRef<
  TugConfirmPopoverHandle,
  TugConfirmPopoverProps
>(function TugConfirmPopover(
  {
    message,
    confirmLabel = "Confirm",
    confirmRole = "danger",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
    side = "bottom",
    sideOffset = 6,
    children,
  },
  ref,
) {
  const [open, setOpen] = React.useState(false);

  // Resolver pair for imperative mode. Null when not in an active promise.
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  React.useImperativeHandle(ref, () => ({
    confirm(): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setOpen(true);
      });
    },
  }));

  function handleConfirm() {
    setOpen(false);
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
    onConfirm?.();
  }

  function handleCancel() {
    setOpen(false);
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    onCancel?.();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      // Dismissed by Escape or click-outside — treat as cancel.
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
      onCancel?.();
    }
    setOpen(nextOpen);
  }

  return (
    <TugPopover open={open} onOpenChange={handleOpenChange}>
      <TugPopoverTrigger asChild>{children}</TugPopoverTrigger>
      <TugPopoverContent side={side} sideOffset={sideOffset}>
        <div data-slot="tug-confirm-popover" className="tug-confirm-popover" data-side={side}>
          <div className="tug-confirm-popover-actions">
            <TugPushButton emphasis="ghost" size="sm" onClick={handleCancel}>
              {cancelLabel}
            </TugPushButton>
            <TugPushButton
              emphasis="filled"
              role={confirmRole}
              size="sm"
              onClick={handleConfirm}
            >
              {confirmLabel}
            </TugPushButton>
          </div>
          <div className="tug-confirm-popover-body">{message}</div>
        </div>
      </TugPopoverContent>
    </TugPopover>
  );
});
