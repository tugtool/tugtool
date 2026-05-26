/**
 * TugConfirmPopover — Pre-built confirmation pattern composing TugPopover.
 *
 * Renders an anchored popover with a message, a cancel button, and a confirm
 * button. Exposes two interchangeable APIs:
 *
 *  - **Imperative API** (legacy): `ref.current.confirm() → Promise<boolean>`
 *    opens the popover and resolves when the user confirms, cancels, or
 *    dismisses it. The popover is anchored to a `<children>` trigger
 *    element. Each call site mounts its own popover instance.
 *  - **Controlled API** (preferred): `open`, `anchorEl`, `onConfirm`,
 *    `onCancel` props. The caller drives the popover's open state from
 *    its own state; the popover anchors to an arbitrary external element
 *    via `<TugPopoverAnchor virtualRef>`. One instance can serve N
 *    distinct anchor targets — the canonical "in-list confirmation"
 *    shape (see [tugplan-tide-picker-redesign §D15](
 *    ../../roadmap/tugplan-tide-picker-redesign.md#d15-tug-confirm-popover-controlled)).
 *
 * The two APIs are mutually exclusive at the call site: a controlled-mode
 * caller passes `open` and skips the imperative `ref.confirm()` path
 * entirely; an imperative-mode caller passes `<children>` as the trigger
 * and never sets `open`. The component dev-warns when both shapes are
 * used together.
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
 * with matching handlers that resolve the pending promise (imperative
 * mode) or invoke the `onConfirm` / `onCancel` callbacks (controlled
 * mode), in either case ending in a close.
 *
 * Buttons dispatch via `sendToTarget(responderId, ...)` — explicitly
 * addressing the popover's own responder rather than relying on
 * pointerdown-driven first-responder promotion. The buttons (TugPushButton)
 * carry `data-tug-focus="refuse"`, which the responder-chain provider's
 * pointerdown handler treats as a signal to SKIP first-responder promotion.
 * Without explicit targeting, the dispatch would land on whatever ambient
 * responder happens to be first when the click fires (commonly a TugSheet
 * ancestor that also registers a `cancelDialog` handler), and clicking our
 * Cancel would dismiss the host modal instead of just the popover.
 * Targeting ourselves keeps the dispatch a true self-loop, independent of
 * promotion state. [L11]
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
 * component. Any chain action whose sender is NOT this popover's
 * own `senderId` resolves the pending confirmation negatively (via
 * `handleResolution(false)`) and triggers the close path. Self-
 * dispatches from our own confirm/cancel buttons carry our `senderId`
 * and are filtered out by the sender check. The same gating means the
 * subscription is a no-op when no confirmation is in flight (no
 * `confirm()` Promise pending in imperative mode AND `open !== true`
 * in controlled mode), so there is no need for a separate open-state
 * gate on the effect.
 *
 * **Double subscription with the underlying `TugPopover` is
 * intentional.** `TugPopoverContentShell` also subscribes to
 * `observeDispatch` while the popover is open, and its handler also
 * closes the popover on external chain activity. We need BOTH
 * subscriptions: the shell closes the popover, but it has no way to
 * resolve `TugConfirmPopover`'s pending promise or invoke its
 * controlled-mode callbacks. Without the confirm-popover subscription
 * here, an external dispatch would silently close the popover while
 * leaving the `confirm()` promise hanging or the parent's `pending*`
 * state stuck non-null. Do not "optimize" by deleting either
 * subscription.
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
  TugPopoverAnchor,
  type TugPopoverHandle,
} from "./tug-popover";
import { TugLabel } from "./tug-label";
import { TugPushButton } from "./tug-push-button";
import type { TugButtonRole } from "./internal/tug-button";
import { suppressButtonFocusShift } from "./internal/safari-focus-shift";
import { useResponderChain } from "./responder-chain-provider";
import { useOptionalResponder } from "./use-responder";
import { TUG_ACTIONS } from "./action-vocabulary";

/* ---------------------------------------------------------------------------
 * TugConfirmPopoverHandle
 * ---------------------------------------------------------------------------*/

/** Imperative handle for TugConfirmPopover (imperative-mode API only). */
export interface TugConfirmPopoverHandle {
  /**
   * Opens the popover and returns a promise.
   * Resolves true if confirmed, false if cancelled or dismissed.
   *
   * Imperative-mode only: callers in controlled mode (`open` prop set)
   * should not use this method. Calling it in controlled mode dev-warns
   * and returns a promise that never resolves.
   */
  confirm: () => Promise<boolean>;
}

/* ---------------------------------------------------------------------------
 * TugConfirmPopoverProps
 * ---------------------------------------------------------------------------*/

/** TugConfirmPopover props. */
export interface TugConfirmPopoverProps {
  /** Confirmation message displayed in the popover body. */
  message: string;
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
   * Which side of the trigger / anchor to place the popover.
   * @default "bottom"
   */
  side?: "top" | "bottom" | "left" | "right";
  /**
   * Distance from trigger / anchor in px.
   * @default 6
   */
  sideOffset?: number;
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Parent responders disambiguate multi-popover
   * pages by matching this id when observing dispatches. The sender
   * also gates this component's own `observeDispatch` listener — chain
   * traffic carrying this `senderId` is treated as a self-dispatch and
   * skipped. [L11]
   */
  senderId?: string;
  /**
   * Controlled-mode open state. When `open !== undefined`, the popover
   * runs in controlled mode: the caller drives open/close state and
   * receives confirm/cancel via the `onConfirm` / `onCancel` callbacks
   * instead of an awaited Promise. Pair with `anchorEl` to position
   * the popover against an arbitrary external element.
   *
   * Controlled mode is mutually exclusive with the imperative
   * `<children>` trigger + `ref.confirm()` API.
   */
  open?: boolean;
  /**
   * Controlled-mode anchor element. The popover positions itself
   * relative to this element via `<TugPopoverAnchor virtualRef>`.
   * Required (but allowed to be `null` transiently) in controlled mode;
   * ignored in imperative mode.
   *
   * When `open === true` but `anchorEl == null`, the popover stays
   * closed — useful for callers that resolve the anchor in a layout
   * effect after the open-flipping render. The popover opens on the
   * next render once both `open === true` and a non-null `anchorEl`
   * are observed.
   */
  anchorEl?: HTMLElement | null;
  /**
   * Controlled-mode confirm callback. Fires when the user clicks the
   * confirm button or presses the corresponding key binding. Use the
   * callback to update parent state — typically clearing whatever
   * pending-id field drove the popover's `open` to `true`.
   */
  onConfirm?: () => void;
  /**
   * Controlled-mode cancel callback. Fires when the user clicks the
   * cancel button, presses Escape, clicks outside the popover, or any
   * unrelated chain action causes external dismissal. Use the callback
   * to update parent state.
   */
  onCancel?: () => void;
  /**
   * Imperative-mode trigger element. Wrapped with `asChild` by
   * `TugPopoverTrigger`. Ignored in controlled mode (where the popover
   * is anchored to `anchorEl` and opened via the `open` prop).
   */
  children?: React.ReactElement;
}

/* ---------------------------------------------------------------------------
 * TugConfirmPopover
 * ---------------------------------------------------------------------------*/

/**
 * TugConfirmPopover — confirmation popover composing TugPopover.
 *
 * Use `ref.current.confirm()` for the imperative Promise API, or set
 * `open` + `anchorEl` + `onConfirm` + `onCancel` for the controlled API
 * (preferred for in-list confirmation flows). The two APIs are mutually
 * exclusive at the call site.
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
    open: openProp,
    anchorEl,
    onConfirm,
    onCancel,
    children,
  },
  ref,
) {
  const isControlled = openProp !== undefined;

  // Handle on the inner TugPopover. In imperative mode `confirm()` opens
  // it and chain-action handlers close it. In controlled mode the parent
  // owns open state via the `open` prop, but we still pass `popoverRef`
  // for parity with imperative-mode close-helpers.
  const popoverRef = React.useRef<TugPopoverHandle>(null);

  // Resolver for the imperative `confirm()` Promise. Null when no
  // imperative call is in flight or when running in controlled mode.
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  // Chain manager — null when rendered outside a ResponderChainProvider
  // (standalone previews, unit tests). The responder registration is
  // skipped and the buttons fall back to calling the handler functions
  // directly when no manager is in scope.
  const manager = useResponderChain();

  const fallbackResponderId = React.useId();
  const fallbackSenderId = React.useId();
  const responderId = fallbackResponderId;
  const senderId = senderIdProp ?? fallbackSenderId;

  // Refs for controlled-mode policy parameters. The chain handlers
  // and the observeDispatch listener read these at dispatch time so
  // they always see the latest callbacks and open state without
  // re-subscribing on every prop change.
  const isControlledRef = React.useRef(isControlled);
  isControlledRef.current = isControlled;
  const openPropRef = React.useRef(openProp);
  openPropRef.current = openProp;
  const onConfirmRef = React.useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const onCancelRef = React.useRef(onCancel);
  onCancelRef.current = onCancel;

  // Dev-mode warning when both API shapes are used together. The
  // controlled API takes precedence at runtime; the imperative
  // `<children>` trigger is silently ignored in controlled mode.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (isControlled && children !== undefined) {
      console.warn(
        "TugConfirmPopover: controlled mode (`open` prop) is mutually exclusive with " +
          "the imperative `children` trigger. Drop one or the other; the controlled API is preferred.",
      );
    }
  }, [isControlled, children]);

  // Single resolution path for both modes. Imperative mode: resolves
  // the pending Promise and closes via the popover handle. Controlled
  // mode: invokes the appropriate callback so the parent flips
  // `open` to false on its next render.
  const handleResolution = React.useCallback((value: boolean) => {
    if (resolverRef.current) {
      // Imperative mode.
      resolverRef.current(value);
      resolverRef.current = null;
      popoverRef.current?.close();
      return;
    }
    if (isControlledRef.current) {
      // Controlled mode.
      if (value) onConfirmRef.current?.();
      else onCancelRef.current?.();
      // Parent flips `open` -> TugPopover unmounts content. No imperative
      // close required.
      return;
    }
    // Neither mode active — spurious dispatch (no open in flight). Close
    // redundantly so a stale state can't keep the popover visible.
    popoverRef.current?.close();
  }, []);

  const handleConfirmAction = React.useCallback(() => {
    handleResolution(true);
  }, [handleResolution]);

  const handleCancelAction = React.useCallback(() => {
    handleResolution(false);
  }, [handleResolution]);

  // Register the popover as a chain responder so buttons inside the
  // portaled content can dispatch confirmDialog / cancelDialog and have
  // the walk land back here. Tolerant of no-provider contexts.
  const { responderRef } = useOptionalResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.CONFIRM_DIALOG]: handleConfirmAction,
      [TUG_ACTIONS.CANCEL_DIALOG]: handleCancelAction,
    },
  });

  // External dismissal: any chain activity (other than our own
  // confirm/cancel button dispatches, identified by sender id) cancels
  // the open confirmation.
  //
  //  - Imperative mode: gated on `resolverRef !== null`.
  //  - Controlled mode: gated on `openPropRef.current === true`.
  //
  // Self-dispatches (our own confirmDialog / cancelDialog buttons) carry
  // the popover's own `senderId` and are filtered out so we don't
  // re-fire `onCancel` after `onConfirm` has just landed. The
  // self-filter also makes the listener correct in controlled mode,
  // where the resolverRef-null guard alone is insufficient (the parent
  // hasn't yet flipped `open` to `false` when our self-dispatch's
  // observer runs — without the sender filter, we'd see "controlled
  // active" still true and call onCancel after onConfirm fired).
  React.useLayoutEffect(() => {
    if (!manager) return;
    return manager.observeDispatch((event) => {
      if (event.sender === senderId) return;
      const imperativeActive = resolverRef.current !== null;
      const controlledActive =
        isControlledRef.current && openPropRef.current === true;
      if (!imperativeActive && !controlledActive) return;
      handleResolution(false);
    });
  }, [manager, handleResolution, senderId]);

  React.useImperativeHandle(ref, () => ({
    confirm(): Promise<boolean> {
      if (process.env.NODE_ENV !== "production" && isControlledRef.current) {
        console.warn(
          "TugConfirmPopover.confirm(): imperative API called on a controlled-mode " +
            "popover (the `open` prop is set). The Promise will never resolve. Drive open/close " +
            "via the parent's state and `onConfirm`/`onCancel` callbacks instead.",
        );
      }
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        popoverRef.current?.open();
      });
    },
  }));

  // Button click handlers. In the normal chain-native path they
  // dispatch through the manager; with no provider in scope they call
  // the primary handler directly.
  //
  // We target the popover's OWN responder id explicitly via
  // `sendToTarget` rather than `sendToFirstResponder`. The buttons
  // (TugPushButton) carry `data-tug-focus="refuse"`, which blocks the
  // pointerdown promotion the responder-chain provider would otherwise
  // run on click — so the popover's responder is never promoted to
  // first responder and `sendToFirstResponder` would land on whatever
  // ambient responder happens to be first (e.g., a TugSheet ancestor
  // that also handles `cancelDialog`, in which case clicking our
  // Cancel would dismiss the sheet, not just the popover). Targeting
  // ourselves keeps the dispatch a true self-loop independent of
  // promotion state.
  function onConfirmClick() {
    if (!manager) {
      handleConfirmAction();
      return;
    }
    manager.sendToTarget(responderId, {
      action: TUG_ACTIONS.CONFIRM_DIALOG,
      sender: senderId,
      phase: "discrete",
    });
  }

  function onCancelClick() {
    if (!manager) {
      handleCancelAction();
      return;
    }
    manager.sendToTarget(responderId, {
      action: TUG_ACTIONS.CANCEL_DIALOG,
      sender: senderId,
      phase: "discrete",
    });
  }

  // ---- Anchor element wiring (controlled mode) ----
  //
  // Radix Popover.Anchor accepts a `virtualRef` (a ref-shaped object
  // whose `current` is anything with `getBoundingClientRect`). The
  // `current` is read on every Popper update, so a parent that swaps
  // `anchorEl` between renders gets correct repositioning without us
  // re-creating the ref object.
  //
  // The inner popover's effective open state in controlled mode is
  // `openProp && anchorEl != null`. This handles the brief race where
  // a parent flips `open` to `true` in render N and resolves the
  // anchor in a layout effect after that render — the popover stays
  // closed for one render, then opens on the next once `anchorEl` is
  // available. Without this gate, Radix would mount Popper with no
  // anchor and warn.
  const virtualAnchorRef = React.useRef<HTMLElement | null>(anchorEl ?? null);
  virtualAnchorRef.current = anchorEl ?? null;

  const effectiveOpenForControlled = isControlled
    ? openProp === true && anchorEl != null
    : undefined;

  // Explicit default-focus target on open. Driven by `confirmRole`
  // intent, not DOM order:
  //   - `danger`: Enter should NOT fire a destructive action, so
  //     focus lands on Cancel. Enter (a native button activation)
  //     dismisses.
  //   - `action` / `accent`: Enter accepts. Focus the Confirm
  //     button so native Enter-on-button activates it. (The filled
  //     +action default-button registration also wires the global
  //     Enter→default path, but explicit focus keeps the behaviour
  //     locked in even when the chain manager isn't in scope.)
  // We `preventDefault()` so Radix's FocusScope doesn't run its own
  // first-focusable walk afterwards.
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      event.preventDefault();
      const target =
        confirmRole === "danger"
          ? cancelButtonRef.current
          : confirmButtonRef.current;
      target?.focus();
    },
    [confirmRole],
  );

  return (
    <TugPopover
      ref={popoverRef}
      open={effectiveOpenForControlled}
      // No `onOpenChange` in controlled mode: the chain-action handlers
      // and observeDispatch own the close path; Radix's open-state
      // changes flow through the chain re-emit (DISMISS_POPOVER) and
      // back into our observer.
    >
      {!isControlled && children !== undefined && (
        <TugPopoverTrigger asChild>{children}</TugPopoverTrigger>
      )}
      {isControlled && (
        <TugPopoverAnchor virtualRef={virtualAnchorRef} />
      )}
      <TugPopoverContent
        side={side}
        sideOffset={sideOffset}
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        <div
          data-slot="tug-confirm-popover"
          className="tug-confirm-popover"
          onMouseDown={suppressButtonFocusShift}
          data-side={side}
          ref={responderRef as (el: HTMLDivElement | null) => void}
        >
          <div className="tug-confirm-popover-actions">
            <TugPushButton
              ref={cancelButtonRef}
              emphasis="ghost"
              size="sm"
              onClick={onCancelClick}
            >
              {cancelLabel}
            </TugPushButton>
            <TugPushButton
              ref={confirmButtonRef}
              emphasis="filled"
              role={confirmRole}
              size="sm"
              onClick={onConfirmClick}
            >
              {confirmLabel}
            </TugPushButton>
          </div>
          <TugLabel size="md" align="center">{message}</TugLabel>
        </div>
      </TugPopoverContent>
    </TugPopover>
  );
});
