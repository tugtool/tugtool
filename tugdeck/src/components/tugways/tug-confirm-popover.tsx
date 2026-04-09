/**
 * TugConfirmPopover — Pre-built confirmation pattern composing TugPopover.
 *
 * Renders an anchored popover with a message, a cancel button, and a confirm
 * button. Exposes a single ergonomic entry point: the imperative Promise API
 * via `TugConfirmPopoverHandle.confirm()`, which opens the popover and
 * resolves when the user confirms, cancels, or dismisses it.
 *
 * Composition: TugPopover owns the popover chrome (bg, border, shadow,
 * animation). This component adds only the confirmation-specific layout:
 * message text and button row. Never touches popover tokens. [L20]
 *
 * ## Chain-native button wiring
 *
 * The confirm and cancel buttons dispatch `confirmDialog` / `cancelDialog`
 * through the responder chain rather than calling local handlers directly.
 * The popover registers itself as a responder via `useOptionalResponder`
 * with matching handlers that resolve the pending promise and close the
 * popover. The dispatch walks from the innermost responder (promoted by
 * the pointerdown capture from the button click to the `.tug-confirm-popover`
 * div, which carries `data-responder-id`) and lands back on the popover's
 * own handler — a short self-loop that keeps the resolver logic behind a
 * chain handler instead of inline button callbacks. [L11]
 *
 * Rendered outside a `ResponderChainProvider` (standalone previews,
 * tests), `useOptionalResponder` no-ops and the buttons fall back to
 * invoking the handler functions directly so the component still works
 * as a plain confirmation popover.
 *
 * ## External dismissal via observeDispatch
 *
 * While the popover is open, TugConfirmPopover subscribes to
 * `manager.observeDispatch`. Any action flowing through the chain that
 * is not this popover's own confirm/cancel dismisses the popover and
 * resolves the pending promise with `false`. Self-dispatches (confirm or
 * cancel from our own buttons) are skipped because by the time the
 * observer fires, the primary handler has already nulled `resolverRef`
 * — the observer sees the empty resolver and does nothing. This mirrors
 * the `tug-editor-context-menu` and `tug-popup-menu` precedents.
 *
 * Laws: [L06] appearance via CSS/DOM, never React state,
 *       [L11] controls emit actions; responders handle actions,
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
  type TugPopoverHandle,
} from "./tug-popover";
import { TugPushButton } from "./tug-push-button";
import type { TugButtonRole } from "./internal/tug-button";
import { useResponderChain } from "./responder-chain-provider";
import { useOptionalResponder } from "./use-responder";

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
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Parent responders disambiguate multi-popover
   * pages by matching this id when observing dispatches. [L11]
   */
  senderId?: string;
  /** The trigger element. Wrapped with asChild by TugPopoverTrigger. */
  children: React.ReactElement;
}

/* ---------------------------------------------------------------------------
 * TugConfirmPopover
 * ---------------------------------------------------------------------------*/

/**
 * TugConfirmPopover — confirmation popover composing TugPopover.
 *
 * Use `ref.current.confirm()` for the imperative Promise API. Internally
 * the confirm and cancel buttons dispatch `confirmDialog` / `cancelDialog`
 * through the chain; the popover's own registered handlers resolve the
 * promise and close.
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
    side = "bottom",
    sideOffset = 6,
    senderId: senderIdProp,
    children,
  },
  ref,
) {
  // Handle on the inner TugPopover. `confirm()` opens it; the
  // chain-action handlers close it. TugPopover now owns its open
  // state internally — there is no controlled open/onOpenChange
  // boundary.
  const popoverRef = React.useRef<TugPopoverHandle>(null);

  // Mirror of popover open state, used only to gate the
  // observeDispatch subscription below. Flipped to true in confirm()
  // and false in resolveAndClose.
  const [open, setOpen] = React.useState(false);

  // Resolver pair for the imperative confirm() Promise. Null when no
  // call is in flight.
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  // Chain manager — null when rendered outside a ResponderChainProvider
  // (standalone previews, unit tests). In that case the responder
  // registration is skipped and the buttons fall back to calling the
  // handler functions directly.
  const manager = useResponderChain();

  const fallbackResponderId = React.useId();
  const fallbackSenderId = React.useId();
  const responderId = fallbackResponderId;
  const senderId = senderIdProp ?? fallbackSenderId;

  // Primary handlers — resolve the pending promise and close. Shared by
  // the chain action handlers, the direct-invocation fallback used
  // when no provider is in scope, and the Radix dismissal path (which
  // reaches us via TugPopover's cancelDialog re-emission when Escape /
  // click-outside fires). Idempotent: a second call with the resolver
  // already null just closes redundantly.
  const resolveAndClose = React.useCallback((value: boolean) => {
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
    setOpen(false);
    popoverRef.current?.close();
  }, []);

  const handleConfirmAction = React.useCallback(() => {
    resolveAndClose(true);
  }, [resolveAndClose]);

  const handleCancelAction = React.useCallback(() => {
    resolveAndClose(false);
  }, [resolveAndClose]);

  // Register the popover as a chain responder so buttons inside the
  // portaled content can dispatch confirmDialog / cancelDialog and have
  // the walk land back here. Tolerant of no-provider contexts.
  const { responderRef } = useOptionalResponder({
    id: responderId,
    actions: {
      confirmDialog: handleConfirmAction,
      cancelDialog: handleCancelAction,
    },
  });

  // External dismissal: any chain activity while the popover is open
  // cancels it. Self-dispatches (our own confirm/cancel buttons) are
  // handled by the primary handler above before this observer fires,
  // so resolverRef is already null and the observer is a no-op for
  // them. Any other dispatch — a keyboard shortcut elsewhere, a
  // button click in an unrelated control — lands here with
  // resolverRef still set and triggers the cancel-and-close path.
  React.useLayoutEffect(() => {
    if (!open || !manager) return;
    return manager.observeDispatch(() => {
      if (resolverRef.current === null) return;
      resolveAndClose(false);
    });
  }, [open, manager, resolveAndClose]);

  React.useImperativeHandle(ref, () => ({
    confirm(): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setOpen(true);
        popoverRef.current?.open();
      });
    },
  }));

  // Button click handlers. In the normal chain-native path they
  // dispatch through the manager; with no provider in scope they call
  // the primary handler directly.
  function onConfirmClick() {
    if (!manager) {
      handleConfirmAction();
      return;
    }
    manager.dispatch({
      action: "confirmDialog",
      sender: senderId,
      phase: "discrete",
    });
  }

  function onCancelClick() {
    if (!manager) {
      handleCancelAction();
      return;
    }
    manager.dispatch({
      action: "cancelDialog",
      sender: senderId,
      phase: "discrete",
    });
  }

  // Suppress Safari/macOS button-focus quirk for clicks inside the
  // popover. macOS WebKit does not move focus to a <button> on click
  // (only keyboard Tab focuses buttons). When the user clicks a
  // confirm/cancel button, Safari walks up from the click target
  // looking for the nearest focusable ancestor — which lands on
  // Radix Popover's FocusScope container, an element OUTSIDE our
  // responder's data-responder-id. The focusin on that ancestor
  // promotes the wrong responder (usually the card), and the chain
  // dispatch from onClick finds no handler. Preventing mousedown's
  // default on non-text targets keeps focus where it was and lets
  // the pointerdown-promoted popover handle the dispatch. See
  // tug-sheet.tsx for the full rationale.
  function handleContentMouseDown(e: React.MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (
      target.closest(
        'input, textarea, [contenteditable="true"], [contenteditable=""]',
      )
    ) {
      return;
    }
    e.preventDefault();
  }

  return (
    <TugPopover ref={popoverRef}>
      <TugPopoverTrigger asChild>{children}</TugPopoverTrigger>
      <TugPopoverContent side={side} sideOffset={sideOffset}>
        <div
          data-slot="tug-confirm-popover"
          className="tug-confirm-popover"
          onMouseDown={handleContentMouseDown}
          data-side={side}
          ref={responderRef as (el: HTMLDivElement | null) => void}
        >
          <div className="tug-confirm-popover-actions">
            <TugPushButton emphasis="ghost" size="sm" onClick={onCancelClick}>
              {cancelLabel}
            </TugPushButton>
            <TugPushButton
              emphasis="filled"
              role={confirmRole}
              size="sm"
              onClick={onConfirmClick}
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
