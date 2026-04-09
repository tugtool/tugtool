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
 * TugConfirmPopover subscribes to `manager.observeDispatch` on mount
 * and keeps the subscription active for the lifetime of the
 * component. Any action flowing through the chain that is not this
 * popover's own confirm/cancel resolves the pending promise with
 * `false` and closes the popover. Self-dispatches (confirm or cancel
 * from our own buttons) are skipped because by the time the observer
 * fires, the primary handler has already nulled `resolverRef` — the
 * observer sees the empty resolver and returns without doing
 * anything. The same null-resolver guard makes the subscription a
 * no-op when the popover is closed (no `confirm()` call in flight),
 * so there is no need to gate the effect on an `open` state.
 *
 * **Double subscription with the underlying `TugPopover` is
 * intentional.** `TugPopoverContentShell` also subscribes to
 * `observeDispatch` while the popover is open, and its handler also
 * closes the popover on external chain activity. We need BOTH
 * subscriptions: the shell closes the popover, but it has no way to
 * resolve `TugConfirmPopover`'s pending promise. Without the
 * confirm-popover subscription here, an external dispatch would
 * silently close the popover while leaving the `confirm()` promise
 * hanging forever. Do not "optimize" by deleting either subscription.
 *
 * Laws: [L06] appearance via CSS/DOM, never React state,
 *       [L11] controls emit actions; responders handle actions,
 *       [L16] pairings declared,
 *       [L19] component authoring guide,
 *       [L20] token sovereignty — popover chrome owned by tug-popover.css
 *
 * @see ./internal/floating-surface-notes.ts for the cross-surface
 *      invariants table covering popover / confirm-popover / alert /
 *      sheet and the chain-reactive vs. modal semantic models.
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
import { suppressButtonFocusShift } from "./internal/safari-focus-shift";
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

  // Resolver for the imperative confirm() Promise. Null when no
  // call is in flight. Doubles as the observeDispatch subscription's
  // no-op guard — when `resolverRef.current === null`, the popover
  // is not active and the observer has nothing to do.
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

  // External dismissal: any chain activity cancels the popover if a
  // `confirm()` call is in flight. Self-dispatches (our own
  // confirm/cancel buttons) are handled by the primary handler above
  // before this observer fires, so resolverRef is already null and
  // the observer is a no-op for them. Any other dispatch — a
  // keyboard shortcut elsewhere, a button click in an unrelated
  // control — lands here with resolverRef still set and triggers
  // the cancel-and-close path. When no `confirm()` is in flight,
  // resolverRef is null and the observer returns without doing
  // anything, so the subscription runs for the lifetime of the
  // component without needing an explicit open-state gate.
  React.useLayoutEffect(() => {
    if (!manager) return;
    return manager.observeDispatch(() => {
      if (resolverRef.current === null) return;
      resolveAndClose(false);
    });
  }, [manager, resolveAndClose]);

  React.useImperativeHandle(ref, () => ({
    confirm(): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
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

  return (
    <TugPopover ref={popoverRef}>
      <TugPopoverTrigger asChild>{children}</TugPopoverTrigger>
      <TugPopoverContent side={side} sideOffset={sideOffset}>
        <div
          data-slot="tug-confirm-popover"
          className="tug-confirm-popover"
          onMouseDown={suppressButtonFocusShift}
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
