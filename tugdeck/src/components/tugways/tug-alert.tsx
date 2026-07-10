/**
 * TugAlert — App-modal dialog for critical interruptions requiring explicit user response.
 *
 * Wraps @radix-ui/react-alert-dialog. Exposes a single ergonomic entry
 * point: the imperative Promise API via `TugAlertHandle.alert(options)`.
 * Two usage patterns:
 *
 * - **Singleton via TugAlertProvider.** Mount one `<TugAlertProvider>`
 *   in the root tree, then call `const showAlert = useTugAlert()` from
 *   any descendant. The hook resolves the Promise the provider's
 *   singleton opens.
 * - **Inline with a local ref.** Mount `<TugAlert ref={alertRef} title="..." />`
 *   directly and call `alertRef.current.alert(options)`. Per-call
 *   overrides stack on top of the props for title, message, labels,
 *   icon, and confirm role.
 *
 * ## Chain-native button wiring
 *
 * The confirm and cancel buttons dispatch `confirmDialog` /
 * `cancelDialog` through the responder chain rather than calling local
 * handlers directly. The alert registers itself as a responder via
 * `useOptionalResponder` with matching handlers that resolve the
 * pending promise and close. The dispatch walks from the innermost
 * responder (promoted by the pointerdown capture from the button click
 * to the `.tug-alert-content` element, which carries
 * `data-responder-id`) and lands back on the alert's own handler — the
 * same short self-loop used by TugConfirmPopover. [L11]
 *
 * The Radix `AlertDialog.Cancel` / `AlertDialog.Action` wrappers are
 * retained so their accessibility affordances (Enter-to-confirm,
 * initial focus on the action button, Escape-to-cancel via
 * DismissableLayer) continue to work. When Radix's internal click
 * fires `onOpenChange(false)` alongside our chain dispatch, the
 * second resolveAndClose call is a no-op because the resolver ref was
 * already nulled by the first.
 *
 * Rendered outside a `ResponderChainProvider`, `useOptionalResponder`
 * no-ops and the buttons fall back to invoking the handler functions
 * directly so the component still works as a plain alert dialog.
 *
 * ## No observeDispatch subscription — modal semantics
 *
 * Unlike TugConfirmPopover (which is an anchored popover and dismisses
 * on any external chain activity), TugAlert is modal: the overlay
 * physically blocks clicks outside, and the user is expected to
 * explicitly confirm or cancel. A chain-driven auto-dismiss would
 * surprise users whose alert disappears because an unrelated keyboard
 * shortcut fired. The alert stays open until the user responds via the
 * confirm button, the cancel button, Escape, or Cmd+. — or the host
 * calls `TugAlertHandle.dismiss()` because the condition that opened
 * the alert no longer holds (resolves the pending promise with false).
 *
 * Laws: [L06] appearance via CSS,
 *       [L11] controls emit actions; responders handle actions,
 *       [L16] pairings declared,
 *       [L19] component authoring guide,
 *       [L20] token sovereignty (composes TugButton)
 *
 * @see ./internal/floating-surface-notes.ts for the cross-surface
 *      invariants table covering popover / confirm-popover / alert /
 *      sheet and the chain-reactive vs. modal semantic models.
 */

import "./tug-alert.css";

import React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { icons } from "lucide-react";
import { TugPushButton } from "./tug-push-button";
import { TugListRow } from "./tug-list-row";
import type { TugButtonEmphasis, TugButtonRole } from "./internal/tug-button";
import { suppressButtonFocusShift } from "./internal/safari-focus-shift";
import { useResponderChain } from "./responder-chain-provider";
import { useOptionalResponder } from "./use-responder";
import { TUG_ACTIONS } from "./action-vocabulary";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import { useFocusTrap } from "./use-focus-trap";
import { useFocusManager } from "./use-focusable";
import { useSpatialOrder } from "./use-spatial-order";
import type { SpatialOrder } from "./spatial-order";

/* ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------*/

/** Map confirmRole to a default Lucide icon name (PascalCase — matches lucide-react `icons` keys). */
function defaultIconForRole(role: TugButtonRole): string {
  if (role === "danger") {
    return "TriangleAlert";
  }
  return "Info";
}

/* ---------------------------------------------------------------------------
 * TugAlertChoice
 * ---------------------------------------------------------------------------*/

/**
 * One selectable action in the multi-action {@link TugAlertHandle.choose} form.
 * Each choice renders as its own button in the action row and resolves the
 * `choose()` promise with its {@link id} when picked. The default choice
 * (exactly one — flagged via {@link isDefault}, or the last when none is
 * flagged) wears the recommended-default look and is the Return target; the
 * rest render `outlined`, at Cancel's weight, following the classic Mac HIG
 * three-button layout (Don't Save / Cancel / Save).
 */
export interface TugAlertChoice {
  /** Opaque value the `choose()` promise resolves to when this row is picked. */
  id: string;
  /** Primary line of the row. */
  label: string;
  /**
   * Secondary explanatory line under {@link label}. When any choice carries a
   * `description` (or `icon`), the chooser renders as a vertical stack of rich
   * rows (leading icon + title + description) rather than a compact button row.
   */
  description?: string;
  /** Lucide icon name (PascalCase) shown at the leading edge of the row. */
  icon?: string;
  /**
   * Color domain for the row.
   * @default "action"
   */
  role?: TugButtonRole;
  /**
   * Visual weight. Defaults to `primary` for the default choice and
   * `outlined` for the rest.
   */
  emphasis?: TugButtonEmphasis;
  /**
   * Marks this as the Return-default (recommended-default look, seeded key
   * view). At most one choice should set it; when none does, the last choice
   * is the default.
   */
  isDefault?: boolean;
}

/* ---------------------------------------------------------------------------
 * TugAlertHandle
 * ---------------------------------------------------------------------------*/

/** Imperative handle for TugAlert. */
export interface TugAlertHandle {
  /**
   * Opens the alert dialog and returns a promise.
   * Resolves true if confirmed, false if cancelled or dismissed.
   */
  alert(options?: {
    title?: string;
    message?: string | React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string | null;
    confirmRole?: TugButtonRole;
    /** Lucide icon name override. Defaults to role-based icon. */
    icon?: string;
  }): Promise<boolean>;
  /**
   * Opens the alert as a multi-action chooser: the icon/title/message with an
   * ordered row of {@link choices} buttons plus an optional Cancel. Resolves
   * with the chosen choice's `id`, or `null` on Cancel / Escape / Cmd-. /
   * {@link dismiss}. The generalization of `alert()` past a single confirm
   * button — a closed arrow ring spans Cancel + every choice.
   */
  choose(options: {
    title?: string;
    message?: string | React.ReactNode;
    /** Lucide icon name override. Defaults to role-based icon. */
    icon?: string;
    /**
     * Cancel button text; pass `null` to omit it.
     * @default "Cancel"
     */
    cancelLabel?: string | null;
    /** The selectable actions, rendered left-to-right after Cancel. */
    choices: TugAlertChoice[];
  }): Promise<string | null>;
  /**
   * Closes the alert programmatically, resolving any pending `alert()`
   * promise with false (or a pending `choose()` promise with null). For
   * hosts whose precondition evaporates while the alert is open (e.g. the
   * empty-deck offer when a card lands via Cmd-N). No-op when closed.
   */
  dismiss(): void;
}

/* ---------------------------------------------------------------------------
 * TugAlertProps
 * ---------------------------------------------------------------------------*/

/** TugAlert props. */
export interface TugAlertProps {
  /** Alert title (required). */
  title: string;
  /** Body content. */
  message?: string | React.ReactNode;
  /**
   * Confirm button text.
   * @default "OK"
   */
  confirmLabel?: string;
  /**
   * Cancel button text. Pass null to hide cancel button.
   * @default "Cancel"
   */
  cancelLabel?: string | null;
  /**
   * Semantic role for confirm button.
   * @default "action"
   */
  confirmRole?: TugButtonRole;
  /**
   * Lucide icon name. Defaults to a role-based icon.
   * Pass an empty string to suppress the icon.
   */
  icon?: string;
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Disambiguates multi-alert pages when a
   * parent responder observes dispatches by sender. [L11]
   */
  senderId?: string;
}

/* ---------------------------------------------------------------------------
 * TugAlert
 * ---------------------------------------------------------------------------*/

/**
 * TugAlert — app-modal dialog composing Radix AlertDialog.
 *
 * Use `ref.current.alert(options)` for the imperative Promise API, or
 * mount under `TugAlertProvider` and call `useTugAlert()` for the
 * singleton pattern.
 */
export const TugAlert = React.forwardRef<TugAlertHandle, TugAlertProps>(
  function TugAlert(
    {
      title: titleProp,
      message: messageProp,
      confirmLabel: confirmLabelProp = "OK",
      cancelLabel: cancelLabelProp = "Cancel",
      confirmRole: confirmRoleProp = "action",
      icon: iconProp,
      senderId: senderIdProp,
    },
    ref,
  ) {
    const overlayRoot = useCanvasOverlay();
    const [open, setOpen] = React.useState(false);

    // Override options set by the imperative alert() / choose() call. `mode`
    // discriminates the single-confirm form (default) from the multi-action
    // chooser; `choices` is populated only in "choose" mode.
    const overrideRef = React.useRef<{
      mode?: "confirm" | "choose";
      title?: string;
      message?: string | React.ReactNode;
      confirmLabel?: string;
      cancelLabel?: string | null;
      confirmRole?: TugButtonRole;
      icon?: string;
      choices?: TugAlertChoice[];
    } | null>(null);

    // Resolver for imperative mode. Null when not in an active promise. The
    // value is `boolean` for `alert()` and `string | null` for `choose()`.
    const resolverRef = React.useRef<
      ((value: boolean | string | null) => void) | null
    >(null);

    // The value a dismissal (Cancel / Escape / Cmd-. / dismiss()) resolves
    // with — `false` for `alert()`, `null` for `choose()`. Set at open.
    const dismissValueRef = React.useRef<false | null>(false);

    // Chain manager — null when rendered outside a ResponderChainProvider
    // (standalone previews, unit tests). Buttons fall back to calling
    // the primary handler directly.
    const manager = useResponderChain();

    const fallbackResponderId = React.useId();
    const fallbackSenderId = React.useId();
    const responderId = fallbackResponderId;
    const senderId = senderIdProp ?? fallbackSenderId;

    // Primary handler — resolves the pending promise and closes the
    // dialog. Shared by the chain action handlers, the no-provider
    // fallback on button click, and the Radix onOpenChange dismissal
    // path (Escape, Cmd+., AlertDialog.Cancel/Action's built-in close).
    // Idempotent: a second call with the resolver already null just
    // closes redundantly, which matches the "two converging close
    // paths" expectation when Radix's Cancel/Action wrappers fire
    // alongside the chain dispatch.
    const resolveAndClose = React.useCallback((value: boolean | string | null) => {
      if (resolverRef.current) {
        resolverRef.current(value);
        resolverRef.current = null;
      }
      setOpen(false);
    }, []);

    const handleConfirmAction = React.useCallback(() => {
      resolveAndClose(true);
    }, [resolveAndClose]);

    // Dismissal resolves the mode-appropriate negative value (`false` for
    // alert(), `null` for choose()).
    const handleCancelAction = React.useCallback(() => {
      resolveAndClose(dismissValueRef.current);
    }, [resolveAndClose]);

    // Register the alert as a chain responder so the buttons inside
    // the portaled content can dispatch confirmDialog / cancelDialog
    // and have the walk land back here. Tolerant of no-provider
    // contexts.
    const { responderRef } = useOptionalResponder({
      id: responderId,
      actions: {
        [TUG_ACTIONS.CONFIRM_DIALOG]: handleConfirmAction,
        [TUG_ACTIONS.CANCEL_DIALOG]: handleCancelAction,
      },
    });

    // Engine focus trap ([P06]): the alert is the last dismissable surface that
    // sat entirely outside the engine model — "single authority" is false while
    // it does. Push a trapped mode while open so the engine's Escape ladder owns
    // its Escape (calling `handleCancelAction`, the same cancel its CANCEL_DIALOG
    // handler / Radix dismissal ran), the key view is captured/restored on close,
    // and the close-focus DOM write is the trap's single teardown writer wired to
    // `AlertDialog.Content` below. App-modal blocking is unchanged — Radix's own
    // overlay + focus scope still block everything; only Escape routing moves.
    const { FocusModeScope, onCloseAutoFocus } = useFocusTrap({
      active: open,
      deferDomFocusToTeardown: true,
      onEscapeDismiss: handleCancelAction,
    });

    React.useImperativeHandle(ref, () => ({
      alert(options) {
        return new Promise<boolean>((resolve) => {
          overrideRef.current = { mode: "confirm", ...options };
          dismissValueRef.current = false;
          resolverRef.current = resolve as (v: boolean | string | null) => void;
          setOpen(true);
        });
      },
      choose(options) {
        return new Promise<string | null>((resolve) => {
          overrideRef.current = { mode: "choose", ...options };
          dismissValueRef.current = null;
          resolverRef.current = resolve as (v: boolean | string | null) => void;
          setOpen(true);
        });
      },
      dismiss() {
        resolveAndClose(dismissValueRef.current);
      },
    }));

    // Resolve effective values: override (imperative) takes precedence over props.
    const override = overrideRef.current;
    const mode = override?.mode ?? "confirm";
    const title = override?.title ?? titleProp;
    const message = override?.message ?? messageProp;
    const confirmLabel = override?.confirmLabel ?? confirmLabelProp;
    const cancelLabel = override !== null && override !== undefined && "cancelLabel" in override
      ? override.cancelLabel
      : cancelLabelProp;
    const confirmRole = override?.confirmRole ?? confirmRoleProp;
    const iconName = override !== null && override !== undefined && "icon" in override
      ? override.icon
      : iconProp;

    // Resolve icon component: explicit name, role-based default, or nothing if "".
    const resolvedIconName = iconName !== undefined
      ? iconName
      : defaultIconForRole(confirmRole);

    const IconComponent = resolvedIconName
      ? (icons[resolvedIconName as keyof typeof icons] ?? null)
      : null;

    // ---- Action buttons ----
    // The generalized button model: Cancel (order 0, when present) followed by
    // an ordered list of action buttons (orders 1..N). In "confirm" mode that
    // list is the single confirm button; in "choose" mode it is one button per
    // choice. Exactly one action button is the Radix Action / Return default —
    // the confirm button, or the choice flagged `isDefault` (else the last).
    const CANCEL_ORDER = 0;
    const hasCancel = cancelLabel !== null;
    interface ActionButtonSpec {
      key: string;
      order: number;
      label: React.ReactNode;
      /** Secondary line + leading icon, present only for rich chooser rows. */
      description?: string;
      icon?: string;
      emphasis: TugButtonEmphasis;
      role: TugButtonRole;
      /** Wrapped in AlertDialog.Action + the Return default. */
      isDefault: boolean;
      onClick: () => void;
    }
    const actionButtons: ActionButtonSpec[] = React.useMemo(() => {
      if (mode === "choose") {
        const choices = override?.choices ?? [];
        const flagged = choices.findIndex((c) => c.isDefault);
        const defaultIndex = flagged >= 0 ? flagged : choices.length - 1;
        return choices.map((choice, i) => {
          // Rich rows read as a uniform list — every row `outlined`, the
          // default marked by the resting key-view ring (seeded at open).
          // Compact inline choices keep the recommended-default `primary` look.
          const isRich = Boolean(choice.description || choice.icon);
          const defaultEmphasis: TugButtonEmphasis = isRich
            ? "outlined"
            : i === defaultIndex
              ? "primary"
              : "outlined";
          return {
            key: choice.id,
            order: i + 1,
            label: choice.label,
            description: choice.description,
            icon: choice.icon,
            emphasis: choice.emphasis ?? defaultEmphasis,
            role: choice.role ?? "action",
            isDefault: i === defaultIndex,
            onClick: () => resolveAndClose(choice.id),
          };
        });
      }
      return [
        {
          key: "__confirm__",
          order: 1,
          label: confirmLabel,
          emphasis: confirmRole === "action" ? "primary" : "filled",
          role: confirmRole,
          isDefault: true,
          onClick: onConfirmClick,
        },
      ];
      // onConfirmClick is a stable closure over refs; safe to omit.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, override?.choices, confirmLabel, confirmRole, resolveAndClose]);

    // Rich rows: a chooser whose choices carry an icon or description renders as
    // a vertical stack of list rows (leading icon + title + description) with
    // Cancel below, rather than a compact right-aligned button row.
    const richRows =
      mode === "choose" && actionButtons.some((b) => b.description || b.icon);

    // ---- Focus language ([P14]/[P22]/[P23]) ----
    // Author Cancel + every action button into a focus group so Tab walks them,
    // declare a closed arrow ring over the whole row (registered inside the
    // trap's FocusModeScope by AlertSpatialOrder), and seed the engine key view
    // on the default button at open — the ring rests there and the default
    // button promotes to its live/filled style ([P14]). Danger keeps Return
    // safe by defaulting to Cancel when present.
    const focusManager = useFocusManager();
    const buttonFocusGroup = React.useId();
    const actionCount = actionButtons.length;
    // In rich-row mode Cancel sits below the rows (last in the ring); otherwise
    // it leads the button row (order 0). The ring nodes are listed in visual
    // order so an arrow roves them in reading order.
    const richCancelOrder = actionCount + 1;
    const effectiveCancelOrder = richRows ? richCancelOrder : CANCEL_ORDER;
    const buttonSpatialOrder = React.useMemo<SpatialOrder>(() => {
      const actionOrders = Array.from({ length: actionCount }, (_, i) => i + 1);
      const orders = richRows
        ? [...actionOrders, ...(hasCancel ? [richCancelOrder] : [])]
        : [...(hasCancel ? [CANCEL_ORDER] : []), ...actionOrders];
      const nodes = orders.map((o) => `${buttonFocusGroup}:${o}`);
      return {
        rings: [
          { axis: "horizontal", nodes, closed: true },
          { axis: "vertical", nodes, closed: true },
        ],
      };
    }, [buttonFocusGroup, hasCancel, actionCount, richRows, richCancelOrder]);
    // The order the key view rests on at open: Cancel for a danger confirm (so
    // Return can't destroy), otherwise the default action button / row.
    const defaultButtonOrder =
      mode === "confirm" && confirmRole === "danger" && hasCancel
        ? CANCEL_ORDER
        : (actionButtons.find((b) => b.isDefault)?.order ?? effectiveCancelOrder);
    const handleOpenAutoFocus = React.useCallback(
      (event: Event) => {
        // Stop Radix's own first-focusable walk; the engine drives focus.
        event.preventDefault();
        focusManager?.armKeyboardRestore(`${buttonFocusGroup}:${defaultButtonOrder}`);
      },
      [focusManager, buttonFocusGroup, defaultButtonOrder],
    );

    // IMPORTANT: Never clear overrideRef during close. The exit animation
    // needs the override values to stay so the content doesn't revert to
    // singleton defaults while fading out. Overrides are cleared on next open
    // (the imperative alert() sets fresh overrides before opening).

    // Radix-level dismissal (Escape via DismissableLayer, Cmd+. via
    // onKeyDown, AlertDialog.Cancel/Action built-in close) routes
    // through here. Convert any open→false transition to a cancel so
    // the pending promise resolves with false. The cancel-and-close is
    // idempotent, so Radix's own close after a chain-dispatched
    // confirm is a no-op.
    function handleOpenChange(nextOpen: boolean) {
      if (!nextOpen) {
        resolveAndClose(false);
        return;
      }
      setOpen(nextOpen);
    }

    // Button onClick handlers. Dispatch through the chain (for keyboard/
    // responder consistency) AND resolve directly. The direct call is what
    // makes a click reliable: when this alert is an app-level singleton (e.g.
    // the deck-root one TugLogout opens), the chain's first responder is a
    // card, not this alert, so `sendToFirstResponder` never reaches the
    // handler and only Radix's built-in Action/Cancel close fires — which
    // resolves `false` for *both* buttons. `resolveAndClose` is idempotent, so
    // if the chain did reach the handler first, the direct call is a no-op.
    function onConfirmClick() {
      manager?.sendToFirstResponder({
        action: TUG_ACTIONS.CONFIRM_DIALOG,
        sender: senderId,
        phase: "discrete",
      });
      handleConfirmAction();
    }

    function onCancelClick() {
      manager?.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: senderId,
        phase: "discrete",
      });
      handleCancelAction();
    }

    return (
      <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
        <AlertDialog.Portal container={overlayRoot}>
          <AlertDialog.Overlay className="tug-alert-overlay" />
          <AlertDialog.Content
            ref={responderRef as (el: HTMLDivElement | null) => void}
            className="tug-alert-content"
            data-slot="tug-alert"
            onMouseDown={suppressButtonFocusShift}
            // The engine seeds the default button as the key view ([P14]); stop
            // Radix's own first-focusable walk so the two don't fight.
            onOpenAutoFocus={handleOpenAutoFocus}
            // [P03] Suppress Radix's own Escape — the engine's Escape ladder owns
            // it via the trap's `onEscapeDismiss` (above).
            onEscapeKeyDown={(e) => e.preventDefault()}
            // [P06] The trap is the single close-focus DOM writer at teardown.
            onCloseAutoFocus={onCloseAutoFocus}
            onKeyDown={(e) => {
              // Cmd+. dismisses (macOS convention) — treat as cancel. Stays
              // chain-routed; only Escape moved to the engine ladder (#non-goals).
              if (e.metaKey && e.key === ".") {
                e.preventDefault();
                handleOpenChange(false);
              }
            }}
          >
            <FocusModeScope>
            {/* Registers the button-row arrow ring against the alert's trap
                mode. Must mount INSIDE FocusModeScope so the context-form
                `useSpatialOrder` reads the trap scope, not the outer one. */}
            <AlertSpatialOrder order={buttonSpatialOrder} />
            {/* Classic Mac HIG layout: icon left, text right, buttons bottom-right */}
            <div
              className="tug-alert-body"
              data-scale="alert"
              data-has-message={message ? "true" : undefined}
            >
              {IconComponent && (
                <div className="tug-alert-icon" aria-hidden="true">
                  {/* The icon box owns the size (see tugx-header.css); the
                      svg fills it. */}
                  {React.createElement(IconComponent, { size: "100%" })}
                </div>
              )}
              <div className="tug-alert-text">
                <AlertDialog.Title className="tug-alert-title">
                  {title}
                </AlertDialog.Title>
                {message && (
                  <AlertDialog.Description className="tug-alert-message">
                    {message}
                  </AlertDialog.Description>
                )}
              </div>
            </div>
            {richRows ? (
              // Rich chooser: a vertical stack of list rows (leading icon +
              // title + description), each a real button in the arrow ring,
              // with Cancel below.
              <>
                <div className="tug-alert-choices">
                  {actionButtons.map((b) => {
                    const RowIcon = b.icon
                      ? (icons[b.icon as keyof typeof icons] ?? null)
                      : null;
                    const row = (
                      <TugPushButton
                        className="tug-alert-choice"
                        size="sm"
                        emphasis={b.emphasis}
                        role={b.role}
                        onClick={b.onClick}
                        focusGroup={buttonFocusGroup}
                        focusOrder={b.order}
                      >
                        <TugListRow
                          variant="flush"
                          leading={
                            // The rendered size is set in CSS (the base
                            // `.tug-button svg` rule clamps this attribute).
                            RowIcon
                              ? React.createElement(RowIcon, { size: 30 })
                              : undefined
                          }
                          title={typeof b.label === "string" ? b.label : undefined}
                          subtitle={b.description}
                        />
                      </TugPushButton>
                    );
                    return b.isDefault ? (
                      <AlertDialog.Action asChild key={b.key}>
                        {row}
                      </AlertDialog.Action>
                    ) : (
                      <React.Fragment key={b.key}>{row}</React.Fragment>
                    );
                  })}
                </div>
                {hasCancel && (
                  <div className="tug-alert-actions">
                    <AlertDialog.Cancel asChild>
                      <TugPushButton
                        size="sm"
                        emphasis="outlined"
                        onClick={onCancelClick}
                        focusGroup={buttonFocusGroup}
                        focusOrder={effectiveCancelOrder}
                      >
                        {cancelLabel}
                      </TugPushButton>
                    </AlertDialog.Cancel>
                  </div>
                )}
              </>
            ) : (
              <div className="tug-alert-actions">
                {hasCancel && (
                  <AlertDialog.Cancel asChild>
                    <TugPushButton
                      size="sm"
                      emphasis="outlined"
                      onClick={onCancelClick}
                      focusGroup={buttonFocusGroup}
                      focusOrder={CANCEL_ORDER}
                    >
                      {cancelLabel}
                    </TugPushButton>
                  </AlertDialog.Cancel>
                )}
                {actionButtons.map((b) => {
                  const button = (
                    <TugPushButton
                      size="sm"
                      emphasis={b.emphasis}
                      role={b.role}
                      onClick={b.onClick}
                      focusGroup={buttonFocusGroup}
                      focusOrder={b.order}
                    >
                      {b.label}
                    </TugPushButton>
                  );
                  // Exactly one action button is the semantic Radix Action (the
                  // Return default); the rest are plain buttons in the arrow ring.
                  return b.isDefault ? (
                    <AlertDialog.Action asChild key={b.key}>
                      {button}
                    </AlertDialog.Action>
                  ) : (
                    <React.Fragment key={b.key}>{button}</React.Fragment>
                  );
                })}
              </div>
            )}
            </FocusModeScope>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    );
  },
);

/* ---------------------------------------------------------------------------
 * AlertSpatialOrder
 * ---------------------------------------------------------------------------*/

/**
 * Null-rendering registrar for the alert's button-row arrow ring. It must mount
 * INSIDE the alert's `FocusModeScope` so the context-form `useSpatialOrder(order)`
 * resolves the enclosing `FocusModeContext` to the alert's trapped focus mode —
 * calling it in the `TugAlert` body would bind the order to the mode ABOVE the
 * trap. Mirrors `ConfirmPopoverSpatialOrder`. [L03]
 */
function AlertSpatialOrder({ order }: { order: SpatialOrder }): null {
  useSpatialOrder(order);
  return null;
}

/* ---------------------------------------------------------------------------
 * TugAlertContext + TugAlertProvider + useTugAlert
 * ---------------------------------------------------------------------------*/

/** Shape of the context value provided by TugAlertProvider. */
interface TugAlertContextValue {
  showAlert: (options?: {
    title?: string;
    message?: string | React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string | null;
    confirmRole?: TugButtonRole;
    /** Lucide icon name override. Defaults to role-based icon. */
    icon?: string;
  }) => Promise<boolean>;
}

const TugAlertContext = React.createContext<TugAlertContextValue | null>(null);

/** Props for TugAlertProvider. */
export interface TugAlertProviderProps {
  children: React.ReactNode;
}

/**
 * TugAlertProvider — mounts a singleton TugAlert and exposes showAlert()
 * via the useTugAlert() hook to all descendant components.
 *
 * Mount once in the root render tree, wrapping the main app content.
 */
export function TugAlertProvider({ children }: TugAlertProviderProps) {
  const alertRef = React.useRef<TugAlertHandle>(null);

  const showAlert = React.useCallback(
    (options?: {
      title?: string;
      message?: string | React.ReactNode;
      confirmLabel?: string;
      cancelLabel?: string | null;
      confirmRole?: TugButtonRole;
      icon?: string;
    }) => {
      if (!alertRef.current) {
        return Promise.resolve(false);
      }
      return alertRef.current.alert(options);
    },
    [],
  );

  const contextValue = React.useMemo(() => ({ showAlert }), [showAlert]);

  return (
    <TugAlertContext.Provider value={contextValue}>
      {children}
      {/* Singleton TugAlert — rendered after children so it layers above them */}
      <TugAlert
        ref={alertRef}
        title=""
        confirmLabel="OK"
        cancelLabel="Cancel"
        confirmRole="action"
      />
    </TugAlertContext.Provider>
  );
}

/**
 * useTugAlert — returns a showAlert function that opens the singleton TugAlert.
 *
 * Must be used inside a TugAlertProvider.
 *
 * @example
 * ```tsx
 * const showAlert = useTugAlert();
 * const confirmed = await showAlert({ title: "Delete Card", confirmRole: "danger" });
 * ```
 */
export function useTugAlert(): (options?: {
  title?: string;
  message?: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string | null;
  confirmRole?: TugButtonRole;
  icon?: string;
}) => Promise<boolean> {
  const ctx = React.useContext(TugAlertContext);
  if (!ctx) {
    throw new Error("useTugAlert must be used within a TugAlertProvider");
  }
  return ctx.showAlert;
}
