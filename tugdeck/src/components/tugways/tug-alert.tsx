/**
 * TugAlert — App-modal dialog for critical interruptions requiring explicit user response.
 *
 * Wraps @radix-ui/react-alert-dialog. Supports imperative Promise-based API
 * (via TugAlertHandle.alert()) and declarative controlled usage. TugAlertProvider
 * mounts a singleton instance in the root tree; useTugAlert() provides access
 * from any component.
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide,
 *       [L20] token sovereignty (composes TugButton)
 */

import "./tug-alert.css";

import React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { icons } from "lucide-react";
import { TugPushButton } from "./tug-push-button";
import type { TugButtonRole } from "./internal/tug-button";

/* ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------*/

/** Map confirmRole to a default Lucide icon name (PascalCase — matches lucide-react `icons` keys). */
function defaultIconForRole(role: TugButtonRole): string {
  if (role === "danger" || role === "caution") {
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
   * Controlled open state.
   * @selector [data-state]
   */
  open?: boolean;
  /** Open state callback. */
  onOpenChange?: (open: boolean) => void;
  /** Confirm callback (declarative API). */
  onConfirm?: () => void;
  /** Cancel callback (declarative API). */
  onCancel?: () => void;
}

/* ---------------------------------------------------------------------------
 * TugAlert
 * ---------------------------------------------------------------------------*/

/**
 * TugAlert — app-modal dialog composing Radix AlertDialog.
 *
 * Use `ref.current.alert()` for the imperative Promise API, or
 * supply `onConfirm`/`onCancel` for the declarative callback pattern.
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
      open: openProp,
      onOpenChange,
      onConfirm,
      onCancel,
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

    // Controlled open: if openProp is provided, use it; otherwise use internal state.
    const isOpen = openProp !== undefined ? openProp : open;

    // IMPORTANT: Never clear overrideRef during close. The exit animation
    // needs the override values to stay so the content doesn't revert to
    // singleton defaults while fading out. Overrides are cleared on next open
    // (the imperative alert() sets fresh overrides before opening).

    function handleConfirm() {
      if (resolverRef.current) {
        resolverRef.current(true);
        resolverRef.current = null;
      }
      setOpen(false);
      onOpenChange?.(false);
      onConfirm?.();
    }

    function handleCancel() {
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
      setOpen(false);
      onOpenChange?.(false);
      onCancel?.();
    }

    function handleOpenChange(nextOpen: boolean) {
      if (!nextOpen) {
        // Escape or programmatic close — treat as cancel.
        if (resolverRef.current) {
          resolverRef.current(false);
          resolverRef.current = null;
        }
        onCancel?.();
      }
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    }

    return (
      <AlertDialog.Root open={isOpen} onOpenChange={handleOpenChange}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="tug-alert-overlay" />
          <AlertDialog.Content
            className="tug-alert-content"
            data-slot="tug-alert"
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
                  <TugPushButton emphasis="ghost" onClick={handleCancel}>
                    {cancelLabel}
                  </TugPushButton>
                </AlertDialog.Cancel>
              )}
              <AlertDialog.Action asChild>
                <TugPushButton
                  emphasis="filled"
                  role={confirmRole}
                  onClick={handleConfirm}
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
