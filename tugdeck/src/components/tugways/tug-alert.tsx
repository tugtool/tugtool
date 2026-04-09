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
 * confirm button, the cancel button, Escape, or Cmd+.
 *
 * Laws: [L06] appearance via CSS,
 *       [L11] controls emit actions; responders handle actions,
 *       [L16] pairings declared,
 *       [L19] component authoring guide,
 *       [L20] token sovereignty (composes TugButton)
 */

import "./tug-alert.css";

import React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { icons } from "lucide-react";
import { TugPushButton } from "./tug-push-button";
import type { TugButtonRole } from "./internal/tug-button";
import { suppressButtonFocusShift } from "./internal/safari-focus-shift";
import { useResponderChain } from "./responder-chain-provider";
import { useOptionalResponder } from "./use-responder";

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
    const [open, setOpen] = React.useState(false);

    // Override options set by the imperative alert() call.
    const overrideRef = React.useRef<{
      title?: string;
      message?: string | React.ReactNode;
      confirmLabel?: string;
      cancelLabel?: string | null;
      confirmRole?: TugButtonRole;
      icon?: string;
    } | null>(null);

    // Resolver for imperative mode. Null when not in an active promise.
    const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

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
    const resolveAndClose = React.useCallback((value: boolean) => {
      if (resolverRef.current) {
        resolverRef.current(value);
        resolverRef.current = null;
      }
      setOpen(false);
    }, []);

    const handleConfirmAction = React.useCallback(() => {
      resolveAndClose(true);
    }, [resolveAndClose]);

    const handleCancelAction = React.useCallback(() => {
      resolveAndClose(false);
    }, [resolveAndClose]);

    // Register the alert as a chain responder so the buttons inside
    // the portaled content can dispatch confirmDialog / cancelDialog
    // and have the walk land back here. Tolerant of no-provider
    // contexts.
    const { responderRef } = useOptionalResponder({
      id: responderId,
      actions: {
        confirmDialog: handleConfirmAction,
        cancelDialog: handleCancelAction,
      },
    });

    React.useImperativeHandle(ref, () => ({
      alert(options) {
        return new Promise<boolean>((resolve) => {
          overrideRef.current = options ?? null;
          resolverRef.current = resolve;
          setOpen(true);
        });
      },
    }));

    // Resolve effective values: override (imperative) takes precedence over props.
    const override = overrideRef.current;
    const title = override?.title ?? titleProp;
    const message = override?.message ?? messageProp;
    const confirmLabel = override?.confirmLabel ?? confirmLabelProp;
    const cancelLabel = override !== undefined && "cancelLabel" in (override ?? {})
      ? override?.cancelLabel
      : cancelLabelProp;
    const confirmRole = override?.confirmRole ?? confirmRoleProp;
    const iconName = override !== undefined && "icon" in (override ?? {})
      ? override?.icon
      : iconProp;

    // Resolve icon component: explicit name, role-based default, or nothing if "".
    const resolvedIconName = iconName !== undefined
      ? iconName
      : defaultIconForRole(confirmRole);

    const IconComponent = resolvedIconName
      ? (icons[resolvedIconName as keyof typeof icons] ?? null)
      : null;

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

    // Button onClick handlers. Normal path: dispatch through the
    // chain, which walks back to the alert's own responder handler.
    // No-provider fallback: call the primary handler directly.
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
      <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="tug-alert-overlay" />
          <AlertDialog.Content
            ref={responderRef as (el: HTMLDivElement | null) => void}
            className="tug-alert-content"
            data-slot="tug-alert"
            onMouseDown={suppressButtonFocusShift}
            onKeyDown={(e) => {
              // Cmd+. dismisses (macOS convention) — treat as cancel.
              if (e.metaKey && e.key === ".") {
                e.preventDefault();
                handleOpenChange(false);
              }
            }}
          >
            {/* Classic Mac HIG layout: icon left, text right, buttons bottom-right */}
            <div className="tug-alert-body">
              {IconComponent && (
                <div className="tug-alert-icon" aria-hidden="true">
                  {React.createElement(IconComponent, { size: 48 })}
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
            <div className="tug-alert-actions">
              {cancelLabel !== null && (
                <AlertDialog.Cancel asChild>
                  <TugPushButton emphasis="outlined" onClick={onCancelClick}>
                    {cancelLabel}
                  </TugPushButton>
                </AlertDialog.Cancel>
              )}
              <AlertDialog.Action asChild>
                <TugPushButton
                  emphasis="filled"
                  role={confirmRole}
                  onClick={onConfirmClick}
                >
                  {confirmLabel}
                </TugPushButton>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    );
  },
);

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
